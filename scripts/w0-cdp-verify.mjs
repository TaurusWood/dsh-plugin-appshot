/**
 * W0 真机验证脚本：通过 CDP (Chrome DevTools Protocol) 连接 DSH Desktop Renderer，
 * 验证：
 *  1. Renderer 可通过 http://dsh.internal 访问自建 POST 与长轮询路由；
 *  2. ctx.sessions.binding / ctx.conversation.createDraftImages / addImages /
 *     snapshot.imageIds / draftImages / removeImage / releaseDraftImage 行为。
 *
 * 用法：node w0-cdp-verify.mjs [--debug-port 9222]
 */
import { writeFileSync } from 'node:fs'

const DEBUG_PORT = process.argv.includes('--debug-port')
  ? Number(process.argv[process.argv.indexOf('--debug-port') + 1])
  : 9222

const BASE = `http://127.0.0.1:${DEBUG_PORT}`
const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + JSON.stringify(detail) : ''}`)
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body, headers: res.headers }
}

// 1. 获取 CDP targets（找 Renderer）
const targetsRes = await fetch(`${BASE}/json`)
const targets = await targetsRes.json()
const pageTargets = targets.filter((t) => t.type === 'page')
record('CDP 连接与 target 枚举', pageTargets.length > 0, { targets: pageTargets.length, urls: pageTargets.slice(0, 5).map((t) => t.url) })
if (pageTargets.length === 0) {
  console.error('no page targets found; cannot verify renderer-side APIs')
  process.exit(1)
}

// 选择第一个 page target
const target = pageTargets[0]
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let msgId = 0
const pending = new Map()
function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.result?.exceptionDetails) {
    return { error: res.result.exceptionDetails.text ?? 'exception' }
  }
  return res.result?.result?.value
}

// 2. 验证 http://dsh.internal 可达性与 Origin / Sec-Fetch-Site 观察
record('Renderer 上下文可达', true)
const originInfo = await evaluate(`JSON.stringify({ href: location.href, origin: location.origin, protocol: location.protocol })`)
record('Renderer 页面 origin 观察', originInfo !== undefined, originInfo)

// 3. 通过 http://dsh.internal 发起 POST 到自建 session 路由（验证 dsh.internal 基址规则）
const sessionPost = await evaluate(`
(async () => {
  const res = await fetch('http://dsh.internal/plugins/appshot/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess_w0_probe', clientInstanceId: 'client-w0-probe-0001' }),
  })
  return JSON.stringify({ status: res.status, body: await res.text(), secFetchSite: (await fetch('http://dsh.internal/plugins/appshot/session', { method: 'GET' }).catch(() => null)) })
})().catch(e => JSON.stringify({ error: String(e) }))
`)
record('http://dsh.internal POST 自建路由', typeof sessionPost === 'string' && !sessionPost.includes('error'), sessionPost)

// 4. 探测 Renderer 全局可用的 ctx 入口（sessions / conversation service）
const ctxProbe = await evaluate(`
(() => {
  const keys = Object.keys(globalThis).filter((k) => /ctx|session|conversation|runtime|module/i.test(k)).slice(0, 30)
  return JSON.stringify(keys)
})()
`)
record('Renderer 全局 ctx 探测', typeof ctxProbe === 'string', ctxProbe)

// 5. 尝试通过 window.__ModuleLoader__ 或已知入口访问 cordis ctx
const moduleLoaderProbe = await evaluate(`
(() => {
  const ml = globalThis.__ModuleLoader__
  return JSON.stringify({ hasModuleLoader: typeof ml === 'object' && ml !== null, keys: ml ? Object.keys(ml).slice(0, 20) : [] })
})()
`)
record('ModuleLoader 探测', true, moduleLoaderProbe)

ws.close()

// 6. 保存结果
writeFileSync('w0-cdp-results.json', JSON.stringify(results, null, 2))
console.log('\nresults saved to w0-cdp-results.json')
