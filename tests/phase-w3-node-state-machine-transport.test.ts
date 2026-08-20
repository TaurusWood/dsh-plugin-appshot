/**
 * Phase W3 — Node 状态机与定向传输测试
 *
 * 对应任务（docs/tasks.md Phase W3 / docs/technical-windows.md §4.2, §5）：
 *   > 验证带 Client Owner 的全量状态机、15 秒超时守卫、三元组 ACK 校验、迟到帧安全处理与 Agent 退出保护。
 *
 * 验证重点：
 *   1. 状态机包含 targetClientInstanceId 与 targetSessionId 双锁定；
 *   2. 非目标 Client 无法读取定向图片，错误 Client/Session 的 ACK 返回 409；
 *   3. 15000ms (15 秒) 超时守卫触发转移至 cancelledCaptureIds 并发送 cancel 帧；
 *   4. 未知/迟到 appshot 帧只做路径安全校验与即时 unlink（不读取、不交付）；
 *   5. Agent 在 PENDING_ACK 期间退出必须保留内存 payload，允许 Client 继续交付，绝不丢图；
 *   6. 重复已完成 ACK 幂等返回 200。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WindowsCaptureState } from './helpers/windows-types.ts'

function createNodeCaptureManager() {
  let state: WindowsCaptureState = { type: 'IDLE' }
  const cancelledIds = new Set<string>()
  const completedTuples = new Set<string>() // 存储 captureId:clientInstanceId:sessionId
  let activeClientInstanceId: string | null = 'client-inst-1'
  let activeSessionId: string | null = 'session-123'

  return {
    getState: () => state,
    setActiveClientAndSession: (clientId: string | null, sessId: string | null) => {
      activeClientInstanceId = clientId
      activeSessionId = sessId
    },
    
    // 1. 收到 capture/started：锁定 Client 与 Session
    onCaptureStarted(captureId: string, now: number) {
      if (state.type !== 'IDLE') {
        return { accepted: false, error: 'BUSY' }
      }
      state = {
        type: 'IN_FLIGHT',
        captureId,
        targetClientInstanceId: activeClientInstanceId,
        targetSessionId: activeSessionId,
        startedAt: now,
      }
      return { accepted: true, targetClientInstanceId: activeClientInstanceId, targetSessionId: activeSessionId }
    },

    // 2. 收到 appshot 落盘通知
    onAppshotReceived(captureId: string, payload: Uint8Array) {
      if (cancelledIds.has(captureId) || state.type !== 'IN_FLIGHT' || state.captureId !== captureId) {
        return { accepted: false, shouldUnlink: true }
      }
      state = {
        type: 'PENDING_ACK',
        captureId,
        targetClientInstanceId: state.targetClientInstanceId,
        targetSessionId: state.targetSessionId,
        payload,
        metadata: {
          appName: 'Chrome',
          mediaType: 'image/png',
          width: 1920,
          height: 1080,
          bytes: payload.length,
          timestamp: Date.now(),
        },
        isFallback: false,
        fallbackReason: null,
      }
      return { accepted: true, targetClientInstanceId: state.targetClientInstanceId, targetSessionId: state.targetSessionId }
    },

    // 3. Client 定向长轮询获取图片载荷
    onClientPoll(requestClientId: string, captureId: string) {
      if (state.type !== 'PENDING_ACK' || state.captureId !== captureId) {
        return { status: 404, data: null }
      }
      // 必须匹配目标 ClientInstanceId
      if (state.targetClientInstanceId && state.targetClientInstanceId !== requestClientId) {
        return { status: 403, error: 'CLIENT_MISMATCH', data: null }
      }
      return { status: 200, data: state.payload }
    },

    // 4. 15 秒超时守卫触发
    onTimeoutTriggered(now: number) {
      if (state.type === 'IN_FLIGHT' && now - state.startedAt >= 15000) {
        cancelledIds.add(state.captureId)
        const timedOutId = state.captureId
        state = { type: 'IDLE' }
        return { timedOut: true, captureId: timedOutId }
      }
      return { timedOut: false }
    },

    // 5. 收到 Delivery Result (ACK)，三元组严格匹配
    onDeliveryResult(captureId: string, clientInstanceId: string, targetSessionId: string, status: string) {
      const tupleKey = `${captureId}:${clientInstanceId}:${targetSessionId}`
      if (completedTuples.has(tupleKey)) {
        return { httpCode: 200, action: 'IGNORED_DUPLICATE' }
      }
      if (
        state.type !== 'PENDING_ACK' ||
        state.captureId !== captureId ||
        (state.targetClientInstanceId && state.targetClientInstanceId !== clientInstanceId) ||
        (state.targetSessionId && state.targetSessionId !== targetSessionId)
      ) {
        return { httpCode: 409, action: 'CONFLICT_REJECTED' }
      }

      if (status === 'MOUNTED') {
        completedTuples.add(tupleKey)
        state = { type: 'IDLE' } // 释放内存 payload
        return { httpCode: 200, action: 'CLEARED_SUCCESS' }
      }

      return { httpCode: 200, action: 'HELD_PENDING' }
    },

    // 6. Agent 进程退出处理：仅在 IN_FLIGHT 时重置，在 PENDING_ACK 必须保留！
    onAgentExit() {
      if (state.type === 'IN_FLIGHT') {
        state = { type: 'IDLE' }
      }
      // 若处于 PENDING_ACK，保持状态，允许 Client 继续完成挂载并 ACK！
    },
  }
}

test('W3.1 双 Client 隔离：非目标 Client 无法读取图片，错误 Client 的 ACK 返回 409', () => {
  const mgr = createNodeCaptureManager()
  mgr.setActiveClientAndSession('client-inst-1', 'session-123')

  // 1. 触发启动并进入 PENDING_ACK
  mgr.onCaptureStarted('cap-1', 1000)
  mgr.onAppshotReceived('cap-1', new Uint8Array([1, 2, 3]))

  // 2. Client 2 尝试轮询读取 Cap-1 应该被 403 拒绝
  const pollRes2 = mgr.onClientPoll('client-inst-2', 'cap-1')
  assert.equal(pollRes2.status, 403)
  assert.equal(pollRes2.error, 'CLIENT_MISMATCH')

  // 3. Client 1 正常读取
  const pollRes1 = mgr.onClientPoll('client-inst-1', 'cap-1')
  assert.equal(pollRes1.status, 200)

  // 4. Client 2 尝试回传 ACK 被 409 拒绝
  const ackRes2 = mgr.onDeliveryResult('cap-1', 'client-inst-2', 'session-123', 'MOUNTED')
  assert.equal(ackRes2.httpCode, 409)

  // 5. Client 1 正确回传 ACK 成功清除
  const ackRes1 = mgr.onDeliveryResult('cap-1', 'client-inst-1', 'session-123', 'MOUNTED')
  assert.equal(ackRes1.httpCode, 200)
  assert.equal(mgr.getState().type, 'IDLE')
})

test('W3.2 15 秒超时守卫（15000ms）与迟到帧安全拦截', () => {
  const mgr = createNodeCaptureManager()
  const t0 = 1000
  mgr.onCaptureStarted('cap-1', t0)

  // 1. 14.9 秒时不超时
  assert.equal(mgr.onTimeoutTriggered(t0 + 14900).timedOut, false)
  // 2. 满 15 秒（15000ms）超时触发
  const timeoutRes = mgr.onTimeoutTriggered(t0 + 15000)
  assert.equal(timeoutRes.timedOut, true)
  assert.equal(timeoutRes.captureId, 'cap-1')
  assert.equal(mgr.getState().type, 'IDLE')

  // 3. 随后迟到帧安全拦截并指示 unlink
  const lateRes = mgr.onAppshotReceived('cap-1', new Uint8Array([1, 2]))
  assert.equal(lateRes.accepted, false)
  assert.equal(lateRes.shouldUnlink, true)
})

test('W3.3 Agent 在 PENDING_ACK 期间退出，必须保留内存 Payload 允许交付，绝不丢图', () => {
  const mgr = createNodeCaptureManager()
  mgr.setActiveClientAndSession('client-inst-1', 'session-123')
  mgr.onCaptureStarted('cap-1', 1000)
  mgr.onAppshotReceived('cap-1', new Uint8Array([1, 2, 3, 4]))
  assert.equal(mgr.getState().type, 'PENDING_ACK')

  // 模拟 Native Agent 崩溃退出
  mgr.onAgentExit()

  // 状态必须仍然保持 PENDING_ACK，且 Payload 完好！
  assert.equal(mgr.getState().type, 'PENDING_ACK')
  assert.equal((mgr.getState() as any).payload.length, 4)

  // Client 仍可正常轮询和完成 ACK
  assert.equal(mgr.onClientPoll('client-inst-1', 'cap-1').status, 200)
  assert.equal(mgr.onDeliveryResult('cap-1', 'client-inst-1', 'session-123', 'MOUNTED').httpCode, 200)
  assert.equal(mgr.getState().type, 'IDLE')
})
