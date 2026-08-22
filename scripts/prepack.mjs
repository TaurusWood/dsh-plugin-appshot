#!/usr/bin/env node
/**
 * scripts/prepack.mjs — npm pack/publish 前的平台感知构建与产物 Gate。
 *
 * 权威依据：docs/technical-windows.md §7.4（双 runner 装配 + 包内容 Gate / G8）。
 * - 宿主与客户端 bundle（pnpm build）在所有平台执行；
 * - Native 产物只在本平台构建：darwin 构建 Swift Agent，win32 执行 dotnet publish；
 *   其他平台（CI 装配机）跳过构建，产物由双 runner artifact 还原后经 Gate 校验；
 * - Gate：CI 环境（CI=true）要求两端产物同时存在且无调试符号，缺失即非零退出阻断发布；
 *   本地打包只要求当前平台产物存在（单平台包不作为正式跨平台发布源，§7.4 第 6 条）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WIN_EXE = 'native/windows/bin/win-x64/appshot-win-x64.exe'
const WIN_DIR = 'native/windows/bin/win-x64'
const MAC_APP = 'native/macos/.build/Appshot Agent.app'
const isCI = process.env.CI === 'true'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('pnpm', ['build'])

if (process.platform === 'darwin') {
  run('pnpm', ['build:native'])
} else if (process.platform === 'win32') {
  run('pnpm', ['build:native:windows'])
} else {
  console.log(`[prepack] ${process.platform}: skip native build (CI assemble expects artifacts in place)`)
}

let failed = false
const winOk = existsSync(WIN_EXE)
const macOk = existsSync(MAC_APP)

const requirePlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : null
if (requirePlatform === 'windows' && !winOk) {
  console.error(`[prepack] gate failed: ${WIN_EXE} missing after build`)
  failed = true
}
if (requirePlatform === 'macos' && !macOk) {
  console.error(`[prepack] gate failed: ${MAC_APP} missing after build`)
  failed = true
}

if (isCI) {
  if (!winOk) {
    console.error('[prepack] gate failed: windows agent artifact missing (expected from build-windows job)')
    failed = true
  }
  if (!macOk) {
    console.error('[prepack] gate failed: macos agent artifact missing (expected from build-macos job)')
    failed = true
  }
  if (winOk) {
    const strays = readdirSync(WIN_DIR).filter((f) => !f.endsWith('.exe'))
    if (strays.length > 0) {
      console.error(`[prepack] gate failed: debug symbols/unexpected files in ${WIN_DIR}: ${strays.join(', ')}`)
      failed = true
    }
  }
} else if (requirePlatform !== null) {
  const other = requirePlatform === 'windows' ? `macos (${MAC_APP})` : `windows (${WIN_EXE})`
  const otherOk = requirePlatform === 'windows' ? macOk : winOk
  if (!otherOk) {
    console.warn(`[prepack] warn: ${other} artifact absent — local single-platform pack, not a release source`)
  }
}

if (failed) process.exit(1)
console.log('[prepack] gate passed')
