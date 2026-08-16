/**
 * tests/helpers/mock-ctx.ts — 宿主 ctx 的最小类型化 mock（无 `any`）。
 *
 * 只覆盖插件实际会触碰的服务面（attachments / webServer / sessions / tools）
 * 与 Cordis 生命周期面（effect / on / emit）。仅按 AGENTS.md 认可的接口建模，
 * 不引入未核实的宿主接口。SSE socket 面（write / on / end）为最小假设，
 * `registerUpgrade` 真实签名未核实（docs/api-grounded-review.md 缺失），
 * 实现对接时以宿主为准。
 */

import type { ImageAttachmentRef, SaveImageInput } from './types.ts'

export interface MockSocket {
  /** 已写入的原始帧（按 string 拼接，便于断言 SSE 帧格式）。 */
  chunks: string[]
  closed: boolean
  ended: boolean
  write(chunk: string): void
  end(): void
  on(event: 'close' | 'error', listener: () => void): void
  emitClose(): void
}

export function createMockSocket(): MockSocket {
  const closeListeners: Array<() => void> = []
  return {
    chunks: [],
    closed: false,
    ended: false,
    write(chunk: string): void {
      if (this.closed || this.ended) return
      this.chunks.push(chunk)
    },
    end(): void {
      this.ended = true
    },
    on(event: 'close' | 'error', listener: () => void): void {
      if (event === 'close') closeListeners.push(listener)
    },
    emitClose(): void {
      this.closed = true
      for (const listener of closeListeners) listener()
    },
  }
}

export interface MockWebServer {
  /** path → upgrade handler；测试可自行调用 handler 模拟客户端连入。 */
  routes: Map<string, (socket: MockSocket) => void>
  registerUpgrade(path: string, handler: (socket: MockSocket) => void): void
}

export interface MockCtx {
  attachments: {
    saveImage(input: SaveImageInput): Promise<ImageAttachmentRef>
    saveImageCalls: SaveImageInput[]
  }
  webServer: MockWebServer
  sessions: Record<string, never>
  tools: {
    register(tool: unknown): () => void
    get(name: string): unknown
  }
  effect(fn: () => void | (() => void)): void
  cleanups: Array<() => void>
  runCleanups(): void
  on(event: string, listener: (...args: unknown[]) => void): void
  emit(event: string, ...args: unknown[]): void
  onCalls: Array<{ event: string }>
  emitCalls: Array<{ event: string; args: unknown[] }>
}

export interface MockCtxOptions {
  /** saveImage 桩；默认返回固定 ref。传抛错实现可验证失败分支的清理逻辑。 */
  saveImage?: (input: SaveImageInput) => Promise<ImageAttachmentRef>
}

export function makeRef(overrides?: Partial<ImageAttachmentRef>): ImageAttachmentRef {
  return {
    attachmentId: 'att_test_0001',
    mediaType: 'image/png',
    bytes: 123,
    width: 100,
    height: 80,
    ...overrides,
  }
}

export function createMockCtx(options: MockCtxOptions = {}): MockCtx {
  const saveImageCalls: SaveImageInput[] = []
  const cleanups: Array<() => void> = []
  const onCalls: Array<{ event: string }> = []
  const emitCalls: Array<{ event: string; args: unknown[] }> = []
  const routes = new Map<string, (socket: MockSocket) => void>()

  return {
    attachments: {
      saveImage: async (input) => {
        saveImageCalls.push(input)
        return options.saveImage ? options.saveImage(input) : makeRef()
      },
      saveImageCalls,
    },
    webServer: {
      routes,
      registerUpgrade(path, handler) {
        routes.set(path, handler)
      },
    },
    sessions: {},
    tools: {
      register() {
        return () => {}
      },
      get() {
        return undefined
      },
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    cleanups,
    runCleanups() {
      for (const cleanup of [...cleanups].reverse()) cleanup()
    },
    on(event) {
      onCalls.push({ event })
    },
    emit(event, ...args) {
      emitCalls.push({ event, args })
    },
    onCalls,
    emitCalls,
  }
}
