import type { ImageAttachmentRef } from './types.ts'

export interface AppshotReadyFrame {
  type: 'appshot/ready'
  attachmentRef: ImageAttachmentRef
  metadata: {
    appName: string
    windowTitle?: string
  }
}

export interface SseSocket {
  write(chunk: string): void
  end(): void
  on(event: 'close' | 'error', listener: () => void): void
}

export interface WebServerService {
  registerUpgrade(path: string, handler: (socket: SseSocket) => void): void
}

export interface SseContext {
  webServer: WebServerService
}

export interface AppshotSSEHub {
  broadcast(frame: AppshotReadyFrame): void
  dispose(): void
}

export function createAppshotSSEHub(ctx: SseContext): AppshotSSEHub {
  const sockets = new Set<SseSocket>()

  ctx.webServer.registerUpgrade('/plugins/appshot/events', (socket: SseSocket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
    socket.on('error', () => {
      sockets.delete(socket)
    })
  })

  return {
    broadcast(frame: AppshotReadyFrame): void {
      const payload = `event: appshot/ready\ndata: ${JSON.stringify(frame)}\n\n`
      for (const socket of sockets) {
        try {
          socket.write(payload)
        } catch {
          sockets.delete(socket)
        }
      }
    },
    dispose(): void {
      for (const socket of sockets) {
        try {
          socket.end()
        } catch {
          // ignore
        }
      }
      sockets.clear()
    },
  }
}
