/**
 * Phase 2 / T2.1 — Agent.app 打包与签名
 *
 * 通过标准（docs/tasks.md T2.1）：
 *   > Agent.app 在当前 GUI 会话中静默启动，Activity Monitor 中可见进程，
 *   > Dock 栏无图标。
 *
 * 自动化覆盖（主流程 + 常规边界）：Info.plist 关键项（LSUIElement / Bundle ID /
 * 包类型）与可执行入口、代码签名存在性。Agent.app 未构建前全部 skip
 * （T2.1 尚未落地时保持 skip，构建后自动激活）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const AGENT_APP = fileURLToPath(
  new URL('../native/macos/.build/Appshot Agent.app', import.meta.url),
)
const INFO_PLIST = fileURLToPath(
  new URL('../native/macos/.build/Appshot Agent.app/Contents/Info.plist', import.meta.url),
)
const agentBuilt = existsSync(INFO_PLIST)
const skipReason = agentBuilt
  ? false
  : 'T2.1 未构建：缺少 .build/Appshot Agent.app（在 native/macos 执行 ./build-agent-app.sh 后自动激活）'

async function readInfoPlist(): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', INFO_PLIST])
  return JSON.parse(stdout) as Record<string, unknown>
}

test('Info.plist 声明 LSUIElement=true（无 Dock 图标，主流程）', { skip: skipReason }, async () => {
  const plist = await readInfoPlist()
  assert.equal(plist.LSUIElement, true, 'LSUIElement 必须为 true（后台应用，无 Dock 图标）')
})

test('Bundle ID = com.deepseek-harness.appshot-agent（主流程）', { skip: skipReason }, async () => {
  const plist = await readInfoPlist()
  assert.equal(plist.CFBundleIdentifier, 'com.deepseek-harness.appshot-agent')
})

test('CFBundlePackageType = APPL（常规边界）', { skip: skipReason }, async () => {
  const plist = await readInfoPlist()
  assert.equal(plist.CFBundlePackageType, 'APPL')
})

test('Agent.app 包含可执行入口（主流程）', { skip: skipReason }, () => {
  const macosDir = fileURLToPath(
    new URL('../native/macos/.build/Appshot Agent.app/Contents/MacOS', import.meta.url),
  )
  const entries = readdirSync(macosDir)
  assert.ok(entries.length >= 1, 'Contents/MacOS 下应存在可执行文件')
})

test('Agent.app 已代码签名（常规边界）', { skip: skipReason }, async () => {
  await assert.doesNotReject(
    execFileAsync('/usr/bin/codesign', ['-dv', '--verbose=2', AGENT_APP]),
    'Agent.app 必须已签名（本地开发与发布签名对齐，保证 TCC 权限稳定）',
  )
})

test('手动：Agent.app 静默启动、Activity Monitor 可见、Dock 无图标（人工验收）', {
  skip: '人工验收：启动 Agent.app，核对 Activity Monitor 中进程存在、Dock 栏无图标、菜单栏无额外图标',
}, () => {})
