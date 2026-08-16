/**
 * Phase 7 / T7.4 — 自定义快捷键配置面板（Post-MVP）
 *
 * 目标（docs/tasks.md T7.4）：提供配置面板，用户可自定义全局快捷键
 * （如 `Cmd + Shift + 8` 作为双 Command 的冲突回退方案，见 requirements.md FR-01）。
 *
 * 验收要点（落地后转为可执行测试）：
 * - 修改快捷键后立即生效（不重启 DSH）；
 * - 与其它应用快捷键冲突时上报 SHORTCUT_CONFLICT 并给出系统通知提示。
 */
import { test } from 'node:test'

test('T7.4 自定义快捷键配置面板（Post-MVP 占位）', {
  skip: 'Post-MVP（Phase 7）暂无实现；落地时覆盖：快捷键配置持久化与即时生效、冲突检测（SHORTCUT_CONFLICT）',
}, () => {})
