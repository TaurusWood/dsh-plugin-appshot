/**
 * Phase 3 / T3.1 — 全局按键状态机（双 Command）
 *
 * 通过标准（docs/tasks.md T3.1）：
 *   > 快速按下双 Command 时稳定触发，长按 5 秒仅触发 1 次，单按 Command 绝不误触。
 *
 * 状态机为 Swift 原生逻辑（CGEventTap 事件流），Node 侧无法直接单测，
 * 本文件以机上人工验收用例承载（skip 携带精确按键序列与预期）。
 *
 * 建议：T3.1 落地时把状态机提取为纯 Swift 类型（如 `DoubleCommandStateMachine`），
 * 并在 native/macos 增加 XCTest test target 做单元测试（当前 Package.swift 无
 * test target，避免引入未经编译验证的测试基建）。
 */
import { test } from 'node:test'

test('快速按下 LeftCmd + RightCmd → 恰好触发 1 次（主流程）', {
  skip: '人工验收：快速依次按下 Left Command 与 Right Command 后同时释放；预期恰好触发 1 次截图（观测日志中的 appshot 事件计数）',
}, () => {})

test('长按 5 秒仅触发 1 次（主流程/常规边界）', {
  skip: '人工验收：按住 Left Command + Right Command 保持 5 秒再释放；预期整个按压期间仅触发 1 次，长按不重复触发',
}, () => {})

test('单按任一 Command 不触发（常规边界）', {
  skip: '人工验收：仅按 Left Command 后释放、仅按 Right Command 后释放；预期均不触发截图',
}, () => {})

test('触发后必须先释放才能再次触发（常规边界）', {
  skip: '人工验收：触发一次后保持双键按住不放再快速连点（不释放），预期不产生第二次触发；释放双键后重新按下，预期产生第二次触发',
}, () => {})
