/**
 * src/windows/safe-ingest.ts — Windows Basic Staging 安全 Ingest 与孤儿 GC（生产实现）。
 *
 * 权威依据：docs/technical-windows.md §6（安全边界与临时文件生命周期）+ §3.4 尺寸上限；
 * 产品合同：docs/requirements-windows.md §7。
 *
 * 规则要点：
 * - 严格路径白名单：realpath(stagingDir) 为根，relative 校验防兄弟目录/盘符穿越，
 *   文件名必须严格等于 `${captureId}.png`（captureId 先经 UUID parser 校验）；
 * - 只有 validate 成功返回的 realImage 可进入读取/清理流程；校验失败绝不 unlink 输入路径；
 * - 校验 PNG 签名 + IHDR 宽高（8K 上限，横竖可对调）+ 20MB 上限，IHDR 与 IPC 元数据一致；
 * - 读取字节后立即 unlink；PID + Lock 双重检查孤儿 GC（Owner PID 死亡且目录修改时间 > 24h 才清理）。
 */

import { promises as fs } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import type { WindowsCaptureMetadata } from './types.ts'
import { isValidCaptureId } from './state-machine.ts'

export const MAX_PNG_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_WIDTH = 7680
export const MAX_IMAGE_HEIGHT = 4320

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * 严格 Windows Staging 路径与文件名安全校验。
 * 校验通过返回规范化后的真实路径（唯一可进入读取/清理流程的路径）。
 */
export async function validateWindowsStagingPath(
  stagingDir: string,
  imagePath: string,
  expectedCaptureId: string,
): Promise<string> {
  if (!isValidCaptureId(expectedCaptureId)) {
    throw new Error(`Security Alert: Invalid captureId ${expectedCaptureId}`)
  }

  const realStaging = await fs.realpath(resolve(stagingDir))
  const realImage = await fs.realpath(resolve(imagePath))
  const rel = relative(realStaging, realImage)

  // 1. 必须严格位于 stagingDir 之内（防兄弟目录、父目录遍历、盘符穿越、符号链接/重解析点）
  if (rel.startsWith('..') || rel.includes(':') || rel.includes('/') || rel.includes('\\')) {
    throw new Error(`Security Alert: Path traversal detected: ${imagePath}`)
  }

  // 2. 文件名必须严格等于 ${expectedCaptureId}.png
  const expectedName = `${expectedCaptureId}.png`
  if (basename(realImage) !== expectedName) {
    throw new Error(`Security Alert: Filename mismatch. Expected ${expectedName}, got ${basename(realImage)}`)
  }

  return realImage
}

export interface PngValidationResult {
  valid: boolean
  error?: string
  width?: number
  height?: number
}

/** 校验 PNG 头部与尺寸边界（防伪造文件与超大文件 DoS）。 */
export function validatePngPayload(
  bytes: Uint8Array,
  maxWidth = MAX_IMAGE_WIDTH,
  maxHeight = MAX_IMAGE_HEIGHT,
  maxBytes = MAX_PNG_BYTES,
): PngValidationResult {
  if (bytes.length > maxBytes) {
    return { valid: false, error: 'IMAGE_TOO_LARGE' }
  }

  if (bytes.length < 8) return { valid: false, error: 'INVALID_PNG_HEADER' }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return { valid: false, error: 'INVALID_PNG_HEADER' }
    }
  }

  // 解析 IHDR chunk 获取宽高（PNG 结构：8B signature + 4B length + 4B "IHDR" + 4B width + 4B height，Big-Endian）
  if (bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16, false)
    const height = view.getUint32(20, false)
    if (width > maxWidth || height > maxHeight) {
      return { valid: false, error: 'IMAGE_DIMENSION_EXCEEDED' }
    }
    return { valid: true, width, height }
  }

  return { valid: true }
}

export interface IngestWindowsResult {
  captureId: string
  payload: Uint8Array
  metadata: WindowsCaptureMetadata
  isFallback: boolean
  fallbackReason: string | null
  realImage: string
}

/**
 * 安全 Ingest：校验路径 → 校验尺寸/签名 → 读入字节 → 立即 unlink。
 * 任何失败分支都不对输入原路径执行 unlink（只清理已验证的 realImage）。
 */
export async function ingestWindowsScreenshot(
  stagingDir: string,
  imagePath: string,
  captureId: string,
  frame: {
    appName: string
    windowTitle?: string
    width: number
    height: number
    isFallback: boolean
    fallbackReason: string | null
    timestamp: number
  },
): Promise<IngestWindowsResult> {
  const realImage = await validateWindowsStagingPath(stagingDir, imagePath, captureId)

  let payload: Uint8Array
  try {
    const st = await fs.stat(realImage)
    if (st.size > MAX_PNG_BYTES) {
      throw new Error('IMAGE_TOO_LARGE')
    }
    payload = new Uint8Array(await fs.readFile(realImage))
  } catch (err) {
    throw err
  }

  const pngCheck = validatePngPayload(payload)
  if (!pngCheck.valid) {
    // 校验失败：仅清理已验证路径，不交付
    await fs.unlink(realImage).catch(() => {})
    throw new Error(pngCheck.error ?? 'INVALID_PNG')
  }

  // IHDR 必须存在（不足 24 字节无法解析宽高，视为非法结构）
  if (pngCheck.width === undefined || pngCheck.height === undefined) {
    await fs.unlink(realImage).catch(() => {})
    throw new Error('INVALID_PNG_HEADER')
  }

  // IHDR 宽高必须与 IPC 元数据一致（横竖对调允许，绝对值必须吻合）
  const width = pngCheck.width
  const height = pngCheck.height
  const frameW = Math.max(frame.width, frame.height)
  const frameH = Math.min(frame.width, frame.height)
  if (width !== undefined && height !== undefined) {
    const pngW = Math.max(width, height)
    const pngH = Math.min(width, height)
    if (pngW !== frameW || pngH !== frameH) {
      await fs.unlink(realImage).catch(() => {})
      throw new Error('IHDR_METADATA_MISMATCH')
    }
  }

  // 读取成功后立即删除 Staging 文件（单一 Owner：Node Pending 成为 ACK 前唯一可重放副本）
  await fs.unlink(realImage)

  const metadata: WindowsCaptureMetadata = {
    appName: frame.appName,
    windowTitle: frame.windowTitle,
    mediaType: 'image/png',
    width,
    height,
    bytes: payload.length,
    timestamp: frame.timestamp,
  }

  return {
    captureId,
    payload,
    metadata,
    isFallback: frame.isFallback,
    fallbackReason: frame.fallbackReason,
    realImage,
  }
}

// ── 孤儿 GC：PID + Lock 双重检查 ─────────────────────────────────────────

export interface InstanceLockInfo {
  ownerPid: number
  instanceId: string
}

export interface CleanupDecision {
  shouldClean: boolean
  reason: string
}

/**
 * 孤儿清理判定：仅当 Owner PID 进程已死亡 且 目录修改时间 > 24 小时 时清理。
 * 防止误删长期空闲的活跃实例目录。
 */
export function shouldCleanInstanceDir(
  ownerPid: number,
  dirModifiedAgeHours: number,
  isProcessAlive: (pid: number) => boolean,
): CleanupDecision {
  if (isProcessAlive(ownerPid)) {
    return { shouldClean: false, reason: 'OWNER_ALIVE' }
  }
  if (dirModifiedAgeHours <= 24) {
    return { shouldClean: false, reason: 'TOO_RECENT' }
  }
  return { shouldClean: true, reason: 'OWNER_DEAD_AND_OLD' }
}

/**
 * 扫描实例根目录（%TEMP%\dsh-appshot）下所有 `<pid>-<instanceId>` 子目录，
 * 按 PID + Lock 双重检查清理孤儿实例目录。
 */
export async function cleanOrphanWindowsStagingDirs(
  rootDir: string,
  now: number = Date.now(),
  isProcessAlive: (pid: number) => boolean = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
): Promise<number> {
  let entries
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true })
  } catch {
    return 0 // 根目录不存在时不抛错
  }

  let cleaned = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = resolve(rootDir, entry.name)
    const match = /^(\d+)-(.+)$/.exec(entry.name)
    if (!match) continue

    const ownerPid = Number(match[1])
    const lockPath = resolve(dirPath, 'instance.lock')
    let lockInfo: InstanceLockInfo | null = null
    try {
      const raw = await fs.readFile(lockPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<InstanceLockInfo>
      if (typeof parsed.ownerPid === 'number' && typeof parsed.instanceId === 'string') {
        lockInfo = { ownerPid: parsed.ownerPid, instanceId: parsed.instanceId }
      }
    } catch {
      // 无 lock 文件：目录名中的 pid 作为 Owner
    }

    const effectivePid = lockInfo?.ownerPid ?? ownerPid
    try {
      const st = await fs.stat(dirPath)
      const ageHours = (now - st.mtimeMs) / 3_600_000
      const decision = shouldCleanInstanceDir(effectivePid, ageHours, isProcessAlive)
      if (decision.shouldClean) {
        await fs.rm(dirPath, { recursive: true, force: true })
        cleaned++
      }
    } catch {
      // 单目录失败忽略
    }
  }
  return cleaned
}

export async function writeInstanceLock(dirPath: string, info: InstanceLockInfo): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
  await fs.writeFile(resolve(dirPath, 'instance.lock'), JSON.stringify(info), 'utf-8')
}
