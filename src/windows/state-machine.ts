/**
 * src/windows/state-machine.ts — Windows Basic Node 宿主全量状态机（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §4.2 状态转换表 + §4.1 长轮询语义；
 * 产品合同：docs/requirements-windows.md §6。
 *
 * 设计要点：
 * - 单 Pending：同一时刻最多一个 IN_FLIGHT 或 PENDING_ACK；
 * - 双锁定：接受 capture/request 时固化 targetClientInstanceId + targetSessionId，
 *   后续普通 Client/Session 活动不得改变二者；
 * - 有界集合：cancelledCaptureIds（默认 60s TTL）、completedCaptures（默认 50 条）；
 * - Agent 退出保护：IN_FLIGHT 重置、PENDING_ACK 保留 payload 继续交付；
 * - 状态机与传输解耦：对外返回结构化结果（WindowsPollResult / {httpCode, action}），
 *   HTTP 路由层负责映射为具体状态码。
 */

import type {
  WindowsAppshotReadyPayload,
  WindowsCancelFrame,
  WindowsCaptureMetadata,
  WindowsCaptureState,
  WindowsCompletedCapture,
  WindowsDeliveryResultRequest,
  WindowsDeliveryResultStatus,
  WindowsNodeToNativeFrame,
  WindowsPollResult,
  WindowsStatusFrame,
} from './types.ts'

export interface CaptureStateMachineOptions {
  /** 时钟注入（测试可控），默认 Date.now。 */
  now?: () => number
  /** Node → Native 指令回调（status / cancel 帧）。 */
  onNativeFrame?: (frame: WindowsNodeToNativeFrame) => void
  /** IN_FLIGHT 超时守卫，默认 15000ms。 */
  inflightTimeoutMs?: number
  /** 长轮询无变化等待上限，默认 20000ms。 */
  pollTimeoutMs?: number
  /** cancelledCaptureIds TTL，默认 60000ms。 */
  cancelledTtlMs?: number
  /** completedCaptures 上限，默认 50 条。 */
  completedLimit?: number
}

interface PollWaiter {
  clientInstanceId: string
  knownCaptureId: string | null
  knownTargetSessionId: string | null
  resolve: (result: WindowsPollResult) => void
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidCaptureId(value: string): boolean {
  return uuidRe.test(value)
}

export function isValidClientInstanceId(value: string): boolean {
  return value.length >= 8 && value.length <= 128 && !/[\/:*?"<>|]/.test(value)
}

export function isValidSessionId(value: string): boolean {
  return value.length >= 1 && value.length <= 256
}

export class WindowsCaptureStateMachine {
  private state: WindowsCaptureState = { type: 'IDLE' }
  private readonly cancelledIds = new Map<string, number>() // captureId -> expiresAt
  private completed: WindowsCompletedCapture[] = []
  private lastActiveClient: { clientInstanceId: string | null; sessionId: string | null } = {
    clientInstanceId: null,
    sessionId: null,
  }
  private readonly waiters = new Map<string, PollWaiter>()
  private disposed = false

  private readonly nowFn: () => number
  private readonly onNativeFrame?: (frame: WindowsNodeToNativeFrame) => void
  private readonly inflightTimeoutMs: number
  private readonly pollTimeoutMs: number
  private readonly cancelledTtlMs: number
  private readonly completedLimit: number

  constructor(options: CaptureStateMachineOptions = {}) {
    this.nowFn = options.now ?? Date.now
    this.onNativeFrame = options.onNativeFrame
    this.inflightTimeoutMs = options.inflightTimeoutMs ?? 15000
    this.pollTimeoutMs = options.pollTimeoutMs ?? 20000
    this.cancelledTtlMs = options.cancelledTtlMs ?? 60000
    this.completedLimit = options.completedLimit ?? 50
  }

  getState(): WindowsCaptureState {
    return this.state
  }

  /** 最近上报的活跃 Client + Session（服务端接收时间语义由调用方保证）。 */
  getLastActiveClient(): { clientInstanceId: string | null; sessionId: string | null } {
    return { ...this.lastActiveClient }
  }

  setLastActiveClient(clientInstanceId: string | null, sessionId: string | null): void {
    this.lastActiveClient = { clientInstanceId, sessionId }
  }

  getCompletedCaptures(): readonly WindowsCompletedCapture[] {
    return [...this.completed]
  }

  isCancelled(captureId: string): boolean {
    this.sweepCancelled()
    return this.cancelledIds.has(captureId)
  }

  // ── 1. capture/request 接受 ────────────────────────────────────────────
  /** 返回与 W3 测试兼容的结构：{ accepted, error?, targetClientInstanceId, targetSessionId } */
  onCaptureStarted(captureId: string, now: number, clientInstanceId?: string | null, sessionId?: string | null) {
    this.sweepCancelled()
    const clientId = clientInstanceId !== undefined ? clientInstanceId : this.lastActiveClient.clientInstanceId
    const sessId = sessionId !== undefined ? sessionId : this.lastActiveClient.sessionId

    if (this.state.type !== 'IDLE') {
      this.sendNative({ type: 'status', captureId, state: 'BUSY' })
      return { accepted: false, error: 'BUSY' }
    }
    if (!clientId) {
      this.sendNative({ type: 'status', captureId, state: 'NO_CLIENT' })
      return { accepted: false, error: 'NO_CLIENT' }
    }

    this.state = {
      type: 'IN_FLIGHT',
      captureId,
      targetClientInstanceId: clientId,
      targetSessionId: sessId,
      startedAt: now,
    }
    this.sendNative({ type: 'status', captureId, state: 'IN_FLIGHT' })
    return { accepted: true, targetClientInstanceId: clientId, targetSessionId: sessId }
  }

  // ── 2. appshot 落盘通知（IN_FLIGHT → PENDING_ACK） ─────────────────────
  /** 同步版（payload 已读入内存）。未知/迟到帧返回 { accepted: false, shouldUnlink: true }。 */
  onAppshotReceived(
    captureId: string,
    payload: Uint8Array,
    metadata?: Partial<WindowsCaptureMetadata>,
    isFallback = false,
    fallbackReason: string | null = null,
  ) {
    this.sweepCancelled()
    if (this.cancelledIds.has(captureId) || this.state.type !== 'IN_FLIGHT' || this.state.captureId !== captureId) {
      return { accepted: false, shouldUnlink: true }
    }
    const inflight = this.state
    const fullMetadata: WindowsCaptureMetadata = {
      appName: metadata?.appName ?? 'unknown',
      windowTitle: metadata?.windowTitle,
      mediaType: 'image/png',
      width: metadata?.width ?? 0,
      height: metadata?.height ?? 0,
      bytes: payload.length,
      timestamp: metadata?.timestamp ?? this.nowFn(),
    }
    this.state = {
      type: 'PENDING_ACK',
      captureId,
      targetClientInstanceId: inflight.targetClientInstanceId,
      targetSessionId: inflight.targetSessionId,
      payload,
      metadata: fullMetadata,
      isFallback,
      fallbackReason,
    }
    this.sendNative({ type: 'status', captureId, state: 'WAITING_DSH' })
    this.wakeWaiterFor(inflight.targetClientInstanceId)
    return {
      accepted: true,
      targetClientInstanceId: inflight.targetClientInstanceId,
      targetSessionId: inflight.targetSessionId,
    }
  }

  // ── 3. IN_FLIGHT 错误/失败 ─────────────────────────────────────────────
  onCaptureError(captureId: string): void {
    if (this.state.type === 'IN_FLIGHT' && this.state.captureId === captureId) {
      this.state = { type: 'IDLE' }
      this.sendNative({ type: 'status', captureId, state: 'RESET' })
    }
  }

  // ── 4. 15s 超时守卫 ────────────────────────────────────────────────────
  /** 满 inflightTimeoutMs 时转移至 cancelled 并下发 cancel:TIMEOUT。 */
  onTimeoutTriggered(now: number) {
    if (this.state.type === 'IN_FLIGHT' && now - this.state.startedAt >= this.inflightTimeoutMs) {
      const timedOutId = this.state.captureId
      this.recordCancelled(timedOutId)
      this.state = { type: 'IDLE' }
      this.sendNative({ type: 'cancel', captureId: timedOutId, reason: 'TIMEOUT' })
      return { timedOut: true, captureId: timedOutId }
    }
    return { timedOut: false }
  }

  // ── 5. 长轮询 ──────────────────────────────────────────────────────────
  /**
   * 立即判定。返回 'wait' 时由调用方通过 waitForChange 挂起。
   * 语义（technical-windows.md §4.1.4）：
   * - 先查有界终态集合：cancelled → cancelled；completed 完整元组 → completed；
   *   ID 同但 Client/Session 不同 → conflict；
   * - PENDING_ACK 且请求方为目标 Client：knownCaptureId 不匹配 → ready；
   *   匹配 → 等待状态变化（wait）；
   * - 非目标 / 无 Pending → wait（长轮询挂起后 20s 无变化返回 no-pending）。
   */
  poll(clientInstanceId: string, knownCaptureId: string | null, knownTargetSessionId: string | null): WindowsPollResult | { outcome: 'wait' } {
    this.sweepCancelled()
    if (knownCaptureId && this.cancelledIds.has(knownCaptureId)) {
      return { outcome: 'cancelled', captureId: knownCaptureId }
    }
    if (knownCaptureId) {
      const completedEntry = this.completed.find((c) => c.captureId === knownCaptureId)
      if (completedEntry) {
        const tupleMatches =
          completedEntry.clientInstanceId === clientInstanceId &&
          (knownTargetSessionId === null || completedEntry.sessionId === knownTargetSessionId)
        if (tupleMatches) return { outcome: 'completed', captureId: knownCaptureId }
        return { outcome: 'conflict' }
      }
    }

    if (this.state.type === 'PENDING_ACK') {
      const pending = this.state
      if (pending.targetClientInstanceId === clientInstanceId) {
        if (knownCaptureId === null || knownCaptureId !== pending.captureId) {
          return { outcome: 'ready', payload: this.buildReadyPayload(pending) }
        }
        // 已知同 ID：等待状态变化
        return { outcome: 'wait' }
      }
      // 非目标 Client
      return { outcome: 'not-target' }
    }
    return { outcome: 'wait' }
  }

  /** 注册/替换该 Client 的 waiter；返回取消旧 waiter 的函数。 */
  waitForChange(
    clientInstanceId: string,
    knownCaptureId: string | null,
    knownTargetSessionId: string | null,
    onResult: (result: WindowsPollResult) => void,
    onTimeout: () => void,
  ): () => void {
    const existing = this.waiters.get(clientInstanceId)
    if (existing) {
      this.settleWaiter(existing, { outcome: 'no-pending' })
    }
    const waiter: PollWaiter = {
      clientInstanceId,
      knownCaptureId,
      knownTargetSessionId,
      resolve: onResult,
      timer: null,
      settled: false,
    }
    waiter.timer = setTimeout(() => {
      if (waiter.settled) return
      this.waiters.delete(clientInstanceId)
      waiter.settled = true
      onTimeout()
    }, this.pollTimeoutMs)
    this.waiters.set(clientInstanceId, waiter)
    return () => {
      if (waiter.settled) return
      this.settleWaiter(waiter, { outcome: 'no-pending' })
    }
  }

  // ── 6. Session 注册 / 认领 ─────────────────────────────────────────────
  /**
   * 处理 POST /session 上报。claimPendingCaptureId 仅在 PENDING_ACK 且
   * rebindRequired 或 targetSessionId 为空、且上报方为目标 Client 时生效。
   * 返回 { claimed: boolean; captureId?: string; targetSessionId?: string | null }。
   */
  onSessionRegister(clientInstanceId: string, sessionId: string, claimPendingCaptureId?: string) {
    this.setLastActiveClient(clientInstanceId, sessionId)

    if (this.state.type === 'PENDING_ACK' && claimPendingCaptureId && this.state.captureId === claimPendingCaptureId) {
      const pending = this.state
      if (pending.targetClientInstanceId === clientInstanceId && (pending.rebindRequired || pending.targetSessionId === null)) {
        this.state = {
          ...pending,
          targetSessionId: sessionId,
          rebindRequired: false,
        }
        this.wakeWaiterFor(clientInstanceId)
        return { claimed: true, captureId: pending.captureId, targetSessionId: sessionId }
      }
    }
    return { claimed: false }
  }

  // ── 7. 交付结果（Delivery Result） ─────────────────────────────────────
  onDeliveryResult(req: WindowsDeliveryResultRequest): { httpCode: number; action: string } {
    const { captureId, clientInstanceId, targetSessionId, status } = req
    const completedEntry = this.completed.find((c) => c.captureId === captureId)
    if (completedEntry) {
      const tupleMatches =
        completedEntry.clientInstanceId === clientInstanceId && completedEntry.sessionId === targetSessionId
      return tupleMatches
        ? { httpCode: 200, action: 'IGNORED_DUPLICATE' }
        : { httpCode: 409, action: 'CONFLICT_REJECTED' }
    }

    if (
      this.state.type !== 'PENDING_ACK' ||
      this.state.captureId !== captureId ||
      (this.state.targetClientInstanceId !== null && this.state.targetClientInstanceId !== clientInstanceId) ||
      (this.state.targetSessionId !== null && this.state.targetSessionId !== targetSessionId)
    ) {
      return { httpCode: 409, action: 'CONFLICT_REJECTED' }
    }

    const pending = this.state
    if (status === 'MOUNTED') {
      this.completed.push({
        captureId,
        clientInstanceId,
        sessionId: targetSessionId,
        finalNativeStatus: pending.isFallback ? 'FALLBACK_SUCCESS' : 'SUCCESS',
        notificationPresented: false,
        completedAt: this.nowFn(),
      })
      if (this.completed.length > this.completedLimit) this.completed.splice(0, this.completed.length - this.completedLimit)
      this.state = { type: 'IDLE' } // 释放内存 payload
      this.sendNative({ type: 'status', captureId, state: pending.isFallback ? 'FALLBACK_SUCCESS' : 'SUCCESS' })
      return { httpCode: 200, action: 'CLEARED_SUCCESS' }
    }

    // BUSY / NO_SESSION / SESSION_MISMATCH：保留 payload 与原目标
    if (status === 'SESSION_MISMATCH') {
      this.state = { ...pending, rebindRequired: true }
    }
    return { httpCode: 200, action: 'HELD_PENDING' }
  }

  // ── 8. 二次快捷键取消（cancel/request） ────────────────────────────────
  onCancelRequest(captureId: string): boolean {
    if (this.state.type === 'PENDING_ACK' && this.state.captureId === captureId) {
      const pending = this.state
      this.recordCancelled(captureId)
      this.state = { type: 'IDLE' }
      this.sendNative({ type: 'status', captureId, state: 'CANCELLED_BY_USER' })
      const waiter = this.waiters.get(pending.targetClientInstanceId ?? '')
      if (waiter) this.settleWaiter(waiter, { outcome: 'cancelled', captureId })
      return true
    }
    return false
  }

  // ── 9. Agent 退出 / status/presented ───────────────────────────────────
  onAgentExit(): void {
    if (this.state.type === 'IN_FLIGHT') {
      this.state = { type: 'IDLE' }
    }
    // PENDING_ACK 保持：保留 payload，允许 Client 继续交付（不丢图）
  }

  onStatusPresented(captureId: string, state: 'SUCCESS' | 'FALLBACK_SUCCESS'): void {
    const entry = this.completed.find((c) => c.captureId === captureId && c.finalNativeStatus === state)
    if (entry) {
      entry.notificationPresented = true
    }
    // 非完成 ID 忽略并记录诊断（由调用方日志）
  }

  // ── 10. dispose ────────────────────────────────────────────────────────
  dispose(): void {
    this.disposed = true
    for (const waiter of this.waiters.values()) {
      this.settleWaiter(waiter, { outcome: 'no-pending' })
    }
    this.waiters.clear()
    this.cancelledIds.clear()
    this.completed = []
    this.state = { type: 'IDLE' }
  }

  // ── 内部工具 ───────────────────────────────────────────────────────────
  private sendNative(frame: WindowsNodeToNativeFrame): void {
    if (!this.disposed && this.onNativeFrame) this.onNativeFrame(frame)
  }

  private recordCancelled(captureId: string): void {
    this.sweepCancelled()
    this.cancelledIds.set(captureId, this.nowFn() + this.cancelledTtlMs)
  }

  private sweepCancelled(): void {
    const now = this.nowFn()
    for (const [id, expiresAt] of this.cancelledIds) {
      if (expiresAt <= now) this.cancelledIds.delete(id)
    }
  }

  private wakeWaiterFor(clientInstanceId: string | null): void {
    if (clientInstanceId === null) return
    const waiter = this.waiters.get(clientInstanceId)
    if (!waiter || waiter.settled) return
    const result = this.poll(waiter.clientInstanceId, waiter.knownCaptureId, waiter.knownTargetSessionId)
    if (result.outcome !== 'wait') this.settleWaiter(waiter, result)
  }

  private settleWaiter(waiter: PollWaiter, result: WindowsPollResult): void {
    if (waiter.settled) return
    waiter.settled = true
    if (waiter.timer !== null) clearTimeout(waiter.timer)
    if (this.waiters.get(waiter.clientInstanceId) === waiter) this.waiters.delete(waiter.clientInstanceId)
    waiter.resolve(result)
  }

  private buildReadyPayload(pending: Extract<WindowsCaptureState, { type: 'PENDING_ACK' }>): WindowsAppshotReadyPayload {
    const base64 = Buffer.from(pending.payload).toString('base64')
    return {
      type: 'appshot/ready',
      captureId: pending.captureId,
      targetClientInstanceId: pending.targetClientInstanceId ?? '',
      targetSessionId: pending.targetSessionId,
      isFallback: pending.isFallback,
      fallbackReason: pending.fallbackReason,
      dataBase64: base64,
      metadata: pending.metadata,
    }
  }
}

/** 便捷类型：状态机返回的动作判别（供测试断言）。 */
export type CaptureDeliveryAction =
  | { httpCode: number; action: 'IGNORED_DUPLICATE' | 'CONFLICT_REJECTED' | 'CLEARED_SUCCESS' | 'HELD_PENDING' }
