/**
 * src/windows/ipc.ts — Windows NDJSON IPC 协议（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §5（IPC 通信协议定义）。
 * - Native → Node：ready / capture/request / appshot / error / cancel/request / status/presented / fatal；
 * - Node → Native：status / cancel / shutdown（每行一个 JSON，LF 分隔）。
 */

import type { WindowsNativeToNodeFrame, WindowsNodeToNativeFrame } from './types.ts'

export interface WindowsNdjsonParserOptions {
  onEvent: (event: WindowsNativeToNodeFrame) => void
  onError?: (error: Error) => void
}

export interface WindowsNdjsonParser {
  feed(chunk: string): void
  end(): void
}

/** 逐行解析 Native stdout；粘包/断包安全，非法行不中断后续行。 */
export function createWindowsNdjsonParser(options: WindowsNdjsonParserOptions): WindowsNdjsonParser {
  let buffer = ''

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const parsed = JSON.parse(trimmed) as WindowsNativeToNodeFrame
      options.onEvent(parsed)
    } catch (err) {
      if (options.onError) {
        options.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  return {
    feed(chunk: string): void {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    },
    end(): void {
      if (buffer) {
        processLine(buffer)
        buffer = ''
      }
    },
  }
}

/** 序列化 Node → Native 指令为 NDJSON 行。 */
export function serializeWindowsCommand(frame: WindowsNodeToNativeFrame): string {
  return JSON.stringify(frame) + '\n'
}

/** 判断某帧是否为已知的 Native → Node 帧类型（防未知帧类型静默进入状态机）。 */
export function isKnownNativeFrame(frame: WindowsNativeToNodeFrame): boolean {
  switch (frame.type) {
    case 'ready':
    case 'capture/request':
    case 'appshot':
    case 'error':
    case 'cancel/request':
    case 'status/presented':
    case 'fatal':
      return true
    default:
      return false
  }
}
