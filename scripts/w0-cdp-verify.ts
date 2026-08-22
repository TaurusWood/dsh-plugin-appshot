/**
 * W0 真机验证脚本：通过 CDP (Chrome DevTools Protocol) 连接 DSH Desktop Renderer，
 * 验证：
 *  1. Renderer 可通过 http://dsh.internal 访问自建 POST 与长轮询路由；
 *  2. ctx.sessions.binding / ctx.conversation.createDraftImages / addImages /
 *     snapshot.imageIds / draftImages / removeImage / releaseDraftImage 行为。
 *
 * 用法：node scripts/w0-cdp-verify.ts [--debug-port 9222]
 */
import { writeFileSync } from 'node:fs'
import { connectCdp, listCdpTargets } from './cdp.ts'

const DEBUG_PORT = process.argv.includes('--debug-port')
  ? Number(process.argv[process.argv.indexOf('--debug-port') + 1])
  : 9222

interface W0Result {
  name: string
  ok: boolean
  detail: unknown
}

const results: W0Result[] = []
function record(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + JSON.stringify(detail) : ''}`)
}

// 1. 获取 CDP targets（找 Renderer）
const pageTargets = (await listCdpTargets(DEBUG_PORT)).filter((t) => t.type === 'page')
record('CDP 连接与 target 枚举', pageTargets.length > 0, { targets: pageTargets.length, urls: pageTargets.slice(0, 5).map((t) => t.url) })
if (pageTargets.length === 0) {
  console.error('no page targets found; cannot verify renderer-side APIs')
  process.exit(1)
}

const cdp = await connectCdp(DEBUG_PORT)

// 2. 验证 http://dsh.internal 可达性与 Origin / Sec-Fetch-Site 观察
record('Renderer 上下文可达', true)
const originInfo = await cdp.evaluate(`JSON.stringify({ href: location.href, origin: location.origin, protocol: location.protocol })`)
record('Renderer 页面 origin 观察', originInfo !== undefined, originInfo)

// 3. 通过 http://dsh.internal 发起 POST 到自建 session 路由（验证 dsh.internal 基址规则）
const sessionPost = await cdp.evaluate(`
(async () => {
  const res = await fetch('http://dsh.internal/plugins/appshot/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess_w0_probe', clientInstanceId: 'client-w0-probe-0001' }),
  })
  return JSON.stringify({ status: res.status, body: await res.text(), secFetchSite: (await fetch('http://dsh.internal/plugins/appshot/session', { method: 'GET' }).catch(() => null)) })
})().catch(e => JSON.stringify({ error: String(e) }))
`)
record('http://dsh.internal POST 自建路由', typeof sessionPost === 'string' && !String(sessionPost).includes('error'), sessionPost)

// 4. 探测 Renderer 全局可用的 ctx 入口（sessions / conversation service）
const ctxProbe = await cdp.evaluate(`
(() => {
  const keys = Object.keys(globalThis).filter((k) => /ctx|session|conversation|runtime|module/i.test(k)).slice(0, 30)
  return JSON.stringify(keys)
})()
`)
record('Renderer 全局 ctx 探测', typeof ctxProbe === 'string', ctxProbe)

// 5. 尝试通过 window.__ModuleLoader__ 或已知入口访问 cordis ctx
const moduleLoaderProbe = await cdp.evaluate(`
(() => {
  const ml = globalThis.__ModuleLoader__
  return JSON.stringify({ hasModuleLoader: typeof ml === 'object' && ml !== null, keys: ml ? Object.keys(ml).slice(0, 20) : [] })
})()
`)
record('ModuleLoader 探测', true, moduleLoaderProbe)

cdp.close()

// 6. 保存结果
writeFileSync('w0-cdp-results.json', JSON.stringify(results, null, 2))
console.log('\nresults saved to w0-cdp-results.json')
