/**
 * Phase 5 / T5.1 — 客户端模块（dsh.client / Renderer）
 *
 * 通过标准（docs/tasks.md T5.1）：
 *   > 双 Command 触发后，DSH 窗口弹至前台，Composer 已挂载截图，光标就绪。
 *
 * 计划模块边界（src/client.ts，T5.1 落地时实现）：
 *   createAppshotClient(deps) → { start(), dispose() }
 *   deps = {
 *     subscribe(listener: (frame: AppshotReadyFrame) => void): () => void
 *     getActiveSessionId(): string | null
 *     composer: { appendDraft(sessionId: string, ref: ImageAttachmentRef): void; focus(): void }
 *     onNeedSession?: () => void
 *   }
 *   - 收到 appshot/ready 帧 → 读取当前活跃 sessionId → appendDraft → focus；
 *   - 无活跃会话 → 不挂载，回调 onNeedSession（PRD「目标 Session 解析」）；
 *   - 非 appshot/ready 或字段缺失的帧 → 忽略（运行时校验）。
 *
 * 设计说明：模块运行于 Renderer；活跃会话由本模块在 Renderer 侧读取，
 * 宿主不猜测（AGENTS.md 硬规则 6）。
 *
 * 红/绿语义：src/client.ts 尚未实现，当前全部 skip；落地后自动激活。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { makeRef } from './helpers/mock-ctx.ts'
import type { AppshotReadyFrame, ImageAttachmentRef } from './helpers/types.ts'

const clientReady = existsSync(new URL('../src/client.ts', import.meta.url))
const skipReason = clientReady
  ? false
  : 'T5.1 未实现：缺少 src/client.ts（落地后自动激活；模块名不同请同步本文件）'

interface Harness {
  start(): void
  dispose(): void
  emit(frame: unknown): void
  sent: Array<{ sessionId: string; ref: ImageAttachmentRef }>
  focusCount: number
  needSessionCount: number
}

async function makeHarness(overrides: { activeSessionId?: string | null } = {}): Promise<Harness> {
  const { createAppshotClient } = await import('../src/client.ts')
  let listener: ((frame: AppshotReadyFrame) => void) | null = null
  const state = {
    sent: [] as Array<{ sessionId: string; ref: ImageAttachmentRef }>,
    focusCount: 0,
    needSessionCount: 0,
  }
  const client = createAppshotClient({
    subscribe: (l: (frame: AppshotReadyFrame) => void) => {
      listener = l
      return () => {
        listener = null
      }
    },
    getActiveSessionId: () => (overrides.activeSessionId !== undefined ? overrides.activeSessionId : 'session-1'),
    composer: {
      appendDraft: (sessionId: string, ref: ImageAttachmentRef) => {
        state.sent.push({ sessionId, ref })
      },
      focus: () => {
        state.focusCount++
      },
    },
    onNeedSession: () => {
      state.needSessionCount++
    },
  })
  return {
    start: () => client.start(),
    dispose: () => client.dispose(),
    emit: (frame: unknown) => listener?.(frame as AppshotReadyFrame),
    get sent() {
      return state.sent
    },
    get focusCount() {
      return state.focusCount
    },
    get needSessionCount() {
      return state.needSessionCount
    },
  }
}

test('主流程：收到 appshot/ready → 挂载到活跃 Session 的 Composer 并聚焦', { skip: skipReason }, async () => {
  const h = await makeHarness()
  h.start()
  const ref = makeRef({ attachmentId: 'att_shot_01' })
  h.emit({ type: 'appshot/ready', attachmentRef: ref, metadata: { appName: 'VS Code' } })
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0]!.sessionId, 'session-1')
  assert.equal(h.sent[0]!.ref.attachmentId, 'att_shot_01')
  assert.equal(h.focusCount, 1, '挂载后应聚焦输入框光标')
  assert.equal(h.needSessionCount, 0)
})

test('常规边界：无活跃 Session 时不挂载并触发 onNeedSession', { skip: skipReason }, async () => {
  const h = await makeHarness({ activeSessionId: null })
  h.start()
  h.emit({ type: 'appshot/ready', attachmentRef: makeRef(), metadata: { appName: 'Finder' } })
  assert.equal(h.sent.length, 0, '无活跃会话不得挂载草稿')
  assert.equal(h.needSessionCount, 1)
  assert.equal(h.focusCount, 0)
})

test('常规边界：未知事件类型被忽略', { skip: skipReason }, async () => {
  const h = await makeHarness()
  h.start()
  assert.doesNotThrow(() => h.emit({ type: 'appshot/other', payload: {} }))
  assert.equal(h.sent.length, 0)
  assert.equal(h.focusCount, 0)
})

test('常规边界：attachmentRef 缺失的帧被忽略且不崩溃', { skip: skipReason }, async () => {
  const h = await makeHarness()
  h.start()
  assert.doesNotThrow(() => h.emit({ type: 'appshot/ready', attachmentRef: null, metadata: {} }))
  assert.equal(h.sent.length, 0)
  assert.equal(h.focusCount, 0)
})

test('主流程：连续两张截图按序追加（多图追加模式）', { skip: skipReason }, async () => {
  const h = await makeHarness()
  h.start()
  h.emit({ type: 'appshot/ready', attachmentRef: makeRef({ attachmentId: 'att_1' }), metadata: { appName: 'A' } })
  h.emit({ type: 'appshot/ready', attachmentRef: makeRef({ attachmentId: 'att_2' }), metadata: { appName: 'B' } })
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[0]!.ref.attachmentId, 'att_1')
  assert.equal(h.sent[1]!.ref.attachmentId, 'att_2')
  assert.equal(h.focusCount, 2)
})
