/**
 * scripts/cdp.ts — CDP (Chrome DevTools Protocol) 最小客户端，供调试脚本共享。
 *
 * 用法：node scripts/w4-e2e-probe.ts（DSH Desktop 需以 --remote-debugging-port=9222 启动）
 */

export interface CdpTarget {
  type: string
  url: string
  title?: string
  webSocketDebuggerUrl: string
}

interface CdpMessage {
  id?: number
  result?: {
    exceptionDetails?: { text?: string }
    result?: { value?: unknown }
  }
}

export async function listCdpTargets(debugPort = 9222): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json`)
  return (await res.json()) as CdpTarget[]
}

export interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<CdpMessage>
  evaluate(expression: string): Promise<unknown>
  close(): void
}

export async function connectCdp(debugPort = 9222): Promise<CdpClient> {
  const targets = await listCdpTargets(debugPort)
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error(`no page target found on CDP port ${debugPort}`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('CDP websocket error'))
  })

  let msgId = 0
  const pending = new Map<number, (msg: CdpMessage) => void>()
  ws.onmessage = (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data)) as CdpMessage
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)?.(msg)
      pending.delete(msg.id)
    }
  }

  const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> => {
    const id = ++msgId
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve) => pending.set(id, resolve))
  }

  const evaluate = async (expression: string): Promise<unknown> => {
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

  return { send, evaluate, close: () => ws.close() }
}
