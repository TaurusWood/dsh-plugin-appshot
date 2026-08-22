
const r = await fetch('http://127.0.0.1:9222/json')
const targets = await r.json()
const page = targets.find(t => t.type === 'page')
console.log('page url:', page?.url?.slice(0, 120))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
function send(method, params = {}) {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise(resolve => pend.set(mid, resolve))
}
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
async function ev(expr) {
  const r2 = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r2.result?.result?.value
}
const boot = await ev(`(() => { const b = window.__DSH_BOOT__; const e = b?.entries?.find(x => x.id === 'dsh-plugin-appshot'); return JSON.stringify(e ? { rev: e.rev, inject: e.inject } : 'not found') })()`)
console.log('boot appshot:', boot)
// 检查 Host 路由（session）
const route = await ev(`(async () => { try { const res = await fetch(location.origin + '/plugins/appshot/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-probe', clientInstanceId: 'client-probe' }) }); return res.status + ':' + await res.text() } catch (e) { return 'ERR ' + e } })()`)
console.log('session route:', route)
ws.close()
