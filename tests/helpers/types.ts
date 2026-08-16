/**
 * tests/helpers/types.ts — 测试用 DSH 接口类型镜像（证据优先，禁止猜测）。
 *
 * 权威来源：
 * - `ImageMediaType` / `ImageAttachmentRef` / `SaveImageAttachment` 镜像自
 *   node_modules 中 `@deepseek-ai/dsh-attachment@0.1.0-rc.6`
 *   `lib/types/types.d.ts`：`saveImage` 输入是字节（`Uint8Array`），
 *   `ImageAttachmentRef` 是 `{ attachmentId, mediaType, bytes, width, height, name? }`，
 *   没有 `url` 字段（AGENTS.md 硬规则 5）。
 * - NDJSON IPC 帧（ready / appshot / error）镜像自 docs/technical.md §5.1。
 * - SSE 广播帧（appshot/ready）镜像自 docs/technical.md §5.2。
 * - `NativeWindowInfo` / `NativeSuccessResult` / `NativeErrorResult` 镜像自
 *   native/macos/Sources/main.swift 的 Encodable 结构。
 *
 * 若后续实现引入的官方类型与本文件冲突，以官方声明为准并同步本文件。
 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export interface SaveImageInput {
  data: Uint8Array
  mediaType: 'image/png'
  name?: string
}

// ── Native ↔ Node: NDJSON IPC 契约（docs/technical.md §5.1）──────────────
export interface ReadyFrame {
  type: 'ready'
  version: 1
  bundleId?: string
  pid?: number
}

export interface AppshotFrame {
  type: 'appshot'
  id: string
  platform: 'darwin'
  appName: string
  windowTitle?: string
  width: number
  height: number
  mimeType: 'image/png'
  imagePath: string
  timestamp: number
}

export interface ErrorFrame {
  type: 'error'
  id?: string
  code: string
  message: string
}

export type IpcFrame = ReadyFrame | AppshotFrame | ErrorFrame

// ── Node → Client: SSE 广播帧（docs/technical.md §5.2）───────────────────
export interface AppshotReadyFrame {
  type: 'appshot/ready'
  attachmentRef: ImageAttachmentRef
  metadata: { appName: string; windowTitle?: string }
}

// ── Native CLI JSON（native/macos/Sources/main.swift）────────────────────
export interface NativeWindowInfo {
  windowId: number
  appName: string
  pid: number
  title: string | null
  frame: { x: number; y: number; width: number; height: number }
  isOnScreen: boolean
  layer: number
}

export interface NativeSuccessResult {
  ok: true
  platform: 'darwin'
  appName: string
  windowTitle: string | null
  windowId: number
  width: number
  height: number
  mimeType: 'image/png'
  imagePath: string
  timestamp: number
}

export interface NativeErrorResult {
  ok: false
  platform: 'darwin'
  code: string
  message: string
}
