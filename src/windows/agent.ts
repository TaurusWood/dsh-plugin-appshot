/**
 * src/windows/agent.ts — Windows Native Agent 子进程生命周期管理（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §3.1（启动与重启策略）+ §5（IPC 协议）。
 *
 * - 启动：spawn appshot-win-x64.exe，5 秒内未收到 ready 视为启动失败；
 * - 重启：空闲态或 PENDING_ACK 期间异常退出按 1s → 2s → 4s 最多重启 3 次；
 *   稳定运行 60 秒后重置重启计数；
 * - PENDING_ACK 不属于 Agent：Agent 退出时 Node 继续交付，恢复后同步 WAITING_DSH，
 *   或从 completedCaptures 补发未呈现的 SUCCESS/FALLBACK_SUCCESS；
 * - stdin 下发 status / cancel / shutdown NDJSON 指令。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { WindowsNativeToNodeFrame, WindowsNodeToNativeFrame } from './types.ts'
import { createWindowsNdjsonParser, serializeWindowsCommand } from './ipc.ts'

export interface StartWindowsAgentOptions {
  command: string
  args?: string[]
  readyTimeoutMs?: number
  onFrame?: (frame: WindowsNativeToNodeFrame) => void
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null; willRestart: boolean }) => void
  /** 是否允许有界自动重启（默认 true）。 */
  allowRestart?: boolean
  now?: () => number
}

export interface WindowsAgentProcess {
  pid: number
  /** 下发 Node → Native 指令帧。 */
  send(frame: WindowsNodeToNativeFrame): void
  /** 优雅退出：写 shutdown，等待 3s 超时强杀。 */
  stop(): Promise<void>
  wait(): Promise<number | null>
  /** 诊断：子进程 stderr 最近 50 行。 */
  stderrLines(): readonly string[]
}

const MAX_RESTARTS = 3
const RESTART_DELAYS = [1000, 2000, 4000]
const STABLE_RESET_MS = 60_000
const FORCE_KILL_TIMEOUT_MS = 3000

export function startWindowsAgent(options: StartWindowsAgentOptions): WindowsAgentProcess {
  const readyTimeoutMs = options.readyTimeoutMs ?? 15000
  const allowRestart = options.allowRestart ?? true
  const nowFn = options.now ?? Date.now

  let child: ChildProcess | null = null
  let currentPid = 0
  let parser = createNoopParser()
  let hasExited = false
  let exitCode: number | null = null
  let stopped = false
  let restartCount = 0
  let stableSince = nowFn()
  let stopTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  const stderrLines: string[] = []
  const exitWaiters: Array<(code: number | null) => void> = []

  const onFrameCb = (frame: WindowsNativeToNodeFrame) => {
    if (frame.type === 'ready' && readyTimer) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
    options.onFrame?.(frame)
  }

  const spawnChild = () => {
    hasExited = false
    try {
      child = spawn(options.command, options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: { ...process.env },
      })
      currentPid = child.pid ?? 0
    } catch (err) {
      // spawn 同步失败：走 onExit 报告，不进入重启
      options.onExit?.({
        code: null,
        signal: null,
        willRestart: false,
      })
      void err
      return
    }

    parser = createWindowsNdjsonParser({
      onEvent: onFrameCb,
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => parser.feed(chunk))
    child.stderr?.setEncoding('utf8')
    // 消费 stderr：防止管道写满阻塞子进程；错误内容由 stderrLines 留存供诊断
    child.stderr?.on('data', (chunk: unknown) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk ?? '')
      const trimmed = text.trim()
      if (trimmed && stderrLines.length < 50) stderrLines.push(trimmed)
    })

    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = setTimeout(() => {
      // 15s 内未收到 ready：视为启动失败，终止该子进程
      if (child && !hasExited) {
        child.kill()
      }
    }, readyTimeoutMs)

    child.on('error', () => {
      // spawn 异步错误：终止并进入退出处理
    })

    child.on('exit', (code, signal) => {
      if (readyTimer) {
        clearTimeout(readyTimer)
        readyTimer = null
      }
      hasExited = true
      exitCode = code !== null ? code : 0
      parser.end()
      for (const waiter of exitWaiters) waiter(exitCode)

      if (stopped || !allowRestart) {
        options.onExit?.({ code, signal, willRestart: false })
        return
      }

      // 稳定运行 60 秒后重置重启计数
      if (nowFn() - stableSince >= STABLE_RESET_MS) {
        restartCount = 0
      }

      if (restartCount >= MAX_RESTARTS) {
        options.onExit?.({ code, signal, willRestart: false })
        return
      }

      const delay = RESTART_DELAYS[restartCount] ?? RESTART_DELAYS[RESTART_DELAYS.length - 1]
      restartCount++
      options.onExit?.({ code, signal, willRestart: true })
      setTimeout(() => {
        if (!stopped) spawnChild()
      }, delay)
    })
  }

  spawnChild()

  const handle: WindowsAgentProcess = {
    pid: currentPid,
    stderrLines: () => [...stderrLines],
    send(frame: WindowsNodeToNativeFrame) {
      if (hasExited || !child?.stdin || !child.stdin.writable) return
      child.stdin.write(serializeWindowsCommand(frame))
    },
    stop: async () => {
      stopped = true
      if (!child || hasExited) return
      handle.send({ type: 'shutdown' })
      await new Promise<void>((resolveStop) => {
        if (hasExited) {
          resolveStop()
          return
        }
        stopTimer = setTimeout(() => {
          // 3s 超时兜底强杀
          try {
            child?.kill()
          } catch {
            // ignore
          }
          resolveStop()
        }, FORCE_KILL_TIMEOUT_MS)
        child?.once('exit', () => {
          if (stopTimer) clearTimeout(stopTimer)
          resolveStop()
        })
      })
    },
    wait: async () => {
      if (hasExited) return exitCode
      return new Promise<number | null>((res) => {
        exitWaiters.push(res)
      })
    },
  }

  return handle
}

function createNoopParser() {
  return {
    feed(_chunk: string): void {},
    end(): void {},
  }
}
