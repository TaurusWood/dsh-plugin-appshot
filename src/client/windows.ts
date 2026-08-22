/**
 * src/client/windows.ts — Windows Basic Client 交付运行时。
 *
 * 权威依据：docs/technical-windows.md §4（HTTP 长轮询 + 两阶段 Draft 恢复 + 严禁 window.focus）。
 * - 绝对 URL（origin 优先，dsh.internal 仅 origin 缺失时的 fallback）；
 * - sessionStorage 维护 clientInstanceId 与最近 50 条已挂载记录；
 * - 两阶段重试（前 5 次 500ms + 低频 3s）与 ACK 指数退避（1s→2s→4s）；
 * - 无 Session / SESSION_MISMATCH 时挂 pendingClaims，等待用户显式认领。
 */

import type { AppshotClientCtx } from './context.ts'

function appshotUrl(path: string): URL {
  const origin = globalThis.location?.origin
  const base = origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
  return new URL(path, base)
}

/** ACK 指数退避间隔（1s → 2s → 4s 封顶；spec §4.4.3）。纯函数便于单测。 */
export function ackBackoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 4000)
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator !== 'undefined') {
    if (navigator.platform && /win/i.test(navigator.platform)) return true
    if (navigator.userAgent && /windows/i.test(navigator.userAgent)) return true
  }
  if (typeof location !== 'undefined' && location.search && location.search.includes('platform=win32')) {
    return true
  }
  return false
}

function getClientInstanceId(): string {
  if (typeof sessionStorage === 'undefined') return 'client-fallback-id'
  let id = sessionStorage.getItem('dsh-appshot-client-id')
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem('dsh-appshot-client-id', id)
  }
  return id
}

interface DraftCacheRecord {
  captureId: string
  sessionId: string
  draftId: string
  mountedAt: number
}

function getCachedDraft(captureId: string): DraftCacheRecord | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`dsh-appshot-draft-${captureId}`)
    return raw ? (JSON.parse(raw) as DraftCacheRecord) : null
  } catch {
    return null
  }
}

const DRAFT_INDEX_KEY = 'dsh-appshot-draft-index'

function setCachedDraft(captureId: string, record: DraftCacheRecord): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(`dsh-appshot-draft-${captureId}`, JSON.stringify(record))
    // 维护最近 50 条已挂载记录索引（technical-windows.md §4.4.2）
    const rawIndex = sessionStorage.getItem(DRAFT_INDEX_KEY)
    let index: string[] = []
    try {
      const parsed = JSON.parse(rawIndex ?? '[]') as unknown
      if (Array.isArray(parsed)) index = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      index = []
    }
    if (!index.includes(captureId)) index.push(captureId)
    if (index.length > 50) {
      const overflow = index.slice(0, index.length - 50)
      index = index.slice(index.length - 50)
      for (const old of overflow) sessionStorage.removeItem(`dsh-appshot-draft-${old}`)
    }
    sessionStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index))
  } catch {
    // ignore
  }
}

function removeCachedDraft(captureId: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(`dsh-appshot-draft-${captureId}`)
  } catch {
    // ignore
  }
}

export function applyWindowsClient(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] applying windows client runtime (long polling + silent draft)...')
  const clientInstanceId = getClientInstanceId()
  let aborted = false
  let currentSessionId: string | undefined = undefined
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  // 1. Session 同步与上报（POST /plugins/appshot/session）
  //    携带 claimPendingCaptureId 时返回认领响应（technical-windows.md §4.1.2）：
  //    响应 { captureId, targetSessionId } 必须与本地活动记录一致后才允许继续挂载。
  const syncSession = async (claimPendingCaptureId?: string): Promise<
    { captureId: string; targetSessionId: string | null } | null
  > => {
    if (aborted) return null
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (sessionId !== currentSessionId || claimPendingCaptureId) {
      currentSessionId = sessionId
      if (sessionId) {
        try {
          const body: { sessionId: string; clientInstanceId: string; claimPendingCaptureId?: string } = {
            sessionId,
            clientInstanceId,
          }
          if (claimPendingCaptureId) body.claimPendingCaptureId = claimPendingCaptureId
          const res = await fetch(appshotUrl('/plugins/appshot/session').toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (res.status === 200 && claimPendingCaptureId) {
            const data = (await res.json()) as { captureId?: unknown; targetSessionId?: unknown }
            if (typeof data.captureId === 'string' && (typeof data.targetSessionId === 'string' || data.targetSessionId === null)) {
              return { captureId: data.captureId, targetSessionId: data.targetSessionId }
            }
          }
        } catch {
          // ignore network errors
        }
      }
    }
    return null
  }

  // 显式认领：仅当本 Client 有待认领帧 且 用户聚焦了明确 Session 时发送 claim
  // （technical-windows.md §4.1.2：初始化重放、后台心跳或普通 Session 切换不改绑）
  const tryClaimPending = async () => {
    if (aborted || pendingClaims.size === 0) return
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (!sessionId) return
    for (const [captureId] of pendingClaims) {
      const claimResult = await syncSession(captureId)
      if (claimResult && claimResult.captureId === captureId) {
        // 认领成功：仅在响应与本地活动记录一致后继续挂载（由 handleReadyFrame 重新取帧驱动）
        pendingClaims.delete(captureId)
        console.log('[dsh-plugin-appshot:client] claim accepted for', captureId, '->', claimResult.targetSessionId)
      }
    }
  }

  const sessionCheckTimer = setInterval(() => {
    void syncSession()
    void tryClaimPending()
  }, 1000)
  void syncSession()

  // 2. 发送交付结果（POST /plugins/appshot/delivery-result）
  //    指数退避重试（1s → 2s → 4s 封顶，最多 4 次）确保 Node 确认（technical-windows.md §4.4.3）
  const sendDeliveryResult = async (
    captureId: string,
    targetSessionId: string,
    status: 'MOUNTED' | 'BUSY' | 'NO_SESSION' | 'SESSION_MISMATCH',
  ) => {
    let delay = 1000
    for (let attempt = 0; attempt < 4; attempt++) {
      if (aborted) return
      try {
        const res = await fetch(appshotUrl('/plugins/appshot/delivery-result').toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captureId, clientInstanceId, targetSessionId, status }),
        })
        // 200 = 已接受（CLEARED_SUCCESS / IGNORED_DUPLICATE / HELD_PENDING）；409 = 冲突（不再重试）
        if (res.status === 200 || res.status === 409) return
      } catch (err) {
        console.warn('[dsh-plugin-appshot:client] delivery result post failed (attempt ' + attempt + '):', err)
      }
      await new Promise((r2) => setTimeout(r2, delay))
      delay = Math.min(delay * 2, 4000)
    }
    console.warn('[dsh-plugin-appshot:client] delivery result not confirmed after retries:', captureId)
  }

  // 3. 处理 appshot/ready 帧与两阶段重试
  let pendingRetry: {
    captureId: string
    targetSessionId: string
    draftId: string
    retryCount: number
  } | null = null

  // 待认领集合：无 Session / SESSION_MISMATCH 时记录，用户聚焦明确 Session 后显式认领
  // （technical-windows.md §4.1.2：初始化重放、后台心跳或普通 Session 上报不构成认领）
  const pendingClaims = new Map<string, { captureId: string; draftId: string | null }>()

  const scheduleRetry = (captureId: string, targetSessionId: string, draftId: string, count: number) => {
    if (aborted) return
    if (retryTimer) clearTimeout(retryTimer)
    const delay = count <= 5 ? 500 : 3000
    retryTimer = setTimeout(async () => {
      if (aborted || !pendingRetry || pendingRetry.captureId !== captureId) return
      const binding = ctx.sessions.binding(targetSessionId)
      if (!binding) {
        await sendDeliveryResult(captureId, targetSessionId, 'SESSION_MISMATCH')
        return
      }
      try {
        const input = ctx.conversation.input.for(binding.ctx)
        const accepted = input.addImages([draftId])
        if (accepted) {
          setCachedDraft(captureId, { captureId, sessionId: targetSessionId, draftId, mountedAt: Date.now() })
          pendingRetry = null
          await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
        } else {
          pendingRetry.retryCount++
          await sendDeliveryResult(captureId, targetSessionId, 'BUSY')
          scheduleRetry(captureId, targetSessionId, draftId, pendingRetry.retryCount)
        }
      } catch (err) {
        console.error('[dsh-plugin-appshot:client] retry mount failed:', err)
      }
    }, delay)
  }

  const handleReadyFrame = async (frame: {
    captureId: string
    targetClientInstanceId: string
    targetSessionId: string | null
    dataBase64: string
    metadata?: { appName?: string; mediaType?: string }
  }) => {
    if (frame.targetClientInstanceId !== clientInstanceId) return
    const { captureId, targetSessionId, dataBase64 } = frame

    // 1. 无 Session 时记录待认领（等待用户聚焦明确 Session 后显式认领，不改绑）
    if (!targetSessionId) {
      pendingClaims.set(captureId, { captureId, draftId: null })
      await sendDeliveryResult(captureId, '', 'NO_SESSION')
      return
    }

    // 2. 双重活性验证（防假 ACK）
    const cached = getCachedDraft(captureId)
    if (cached && cached.sessionId === targetSessionId) {
      const binding = ctx.sessions.binding(targetSessionId)
      if (binding) {
        const shell = ctx.conversation.input.for(binding.ctx) as unknown as { snapshot?: { imageIds?: readonly string[] } }
        const imageIds = shell.snapshot?.imageIds ?? []
        const activeDrafts = ctx.conversation.draftImages([cached.draftId])
        if (imageIds.includes(cached.draftId) && activeDrafts.length === 1) {
          // 双重验证均通过，安全补发 ACK
          await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
          return
        }
      }
      // 失效缓存，清除重挂载
      removeCachedDraft(captureId)
    }

    // 3. 解析目标 Session Binding
    const binding = ctx.sessions.binding(targetSessionId)
    if (!binding) {
      // 原目标 Session 已删除/改绑：标记待认领（REBIND_REQUIRED），仅允许显式 claim 改绑
      pendingClaims.set(captureId, { captureId, draftId: null })
      await sendDeliveryResult(captureId, targetSessionId, 'SESSION_MISMATCH')
      return
    }

    // 4. 创建 Draft 并静默挂载（不抢焦点、不调用 window.focus）
    try {
      const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0))
      const fileName = `${frame.metadata?.appName ?? 'appshot'}.png`
      const file = new File([bytes], fileName, { type: 'image/png' })
      const [draft] = ctx.conversation.createDraftImages([file])
      if (!draft) return

      const input = ctx.conversation.input.for(binding.ctx)
      const accepted = input.addImages([draft.id])
      if (accepted) {
        setCachedDraft(captureId, { captureId, sessionId: targetSessionId, draftId: draft.id, mountedAt: Date.now() })
        await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
      } else {
        pendingRetry = { captureId, targetSessionId, draftId: draft.id, retryCount: 1 }
        await sendDeliveryResult(captureId, targetSessionId, 'BUSY')
        scheduleRetry(captureId, targetSessionId, draft.id, 1)
      }
    } catch (err) {
      console.error('[dsh-plugin-appshot:client] windows silent mount failed:', err)
    }
  }

  // 4. 用户取消处理（appshot/cancelled）
  const handleCancelledFrame = (captureId: string) => {
    if (pendingRetry && pendingRetry.captureId === captureId) {
      if (retryTimer) clearTimeout(retryTimer)
      const { targetSessionId, draftId } = pendingRetry
      pendingRetry = null
      const binding = ctx.sessions.binding(targetSessionId)
      if (binding) {
        try {
          const input = ctx.conversation.input.for(binding.ctx) as unknown as { removeImage?(id: string): void }
          input.removeImage?.(draftId)
          ctx.conversation.releaseDraftImage(draftId)
        } catch {
          // ignore
        }
      }
    }
    removeCachedDraft(captureId)
    pendingClaims.delete(captureId)
  }

  // 5. 长轮询主循环（GET /plugins/appshot/pending）
  let knownCaptureId: string | null = null
  let knownTargetSessionId: string | null = null
  let backoffDelay = 1000

  const pollLoop = async () => {
    while (!aborted) {
      try {
        const url = appshotUrl('/plugins/appshot/pending')
        url.searchParams.set('clientInstanceId', clientInstanceId)
        if (knownCaptureId) url.searchParams.set('knownCaptureId', knownCaptureId)
        if (knownTargetSessionId) url.searchParams.set('knownTargetSessionId', knownTargetSessionId)

        const res = await fetch(url.toString(), { method: 'GET' })
        backoffDelay = 1000 // 成功收到 HTTP 响应重置退避

        if (res.status === 200) {
          const body = (await res.json()) as Record<string, unknown>
          if (body.type === 'appshot/ready') {
            const readyFrame = body as unknown as Parameters<typeof handleReadyFrame>[0]
            knownCaptureId = readyFrame.captureId
            knownTargetSessionId = readyFrame.targetSessionId
            await handleReadyFrame(readyFrame)
          } else if (body.type === 'appshot/cancelled') {
            const cancelledId = typeof body.captureId === 'string' ? body.captureId : ''
            handleCancelledFrame(cancelledId)
            knownCaptureId = null
            knownTargetSessionId = null
          } else if (body.type === 'appshot/completed') {
            knownCaptureId = null
            knownTargetSessionId = null
          }
        } else if (res.status === 204) {
          // 无 Pending，继续下一轮
        } else if (res.status === 409) {
          knownCaptureId = null
          knownTargetSessionId = null
        }
      } catch {
        if (aborted) break
        // 断线退避（1s → 2s → 4s 封顶）
        await new Promise((r) => setTimeout(r, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, 4000)
      }
    }
  }

  void pollLoop()

  ctx.effect(() => () => {
    aborted = true
    clearInterval(sessionCheckTimer)
    if (retryTimer) clearTimeout(retryTimer)
  })
}
