import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanOrphanStagingFiles } from './staging.ts'
import { createAppshotSSEHub, type AppshotSSEHub } from './sse.ts'
import { ingestScreenshot } from './ingest.ts'
import { startAgent, type AgentProcess } from './agent.ts'
import type { AppshotEventCapture, ImageAttachmentRef } from './types.ts'

// 镜像自 @deepseek-ai/dsh-attachment StoredImageAttachment（禁 any/@ts-ignore）
interface HostAttachmentStore {
  readImage(ref: ImageAttachmentRef): Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>
}

export const name = 'dsh-plugin-appshot'
export const inject = ['attachments', 'webServer', 'sessions']

export interface PluginState {
  sseHub?: AppshotSSEHub
  agent?: AgentProcess
}

let globalState: PluginState = {}

function resolveAgentBinaryPath(): string {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))

  const candidates = [
    // 优先：打包后的 App Bundle 可执行文件
    join(currentDir, '../native/macos/.build/Appshot Agent.app/Contents/MacOS/appshot-macos'),
    // 次优：根目录或构建目录的可执行文件
    join(currentDir, '../native/macos/appshot-macos'),
    join(currentDir, '../native/macos/.build/debug/appshot-macos'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

export function apply(ctx: Context) {
  console.log('[dsh-plugin-appshot] plugin applying...')

  // 1. 启动时孤儿文件 GC
  cleanOrphanStagingFiles().catch((err) => {
    console.error('[dsh-plugin-appshot] failed to clean orphan files:', err)
  })

  // 2. 注册 SSE 广播 Hub
  const sseHub = createAppshotSSEHub(ctx as unknown as Parameters<typeof createAppshotSSEHub>[0])
  globalState.sseHub = sseHub

  // 3. 启动 Native Agent 常驻进程
  if (process.env.DSH_DISABLE_AGENT_SPAWN !== '1') {
    const binaryPath = resolveAgentBinaryPath()
    if (existsSync(binaryPath)) {
      console.log('[dsh-plugin-appshot] starting native agent from:', binaryPath)
      startAgent({
        command: binaryPath,
        args: ['--daemon', '--activate-app', 'com.deepseek-harness.desktop'],
        onEvent: async (event) => {
          if (event.type === 'ready') {
            console.log('[dsh-plugin-appshot] native agent ready, pid:', event.pid)
          } else if (event.type === 'appshot') {
            const capture = event as AppshotEventCapture
            console.log('[dsh-plugin-appshot] captured screenshot:', capture.appName, capture.imagePath)
            try {
              const attachmentRef = await ingestScreenshot(
                ctx as unknown as Parameters<typeof ingestScreenshot>[0],
                capture.imagePath,
                capture.appName,
              )
              console.log('[dsh-plugin-appshot] attachment saved:', attachmentRef.attachmentId)

              // 草稿态附件尚未进入任何 session 日志，客户端 readAttachment 读不到（宿主拒绝：
              // "Image is not referenced by this session"）。改为把已验证字节直接放进帧。
              let dataBase64: string | undefined
              try {
                const stored = await (ctx as unknown as { attachments: HostAttachmentStore }).attachments
                  .readImage(attachmentRef)
                dataBase64 = Buffer.from(stored.data).toString('base64')
              } catch (err) {
                console.warn('[dsh-plugin-appshot] readImage failed, frame carries metadata only:', err)
              }

              sseHub.broadcast({
                type: 'appshot/ready',
                attachmentRef,
                dataBase64,
                appName: capture.appName,
                windowTitle: capture.windowTitle,
                timestamp: capture.timestamp ?? Date.now(),
              })
            } catch (err) {
              console.error('[dsh-plugin-appshot] failed to ingest screenshot:', err)
            }
          } else if (event.type === 'error') {
            console.error('[dsh-plugin-appshot] native agent error:', event.code, event.message)
          }
        },
        onExit: (info) => {
          console.log('[dsh-plugin-appshot] native agent exited with code:', info.code, 'signal:', info.signal)
        },
      }).then((agent) => {
        globalState.agent = agent
      }).catch((err) => {
        console.error('[dsh-plugin-appshot] failed to start native agent:', err)
      })
    }
  }

  // 4. 注册清理钩子
  ctx.effect(() => {
    return () => {
      dispose()
    }
  })

  console.log('[dsh-plugin-appshot] plugin applied successfully')
}

export function dispose(ctx?: Context) {
  if (globalState.agent) {
    globalState.agent.stop().catch(() => {})
    globalState.agent = undefined
  }
  if (globalState.sseHub) {
    globalState.sseHub.dispose()
    globalState.sseHub = undefined
  }
  console.log('[dsh-plugin-appshot] plugin disposed')
}

export { cleanOrphanStagingFiles } from './staging.ts'
export { ingestScreenshot } from './ingest.ts'
export { createAppshotSSEHub } from './sse.ts'
export { createAppshotClient } from './client.ts'
export { createNdjsonParser } from './ipc.ts'
export { startAgent } from './agent.ts'
export * from './types.ts'
