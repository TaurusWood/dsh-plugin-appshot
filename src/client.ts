/**
 * src/client.ts — DSH Client 插件入口（平台分流 + 公开面）。
 *
 * - Windows：HTTP 长轮询 + 静默 Draft（src/client/windows.ts）
 * - macOS：SSE + 原生唤起（src/client/macos.ts）
 * - 设置面板（src/client/settings.ts）、W0 真机验证（src/client/w0.ts）
 */

import type { AppshotClientCtx } from './client/context.ts'
import { isWindowsPlatform, applyWindowsClient } from './client/windows.ts'
import { applyMacosClient } from './client/macos.ts'
import { AppshotSettingsSection } from './client/settings.ts'
import { runW0DraftVerify } from './client/w0.ts'

export const inject = ['sessions', 'conversation', 'slots']

export function apply(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] client plugin applying...')

  // ===== W0 真机验证钩子（仅 sessionStorage['w0-verify']==='1' 时激活；生产默认关闭） =====
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('w0-verify') === '1') {
    void runW0DraftVerify(ctx).catch((err) => {
      console.error('[dsh-plugin-appshot:client] W0 verify failed:', err)
    })
  }

  // 1. 注册 DSH 设置面板中的 "截图 (Appshot)" 配置项
  if (ctx.slots?.inject) {
    try {
      ctx.slots.inject('settings.section', () =>
        ctx.slots!.register(
          {
            name: 'settings.section',
            id: 'appshot',
            order: 120,
            label: () => '截图 (Appshot)',
            inject: () => ({}),
          },
          AppshotSettingsSection,
        ),
      )
      console.log('[dsh-plugin-appshot:client] settings section registered into DSH Settings shell')
    } catch (err) {
      console.warn('[dsh-plugin-appshot:client] failed to register settings section:', err)
    }
  }

  // 2. 平台分流交付：Windows 走自建 HTTP 长轮询 + 静默 Draft，macOS 走 SSE + 原生唤起
  if (isWindowsPlatform()) {
    applyWindowsClient(ctx)
  } else {
    applyMacosClient(ctx)
  }

  console.log('[dsh-plugin-appshot:client] client plugin applied successfully')
}

// ── 公开面（与既有导出保持一致） ─────────────────────────────────────────
export { createAppshotClient } from './client/macos.ts'
export type { ComposerService, ClientDependencies, AppshotClient } from './client/macos.ts'
export { applyMacosClient } from './client/macos.ts'
export { applyWindowsClient, ackBackoffDelay, isWindowsPlatform } from './client/windows.ts'
export { AppshotSettingsSection } from './client/settings.ts'
export { runW0DraftVerify } from './client/w0.ts'
export type { W0VerifyResult } from './client/w0.ts'
export type { AppshotClientCtx } from './client/context.ts'
