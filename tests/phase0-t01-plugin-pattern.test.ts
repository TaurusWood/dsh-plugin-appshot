/**
 * Phase 0 / T0.1 — 插件架构模式与服务依赖改造
 *
 * 通过标准（docs/tasks.md T0.1）：
 *   > 插件可被 Cordis 正常加载与卸载，类型检查 `pnpm run typecheck` 通过。
 *
 * 覆盖范围（主流程 + 常规边界）：
 * - 主流程：插件导出面（name / inject / apply / dispose）满足生命周期插件形态；
 * - 常规边界：服务注入齐备时 apply(ctx) 可正常执行。
 *
 * 红/绿语义：src/index.ts 当前仍是 defineTool 模板（inject=['tools']、无 dispose），
 * 本文件断言 T0.1 的目标契约 —— 在 T0.1 落地前 `inject` / `dispose` 用例保持红色
 * （预期，属验收信号而非测试缺陷）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createMockCtx } from './helpers/mock-ctx.ts'

const plugin = await import('../src/index.ts')

describe('T0.1 插件生命周期与服务依赖', () => {
  test('导出 name = "dsh-plugin-appshot"（主流程）', () => {
    assert.equal(plugin.name, 'dsh-plugin-appshot')
  })

  test('inject 声明 attachments / webServer / sessions / settings（主流程）', () => {
    assert.deepEqual(plugin.inject, ['attachments', 'webServer', 'sessions', 'settings'])
  })

  test('导出 apply 与 dispose 生命周期函数（主流程）', () => {
    assert.equal(typeof plugin.apply, 'function')
    assert.equal(typeof plugin.dispose, 'function')
  })

  test('服务齐备时 apply(ctx) 可正常执行（常规边界）', () => {
    // MockCtx 只实现插件用到的服务面，结构上并不等于宿主 Context，做一次显式断言转换
    const ctx = createMockCtx() as unknown as Parameters<typeof plugin.apply>[0]
    assert.doesNotThrow(() => plugin.apply(ctx))
  })
})
