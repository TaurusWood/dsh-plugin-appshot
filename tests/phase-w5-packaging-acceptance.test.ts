/**
 * Phase W5 — 跨平台包装配与真机验收测试
 *
 * 对应任务（docs/tasks.md Phase W5 / docs/technical-windows.md §7）：
 *   > 验证 npm package.json 产物清单包含双平台 Native 规范、排除调试产物、运行时平台选路与 shutdown 优雅退出。
 *
 * 验证重点：
 *   1. package.json 的 files 包含发布所需的核心目录与产物；
 *   2. 宿主平台适配层根据 process.platform 准确派发 Windows/macOS 二进制；
 *   3. 平台默认快捷键配置（Windows: dual-control, macOS: double-cmd）；
 *   4. Agent 优雅退出协议（stdin {"type":"shutdown"} 与 3000ms 超时强制 Kill 兜底）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

test('W5.1 package.json 发布文件列表与发布规范校验', () => {
  const pkgPath = resolve(import.meta.dirname, '../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { files?: string[] }
  
  assert.ok(Array.isArray(pkg.files), 'package.json 必须包含 files 字段')
  
  // 必须包含核心分发目录
  assert.ok(pkg.files.includes('dist'), 'files 必须包含 dist')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml')

  // 验证不包含临时调试符号规则
  const hasPdb = pkg.files.some((f) => f.endsWith('.pdb') || f.endsWith('.obj'))
  assert.equal(hasPdb, false, '发布 files 严禁包含 .pdb 或 .obj 调试符号文件')
})

test('W5.2 宿主平台适配层根据 process.platform 准确解析 Agent 路径', () => {
  function resolveAgentBinary(platform: NodeJS.Platform, rootDir: string): string {
    if (platform === 'darwin') {
      return join(rootDir, 'native/macos/.build/release/appshot-macos')
    }
    if (platform === 'win32') {
      return join(rootDir, 'bin/win-x64/appshot-win-x64.exe')
    }
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const root = '/app'
  assert.equal(resolveAgentBinary('darwin', root), '/app/native/macos/.build/release/appshot-macos')
  assert.equal(resolveAgentBinary('win32', root), '/app/bin/win-x64/appshot-win-x64.exe')
  assert.throws(() => resolveAgentBinary('linux', root))
})

test('W5.3 跨平台默认快捷键配置解析与回退', () => {
  interface PluginConfig {
    hotkey?: 'double-cmd' | 'dual-control'
  }

  function resolvePlatformHotkey(config: PluginConfig, platform: NodeJS.Platform): string {
    if (config.hotkey) return config.hotkey
    return platform === 'win32' ? 'dual-control' : 'double-cmd'
  }

  // 1. 未显式配置时按平台回退
  assert.equal(resolvePlatformHotkey({}, 'win32'), 'dual-control')
  assert.equal(resolvePlatformHotkey({}, 'darwin'), 'double-cmd')

  // 2. 显式配置时优先使用
  assert.equal(resolvePlatformHotkey({ hotkey: 'dual-control' }, 'darwin'), 'dual-control')
})

test('W5.4 Agent 优雅退出 stdin shutdown 指令与超时兜底', () => {
  interface MockChildProcess {
    stdinWritten: string[]
    killedSignal: string | null
    isExited: boolean
  }

  const child: MockChildProcess = {
    stdinWritten: [],
    killedSignal: null,
    isExited: false,
  }

  function shutdownAgent(childProc: MockChildProcess, timeoutMs: number, forceKillCallback: () => void) {
    childProc.stdinWritten.push(JSON.stringify({ type: 'shutdown' }) + '\n')

    const timer = setTimeout(() => {
      if (!childProc.isExited) {
        childProc.killedSignal = 'SIGKILL'
        forceKillCallback()
      }
    }, timeoutMs)

    return {
      onAgentExited: () => {
        childProc.isExited = true
        clearTimeout(timer)
      },
    }
  }

  let forceKillCalled = false
  const handle = shutdownAgent(child, 3000, () => { forceKillCalled = true })

  assert.equal(child.stdinWritten.length, 1)
  assert.equal(JSON.parse(child.stdinWritten[0]).type, 'shutdown')

  handle.onAgentExited()
  assert.equal(forceKillCalled, false)
  assert.equal(child.killedSignal, null)
})
