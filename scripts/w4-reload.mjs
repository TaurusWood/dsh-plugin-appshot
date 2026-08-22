
const r = await fetch('http://127.0.0.1:9222/json')
const targets = await r.json()
const page = targets.find(t => t.type === 'page')
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

// 触发 Page.reload（Renderer 重载会让 client 重新 apply；Host 侧不变）
await send('Page.enable')
await send('Page.reload', { ignoreCache: true })
console.log('reload issued')
await new Promise(r2 => setTimeout(r2, 5000))
console.log('done')
ws.close()
