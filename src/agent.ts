import { spawn, type ChildProcess } from 'node:child_process'
import { createNdjsonParser } from './ipc.ts'
import type { AppshotEvent } from './types.ts'

export interface StartAgentOptions {
  command: string
  args?: string[]
  readyTimeoutMs?: number
  onEvent?: (event: AppshotEvent) => void
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

export interface AgentProcess {
  pid: number
  stop(): Promise<void>
  wait(): Promise<number | null>
}

export async function startAgent(options: StartAgentOptions): Promise<AgentProcess> {
  const readyTimeoutMs = options.readyTimeoutMs ?? 3000

  return new Promise<AgentProcess>((resolve, reject) => {
    let child: ChildProcess
    let isSettled = false
    let timer: NodeJS.Timeout | null = null
    let hasExited = false
    let exitCode: number | null = null
    const exitPromises: Array<(code: number | null) => void> = []

    const cleanupTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const settleResolve = (agent: AgentProcess) => {
      if (isSettled) return
      isSettled = true
      cleanupTimer()
      resolve(agent)
    }

    const settleReject = (err: Error) => {
      if (isSettled) return
      isSettled = true
      cleanupTimer()
      reject(err)
    }

    try {
      child = spawn(options.command, options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      return settleReject(err instanceof Error ? err : new Error(String(err)))
    }

    const createAgentHandle = (): AgentProcess => ({
      pid: child.pid ?? 0,
      stop: async () => {
        if (hasExited) return
        child.kill('SIGTERM')
        await new Promise<void>((res) => {
          if (hasExited) return res()
          child.once('exit', () => res())
        })
      },
      wait: async () => {
        if (hasExited) return exitCode ?? 0
        return new Promise<number | null>((res) => {
          exitPromises.push(res)
        })
      },
    })

    const parser = createNdjsonParser({
      onEvent: (event) => {
        options.onEvent?.(event)
        if (event.type === 'ready') {
          settleResolve(createAgentHandle())
        }
      },
    })

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      parser.feed(chunk)
    })

    child.on('error', (err) => {
      cleanupTimer()
      settleReject(err)
    })

    child.on('exit', (code, signal) => {
      hasExited = true
      exitCode = code !== null ? code : 0
      cleanupTimer()
      parser.end()
      for (const waiter of exitPromises) {
        waiter(exitCode)
      }
      options.onExit?.({ code, signal })

      if (!isSettled) {
        settleResolve(createAgentHandle())
      }
    })

    timer = setTimeout(() => {
      if (!isSettled) {
        child.kill('SIGTERM')
        settleReject(new Error(`Agent ready handshake timed out after ${readyTimeoutMs}ms`))
      }
    }, readyTimeoutMs)
  })
}
