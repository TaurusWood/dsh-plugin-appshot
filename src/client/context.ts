/**
 * src/client/context.ts — Client 插件共享的 Renderer 运行时类型面。
 *
 * 运行时类型：镜像自宿主包 .d.ts 的本地收窄面（禁 any/@ts-ignore）
 * 证据：dsh-client-runtime/lib/types/client/{sessions/service,session/contract}.d.ts
 *       dsh-client-ui-conversation/lib/types/client/{service,contract/slots,input/contract}.d.ts
 *       dsh-client-ui-slots/lib/types/client/contract/slots.d.ts
 */

export interface SessionInputFacade {
  addImages(ids: readonly string[]): boolean
  notify(level: 'info' | 'error', text: string): void
}

export interface ConversationFace {
  input: {
    /** 解析某会话作用域 ctx 的输入机 */
    for(actx: unknown): SessionInputFacade
  }
  /** 公开面 IConversation 无此方法；运行时 ctx.conversation 即 ConversationController 实例 */
  createDraftImages(files: readonly File[]): readonly { id: string; file: File }[]
  /** 解析仍存活的 Draft 描述符（api-grounded-review.md §3.4 已核实） */
  draftImages(ids: readonly string[]): readonly unknown[]
  /** 释放 Draft 与 object URL（api-grounded-review.md §3.4 已核实） */
  releaseDraftImage(id: string): void
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
    list: { getSnapshot(): { current: string | undefined; ids?: readonly string[] } }
    binding(id: string): { ctx: unknown } | undefined
  }
  conversation: ConversationFace
  slots?: SlotsService
  effect(fn: () => () => void): void
}
