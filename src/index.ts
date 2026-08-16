import type { Context } from '@deepseek-ai/cordis'
import { cleanOrphanStagingFiles } from './staging.ts'
import { createAppshotSSEHub, type AppshotSSEHub } from './sse.ts'
import { ingestScreenshot } from './ingest.ts'
import type { AppshotEventCapture } from './types.ts'

export const name = 'dsh-plugin-appshot'
export const inject = ['attachments', 'webServer', 'sessions']

export interface PluginState {
  sseHub?: AppshotSSEHub
}

let globalState: PluginState = {}

export function apply(ctx: Context) {
  console.log('[dsh-plugin-appshot] plugin applying...')

  // 1. 启动时孤儿文件 GC
  cleanOrphanStagingFiles().catch((err) => {
    console.error('[dsh-plugin-appshot] failed to clean orphan files:', err)
  })

  // 2. 注册 SSE 广播 Hub
  const sseHub = createAppshotSSEHub(ctx as unknown as Parameters<typeof createAppshotSSEHub>[0])
  globalState.sseHub = sseHub

  // 3. 注册清理钩子
  ctx.effect(() => {
    return () => {
      sseHub.dispose()
      globalState.sseHub = undefined
    }
  })

  console.log('[dsh-plugin-appshot] plugin applied successfully')
}

export function dispose(ctx?: Context) {
  if (globalState.sseHub) {
    globalState.sseHub.dispose()
    globalState.sseHub = undefined
  }
  console.log('[dsh-plugin-appshot] plugin disposed')
}

export { cleanOrphanStagingFiles } from './staging.ts'
export { ingestScreenshot } from './ingest.ts'
export { createAppshotSSEHub } from './sse.ts'
export { createAppshotClient } from './client.ts'
export { createNdjsonParser } from './ipc.ts'
export { startAgent } from './agent.ts'
export * from './types.ts'
