import type { AppshotEvent } from '../shared/types.ts'

export interface NdjsonParserOptions {
  onEvent: (event: AppshotEvent) => void
  onError?: (error: Error) => void
}

export interface NdjsonParser {
  feed(chunk: string): void
  end(): void
}

export function createNdjsonParser(options: NdjsonParserOptions): NdjsonParser {
  let buffer = ''

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const parsed = JSON.parse(trimmed) as AppshotEvent
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
      // 最后一个元素是未完成的行或空字符串，保留在 buffer 中
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        processLine(line)
      }
    },
    end(): void {
      if (buffer) {
        processLine(buffer)
        buffer = ''
      }
    },
  }
}
