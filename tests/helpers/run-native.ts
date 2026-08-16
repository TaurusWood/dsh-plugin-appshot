/**
 * tests/helpers/run-native.ts — 运行 native/macos/appshot-macos 二进制的工具。
 *
 * 二进制行为受环境（屏幕录制权限、GUI 会话、CG 初始化）影响，测试需自行判定
 * 前置条件（见 native-probe.ts）。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const NATIVE_BIN = fileURLToPath(
  new URL('../../native/macos/appshot-macos', import.meta.url),
)

export function nativeBinaryExists(): boolean {
  return existsSync(NATIVE_BIN)
}

export interface NativeRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export function runNative(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<NativeRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(NATIVE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 15_000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

/** 解析 stdout 的首个非空行（Native 端契约：单行 JSON）。 */
export function parseFirstJsonLine(stdout: string): unknown {
  const line = stdout.split('\n').find((l) => l.trim() !== '')
  if (line === undefined) throw new Error('stdout 为空，无 JSON 可解析')
  return JSON.parse(line)
}
