/**
 * Phase 1 / T1.1 — ScreenCaptureKit 单窗口截图验证（CLI 模式）
 *
 * 通过标准（docs/tasks.md T1.1）：
 *   > 生成的 PNG 图像仅包含目标窗口，Retina 渲染清晰，不包含全屏幕或桌面背景。
 *
 * 自动化覆盖（CLI 契约）：exit code、单行 JSON、PNG 落盘、错误码与退出码一致性。
 * “像素级只含目标窗口 / Retina 清晰”需人工目检（文末手动用例）。
 *
 * 环境门控：native 行为测试要求（a）二进制已构建（swift build）；
 * （b）当前会话具备屏幕录制权限且可调用 ScreenCaptureKit。不满足时自动 skip
 * 并给出原因（见 helpers/native-probe.ts）。
 *
 * 已知问题：`--cli-capture` 曾偶发 SIGABRT（CGS_REQUIRE_INIT，exit 134）——与
 * TCC/CG 会话初始化状态相关；当前会话已稳定通过。若复现，对应用例红并携带
 * stderr 诊断（详见 tests/README.md「已知问题」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { removeDir, makeTempDir, fileExists } from './helpers/fs.ts'
import { nativeSkipReason, probeNative } from './helpers/native-probe.ts'
import {
  nativeBinaryExists,
  parseFirstJsonLine,
  runNative,
} from './helpers/run-native.ts'
import type { NativeErrorResult, NativeSuccessResult, NativeWindowInfo } from './helpers/types.ts'

const probe = await probeNative()
const nativeGate = nativeSkipReason(probe)

test('--help 输出用法且 exit 0（主流程）', {
  skip: nativeBinaryExists() ? false : 'native binary 未构建（先执行 swift build）',
}, async () => {
  const result = await runNative(['--help'])
  assert.equal(result.code, 0)
  assert.ok(result.stdout.includes('Usage:'), '--help 应输出 Usage 行')
  assert.ok(result.stdout.includes('--cli-capture'), '--help 应列出 --cli-capture')
})

test('--list-windows 输出合法 JSON 窗口数组（主流程）', { skip: nativeGate }, async () => {
  const result = await runNative(['--list-windows'])
  assert.equal(result.code, 0, `stderr: ${result.stderr.trim()}`)
  const parsed = parseFirstJsonLine(result.stdout)
  assert.ok(Array.isArray(parsed), 'stdout 首行应为 JSON 数组')
  for (const window of parsed as NativeWindowInfo[]) {
    assert.equal(typeof window.windowId, 'number')
    assert.equal(typeof window.pid, 'number')
    assert.equal(typeof window.isOnScreen, 'boolean')
    assert.equal(typeof window.layer, 'number')
    assert.equal(typeof window.frame.width, 'number')
    assert.equal(typeof window.frame.height, 'number')
  }
})

test('--cli-capture 成功契约：exit 0 + ok:true + PNG 落盘（主流程）', { skip: nativeGate }, async () => {
  const dir = await makeTempDir('dsh-appshot-native-')
  const output = join(dir, 'shot.png')
  try {
    const result = await runNative(['--cli-capture', '--output', output])
    // 当前 PoC 在本机 SIGABRT（exit 134）——红为正确信号，见文件头注释
    assert.equal(result.code, 0, `stderr: ${result.stderr.trim().slice(0, 300)}`)
    assert.equal(result.signal, null)
    const parsed = parseFirstJsonLine(result.stdout) as NativeSuccessResult
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mimeType, 'image/png')
    assert.equal(parsed.imagePath, output)
    assert.ok(parsed.width > 0 && parsed.height > 0, '截图宽高应大于 0')
    assert.ok(parsed.appName.length > 0, '应识别前台应用名')
    assert.equal(await fileExists(output), true, 'PNG 文件应落盘')
  } finally {
    await removeDir(dir)
  }
})

test('错误契约：无效 window-id 返回 ok:false JSON 且 exit 非 0（常规边界）', { skip: nativeGate }, async () => {
  const result = await runNative(['--cli-capture', '--window-id', '4294967295'])
  assert.notEqual(result.code, 0, '错误路径退出码必须非 0')
  const parsed = parseFirstJsonLine(result.stdout) as NativeErrorResult
  assert.equal(parsed.ok, false)
  assert.equal(parsed.code, 'WINDOW_NOT_FOUND')
  assert.ok(parsed.message.length > 0)
})

test('手动：截图仅含目标窗口且 Retina 清晰（人工目检）', {
  skip: '人工目检：在任意应用前台执行 `--cli-capture --output /tmp/x.png`，用预览打开，核对仅含目标窗口、无桌面/背景、文字清晰锐利',
}, () => {})
