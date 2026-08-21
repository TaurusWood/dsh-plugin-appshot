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
import { join } from 'node:path'
import { WindowsCaptureStateMachine } from './state-machine.ts'
import { registerWindowsRoutes, type WindowsWebServerLike } from './http-routes.ts'
import { startWindowsAgent, type WindowsAgentProcess } from './agent.ts'
import { cleanOrphanWindowsStagingDirs, ingestWindowsScreenshot, writeInstanceLock } from './safe-ingest.ts'
import type { WindowsNativeToNodeFrame } from './types.ts'

export interface WindowsHostContext {
  webServer?: WindowsWebServerLike
  effect?: (fn: () => void | (() => void)) => void
  on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
}

export interface ApplyWindowsOptions {
  /** 覆盖 staging 根目录（测试/调试用），默认 os.tmpdir()/dsh-appshot。 */
  stagingRoot?: string
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
  const candidates = [
    join(process.cwd(), 'bin', 'win-x64', 'appshot-win-x64.exe'),
    join(process.cwd(), 'native', 'windows', 'bin', 'win-x64', 'appshot-win-x64.exe'),
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
  }

  const onNativeFrame = async (frame: WindowsNativeToNodeFrame) => {
    switch (frame.type) {
      case 'ready': {
        console.log('[dsh-plugin-appshot] windows agent ready, pid:', frame.pid)
        handleAgentReady()
        return
      }
      case 'capture/request': {
        const result = machine.onCaptureStarted(frame.captureId, frame.timestamp)
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

  // 注册定向 HTTP 路由
  const disposeRoutes = registerWindowsRoutes(ctx as { webServer?: WindowsWebServerLike }, {
    machine,
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
  if (spawnAgent) {
    const binaryPath = resolveWindowsAgentBinaryPath()
    if (binaryPath) {
      agent = startWindowsAgent({
        command: binaryPath,
        args: ['--mode', 'daemon', '--staging-dir', stagingDir, '--dsh-pid', String(process.ppid || process.pid)],
        onFrame: (frame) => void onNativeFrame(frame),
        onExit: (info) => {
          console.log('[dsh-plugin-appshot] windows agent exited:', info.code, 'signal:', info.signal, 'willRestart:', info.willRestart)
        },
      })
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
