
const r = await fetch('http://127.0.0.1:9222/json')
const targets = await r.json()
const target = targets.find(t => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.text ?? 'exception' }
  return res.result?.result?.value
}

// 1. 设置面板是否注册成功（slots.settings.section）
const settingsPanel = await evaluate(`(() => {
  const boot = window.__DSH_BOOT__
  const appshot = boot?.entries.find(e => e.id === 'dsh-plugin-appshot')
  return JSON.stringify(appshot ? { loaded: true, rev: appshot.rev, inject: appshot.inject } : { loaded: false })
})()`)
console.log('插件加载:', settingsPanel)

// 2. w0-results 是否还在（上次验证的 9 项结果）
const w0results = await evaluate(`(() => {
  const raw = sessionStorage.getItem('w0-results')
  if (!raw) return 'absent'
  const parsed = JSON.parse(raw)
  return JSON.stringify({ present: true, count: parsed.results.length, okCount: parsed.results.filter(r => r.ok).length })
})()`)
console.log('W0 验证结果留存:', w0results)

ws.close()
