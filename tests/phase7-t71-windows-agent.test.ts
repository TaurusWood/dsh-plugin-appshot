/**
 * Phase 7 / T7.1 — Windows Native Agent（Post-MVP）
 *
 * 目标（docs/tasks.md T7.1）：C# / `Windows.Graphics.Capture` 实现 Windows 端
 * Native Agent（双 Command 全局快捷键 + 前台窗口截图 + DSH 唤起）。
 *
 * 验收要点（落地后转为可执行测试）：
 * - Windows 上前台应用触发双 Command 可稳定截取其主窗口；
 * - 复用同一套 NDJSON IPC 契约（platform: "win32"）与 SSE 广播协议；
 * - 遵守「先截后唤」与「单一 Owner」规则。
 */
import { test } from 'node:test'

test('T7.1 Windows Native Agent（Post-MVP 占位）', {
  skip: 'Post-MVP（Phase 7）暂无实现；落地时覆盖：win32 平台双 Command 触发、前台窗口截图、NDJSON IPC（platform:"win32"）、先截后唤',
}, () => {})
