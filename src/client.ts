import type { AppshotReadyFrame } from './sse.ts'
import type { ImageAttachmentRef } from './types.ts'

export interface ComposerService {
  appendDraft(sessionId: string, ref: ImageAttachmentRef): void
  focus(): void
}

export interface AppshotClientDependencies {
  subscribe(listener: (frame: AppshotReadyFrame) => void): () => void
  getActiveSessionId(): string | null
  composer: ComposerService
  onNeedSession?: () => void
}

export interface AppshotClient {
  start(): void
  dispose(): void
}

export function createAppshotClient(deps: AppshotClientDependencies): AppshotClient {
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
    start(): void {
      if (unsubscribe) return
      unsubscribe = deps.subscribe(handleFrame)
    },
    dispose(): void {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    },
  }
}
