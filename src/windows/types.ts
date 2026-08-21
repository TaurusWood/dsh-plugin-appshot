/**
 * src/windows/types.ts — Windows Basic 生产契约类型（事实来源）。
 *
 * 权威依据：docs/requirements-windows.md + docs/technical-windows.md。
 * tests/helpers/windows-types.ts 是本文件的测试侧镜像；实施时以本文件为准，
 * 测试接线后由本文件统一导出。
 */

// ── 捕获元数据 ──────────────────────────────────────────────────────────
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

/** Native 触发截图并向 Node 请求接受（technical-windows.md §5.2.2 帧名 capture/request）。 */
export interface WindowsCaptureRequestFrame {
  type: 'capture/request'
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

/** Node → Native 状态同步（technical-windows.md §5.3.1）。 */
export interface WindowsStatusFrame {
  type: 'status'
  captureId?: string
  state:
    | 'IN_FLIGHT'
    | 'WAITING_DSH'
    | 'SUCCESS'
    | 'FALLBACK_SUCCESS'
    | 'BUSY'
    | 'NO_CLIENT'
    | 'CANCELLED_BY_USER'
    | 'RESET'
    | 'ERROR'
}

/** Node → Native 取消指令（technical-windows.md §5.3.2）。 */
export interface WindowsCancelFrame {
  type: 'cancel'
  captureId: string
  reason: 'TIMEOUT' | 'USER_REQUEST' | 'SESSION_LOST'
}

/** Native → Node 二次快捷键取消请求（technical-windows.md §5.2.5）。 */
export interface WindowsCancelRequestFrame {
  type: 'cancel/request'
  captureId: string
  reason: 'USER_REQUEST'
}

/** Native → Node 最终通知已呈现（technical-windows.md §5.2.6）。 */
export interface WindowsStatusPresentedFrame {
  type: 'status/presented'
  captureId: string
  state: 'SUCCESS' | 'FALLBACK_SUCCESS'
}

export interface WindowsFatalFrame {
  type: 'fatal'
  code: string
  message: string
}

export interface WindowsShutdownFrame {
  type: 'shutdown'
}

export type WindowsNativeToNodeFrame =
  | WindowsReadyFrame
  | WindowsCaptureRequestFrame
  | WindowsAppshotFrame
  | WindowsErrorFrame
  | WindowsCancelRequestFrame
  | WindowsStatusPresentedFrame
  | WindowsFatalFrame

export type WindowsNodeToNativeFrame =
  | WindowsStatusFrame
  | WindowsCancelFrame
  | WindowsShutdownFrame

export type WindowsIpcFrame = WindowsNativeToNodeFrame | WindowsNodeToNativeFrame

// ── Node 状态机 CaptureState（technical-windows.md §4.2） ────────────────
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

// ── Node → Client: HTTP 长轮询响应 ──────────────────────────────────────
export interface WindowsAppshotReadyPayload {
  type: 'appshot/ready'
  captureId: string
  targetClientInstanceId: string
  targetSessionId: string | null
  isFallback: boolean
  fallbackReason: string | null
  dataBase64: string
  metadata: WindowsCaptureMetadata
}

// ── Client → Node: 交付结果 ──────────────────────────────────────────────
export type WindowsDeliveryResultStatus = 'MOUNTED' | 'BUSY' | 'NO_SESSION' | 'SESSION_MISMATCH'

export interface WindowsDeliveryResultRequest {
  captureId: string
  clientInstanceId: string
  targetSessionId: string
  status: WindowsDeliveryResultStatus
}

// ── Client → Node: Session 注册 ─────────────────────────────────────────
export interface WindowsSessionRegisterRequest {
  sessionId: string
  clientInstanceId: string
  claimPendingCaptureId?: string
}

// ── 完成记录（technical-windows.md §4.2 有界集合） ───────────────────────
export interface WindowsCompletedCapture {
  captureId: string
  clientInstanceId: string
  sessionId: string | null
  finalNativeStatus: 'SUCCESS' | 'FALLBACK_SUCCESS' | 'CANCELLED_BY_USER' | 'ERROR'
  notificationPresented: boolean
  completedAt: number
}

// ── 配置 ────────────────────────────────────────────────────────────────
export interface WindowsAppshotConfig {
  hotkey: 'dual-control'
  stagingDir: string
  dshPid?: number
  instanceId: string
}

/** 状态机对外动作描述（供 HTTP 层映射为具体状态码，保持状态机与传输解耦）。 */
export type WindowsPollResult =
  | { outcome: 'ready'; payload: WindowsAppshotReadyPayload }
  | { outcome: 'not-target' }
  | { outcome: 'no-pending' }
  | { outcome: 'cancelled'; captureId: string }
  | { outcome: 'completed'; captureId: string }
  | { outcome: 'conflict' }
