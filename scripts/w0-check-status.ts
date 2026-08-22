/**
 * W0 状态检查脚本：确认插件加载状态与上次 W0 验证结果留存。
 * 用法：node scripts/w0-check-status.ts
 */
import { connectCdp } from './cdp.ts'

const cdp = await connectCdp(9222)

// 1. 设置面板是否注册成功（slots.settings.section）
const settingsPanel = await cdp.evaluate(`(() => {
  const boot = window.__DSH_BOOT__
  const appshot = boot?.entries.find(e => e.id === 'dsh-plugin-appshot')
  return JSON.stringify(appshot ? { loaded: true, rev: appshot.rev, inject: appshot.inject } : { loaded: false })
})()`)
console.log('插件加载:', settingsPanel)

// 2. w0-results 是否还在（上次验证的 9 项结果）
const w0results = await cdp.evaluate(`(() => {
  const raw = sessionStorage.getItem('w0-results')
  if (!raw) return 'absent'
  const parsed = JSON.parse(raw)
  return JSON.stringify({ present: true, count: parsed.results.length, okCount: parsed.results.filter(r => r.ok).length })
})()`)
console.log('W0 验证结果留存:', w0results)

cdp.close()
