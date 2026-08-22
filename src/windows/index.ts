/**
 * src/windows/index.ts — Windows Basic 宿主插件接线入口（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §2（总体架构与端到端数据流）+ §4（宿主与客户端交付可靠性规格）。
 *
 * 接线职责：
 * - 实例临时目录（%TEMP%\dsh-appshot\<pid>-<instanceId>）+ instance.lock + 启动孤儿 GC；
 * - WindowsCaptureStateMachine（IDLE/IN_FLIGHT/PENDING_ACK）+ 15s 超时守卫；
 * - 定向 HTTP 路由（session / pending / delivery-result）；
 * - Windows Native Agent 生命周期（有界重启、NDJSON IPC、stdin 指令）；
 * - Agent 恢复后补发 WAITING_DSH 与未呈现的最终通知。
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WindowsCaptureStateMachine } from './state-machine.ts'
import { registerWindowsRoutes, type WindowsWebServerLike } from './http-routes.ts'
import { startWindowsAgent, type WindowsAgentProcess } from './agent.ts'
import { cleanOrphanWindowsStagingDirs, ingestWindowsScreenshot, writeInstanceLock } from './safe-ingest.ts'
import { DEFAULT_WINDOWS_CONFIG, loadWindowsConfig, resolveConfigStorePath, saveWindowsConfig } from './config-store.ts'
import type { WindowsNativeToNodeFrame } from './types.ts'
import type { AppshotConfig, WindowsHotkeys } from '../shared/types.ts'

export interface WindowsHostContext {
  webServer?: WindowsWebServerLike
  effect?: (fn: () => void | (() => void)) => void
  on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
}

export interface ApplyWindowsOptions {
  /** 覆盖 staging 根目录（测试/调试用），默认 os.tmpdir()/dsh-appshot。 */
  stagingRoot?: string
  /** 覆盖配置持久化文件路径（测试/调试用），默认 %APPDATA%/dsh-plugin-appshot/config.json。 */
  configPath?: string
  /** 是否启动 Agent 子进程（默认 true；DSH_DISABLE_AGENT_SPAWN=1 时强制关闭）。 */
  spawnAgent?: boolean
}

export interface WindowsPluginRuntime {
  machine: WindowsCaptureStateMachine
  agent: WindowsAgentProcess | null
  stagingDir: string
  dispose(): Promise<void>
}

function resolveWindowsAgentBinaryPath(): string {
  // 基于插件模块位置（import.meta.url）而非 cwd：
  // DSH Desktop 运行时 cwd 是安装目录，不能用 cwd 定位插件内产物。
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // 打包后：dist/index.js → ../native/windows/bin/win-x64/
    join(currentDir, '../native/windows/bin/win-x64/appshot-win-x64.exe'),
    // 开发态：src/windows/index.ts → ../../native/windows/bin/win-x64/
    join(currentDir, '../../native/windows/bin/win-x64/appshot-win-x64.exe'),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // ignore
    }
  }
  return candidates[0]
}

export async function applyWindows(ctx: WindowsHostContext, options: ApplyWindowsOptions = {}): Promise<WindowsPluginRuntime> {
  const instanceId = randomUUID()
  const stagingRoot = options.stagingRoot ?? join(tmpdir(), 'dsh-appshot')
  const stagingDir = join(stagingRoot, `${process.pid}-${instanceId}`)
  const configPath = options.configPath ?? resolveConfigStorePath()
  await writeInstanceLock(stagingDir, { ownerPid: process.pid, instanceId })

  // 启动孤儿 GC（不阻塞）
  void cleanOrphanWindowsStagingDirs(stagingRoot).catch((err) => {
    console.error('[dsh-plugin-appshot] windows orphan staging GC failed:', err)
  })

  let agent: WindowsAgentProcess | null = null

  const machine = new WindowsCaptureStateMachine({
    onNativeFrame: (frame) => {
      agent?.send(frame)
    },
  })

  // 超时守卫：500ms 周期检查 IN_FLIGHT 15s 超时
  const guardTimer = setInterval(() => {
    machine.onTimeoutTriggered(Date.now())
  }, 500)

  // Agent 恢复后的补发逻辑
  const handleAgentReady = () => {
    const state = machine.getState()
    if (state.type === 'PENDING_ACK') {
      agent?.send({ type: 'status', captureId: state.captureId, state: 'WAITING_DSH' })
    }
    for (const completed of machine.getCompletedCaptures()) {
      if (!completed.notificationPresented) {
        agent?.send({
          type: 'status',
          captureId: completed.captureId,
          state: completed.finalNativeStatus === 'FALLBACK_SUCCESS' ? 'FALLBACK_SUCCESS' : 'SUCCESS',
        })
      }
    }
    // 恢复后同步当前配置（键位/音效/动画）
    sendConfigToAgent()
  }

  const onNativeFrame = async (frame: WindowsNativeToNodeFrame) => {
    switch (frame.type) {
      case 'ready': {
        console.log('[dsh-plugin-appshot] windows agent ready, pid:', frame.pid)
        handleAgentReady()
        return
      }
      case 'capture/request': {
        // startedAt 用宿主接收时间：超时守卫用 Date.now() 比较，混用 Native 时钟域会立即误判超时
        const result = machine.onCaptureStarted(frame.captureId, Date.now())
        if (!result.accepted) {
          console.log('[dsh-plugin-appshot] capture rejected:', result.error, frame.captureId)
        }
        return
      }
      case 'appshot': {
        try {
          const ingested = await ingestWindowsScreenshot(stagingDir, frame.imagePath, frame.captureId, {
            appName: frame.appName,
            windowTitle: frame.windowTitle,
            width: frame.width,
            height: frame.height,
            isFallback: frame.isFallback,
            fallbackReason: frame.fallbackReason,
            timestamp: frame.timestamp,
          })
          const accepted = machine.onAppshotReceived(
            frame.captureId,
            ingested.payload,
            ingested.metadata,
            ingested.isFallback,
            ingested.fallbackReason,
          )
          if (!accepted.accepted) {
            // 迟到/未知帧：safe-ingest 已 unlink，不交付
            console.warn('[dsh-plugin-appshot] late/unknown appshot frame ignored:', frame.captureId)
          }
        } catch (err) {
          console.error('[dsh-plugin-appshot] windows ingest failed:', err)
          machine.onCaptureError(frame.captureId)
          agent?.send({ type: 'status', captureId: frame.captureId, state: 'ERROR' })
        }
        return
      }
      case 'error': {
        if (frame.captureId) {
          machine.onCaptureError(frame.captureId)
          agent?.send({ type: 'status', captureId: frame.captureId, state: 'ERROR' })
        } else {
          console.error('[dsh-plugin-appshot] windows agent error:', frame.code, frame.message)
        }
        return
      }
      case 'cancel/request': {
        machine.onCancelRequest(frame.captureId)
        return
      }
      case 'status/presented': {
        machine.onStatusPresented(frame.captureId, frame.state)
        return
      }
      case 'fatal': {
        console.error('[dsh-plugin-appshot] windows agent fatal:', frame.code, frame.message)
        return
      }
      default: {
        const exhaustive: never = frame
        console.warn('[dsh-plugin-appshot] unknown windows frame:', exhaustive)
      }
    }
  }

  // 维护 Windows 配置状态：默认值 + 启动时持久化文件合并（字段级校验见 config-store）
  const storedConfig = await loadWindowsConfig(configPath)
  let currentConfig: AppshotConfig = { ...DEFAULT_WINDOWS_CONFIG, ...storedConfig }

  // 配置热下发：键位/音效/动画即时同步 Native（config/update 帧）
  const sendConfigToAgent = () => {
    // 预设归一化：非 custom 模式一律双 Ctrl（避免从自定义切回预设时残留旧组合）
    const hotkeys: WindowsHotkeys =
      currentConfig.shortcutMode === 'custom' && currentConfig.windowsHotkeys
        ? currentConfig.windowsHotkeys
        : { left: 'lctrl', right: 'rctrl' }
    agent?.send({
      type: 'config/update',
      hotkeys,
      soundEnabled: currentConfig.soundEnabled ?? true,
      animationEnabled: currentConfig.animationEnabled ?? true,
    })
  }

  // 注册定向 HTTP 路由
  const disposeRoutes = registerWindowsRoutes(ctx as { webServer?: WindowsWebServerLike }, {
    machine,
    getConfig: () => ({ ...currentConfig }),
    onConfigUpdate: (next) => {
      currentConfig = { ...next, platform: 'win32' }
      console.log('[dsh-plugin-appshot] windows config updated:', currentConfig)
      // 持久化失败不阻断热生效（内存配置 + config/update 帧已下发）
      void saveWindowsConfig(configPath, currentConfig).then((ok) => {
        if (!ok) console.warn('[dsh-plugin-appshot] windows config persist failed:', configPath)
      })
      sendConfigToAgent()
    },
    onW0Report: (report) => {
      const line = JSON.stringify({ ts: Date.now(), report })
      console.log('[dsh-plugin-appshot] W0 report received:', line)
      // 落盘便于采集（W0 验证期间）
      void import('node:fs/promises').then((fs) =>
        fs.appendFile(join(stagingDir, '..', '..', 'w0-reports.jsonl'), line + '\n').catch(() => {}),
      )
    },
  })

  // 启动 Native Agent（受环境变量与选项控制）
  const spawnAgent = options.spawnAgent !== false && process.env.DSH_DISABLE_AGENT_SPAWN !== '1'
  const diagPath = join(stagingDir, 'diag.txt')
  const appendDiag = (line: string) => {
    const timestamp = new Date().toISOString()
    void import('node:fs/promises').then((fs) =>
      fs.appendFile(diagPath, `[${timestamp}] ${line}\n`, 'utf-8').catch(() => {}),
    )
  }

  appendDiag(`init: spawnAgent=${spawnAgent} DSH_DISABLE_AGENT_SPAWN=${String(process.env.DSH_DISABLE_AGENT_SPAWN)}`)
  if (spawnAgent) {
    const binaryPath = resolveWindowsAgentBinaryPath()
    const binaryExists = existsSync(binaryPath)
    appendDiag(`binaryPath=${binaryPath} binaryExists=${binaryExists} cwd=${process.cwd()} ppid=${String(process.ppid || process.pid)}`)
    if (binaryPath && binaryExists) {
      agent = startWindowsAgent({
        command: binaryPath,
        args: ['--mode', 'daemon', '--staging-dir', stagingDir, '--dsh-pid', String(process.ppid || process.pid)],
        readyTimeoutMs: 15000,
        onFrame: (frame) => {
          if (frame.type === 'ready') {
            appendDiag(`agent ready received: pid=${frame.pid}`)
          } else if (frame.type === 'fatal') {
            appendDiag(`agent fatal: code=${frame.code} message=${frame.message}`)
          }
          void onNativeFrame(frame)
        },
        onExit: (info) => {
          const stderr = agent?.stderrLines().join(' | ') ?? ''
          appendDiag(`agent exited: code=${String(info.code)} signal=${String(info.signal)} willRestart=${info.willRestart} stderr=${stderr}`)
          console.log('[dsh-plugin-appshot] windows agent exited:', info.code, 'signal:', info.signal, 'willRestart:', info.willRestart, 'stderr:', stderr)
        },
      })
      appendDiag(`agent started: pid=${String(agent.pid)}`)
    } else {
      appendDiag(`agent spawn skipped: binary not found at ${binaryPath}`)
    }
  }

  const runtime: WindowsPluginRuntime = {
    machine,
    agent,
    stagingDir,
    dispose: async () => {
      clearInterval(guardTimer)
      disposeRoutes()
      machine.dispose()
      if (agent) {
        await agent.stop()
        agent = null
      }
    },
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      void runtime.dispose()
    })
  }

  return runtime
}

export { WindowsCaptureStateMachine } from './state-machine.ts'
export { registerWindowsRoutes } from './http-routes.ts'
export { startWindowsAgent } from './agent.ts'
export {
  cleanOrphanWindowsStagingDirs,
  ingestWindowsScreenshot,
  validateWindowsStagingPath,
  validatePngPayload,
  shouldCleanInstanceDir,
  writeInstanceLock,
} from './safe-ingest.ts'
export { createWindowsNdjsonParser, serializeWindowsCommand } from './ipc.ts'
export type * from './types.ts'
