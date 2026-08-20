/**
 * tests/helpers/windows-mock.ts — Windows Basic 测试辅助与 Mock 环境。
 */
import { realpath } from 'node:fs/promises'
import { relative, resolve, basename } from 'node:path'

export interface RouteRegistration {
  kind: 'http' | 'ws'
  path: string
  handler: (req: any, res: any) => void | Promise<void>
}

export interface MockWindowsWebServer {
  routes: Map<string, RouteRegistration>
  register(route: RouteRegistration): void
}

export function createMockWindowsWebServer(): MockWindowsWebServer {
  const routes = new Map<string, RouteRegistration>()
  return {
    routes,
    register(route: RouteRegistration) {
      routes.set(route.path, route)
    },
  }
}

/**
 * 严格的 Windows Staging 路径与文件名安全校验（防兄弟目录、符号链接、重解析点与扩展名伪造）
 */
export async function validateWindowsStagingPath(
  stagingDir: string,
  imagePath: string,
  expectedCaptureId: string
): Promise<string> {
  const realStaging = await realpath(resolve(stagingDir))
  const realImage = await realpath(resolve(imagePath))
  const rel = relative(realStaging, realImage)

  // 1. 相对路径必须严格位于 stagingDir 之内（不以 .. 开头，且不包含父目录遍历）
  if (rel.startsWith('..') || rel.includes('/') || rel.includes('\\')) {
    throw new Error(`Security Alert: Path traversal detected: ${imagePath}`)
  }

  // 2. 文件名必须严格等于 ${expectedCaptureId}.png
  const expectedName = `${expectedCaptureId}.png`
  if (basename(realImage) !== expectedName) {
    throw new Error(`Security Alert: Filename mismatch. Expected ${expectedName}, got ${basename(realImage)}`)
  }

  return realImage
}

/**
 * 校验 PNG 头部与尺寸边界（防伪造文件与超大文件 DoS）
 */
export function validatePngPayload(bytes: Uint8Array, maxWidth = 7680, maxHeight = 4320, maxBytes = 20 * 1024 * 1024): { valid: boolean; error?: string } {
  if (bytes.length > maxBytes) {
    return { valid: false, error: 'IMAGE_TOO_LARGE' }
  }

  // 校验标准 8 字节 PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 8) return { valid: false, error: 'INVALID_PNG_HEADER' }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSig[i]) {
      return { valid: false, error: 'INVALID_PNG_HEADER' }
    }
  }

  // 解析 IHDR chunk 获取宽高 (第 16-23 字节: 4 字节 width + 4 字节 height, Big-Endian)
  if (bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16, false)
    const height = view.getUint32(20, false)
    if (width > maxWidth || height > maxHeight) {
      return { valid: false, error: 'IMAGE_DIMENSION_EXCEEDED' }
    }
  }

  return { valid: true }
}
