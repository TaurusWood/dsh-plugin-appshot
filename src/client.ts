import type { AppshotReadyFrame } from './sse.ts'
import type { ImageAttachmentRef } from './types.ts'

// ===== 运行时类型：镜像自宿主包 .d.ts 的本地收窄面（禁 any/@ts-ignore）=====
// 证据：dsh-client-runtime/lib/types/client/{sessions/service,session/contract}.d.ts
//       dsh-client-ui-conversation/lib/types/client/{service,contract/slots,input/contract}.d.ts
//       dsh-host-apiproxy/lib/types/api/rpc.d.ts

interface SessionInputFacade {
  addImages(ids: readonly string[]): boolean
  notify(level: 'info' | 'error', text: string): void
}

interface ConversationFace {
  input: {
    /** 解析某会话作用域 ctx 的输入机 */
    for(actx: unknown): SessionInputFacade
  }
  /** 公开面 IConversation 无此方法；运行时 ctx.conversation 即 ConversationController 实例 */
  createDraftImages(files: readonly File[]): readonly { id: string; file: File }[]
}

interface AppshotClientCtx {
  sessions: {
    list: { getSnapshot(): { current: string | undefined } }
    binding(id: string): { ctx: unknown } | undefined
  }
  conversation: ConversationFace
  effect(fn: () => () => void): void
}

// ===== 纯工厂（保持原签名，tests/phase5-t51 依赖它，勿动）=====

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

// ===== 客户端插件入口：真实 Composer 挂载 =====

export const inject = ['sessions', 'conversation']

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

export function apply(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] client plugin applying...')

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

  console.log('[dsh-plugin-appshot:client] client plugin applied successfully')
}
