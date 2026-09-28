/**
 * src/client/macos.ts — macOS 原生 SSE 交付模式（EventSource + Draft 挂载 + 聚焦）。
 *
 * 权威依据：docs/technical.md Phase 5；传输为宿主 SSE 通道（与 Windows 的
 * HTTP 长轮询合同不同，不得交叉套用）。
 */

import type { AppshotReadyFrame } from '../macos/sse.ts'
import type { ImageAttachmentRef } from '../shared/types.ts'
import { mainSessionId, type AppshotClientCtx } from './context.ts'

export interface ComposerService {
  appendDraft(sessionId: string, ref: ImageAttachmentRef): void
  focus(): void
}

export interface ClientDependencies {
  subscribe(onFrame: (frame: unknown) => void): () => void
  getActiveSessionId(): string | null
  composer: ComposerService
  onNeedSession?: () => void
}

export interface AppshotClient {
  start(): void
  dispose(): void
}

// 纯工厂（保持原签名，tests/phase5-t51 依赖它，勿动）
export function createAppshotClient(deps: ClientDependencies): AppshotClient {
  let unsubscribe: (() => void) | null = null

  const handleFrame = (frame: unknown) => {
    if (!frame || typeof frame !== 'object') return
    const candidate = frame as Partial<AppshotReadyFrame>
    if (candidate.type !== 'appshot/ready') return
    if (!candidate.attachmentRef || typeof candidate.attachmentRef !== 'object') return

    const activeSessionId = deps.getActiveSessionId()
    if (!activeSessionId) {
      deps.onNeedSession?.()
      return
    }

    deps.composer.appendDraft(activeSessionId, candidate.attachmentRef)
    deps.composer.focus()
  }

  return {
    start() {
      if (unsubscribe) return
      unsubscribe = deps.subscribe(handleFrame)
    },
    dispose() {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    },
  }
}

function isReadyFrame(frame: unknown): frame is AppshotReadyFrame {
  if (!frame || typeof frame !== 'object') return false
  const candidate = frame as Partial<AppshotReadyFrame>
  return (
    candidate.type === 'appshot/ready' &&
    !!candidate.attachmentRef &&
    typeof candidate.attachmentRef.attachmentId === 'string' &&
    typeof candidate.attachmentRef.mediaType === 'string'
  )
}

export function applyMacosClient(ctx: AppshotClientCtx) {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    console.warn('[dsh-plugin-appshot:client] no browser EventSource; client half disabled')
    return
  }

  const es = new EventSource('/plugins/appshot/events')
  es.addEventListener('open', () => {
    console.log('[dsh-plugin-appshot:client] SSE open', es.url)
  })

  const handleFrame = async (frame: unknown) => {
    if (!isReadyFrame(frame)) return

    const sessionId = mainSessionId(ctx.sessions.list.getSnapshot())
    const scope = sessionId === undefined ? undefined : ctx.sessions.scope(sessionId)
    console.log('[dsh-plugin-appshot:client] ready frame', {
      sessionId: sessionId ?? null,
      dataBase64Chars: frame.dataBase64?.length ?? 0,
    })
    if (sessionId === undefined || scope === undefined) {
      console.warn('[dsh-plugin-appshot:client] no main session; attachment saved on host, not mounted')
      return
    }

    const input = ctx.conversation.input.for(scope)
    if (!frame.dataBase64) {
      input.notify('error', '截图帧缺少图像字节，无法挂载草稿')
      return
    }

    try {
      const bytes = Uint8Array.from(atob(frame.dataBase64), (c) => c.charCodeAt(0))
      const file = new File([bytes], frame.attachmentRef.name ?? '窗口截图.png', {
        type: frame.attachmentRef.mediaType,
      })
      const [draft] = ctx.conversation.createDrafts(sessionId, [file])
      if (draft === undefined) return
      const accepted = input.addAttachments([draft.id])
      if (!accepted) {
        input.notify('info', 'Composer 繁忙，截图已保存为附件，未挂入草稿')
        return
      }
      console.log('[dsh-plugin-appshot:client] draft image mounted:', draft.id)
      input.focus()
    } catch (err) {
      input.notify('error', `截图挂载失败: ${String(err)}`)
    }
  }

  es.addEventListener('appshot/ready', (event) => {
    const msg = event as MessageEvent
    try {
      void handleFrame(JSON.parse(msg.data))
    } catch (err) {
      console.error('[dsh-plugin-appshot:client] failed to parse SSE event:', err)
    }
  })

  es.onerror = () => {
    console.warn('[dsh-plugin-appshot:client] SSE connection error (will auto-reconnect)')
  }

  ctx.effect(() => {
    return () => {
      es.close()
    }
  })
}
