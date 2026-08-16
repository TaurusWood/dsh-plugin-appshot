/**
 * Phase 2 / T2.2 — TCC 权限检测与原生窗口唤起
 *
 * 通过标准（docs/tasks.md T2.2）：
 *   > 授权正常时，截图完成后 DSH 窗口立即平滑唤起置顶；未授权时弹出系统授权引导。
 *
 * 覆盖说明：
 * - 权限检测（CGPreflightScreenCaptureAccess / CGRequestScreenCaptureAccess）与
 *   NSRunningApplication 唤起均为 Native 原生逻辑，Node 侧无法直接单测，
 *   本文件以机上人工验收用例承载（skip 携带具体步骤）。
 * - “截图落盘后才唤起”的时序硬约束见 T5.2 与 docs/technical.md §4。
 */
import { test } from 'node:test'

test('未授权：弹出系统授权引导且不崩溃（主流程）', {
  skip: '人工验收：在未授予屏幕录制权限的会话中触发截图，核对系统设置授权面板弹出、无崩溃、随后可正常授权',
}, () => {})

test('授权正常：截图完成后 DSH 窗口平滑唤起置顶（主流程）', {
  skip: '人工验收：已授权会话中触发截图，核对截图落盘后 DSH 窗口被唤起并置顶（先截后唤，见 T5.2）',
}, () => {})

test('无权限时的错误上报与通知（常规边界）', {
  skip: '人工验收：拒绝屏幕录制权限后触发截图，核对 Node 侧收到 SCREEN_PERMISSION_DENIED 错误、macOS 系统通知出现提示、进程不崩溃',
}, () => {})
