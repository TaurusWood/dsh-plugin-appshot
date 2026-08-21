/**
 * src/windows/http-routes.ts — Windows Basic 定向 HTTP 传输路由（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §4.1（HTTP 传输、Client 注册与目标锁定）。
 * 路由面：
 * - POST /plugins/appshot/session          Client Session 上报（含显式认领）
 * - GET  /plugins/appshot/pending          定向长轮询（appshot/ready / cancelled / completed）
 * - POST /plugins/appshot/delivery-result  交付结果（MOUNTED / BUSY / NO_SESSION / SESSION_MISMATCH）
 *
 * 安全边界（technical-windows.md §4.1.5）：
 * - 仅在 ctx.webServer.host === '127.0.0.1' 时启用；
 * - 拒绝 sec-fetch-site: cross-site；
 * - POST 只接受 application/json，请求体上限 64KB；
 * - 校验 UUID / 状态枚举 / 字符串长度；不发送 CORS 允许头；
 * - 所有路由随插件 dispose 注销（register 返回 disposer）。
 */

import type { WindowsCaptureStateMachine } from './state-machine.ts'
import { isValidCaptureId, isValidClientInstanceId, isValidSessionId } from './state-machine.ts'
import type {
  WindowsDeliveryResultRequest,
  WindowsDeliveryResultStatus,
  WindowsPollResult,
  WindowsSessionRegisterRequest,
} from './types.ts'

export const MAX_POST_BODY_BYTES = 64 * 1024

// ── 最小类型化 HTTP 面（不引入 node:http 具体类型，避免 any） ─────────────

export interface HttpRequestLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  on?(event: 'data' | 'end' | 'close', cb: (chunk?: Buffer) => void): void
}

export interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

export interface WindowsWebServerLike {
  host?: string
  register?(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: HttpRequestLike, res: HttpResponseLike) => void
  }): () => void
}

export interface WindowsRoutesOptions {
  machine: WindowsCaptureStateMachine
  /** W0 真机验证结果接收器（可选；未提供时不注册 w0-report 路由） */
  onW0Report?: (report: unknown) => void
}

export interface WindowsRoutesHandle {
  register(ctx: { webServer?: WindowsWebServerLike }): () => void
}

function getHeader(req: HttpRequestLike, name: string): string | undefined {
  const raw = req.headers?.[name]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

function isCrossSite(req: HttpRequestLike): boolean {
  return getHeader(req, 'sec-fetch-site') === 'cross-site'
}

function readJsonBody(req: HttpRequestLike): Promise<Record<string, unknown> | null> {
  return new Promise((resolveBody) => {
    if (typeof req.on !== 'function') {
      resolveBody(null)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk?: Buffer) => {
      if (!chunk) return
      size += chunk.length
      if (size > MAX_POST_BODY_BYTES) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        resolveBody(null)
        return
      }
      const raw = Buffer.concat(chunks).toString('utf-8')
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolveBody(parsed as Record<string, unknown>)
          return
        }
        resolveBody(null)
      } catch {
        resolveBody(null)
      }
    })
  })
}

function sendJson(res: HttpResponseLike, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendNoContent(res: HttpResponseLike): void {
  res.writeHead(204)
  res.end()
}

const deliveryStatuses: readonly WindowsDeliveryResultStatus[] = ['MOUNTED', 'BUSY', 'NO_SESSION', 'SESSION_MISMATCH']

function isDeliveryResultStatus(value: string): value is WindowsDeliveryResultStatus {
  return (deliveryStatuses as readonly string[]).includes(value)
}

/** 注册全部 Windows 路由；返回注销函数。 */
export function registerWindowsRoutes(ctx: { webServer?: WindowsWebServerLike }, options: WindowsRoutesOptions): () => void {
  const { machine } = options
  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    return () => {}
  }
  if (webServer.host !== '127.0.0.1') {
    // 非 loopback 不启用（安全边界），仅记录由调用方日志
    return () => {}
  }

  const disposers: Array<() => void> = []

  // ── POST /plugins/appshot/session ─────────────────────────────────────
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/plugins/appshot/session',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        if (isCrossSite(req)) {
          res.writeHead(403)
          res.end()
          return
        }
        void (async () => {
          const body = await readJsonBody(req)
          if (body === null) {
            sendJson(res, 400, { error: 'INVALID_BODY' })
            return
          }
          const raw = body as Partial<WindowsSessionRegisterRequest>
          const clientInstanceId = typeof raw.clientInstanceId === 'string' ? raw.clientInstanceId : ''
          const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : ''
          const claimPendingCaptureId = typeof raw.claimPendingCaptureId === 'string' ? raw.claimPendingCaptureId : undefined

          if (!isValidClientInstanceId(clientInstanceId) || !isValidSessionId(sessionId)) {
            sendJson(res, 400, { error: 'INVALID_FIELDS' })
            return
          }
          if (claimPendingCaptureId !== undefined && !isValidCaptureId(claimPendingCaptureId)) {
            sendJson(res, 400, { error: 'INVALID_CAPTURE_ID' })
            return
          }

          const result = machine.onSessionRegister(clientInstanceId, sessionId, claimPendingCaptureId)
          if (result.claimed) {
            sendJson(res, 200, { captureId: result.captureId, targetSessionId: result.targetSessionId })
            return
          }
          sendJson(res, 200, { ok: true })
        })()
      },
    }),
  )

  // ── GET /plugins/appshot/pending（定向长轮询） ─────────────────────────
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/plugins/appshot/pending',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405)
          res.end()
          return
        }
        if (isCrossSite(req)) {
          res.writeHead(403)
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const clientInstanceId = url.searchParams.get('clientInstanceId') ?? ''
        const knownCaptureIdRaw = url.searchParams.get('knownCaptureId')
        const knownTargetSessionIdRaw = url.searchParams.get('knownTargetSessionId')
        const knownCaptureId = knownCaptureIdRaw && knownCaptureIdRaw !== '' ? knownCaptureIdRaw : null
        const knownTargetSessionId =
          knownTargetSessionIdRaw && knownTargetSessionIdRaw !== '' ? knownTargetSessionIdRaw : null

        if (!isValidClientInstanceId(clientInstanceId)) {
          sendJson(res, 400, { error: 'INVALID_CLIENT_INSTANCE_ID' })
          return
        }
        if (knownCaptureId !== null && !isValidCaptureId(knownCaptureId)) {
          sendJson(res, 400, { error: 'INVALID_CAPTURE_ID' })
          return
        }
        if (knownTargetSessionId !== null && !isValidSessionId(knownTargetSessionId)) {
          sendJson(res, 400, { error: 'INVALID_SESSION_ID' })
          return
        }

        const respond = (result: WindowsPollResult) => {
          switch (result.outcome) {
            case 'ready':
              sendJson(res, 200, result.payload)
              return
            case 'cancelled':
              sendJson(res, 200, { type: 'appshot/cancelled', captureId: result.captureId })
              return
            case 'completed':
              sendJson(res, 200, { type: 'appshot/completed', captureId: result.captureId })
              return
            case 'conflict':
              sendJson(res, 409, { error: 'CONFLICT' })
              return
            case 'not-target':
            case 'no-pending':
              sendNoContent(res)
              return
          }
        }

        const immediate = machine.poll(clientInstanceId, knownCaptureId, knownTargetSessionId)
        if (immediate.outcome !== 'wait') {
          respond(immediate)
          return
        }

        // 挂起等待状态变化（20s 无变化返回 204）
        const cancelWait = machine.waitForChange(
          clientInstanceId,
          knownCaptureId,
          knownTargetSessionId,
          (pollResult) => respond(pollResult),
          () => sendNoContent(res),
        )
        // 连接关闭时释放 waiter，防止悬挂
        req.on?.('close', () => {
          cancelWait()
        })
      },
    }),
  )

  // ── POST /plugins/appshot/delivery-result ─────────────────────────────
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/plugins/appshot/delivery-result',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        if (isCrossSite(req)) {
          res.writeHead(403)
          res.end()
          return
        }
        void (async () => {
          const body = await readJsonBody(req)
          if (body === null) {
            sendJson(res, 400, { error: 'INVALID_BODY' })
            return
          }
          const raw = body as Partial<WindowsDeliveryResultRequest>
          const captureId = typeof raw.captureId === 'string' ? raw.captureId : ''
          const clientInstanceId = typeof raw.clientInstanceId === 'string' ? raw.clientInstanceId : ''
          const targetSessionId = typeof raw.targetSessionId === 'string' ? raw.targetSessionId : ''
          const status = typeof raw.status === 'string' ? raw.status : ''

          if (
            !isValidCaptureId(captureId) ||
            !isValidClientInstanceId(clientInstanceId) ||
            !isValidSessionId(targetSessionId) ||
            !isDeliveryResultStatus(status)
          ) {
            sendJson(res, 400, { error: 'INVALID_FIELDS' })
            return
          }

          const result = machine.onDeliveryResult({ captureId, clientInstanceId, targetSessionId, status })
          if (result.action === 'IGNORED_DUPLICATE' || result.action === 'CLEARED_SUCCESS' || result.action === 'HELD_PENDING') {
            sendJson(res, 200, { action: result.action })
            return
          }
          sendJson(res, result.httpCode, { error: result.action })
        })()
      },
    }),
  )

  // ── POST /plugins/appshot/w0-report（W0 真机验证结果接收，仅提供 onW0Report 时注册） ──
  if (options.onW0Report) {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/plugins/appshot/w0-report',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          void (async () => {
            const body = await readJsonBody(req)
            if (body === null) {
              sendJson(res, 400, { error: 'INVALID_BODY' })
              return
            }
            options.onW0Report?.(body)
            sendJson(res, 200, { ok: true })
          })()
        },
      }),
    )
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}
