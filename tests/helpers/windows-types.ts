/**
 * tests/helpers/windows-types.ts — Windows Basic 契约类型镜像（严格对齐权威规格）。
 *
 * 权威依据：
 * - docs/requirements-windows.md
 * - docs/technical-windows.md
 */

export interface WindowsCaptureMetadata {
  appName: string
  windowTitle?: string
  mediaType: 'image/png'
  width: number
  height: number
  bytes: number
  timestamp: number
}

// ── Native ↔ Node: NDJSON IPC 契约 ──────────────────────────────────────
export interface WindowsReadyFrame {
  type: 'ready'
  version: 1
  platform: 'win32'
  pid: number
}

export interface WindowsCaptureStartedFrame {
  type: 'capture/started'
  captureId: string
  timestamp: number
}

export interface WindowsAppshotFrame {
  type: 'appshot'
  captureId: string
  platform: 'win32'
  appName: string
  windowTitle?: string
  width: number
  height: number
  mimeType: 'image/png'
  imagePath: string
  isFallback: boolean
  fallbackReason: string | null
  timestamp: number
}

export interface WindowsErrorFrame {
  type: 'error'
  captureId?: string
  code: string
  message: string
}

export interface WindowsStatusFrame {
  type: 'status'
  captureId?: string
  state: 'IN_FLIGHT' | 'WAITING_DSH' | 'SUCCESS' | 'FALLBACK_SUCCESS' | 'BUSY' | 'ACK_FAILED' | 'RESET' | 'ERROR'
}

export interface WindowsCancelFrame {
  type: 'cancel'
  captureId: string
  reason: 'TIMEOUT' | 'USER_CANCELLED' | 'SESSION_LOST'
}

export interface WindowsShutdownFrame {
  type: 'shutdown'
}

export type WindowsIpcFrame =
  | WindowsReadyFrame
  | WindowsCaptureStartedFrame
  | WindowsAppshotFrame
  | WindowsErrorFrame
  | WindowsStatusFrame
  | WindowsCancelFrame
  | WindowsShutdownFrame

// ── Node 状态机 CaptureState ────────────────────────────────────────────
export type WindowsCaptureState =
  | { type: 'IDLE' }
  | {
      type: 'IN_FLIGHT'
      captureId: string
      targetClientInstanceId: string | null
      targetSessionId: string | null
      startedAt: number
    }
  | {
      type: 'PENDING_ACK'
      captureId: string
      targetClientInstanceId: string | null
      targetSessionId: string | null
      payload: Uint8Array
      metadata: WindowsCaptureMetadata
      isFallback: boolean
      fallbackReason: string | null
      rebindRequired?: boolean
    }

// ── Node → Client: HTTP / SSE 载荷 ──────────────────────────────────────
export interface WindowsAppshotReadyPayload {
  type: 'appshot/ready'
  captureId: string
  targetSessionId: string | null
  isFallback: boolean
  fallbackReason: string | null
  dataBase64: string
  metadata: WindowsCaptureMetadata
}

// ── Client → Node: Delivery Result ──────────────────────────────────────
export interface WindowsDeliveryResultRequest {
  captureId: string
  clientInstanceId: string
  targetSessionId: string
  status: 'MOUNTED' | 'BUSY' | 'NO_SESSION' | 'SESSION_MISMATCH'
}

// ── Client → Node: Session 注册 ─────────────────────────────────────────
export interface WindowsSessionRegisterRequest {
  sessionId: string
  clientInstanceId: string
  claimPendingCaptureId?: string
}
