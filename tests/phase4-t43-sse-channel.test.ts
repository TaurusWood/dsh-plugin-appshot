/**
 * Phase 4 / T4.3 — SSE 事件通道注册
 *
 * 通过标准（docs/tasks.md T4.3）：
 *   > 客户端通过 EventSource 连接该路由可稳定接收广播。
 *
 * 计划模块边界（src/sse.ts，T4.3 落地时实现）：
 *   createAppshotSSEHub(ctx) → { broadcast(frame), dispose() }
 *   - 经 ctx.webServer.registerUpgrade('/plugins/appshot/events', handler) 注册；
 *   - handler 收到 socket 后加入广播集合，socket 触发 close 时移除；
 *   - broadcast 按 SSE 帧格式写入：`event: appshot/ready\ndata: <json>\n\n`；
 *   - dispose() 结束所有连接并清空集合。
 *
 * 注意：`ctx.webServer.registerUpgrade` 的真实签名未在 docs/api-grounded-review.md
 * 中核实（该文档缺失），此处按最小 socket 面（write / on / end）设计；
 * 实现对接宿主时以真实签名为准并同步本文件与 helpers/mock-ctx.ts。
 *
 * 红/绿语义：src/sse.ts 尚未实现，当前全部 skip；落地后自动激活。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { createMockCtx, createMockSocket, makeRef } from './helpers/mock-ctx.ts'
import type { AppshotReadyFrame } from './helpers/types.ts'

const sseReady = existsSync(new URL('../src/macos/sse.ts', import.meta.url))
const skipReason = sseReady
  ? false
  : 'T4.3 未实现：缺少 src/sse.ts（落地后自动激活；模块名不同请同步本文件）'

function makeFrame(): AppshotReadyFrame {
  return {
    type: 'appshot/ready',
    attachmentRef: makeRef({ attachmentId: 'att_shot_01' }),
    metadata: { appName: 'Google Chrome' },
  }
}

test('注册 /plugins/appshot/events 路由（主流程）', { skip: skipReason }, async () => {
  const { createAppshotSSEHub } = await import('../src/macos/sse.ts')
  const ctx = createMockCtx()
  createAppshotSSEHub(ctx)
  assert.ok(ctx.webServer.routes.has('/plugins/appshot/events'), '必须注册 appshot SSE 路由')
})

test('广播按 SSE 帧格式写入（主流程）', { skip: skipReason }, async () => {
  const { createAppshotSSEHub } = await import('../src/macos/sse.ts')
  const ctx = createMockCtx()
  const hub = createAppshotSSEHub(ctx)
  const handler = ctx.webServer.routes.get('/plugins/appshot/events')!
  const socket = createMockSocket()
  handler(socket)
  const frame = makeFrame()
  hub.broadcast(frame)
  assert.equal(socket.chunks.length, 1)
  assert.equal(socket.chunks[0], `event: appshot/ready\ndata: ${JSON.stringify(frame)}\n\n`)
})

test('常规边界：无连接时广播不抛错', { skip: skipReason }, async () => {
  const { createAppshotSSEHub } = await import('../src/macos/sse.ts')
  const hub = createAppshotSSEHub(createMockCtx())
  assert.doesNotThrow(() => hub.broadcast(makeFrame()))
})

test('常规边界：断开的连接不再接收广播', { skip: skipReason }, async () => {
  const { createAppshotSSEHub } = await import('../src/macos/sse.ts')
  const ctx = createMockCtx()
  const hub = createAppshotSSEHub(ctx)
  const handler = ctx.webServer.routes.get('/plugins/appshot/events')!
  const s1 = createMockSocket()
  const s2 = createMockSocket()
  handler(s1)
  handler(s2)
  s1.emitClose()
  hub.broadcast(makeFrame())
  assert.equal(s1.chunks.length, 0, '断开连接不应再写入')
  assert.equal(s2.chunks.length, 1, '存活连接应正常收到')
})

test('常规边界：dispose 结束所有连接', { skip: skipReason }, async () => {
  const { createAppshotSSEHub } = await import('../src/macos/sse.ts')
  const ctx = createMockCtx()
  const hub = createAppshotSSEHub(ctx)
  const handler = ctx.webServer.routes.get('/plugins/appshot/events')!
  const s1 = createMockSocket()
  const s2 = createMockSocket()
  handler(s1)
  handler(s2)
  hub.dispose()
  assert.equal(s1.ended, true)
  assert.equal(s2.ended, true)
  assert.doesNotThrow(() => hub.broadcast(makeFrame()), 'dispose 后广播不应抛错')
})
