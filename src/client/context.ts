/**
 * src/client/context.ts — Client 插件共享的 Renderer 运行时类型面。
 *
 * 运行时类型：镜像自宿主包 .d.ts 的本地收窄面（禁 any/@ts-ignore）
 * 证据：dsh-client-runtime/lib/types/client/{sessions/service,session/contract}.d.ts
 *       dsh-client-ui-conversation/lib/types/client/{service,contract/slots,input/contract}.d.ts
 *       dsh-client-ui-slots/lib/types/client/contract/slots.d.ts
 */

export interface SessionInputFacade {
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): boolean
  notify(level: 'info' | 'error', text: string): void
  focus(): void
  readonly snapshot: { readonly attachmentIds: readonly string[] }
}

export interface ConversationFace {
  input: {
    /** 解析某会话作用域 ctx 的输入机 */
    for(actx: unknown): SessionInputFacade
  }
  /** 按会话登记浏览器草稿。图片 MIME 成为输入框预览，不进入会话日志。 */
  createDrafts(sessionId: string, files: readonly File[]): readonly { id: string }[]
  /** 解析仍存活的草稿描述符。 */
  resolveDraftAttachments(ids: readonly string[]): readonly unknown[]
  /** 释放草稿与 object URL。 */
  releaseDraftAttachment(id: string): void
}

/** 一行会话列表。主界面正在显示的会话由 `retainedBy.mainView` 标记。 */
export interface SessionListRow {
  id: string
  retainedBy?: { mainView?: number }
}

export interface SessionListSnapshot {
  byId: Record<string, SessionListRow>
  ids?: readonly string[]
}

/** 主界面正在显示的会话。列表快照没有 `current`。 */
export function mainSessionId(snapshot: SessionListSnapshot): string | undefined {
  return Object.values(snapshot.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
}

export interface SlotsService {
  inject(name: string, factory: () => unknown): void
  register(descriptor: {
    name: string
    id: string
    order?: number
    label?: () => string
    inject?: () => unknown
  }, component: unknown): unknown
}

export interface AppshotClientCtx {
  sessions: {
    list: { getSnapshot(): SessionListSnapshot }
    /** 已保留会话的作用域。未保留时为 undefined。 */
    scope(id: string): unknown | undefined
  }
  conversation: ConversationFace
  slots?: SlotsService
  effect(fn: () => () => void): void
}
