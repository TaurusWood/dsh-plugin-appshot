/**
 * src/windows/config-store.ts — Windows 配置持久化（用户级 JSON 文件）。
 *
 * 宿主重启后设置不再重置：applyWindows 启动时读取、onConfigUpdate 时原子写。
 * - 位置：%APPDATA%\dsh-plugin-appshot\config.json（无 APPDATA 时 ~/.dsh-plugin-appshot/）；
 * - 读取宽容：文件不存在、JSON 损坏或字段非法一律回退默认值，不阻断启动；
 * - 写入原子：tmp 文件 + rename 覆盖，失败仅告警（内存配置仍然生效）。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppshotConfig } from '../shared/types.ts'
import { isValidWindowsHotkeys } from '../shared/types.ts'

const SHORTCUT_MODES: readonly AppshotConfig['shortcutMode'][] = [
  'double-cmd', 'double-option', 'double-control', 'cmd-option', 'double-ctrl', 'custom',
]

export const DEFAULT_WINDOWS_CONFIG: AppshotConfig = {
  platform: 'win32',
  shortcutMode: 'double-ctrl',
  windowsHotkeys: { left: 'lctrl', right: 'rctrl' },
  soundEnabled: true,
  animationEnabled: true,
}

/** 默认持久化路径：Windows 惯例 %APPDATA%，其余平台回退用户主目录点目录。 */
export function resolveConfigStorePath(): string {
  const appdata = process.env.APPDATA
  if (appdata) return join(appdata, 'dsh-plugin-appshot', 'config.json')
  const home = process.env.HOME ?? tmpdir()
  return join(home, '.dsh-plugin-appshot', 'config.json')
}

/** 白名单字段校验：只接受已知枚举与布尔值，任何非法字段丢弃（不影响其余字段）。 */
export function sanitizeWindowsConfig(raw: unknown): AppshotConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const config: AppshotConfig = {}
  if (typeof source.shortcutMode === 'string' && (SHORTCUT_MODES as readonly string[]).includes(source.shortcutMode)) {
    config.shortcutMode = source.shortcutMode as AppshotConfig['shortcutMode']
  }
  if (isValidWindowsHotkeys(source.windowsHotkeys)) {
    config.windowsHotkeys = { ...source.windowsHotkeys }
  }
  if (typeof source.soundEnabled === 'boolean') config.soundEnabled = source.soundEnabled
  if (typeof source.animationEnabled === 'boolean') config.animationEnabled = source.animationEnabled
  return Object.keys(config).length > 0 ? config : null
}

/** 读取持久化配置；不存在/损坏/全字段非法时返回 null（调用方回退默认值）。 */
export async function loadWindowsConfig(path: string): Promise<AppshotConfig | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return sanitizeWindowsConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 原子写持久化配置；成功返回 true，失败返回 false（不抛出）。 */
export async function saveWindowsConfig(path: string, config: AppshotConfig): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    await rename(tmp, path)
    return true
  } catch {
    return false
  }
}
