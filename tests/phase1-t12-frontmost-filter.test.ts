/**
 * Phase 1 / T1.2 — 前台窗口过滤算法 PoC
 *
 * 通过标准（docs/tasks.md T1.2）：
 *   > 在 Chrome、VS Code、Finder、Terminal 处于前台时执行，均能 100% 正确命中
 *   > 对应的主窗口。
 *
 * 自动化覆盖（常规边界）：--list-windows 窗口条目 schema 校验（过滤算法的数据
 * 基础：windowId / pid / isOnScreen / layer / frame 字段必须完整可用）。
 * “四应用 100% 命中”为机上人工验收（需交互式 GUI 会话，见文末手动用例）。
 *
 * 环境门控同 T1.1（二进制 + 屏幕录制权限，见 helpers/native-probe.ts）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nativeSkipReason, probeNative } from './helpers/native-probe.ts'
import { parseFirstJsonLine, runNative } from './helpers/run-native.ts'
import type { NativeWindowInfo } from './helpers/types.ts'

const probe = await probeNative()
const nativeGate = nativeSkipReason(probe)

test('窗口条目字段完整：windowId/pid/frame/isOnScreen/layer（常规边界）', { skip: nativeGate }, async () => {
  const result = await runNative(['--list-windows'])
  assert.equal(result.code, 0)
  const parsed = parseFirstJsonLine(result.stdout)
  assert.ok(Array.isArray(parsed), '--list-windows 应输出 JSON 数组')
  for (const window of parsed as NativeWindowInfo[]) {
    assert.equal(typeof window.windowId, 'number')
    assert.equal(typeof window.pid, 'number')
    assert.equal(typeof window.appName, 'string')
    assert.ok(window.title === null || typeof window.title === 'string')
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert.equal(typeof window.frame[key], 'number', `frame.${key} 应为数字`)
    }
    assert.equal(typeof window.isOnScreen, 'boolean')
    assert.equal(typeof window.layer, 'number')
  }
})

test('手动：Chrome / VS Code / Finder / Terminal 前台均 100% 命中主窗口（人工验收）', {
  skip: '人工验收：依次将 Chrome、VS Code、Finder、Terminal 置于前台，分别执行 `--cli-capture`，核对截图 appName 与窗口内容一致；4 个应用全部命中即通过',
}, () => {})

test('手动：过滤辅助窗口（Tooltip / 阴影 / 菜单栏弹窗）不误截（常规边界）', {
  skip: '人工验收：打开含 tooltip 的应用（如浏览器 hover 链接）后触发截图，核对截图不包含 tooltip/阴影/菜单栏弹窗',
}, () => {})
