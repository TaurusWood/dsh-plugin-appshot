import type { ImageAttachmentRef } from '../shared/types.ts'

export interface AppshotReadyFrame {
  type: 'appshot/ready'
  attachmentRef: ImageAttachmentRef
  /** 图像字节 base64（草稿态附件专用；readAttachment 读不到未进会话日志的附件） */
  dataBase64?: string
  appName?: string
  windowTitle?: string
  timestamp?: number
}

export interface AppshotSSEHub {
  broadcast(frame: AppshotReadyFrame): void
  dispose(): void
}

export interface WebServerContext {
  webServer: {
    register?(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: unknown, res: unknown) => void | Promise<void>
    }): () => void
    registerUpgrade?(path: string | { path: string }, handler: unknown): void | (() => void)
    routes?: Map<string, unknown>
  }
}

export function createAppshotSSEHub(ctx: WebServerContext): AppshotSSEHub {
  const clients = new Set<{
    write(chunk: string): void
    end(): void
    on?(event: string, listener: () => void): void
  }>()

  let unregister: (() => void) | undefined

  if (typeof ctx.webServer?.register === 'function') {
    // 真实 DSH WebServer 环境 (HTTP SSE 长响应)
    unregister = ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/appshot/events',
      handler(req: any, res: any) {
        if (typeof res.writeHead === 'function') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          })
        }
        if (typeof res.write === 'function') {
          res.write(': connected\n\n')
        }

        clients.add(res)

        req.on?.('close', () => {
          clients.delete(res)
        })
        res.on?.('error', () => {
          clients.delete(res)
        })
        res.on?.('close', () => {
          clients.delete(res)
        })
      },
    })
  } else if (typeof ctx.webServer?.registerUpgrade === 'function') {
    // 兼容测试 mock 桩
    ctx.webServer.registerUpgrade('/plugins/appshot/events', (socket: any) => {
      clients.add(socket)
      socket.on?.('close', () => {
        clients.delete(socket)
      })
      socket.on?.('error', () => {
        clients.delete(socket)
      })
    })
  }

  return {
    broadcast(frame: AppshotReadyFrame) {
      const payload = `event: appshot/ready\ndata: ${JSON.stringify(frame)}\n\n`
      for (const client of clients) {
        try {
          client.write(payload)
        } catch {
          clients.delete(client)
        }
      }
    },
    dispose() {
      for (const client of clients) {
        try {
          client.end()
        } catch {
          // ignore
        }
      }
      clients.clear()
      try {
        unregister?.()
      } catch {
        // ignore
      }
    },
  }
}
