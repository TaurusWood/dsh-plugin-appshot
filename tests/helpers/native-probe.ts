/**
 * tests/helpers/native-probe.ts — 探测 native 二进制在当前环境可用性，
 * 供各阶段 native 相关测试决定 skip 理由。
 *
 * 分级：
 * - binary-missing：未执行 `swift build`，二进制不存在；
 * - permission-denied：无屏幕录制权限（SCREEN_PERMISSION_DENIED）；
 * - ready：`--list-windows` 返回合法窗口数组；
 * - unexpected：其它异常输出（含 CLI 崩溃），测试应红并携带诊断信息。
 */

import { nativeBinaryExists, parseFirstJsonLine, runNative } from './run-native.ts'

export interface NativeProbe {
  status: 'binary-missing' | 'permission-denied' | 'ready' | 'unexpected'
  detail: string
}

export async function probeNative(): Promise<NativeProbe> {
  if (!nativeBinaryExists()) {
    return { status: 'binary-missing', detail: 'native/macos/appshot-macos 未构建（先执行 swift build）' }
  }
  const result = await runNative(['--list-windows'], { timeoutMs: 15_000 })
  // 先按 stdout 分类再判退出码：TCC 并发抖动时错误 JSON 可能伴随非 0 退出码
  let parsed: unknown
  try {
    parsed = parseFirstJsonLine(result.stdout)
  } catch {
    if (result.code !== 0) {
      return {
        status: 'unexpected',
        detail: `--list-windows exit=${result.code} signal=${result.signal} 且 stdout 无 JSON（stderr=${result.stderr.trim().slice(0, 200)}）`,
      }
    }
    return { status: 'unexpected', detail: '--list-windows 输出不是合法 JSON' }
  }
  if (Array.isArray(parsed)) {
    if (result.code !== 0) {
      return { status: 'unexpected', detail: `--list-windows 返回数组但 exit=${result.code}` }
    }
    return { status: 'ready', detail: `窗口列表 ${parsed.length} 条` }
  }
  const obj = parsed as { code?: unknown }
  if (obj && obj.code === 'SCREEN_PERMISSION_DENIED') {
    return {
      status: 'permission-denied',
      detail: '当前会话未授予屏幕录制权限（System Settings → Privacy & Security → Screen & System Audio Recording）',
    }
  }
  return { status: 'unexpected', detail: `--list-windows 返回未知输出: ${JSON.stringify(parsed).slice(0, 200)}` }
}

/** 生成 native 行为测试的 skip 理由；`false` 表示可以运行。 */
export function nativeSkipReason(probe: NativeProbe): string | false {
  if (probe.status === 'ready') return false
  return `native 集成测试未启用：${probe.detail}`
}
