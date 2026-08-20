/**
 * tests/helpers/windows-probe.ts — Windows DSH 真机环境门控探测。
 *
 * 依据 AGENTS.md 与 tasks.md W0 Gate：
 *   非 Windows 平台或未连接真实 Windows DSH Desktop 时，真机接口测试必须明确 skip，
 *   不能用自建 Mock 自证为绿。
 */
import process from 'node:process'

export function getWindowsDshSmokeGate(): { isAvailable: boolean; skipReason: string | false } {
  const isWindows = process.platform === 'win32'
  const isSmokeEnabled = process.env.DSH_WINDOWS_SMOKE_ENABLED === '1'

  if (!isWindows) {
    return {
      isAvailable: false,
      skipReason: `[Gate W0] 当前运行环境为 ${process.platform}，非 Windows 系统；真机接口 Gate 仅在 Windows DSH Desktop 上执行。`,
    }
  }

  if (!isSmokeEnabled) {
    return {
      isAvailable: false,
      skipReason: '[Gate W0] 真实 Windows DSH Smoke 未启用（需设置环境变量 DSH_WINDOWS_SMOKE_ENABLED=1 并运行 DSH Desktop）。',
    }
  }

  return {
    isAvailable: true,
    skipReason: false,
  }
}
