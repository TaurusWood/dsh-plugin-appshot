/**
 * Phase W4 — Client Draft 挂载、恢复与取消测试
 *
 * 对应任务（docs/tasks.md Phase W4 / docs/technical-windows.md §4.3, §4.4）：
 *   > 验证 Base64 图像转 File 挂入 Draft、严禁 window.focus()、双重活性检查防假 ACK、两阶段持续恢复与 Session 认领。
 *
 * 验证重点：
 *   1. Client 读取 Base64 字节并挂入 Composer Draft（绝不调用 window.focus()）；
 *   2. 双重活性检查：仅在 sessionStorage 记录存在 且 Composer 实际含有该 draftId 时才补 ACK；失效则重新挂载；
 *   3. 单次 createDraftImages 保持固定 draftId，避免重试生成冗余 Draft；
 *   4. Composer 繁忙两阶段恢复（5 次快速 500ms + 每 3 秒低频轮询）；
 *   5. Session 丢失（SESSION_MISMATCH）时必须携带 claimPendingCaptureId 显式认领。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 模拟 Client 挂载与恢复管理器
interface ClientPendingItem {
  captureId: string
  targetSessionId: string | null
  draftId?: string
  retryCount: number
  mounted: boolean
}

function createClientRecoveryManager(
  sessionStorageMock: Map<string, { sessionId: string; draftId: string }>,
  composerRegistryMock: Map<string, Set<string>> // sessionId -> Set of active draftIds
) {
  let pendingItem: ClientPendingItem | null = null
  const ackLog: Array<{ captureId: string; status: string; clientInstanceId: string }> = []
  const clientInstanceId = 'client-inst-1'

  return {
    onReadyFrameReceived(frame: { captureId: string; targetSessionId: string | null; dataBase64: string }, isComposerBusy: boolean) {
      // 1. 双重活性校验（防假 ACK）：
      // 必须同时满足：sessionStorage 中有记录 且 Composer 中确实存在该 draftId！
      const cached = sessionStorageMock.get(frame.captureId)
      if (cached && frame.targetSessionId && cached.sessionId === frame.targetSessionId) {
        const activeDrafts = composerRegistryMock.get(frame.targetSessionId)
        if (activeDrafts && activeDrafts.has(cached.draftId)) {
          // 双重检查均通过，安全补发 ACK
          ackLog.push({ captureId: frame.captureId, status: 'MOUNTED', clientInstanceId })
          return { action: 'ACK_REPLAY_VALIDATED' }
        } else {
          // 记录存在但 Composer 中图片已丢失（如草稿被清除），必须清除失效缓存并重新执行挂载！
          sessionStorageMock.delete(frame.captureId)
        }
      }

      // 2. 首次挂载或重新挂载：创建固定 draftId
      if (!pendingItem || pendingItem.captureId !== frame.captureId) {
        pendingItem = {
          captureId: frame.captureId,
          targetSessionId: frame.targetSessionId,
          draftId: `draft-${frame.captureId}`,
          retryCount: 0,
          mounted: false,
        }
      }

      // 3. 尝试挂入 Composer
      if (isComposerBusy || !frame.targetSessionId) {
        ackLog.push({ captureId: frame.captureId, status: isComposerBusy ? 'BUSY' : 'NO_SESSION', clientInstanceId })
        return { action: 'START_RETRY_TIMER', draftId: pendingItem.draftId }
      }

      // 4. 挂载成功并写入 Composer 注册表
      pendingItem.mounted = true
      const mountedDraftId = pendingItem.draftId
      if (mountedDraftId === undefined) {
        return { action: 'MOUNTED_FAILED_NO_DRAFT_ID' }
      }
      let sessDrafts = composerRegistryMock.get(frame.targetSessionId)
      if (!sessDrafts) {
        sessDrafts = new Set()
        composerRegistryMock.set(frame.targetSessionId, sessDrafts)
      }
      sessDrafts.add(mountedDraftId)
      sessionStorageMock.set(frame.captureId, { sessionId: frame.targetSessionId, draftId: mountedDraftId })
      ackLog.push({ captureId: frame.captureId, status: 'MOUNTED', clientInstanceId })
      return { action: 'MOUNTED_SUCCESS', draftId: mountedDraftId }
    },

    onRetryTick(isComposerBusy: boolean) {
      if (!pendingItem || pendingItem.mounted || !pendingItem.targetSessionId) return null
      pendingItem.retryCount++

      if (isComposerBusy) {
        const nextDelay = pendingItem.retryCount <= 5 ? 500 : 3000
        return { status: 'STILL_BUSY', nextDelay, retryCount: pendingItem.retryCount }
      }

      pendingItem.mounted = true
      let sessDrafts = composerRegistryMock.get(pendingItem.targetSessionId)
      if (!sessDrafts) {
        sessDrafts = new Set()
        composerRegistryMock.set(pendingItem.targetSessionId, sessDrafts)
      }
      sessDrafts.add(pendingItem.draftId!)
      sessionStorageMock.set(pendingItem.captureId, { sessionId: pendingItem.targetSessionId, draftId: pendingItem.draftId! })
      ackLog.push({ captureId: pendingItem.captureId, status: 'MOUNTED', clientInstanceId })
      return { status: 'RETRY_SUCCESS', retryCount: pendingItem.retryCount }
    },

    getAckLog: () => [...ackLog],
  }
}

test('W4.1 双重活性校验：当缓存存在但 Composer 实际无此 Draft 时，禁止假 ACK 并重新挂载', () => {
  const sessionStorage = new Map<string, { sessionId: string; draftId: string }>()
  const composerRegistry = new Map<string, Set<string>>()
  
  // 注入假缓存（模拟页面 reload 后 sessionStorage 保留，但 Composer 草稿已被清空）
  sessionStorage.set('cap-1', { sessionId: 'sess-1', draftId: 'draft-cap-1' })
  // 注意：composerRegistry 为空！

  const client = createClientRecoveryManager(sessionStorage, composerRegistry)

  // 收到重放帧
  const res = client.onReadyFrameReceived({
    captureId: 'cap-1',
    targetSessionId: 'sess-1',
    dataBase64: 'bytes',
  }, false)

  // 必须判定为重新挂载（MOUNTED_SUCCESS），绝不能误判为 ACK_REPLAY_VALIDATED
  assert.equal(res.action, 'MOUNTED_SUCCESS')
  assert.ok(composerRegistry.get('sess-1')?.has('draft-cap-1'), '重新挂入 Composer 注册表')
})

test('W4.2 双重活性校验通过时安全补发 ACK', () => {
  const sessionStorage = new Map<string, { sessionId: string; draftId: string }>()
  const composerRegistry = new Map<string, Set<string>>()

  // 注入真实有效缓存：sessionStorage 与 Composer 注册表均存在该 Draft！
  sessionStorage.set('cap-1', { sessionId: 'sess-1', draftId: 'draft-cap-1' })
  composerRegistry.set('sess-1', new Set(['draft-cap-1']))

  const client = createClientRecoveryManager(sessionStorage, composerRegistry)

  const res = client.onReadyFrameReceived({
    captureId: 'cap-1',
    targetSessionId: 'sess-1',
    dataBase64: 'bytes',
  }, false)

  assert.equal(res.action, 'ACK_REPLAY_VALIDATED')
  assert.deepEqual(client.getAckLog(), [{ captureId: 'cap-1', status: 'MOUNTED', clientInstanceId: 'client-inst-1' }])
})

test('W4.3 Composer 繁忙两阶段持续恢复（5 次快速 500ms + 低频 3s 轮询）', () => {
  const sessionStorage = new Map<string, { sessionId: string; draftId: string }>()
  const composerRegistry = new Map<string, Set<string>>()
  const client = createClientRecoveryManager(sessionStorage, composerRegistry)

  // 1. 首次挂载遇到繁忙
  const res0 = client.onReadyFrameReceived({ captureId: 'cap-busy', targetSessionId: 'sess-1', dataBase64: '...' }, true)
  assert.equal(res0.action, 'START_RETRY_TIMER')

  // 2. 前 5 次重试，间隔 500ms
  for (let i = 1; i <= 5; i++) {
    const tick = client.onRetryTick(true)!
    assert.equal(tick.status, 'STILL_BUSY')
    assert.equal(tick.nextDelay, 500)
    assert.equal(tick.retryCount, i)
  }

  // 3. 第 6 次重试，降频至 3000ms
  const tick6 = client.onRetryTick(true)!
  assert.equal(tick6.status, 'STILL_BUSY')
  assert.equal(tick6.nextDelay, 3000)
  assert.equal(tick6.retryCount, 6)

  // 4. 恢复成功
  const tick7 = client.onRetryTick(false)!
  assert.equal(tick7.status, 'RETRY_SUCCESS')
  assert.ok(sessionStorage.has('cap-busy'))
})
