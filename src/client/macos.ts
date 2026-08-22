/**
 * src/client/macos.ts — macOS 原生 SSE 交付模式（EventSource + Draft 挂载 + 聚焦）。
 *
 * 权威依据：docs/technical.md Phase 5；传输为宿主 SSE 通道（与 Windows 的
 * HTTP 长轮询合同不同，不得交叉套用）。
 */

import type { AppshotReadyFrame } from '../macos/sse.ts'
import type { ImageAttachmentRef } from '../shared/types.ts'
import type { AppshotClientCtx } from './context.ts'

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

  const handleFrame = async (frame: unknown) => {
    if (!isReadyFrame(frame)) return

    const current = ctx.sessions.list.getSnapshot().current
    if (!current) {
      console.warn('[dsh-plugin-appshot:client] no active session; attachment saved on host, not mounted')
      return
    }

    const binding = ctx.sessions.binding(current)
    if (!binding) {
      console.warn('[dsh-plugin-appshot:client] active session binding unavailable:', current)
      return
    }

    if (!frame.dataBase64) {
      ctx.conversation.input.for(binding.ctx).notify('error', '截图帧缺少图像字节，无法挂载草稿')
      return
    }

    try {
      const bytes = Uint8Array.from(atob(frame.dataBase64), (c) => c.charCodeAt(0))
      const file = new File([bytes], frame.attachmentRef.name ?? '窗口截图.png', {
        type: frame.attachmentRef.mediaType,
      })
      const [draft] = ctx.conversation.createDraftImages([file])
      const accepted = ctx.conversation.input.for(binding.ctx).addImages([draft.id])
      if (!accepted) {
        ctx.conversation.input.for(binding.ctx).notify('info', 'Composer 繁忙，截图已保存为附件，未挂入草稿')
        return
      }
      console.log('[dsh-plugin-appshot:client] draft image mounted:', draft.id)

      if (typeof window !== 'undefined') {
        window.focus()
      }
      const input = document.querySelector('textarea, [contenteditable="true"]') as HTMLElement | null
      input?.focus()
    } catch (err) {
      ctx.conversation.input.for(binding.ctx).notify('error', `截图挂载失败: ${String(err)}`)
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
