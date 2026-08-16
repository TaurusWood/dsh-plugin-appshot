/**
 * Phase 7 / T7.2 — Accessibility 结构化文本提取（Post-MVP）
 *
 * 目标（docs/tasks.md T7.2）：macOS `AXUIElement` / Windows `UIAutomation`
 * 提取前台窗口的结构化文本（标题、按钮、输入框等）。
 *
 * 验收要点（落地后转为可执行测试）：
 * - 对前台窗口返回结构化元素树/文本，且不阻塞截图主流程；
 * - 权限不足（Accessibility）时走统一错误模型，不崩溃。
 */
import { test } from 'node:test'

test('T7.2 Accessibility 结构化文本提取（Post-MVP 占位）', {
  skip: 'Post-MVP（Phase 7）暂无实现；落地时覆盖：AXUIElement/UIAutomation 提取前台窗口结构化文本、权限不足时的错误上报',
}, () => {})
