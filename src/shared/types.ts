export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export interface SaveImageInput {
  data: Uint8Array
  mediaType: ImageMediaType
  name?: string
}

export interface AppshotEventReady {
  type: 'ready'
  version: number
  pid?: number
  bundleId?: string
}

export interface AppshotEventCapture {
  type: 'appshot'
  id?: string
  platform?: string
  appName: string
  windowTitle?: string
  windowId?: number
  width?: number
  height?: number
  mimeType?: string
  imagePath: string
  timestamp?: number
}

export interface AppshotConfig {
  platform?: 'win32' | 'darwin'
  shortcutMode?: 'double-cmd' | 'double-option' | 'double-control' | 'cmd-option' | 'double-ctrl' | 'custom'
  /** Windows 修饰键组合（双 Ctrl 预设 = lctrl+rctrl）；池子排除 Shift/Win（系统副作用）。 */
  windowsHotkeys?: WindowsHotkeys
  soundEnabled?: boolean
  animationEnabled?: boolean
}

/** Windows 触发键修饰键池（lctrl=0xA2 / rctrl=0xA3 / lalt=0xA4 / ralt=0xA5 / lshift=0xA0 / rshift=0xA1）；Win 因开始菜单副作用排除。 */
export type WindowsModifierKey = 'lctrl' | 'rctrl' | 'lalt' | 'ralt' | 'lshift' | 'rshift'

export const WINDOWS_MODIFIER_KEYS: readonly WindowsModifierKey[] = [
  'lctrl', 'rctrl', 'lalt', 'ralt', 'lshift', 'rshift',
]

export function isWindowsModifierKey(value: unknown): value is WindowsModifierKey {
  return typeof value === 'string' && (WINDOWS_MODIFIER_KEYS as readonly string[]).includes(value)
}

export function isValidWindowsHotkeys(value: unknown): value is WindowsHotkeys {
  if (value === null || typeof value !== 'object') return false
  const hk = value as { left?: unknown; right?: unknown }
  return isWindowsModifierKey(hk.left) && isWindowsModifierKey(hk.right) && hk.left !== hk.right
}

export interface WindowsHotkeys {
  left: WindowsModifierKey
  right: WindowsModifierKey
}

export interface AppshotEventError {
  type: 'error'
  id?: string
  code: string
  message: string
}

export type AppshotEvent = AppshotEventReady | AppshotEventCapture | AppshotEventError
