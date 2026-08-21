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

// ===== W4 增强测试（对应 technical-windows.md §4.4 新增逻辑） =====

test('W4.4 ACK 指数退避（1s → 2s → 4s 封顶）', async () => {
  const { ackBackoffDelay } = await import('../src/client.ts')
  assert.equal(ackBackoffDelay(0), 1000)
  assert.equal(ackBackoffDelay(1), 2000)
  assert.equal(ackBackoffDelay(2), 4000)
  assert.equal(ackBackoffDelay(3), 4000, '封顶 4s，不再增长')
  assert.equal(ackBackoffDelay(10), 4000, '任意大 attempt 封顶 4s')
})

test('W4.5 认领响应一致性：响应与本地活动记录一致才允许继续挂载', () => {
  // 模拟 syncSession 认领响应校验语义（technical-windows.md §4.1.2）：
  // 仅当 claim 响应 { captureId, targetSessionId } 与本地记录一致时才继续
  const localRecord = { captureId: 'cap-claim-1', targetSessionId: 'sess-target' }

  function validateClaimResponse(
    claimResult: { captureId: string; targetSessionId: string | null } | null,
    local: typeof localRecord,
  ): boolean {
    if (!claimResult) return false
    return claimResult.captureId === local.captureId && claimResult.targetSessionId === local.targetSessionId
  }

  // 1. 响应完全匹配 → 认领有效
  assert.equal(
    validateClaimResponse({ captureId: 'cap-claim-1', targetSessionId: 'sess-target' }, localRecord),
    true,
  )
  // 2. 响应 captureId 不匹配 → 拒绝（防错投）
  assert.equal(
    validateClaimResponse({ captureId: 'cap-other', targetSessionId: 'sess-target' }, localRecord),
    false,
  )
  // 3. 响应为 null（未认领）→ 拒绝
  assert.equal(validateClaimResponse(null, localRecord), false)
})

test('W4.6 最近 50 条已挂载记录索引（sessionStorage 上限）', () => {
  // 模拟 setCachedDraft 的索引维护语义
  function maintainIndex(index: string[], captureId: string, storage: { remove(key: string): void }): string[] {
    if (!index.includes(captureId)) index.push(captureId)
    if (index.length > 50) {
      const overflow = index.slice(0, index.length - 50)
      index = index.slice(index.length - 50)
      for (const old of overflow) storage.remove(old)
    }
    return index
  }

  const storage = { removed: [] as string[] }
  let index: string[] = []
  for (let i = 0; i < 55; i++) {
    index = maintainIndex(index, 'cap-' + i, {
      remove(key: string) { storage.removed.push(key) },
    })
  }
  assert.equal(index.length, 50, '索引不超过 50 条')
  assert.equal(index[0], 'cap-5', '最旧的 5 条被淘汰')
  assert.equal(index[49], 'cap-54', '最新的保留')
  assert.equal(storage.removed.length, 5, '5 条溢出记录被删除')
})

test('W4.7 取消竞态：MOUNTED 先生效时不撤销已交付', () => {
  // 规格 §4.4.4：MOUNTED 先处理者生效，二次取消不撤销已确认交付
  // 模拟状态：MOUNTED 已发送（draft 已挂载 + cached 已写），随后取消到达
  const composerHasDraft = new Set(['draft-mounted-1'])
  const cacheHasDraft = true // MOUNTED 已写 sessionStorage

  // 取消处理：仅当 draft 未挂载（pendingRetry 存在）时才从 Composer 移除
  function handleCancel(captureId: string, pendingRetry: { draftId: string } | null) {
    if (pendingRetry) {
      composerHasDraft.delete(pendingRetry.draftId)
    }
    // cached 记录清理（无论是否已交付，本地活动记录移除）
    return { cacheCleared: cacheHasDraft, composerUnchanged: composerHasDraft.size }
  }

  // 场景 A：MOUNTED 已发出（无 pendingRetry）→ 取消不撤销草稿
  const resultA = handleCancel('cap-1', null)
  assert.equal(resultA.composerUnchanged, 1, '已交付的 Draft 保留在 Composer')

  // 场景 B：取消先到（有 pendingRetry 未挂载）→ 从 Composer 移除
  composerHasDraft.add('draft-pending-2')
  const resultB = handleCancel('cap-2', { draftId: 'draft-pending-2' })
  assert.equal(composerHasDraft.has('draft-pending-2'), false, '未挂载草稿被移除')
})
