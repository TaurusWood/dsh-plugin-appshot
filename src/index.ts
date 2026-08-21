import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanOrphanStagingFiles } from './staging.ts'
import { createAppshotSSEHub, type AppshotSSEHub } from './sse.ts'
import { ingestScreenshot } from './ingest.ts'
import { startAgent, type AgentProcess } from './agent.ts'
import type { AppshotConfig, AppshotEventCapture, ImageAttachmentRef } from './types.ts'
import { applyWindows, type WindowsPluginRuntime } from './windows/index.ts'

// 镜像自 @deepseek-ai/dsh-attachment StoredImageAttachment（禁 any/@ts-ignore）
interface HostAttachmentStore {
  readImage(ref: ImageAttachmentRef): Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>
}

export const name = 'dsh-plugin-appshot'
export const inject = ['attachments', 'webServer', 'sessions', 'settings']

export interface PluginState {
  sseHub?: AppshotSSEHub
  agent?: AgentProcess
  windows?: WindowsPluginRuntime
}

let globalState: PluginState = {}

interface HostSettingsService {
  register(ns: string, schema: unknown, options?: { applies?: 'live' | 'restart' }): {
    get(): AppshotConfig
  }
  get?(ns: string): AppshotConfig | undefined
}

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

/** macOS 路径（原有实现，保持不动）。 */
function applyMacos(ctx: Context) {
  console.log('[dsh-plugin-appshot] plugin applying...')

  // 1. 启动时孤儿文件 GC
  cleanOrphanStagingFiles().catch((err) => {
    console.error('[dsh-plugin-appshot] failed to clean orphan files:', err)
  })

  // 2. 注册 SSE 广播 Hub
  const sseHub = createAppshotSSEHub(ctx as unknown as Parameters<typeof createAppshotSSEHub>[0])
  globalState.sseHub = sseHub

  // 3. 注册配置服务 (DSH Settings Seam)
  let initialConfig: AppshotConfig | undefined
  const settings = (ctx as unknown as { settings?: HostSettingsService }).settings
  if (settings) {
    try {
      // DSH SettingsProvider.resolve() 内部执行 schema(mergeLayers(...))，
      // 期望 schema 是可调用函数且具有 toJSON()；构造 duck-typed schemastery 对象。
      const appshotSchema = Object.assign(
        (val: unknown): AppshotConfig => {
          const v = (typeof val === 'object' && val !== null ? val : {}) as Record<string, unknown>
          return {
            shortcutMode: (typeof v.shortcutMode === 'string'
              ? v.shortcutMode
              : 'double-cmd') as AppshotConfig['shortcutMode'],
            soundEnabled: typeof v.soundEnabled === 'boolean' ? v.soundEnabled : true,
            animationEnabled: typeof v.animationEnabled === 'boolean' ? v.animationEnabled : true,
          }
        },
        {
          toJSON: () => ({
            type: 'object',
            properties: {
              shortcutMode: { type: 'string', default: 'double-cmd' },
              soundEnabled: { type: 'boolean', default: true },
              animationEnabled: { type: 'boolean', default: true },
            },
          }),
        },
      )
      const scope = settings.register('appshot', appshotSchema, { applies: 'live' })
      initialConfig = scope?.get()
    } catch (err) {
      console.warn('[dsh-plugin-appshot] settings registration skipped/warn:', err)
    }
  }

  // 4. 启动 Native Agent 常驻进程
  if (process.env.DSH_DISABLE_AGENT_SPAWN !== '1') {
    const binaryPath = resolveAgentBinaryPath()
    if (existsSync(binaryPath)) {
      console.log('[dsh-plugin-appshot] starting native agent from:', binaryPath)
      const activatePid = process.ppid || process.pid
      startAgent({
        command: binaryPath,
        args: [
          '--daemon',
          '--activate-pid', String(activatePid),
          '--activate-app', 'com.deepseek-harness.desktop',
        ],
        onEvent: async (event) => {
          if (event.type === 'ready') {
            console.log('[dsh-plugin-appshot] native agent ready, pid:', event.pid)
            if (initialConfig && globalState.agent) {
              globalState.agent.sendConfig(initialConfig)
            }
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
        if (initialConfig) {
          agent.sendConfig(initialConfig)
        }
      }).catch((err) => {
        console.error('[dsh-plugin-appshot] failed to start native agent:', err)
      })
    }
  }

  // 5. 监听配置变更事件并实时同步给 Agent
  ctx.effect(() => {
    const off = (ctx as unknown as { on(event: string, cb: (...args: unknown[]) => void): () => void }).on(
      'settings/updated',
      (ns: unknown, next: unknown) => {
        if (ns === 'appshot' && globalState.agent && next && typeof next === 'object') {
          console.log('[dsh-plugin-appshot] settings updated, syncing to native agent:', next)
          globalState.agent.sendConfig(next as AppshotConfig)
        }
      },
    )
    return () => {
      off?.()
    }
  })

  // 6. 注册配置 REST 端点（供客户端浮动设置面板读写）
  const webServer = (ctx as unknown as { webServer?: { register?(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }): () => void } }).webServer
  if (typeof webServer?.register === 'function') {
    // 当前配置快照（fallback：用 settings scope 或默认值）
    const getConfig = (): AppshotConfig => {
      if (settings) {
        try {
          return settings.get?.('appshot' as unknown as string) as AppshotConfig ?? initialConfig ?? { shortcutMode: 'double-cmd', soundEnabled: true, animationEnabled: true }
        } catch {
          // ignore
        }
      }
      return initialConfig ?? { shortcutMode: 'double-cmd', soundEnabled: true, animationEnabled: true }
    }

    webServer.register({
      kind: 'exact',
      path: '/plugins/appshot/config',
      handler(req: unknown, res: unknown) {
        const httpReq = req as { method?: string; on?(event: string, cb: (chunk: Buffer) => void): void }
        const httpRes = res as {
          writeHead(status: number, headers?: Record<string, string>): void
          end(body?: string): void
        }

        if (httpReq.method === 'GET') {
          httpRes.writeHead(200, { 'Content-Type': 'application/json' })
          httpRes.end(JSON.stringify(getConfig()))
          return
        }

        if (httpReq.method === 'POST') {
          const chunks: Buffer[] = []
          const reqNode = req as { on(event: string, cb: (data?: Buffer) => void): void }
          reqNode.on('data', (chunk?: Buffer) => { if (chunk) chunks.push(chunk) })
          reqNode.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>
              const patch: Partial<AppshotConfig> = {}
              if (typeof body.shortcutMode === 'string') patch.shortcutMode = body.shortcutMode as AppshotConfig['shortcutMode']
              if (typeof body.soundEnabled === 'boolean') patch.soundEnabled = body.soundEnabled
              if (typeof body.animationEnabled === 'boolean') patch.animationEnabled = body.animationEnabled

              // 合并为完整配置
              const current = getConfig()
              const merged: AppshotConfig = { ...current, ...patch }

              // 同步给 Native Agent
              if (globalState.agent) {
                globalState.agent.sendConfig(merged)
              }

              // 尝试持久化到 DSH settings
              if (settings) {
                try {
                  const settingsAny = settings as unknown as { update?(ns: string, patch: object): void }
                  settingsAny.update?.('appshot', patch)
                } catch {
                  // DSH settings 可能不支持外部 update，仅同步给 Agent
                }
              }

              // 更新本地缓存
              initialConfig = merged

              httpRes.writeHead(200, { 'Content-Type': 'application/json' })
              httpRes.end(JSON.stringify(merged))
            } catch (err) {
              httpRes.writeHead(400, { 'Content-Type': 'application/json' })
              httpRes.end(JSON.stringify({ error: 'Invalid JSON', detail: String(err) }))
            }
          })
          return
        }

        httpRes.writeHead(405, { 'Content-Type': 'application/json' })
        httpRes.end(JSON.stringify({ error: 'Method not allowed' }))
      },
    })
  }

  // 7. 注册清理钩子
  ctx.effect(() => {
    return () => {
      dispose()
    }
  })

  console.log('[dsh-plugin-appshot] plugin applied successfully')
}

/** 平台分流入口：win32 走 Windows Basic 路径，其余保持 macOS 实现。 */
export function apply(ctx: Context) {
  if (process.platform === 'win32') {
    console.log('[dsh-plugin-appshot] windows platform detected, applying windows runtime...')
    applyWindows(ctx as unknown as Parameters<typeof applyWindows>[0], {})
      .then((runtime) => {
        globalState.windows = runtime
        console.log('[dsh-plugin-appshot] windows runtime applied, staging:', runtime.stagingDir)
      })
      .catch((err) => {
        console.error('[dsh-plugin-appshot] windows runtime apply failed:', err)
      })
    return
  }
  applyMacos(ctx)
}

export function dispose(ctx?: Context) {
  if (globalState.windows) {
    void globalState.windows.dispose()
    globalState.windows = undefined
  }
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
export { createAppshotClient, AppshotSettingsSection } from './client.ts'
export { createNdjsonParser } from './ipc.ts'
export { startAgent } from './agent.ts'
export * from './types.ts'
export { applyWindows } from './windows/index.ts'
