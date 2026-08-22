/**
 * W4 E2E 探针：确认插件 bundle 在 Renderer 内注册，并验证 Host session 路由可达。
 * 用法：node scripts/w4-e2e-probe.ts
 */
import { connectCdp } from './cdp.ts'

const cdp = await connectCdp(9222)

const boot = await cdp.evaluate(`(() => { const b = window.__DSH_BOOT__; const e = b?.entries?.find(x => x.id === 'dsh-plugin-appshot'); return JSON.stringify(e ? { rev: e.rev, inject: e.inject } : 'not found') })()`)
console.log('boot appshot:', boot)

// 检查 Host 路由（session）
const route = await cdp.evaluate(`(async () => { try { const res = await fetch(location.origin + '/plugins/appshot/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-probe', clientInstanceId: 'client-probe' }) }); return res.status + ':' + await res.text() } catch (e) { return 'ERR ' + e } })()`)
console.log('session route:', route)

cdp.close()
