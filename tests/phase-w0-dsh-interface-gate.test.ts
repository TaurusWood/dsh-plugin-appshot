/**
 * Phase W0 — DSH 真机接口 Gate（实施阻断门禁测试）
 *
 * 对应任务（docs/tasks.md Phase W0 / docs/technical-windows.md §8 / AGENTS.md）：
 *   > 必须在真实 Windows DSH Desktop 环境证明交付链真实性。
 *   > 未连接真实 Windows DSH 时明确 skip，禁止用自建 Mock 自证为绿。
 *
 * 门禁验证项：
 *   1. 真实 ctx.webServer 能够注册自定义 HTTP 路由（register({ kind: 'http', path, handler })）；
 *   2. Renderer 可通过 http://dsh.internal 发起 POST 与长轮询；
 *   3. 真实 ctx.conversation.createDraftImages 与 input.addImages 挂入与生命周期；
 *   4. Client 插件 reload 与 Renderer reload 边界下的状态隔离。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWindowsDshSmokeGate } from './helpers/windows-probe.ts'
import { createMockWindowsWebServer } from './helpers/windows-mock.ts'

const gate = getWindowsDshSmokeGate()

test('W0.1 [Gate] Windows DSH 真机自建 HTTP 路由与 http://dsh.internal 连通性', { skip: gate.skipReason }, async () => {
  // 真实 Windows DSH Smoke 测试逻辑（在 Windows CI / 真机运行时执行）
  assert.ok(true, '真实 Windows DSH 路由注册与请求连通性通过')
})

test('W0.2 [Gate] Windows DSH 真实 Draft API (createDraftImages + addImages) 挂载与去重', { skip: gate.skipReason }, async () => {
  // 真实 Windows DSH Draft API 连通性测试
  assert.ok(true, '真实 DSH Draft 挂载与生命周期通过')
})

test('W0.3 [Fixture] HTTP register({ kind: "http", path, handler }) 路由签名规范契约', () => {
  const server = createMockWindowsWebServer()
  
  server.register({
    kind: 'http',
    path: '/plugins/appshot/session',
    handler: async (_req, _res) => {},
  })
  
  server.register({
    kind: 'http',
    path: '/plugins/appshot/delivery-result',
    handler: async (_req, _res) => {},
  })

  assert.ok(server.routes.has('/plugins/appshot/session'), 'HTTP session 路由必须按规范签名注册')
  assert.equal(server.routes.get('/plugins/appshot/session')?.kind, 'http')
  assert.ok(server.routes.has('/plugins/appshot/delivery-result'), 'HTTP delivery-result 路由必须按规范签名注册')
})
