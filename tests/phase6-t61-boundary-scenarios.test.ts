/**
 * Phase 6 / T6.1 — 边界场景测试
 *
 * 场景（docs/tasks.md T6.1）：
 *   多显示器 / 同 App 多窗口 / 全屏 Space 切换 / 系统通知。
 *
 * 自动化覆盖（可执行部分）：--list-windows 数据基础校验（多窗口场景的数据源）。
 * 其余为机上人工验收用例（skip 携带具体场景与预期）。
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

test('--list-windows 至少返回 1 个 on-screen 窗口（多窗口数据基础，常规边界）', { skip: nativeGate }, async () => {
  const result = await runNative(['--list-windows'])
  assert.equal(result.code, 0)
  const parsed = parseFirstJsonLine(result.stdout)
  assert.ok(Array.isArray(parsed) && parsed.length > 0, '窗口列表不应为空')
  const onScreen = (parsed as NativeWindowInfo[]).filter((w) => w.isOnScreen)
  assert.ok(onScreen.length > 0, '至少存在 1 个 on-screen 窗口')
})

test('手动：多显示器——副屏 Chrome 触发只截副屏窗口', {
  skip: '人工验收：双屏环境，把 Chrome 拖到副屏并置为前台，触发双 Command；核对截图只含副屏 Chrome 窗口、不含主屏内容或整屏',
}, () => {})

test('手动：同 App 多窗口——捕获正在操作的置顶窗口', {
  skip: '人工验收：Chrome 打开 3 个窗口，将其中 1 个置顶并操作，触发截图；核对截图为该置顶窗口',
}, () => {})

test('手动：全屏 Space 切换——截图完成后平滑切回 DSH 所在桌面', {
  skip: '人工验收：在全屏应用（如全屏视频）中触发，核对截图内容为全屏应用窗口，且截图完成后 DSH 窗口平滑切回所在桌面（Space）',
}, () => {})

test('手动：系统通知——无权限/窗口不可截取时弹出 macOS 原生通知', {
  skip: '人工验收：分别构造「无屏幕录制权限」与「窗口不可截取（如受 DRM 保护的播放窗口）」场景，核对出现 UNUserNotificationCenter 系统通知、内容可读、进程不崩溃',
}, () => {})
