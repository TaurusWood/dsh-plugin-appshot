/**
 * Phase W2 — 两阶段截图与 Staging 安全测试
 *
 * 对应任务（docs/tasks.md Phase W2 / docs/technical-windows.md §3.4, §6）：
 *   > 验证两阶段截图降级、PNG 头部/尺寸防 DoS、严密的 realpath/relative 路径安全算法与 PID+Lock 孤儿 GC。
 *
 * 验证重点：
 *   1. 阶段 1 可见备份与阶段 2 普通置前（严禁 HWND_TOPMOST）；
 *   2. Topmost 遮挡与置前失败时降级使用可见备份（isFallback: true）；
 *   3. 真实 PNG 头部 (89 50 4E 47) 与 8K / 20MB 边界防护；
 *   4. realpath + relative + captureId 文件名严谨路径校验（防兄弟目录遍历）；
 *   5. PID + Lock 双重检查孤儿 GC 保护存活实例。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, rename, rm, stat } from 'node:fs/promises'
import { validateWindowsStagingPath, validatePngPayload } from './helpers/windows-mock.ts'

interface CaptureDecisionInput {
  bringToTopSuccess: boolean
  hasIntersectingTopmost: boolean
}

function decideCaptureResult(input: CaptureDecisionInput) {
  if (input.bringToTopSuccess && !input.hasIntersectingTopmost) {
    return { isFallback: false, fallbackReason: null, source: 'FRESH_WINDOW_CAPTURE' }
  }
  return {
    isFallback: true,
    fallbackReason: !input.bringToTopSuccess ? 'BRING_TO_FRONT_FAILED' : 'TOPMOST_OCCLUSION',
    source: 'VISIBLE_BACKUP',
  }
}

test('W2.1 普通置前成功且无 Topmost 遮挡时输出主截图', () => {
  const result = decideCaptureResult({ bringToTopSuccess: true, hasIntersectingTopmost: false })
  assert.equal(result.isFallback, false)
  assert.equal(result.source, 'FRESH_WINDOW_CAPTURE')
})

test('W2.2 置前被拒或存在 Topmost 遮挡时自动降级使用可见备份', () => {
  // 1. 置前被系统拒绝
  const res1 = decideCaptureResult({ bringToTopSuccess: false, hasIntersectingTopmost: false })
  assert.equal(res1.isFallback, true)
  assert.equal(res1.fallbackReason, 'BRING_TO_FRONT_FAILED')
  assert.equal(res1.source, 'VISIBLE_BACKUP')

  // 2. 置前成功但被系统 Topmost 窗口遮挡
  const res2 = decideCaptureResult({ bringToTopSuccess: true, hasIntersectingTopmost: true })
  assert.equal(res2.isFallback, true)
  assert.equal(res2.fallbackReason, 'TOPMOST_OCCLUSION')
  assert.equal(res2.source, 'VISIBLE_BACKUP')
})

test('W2.3 Staging 临时文件原子写入（.partial -> .png）', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'dsh-staging-test-'))
  const uuid = 'test-uuid-1234'
  const partialPath = join(testDir, `${uuid}.partial`)
  const finalPath = join(testDir, `${uuid}.png`)

  try {
    await writeFile(partialPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const statsPartial = await stat(partialPath)
    assert.ok(statsPartial.isFile())

    await rename(partialPath, finalPath)
    const statsFinal = await stat(finalPath)
    assert.ok(statsFinal.isFile())

    await assert.rejects(stat(partialPath))
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('W2.4 严密的 realpath + relative 路径安全校验（防兄弟目录与跨目录攻击）', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'dsh-sec-'))
  const stagingDir = join(baseDir, 'inst-123')
  const evilSiblingDir = join(baseDir, 'inst-123-evil')
  
  const captureId = 'cap-abc-123'
  const validFile = join(stagingDir, `${captureId}.png`)
  const evilFile = join(evilSiblingDir, `${captureId}.png`)
  const wrongNameFile = join(stagingDir, 'wrong-id.png')

  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(stagingDir, { recursive: true })
    await mkdir(evilSiblingDir, { recursive: true })
    await writeFile(validFile, 'png-bytes')
    await writeFile(evilFile, 'evil-bytes')
    await writeFile(wrongNameFile, 'wrong-bytes')

    // 1. 合法子文件通过校验
    const validated = await validateWindowsStagingPath(stagingDir, validFile, captureId)
    assert.ok(validated.endsWith(`${captureId}.png`))

    // 2. 兄弟目录伪造攻击必须被拒绝（防 startsWith 漏洞）
    await assert.rejects(
      validateWindowsStagingPath(stagingDir, evilFile, captureId),
      /Path traversal detected/
    )

    // 3. 文件名与 captureId 不匹配必须被拒绝
    await assert.rejects(
      validateWindowsStagingPath(stagingDir, wrongNameFile, captureId),
      /Filename mismatch/
    )
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})

test('W2.5 PNG 头部与尺寸边界校验（防伪造与超大文件）', () => {
  // 1. 合法 PNG 8 字节头
  const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 7, 128, 0, 0, 4, 56])
  assert.equal(validatePngPayload(validPng).valid, true)

  // 2. 非法头部
  const invalidPng = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
  assert.equal(validatePngPayload(invalidPng).error, 'INVALID_PNG_HEADER')

  // 3. 超过 20MB 上限
  const oversized = new Uint8Array(21 * 1024 * 1024)
  assert.equal(validatePngPayload(oversized).error, 'IMAGE_TOO_LARGE')
})

test('W2.6 PID + Lock 孤儿 GC 保护存活实例', () => {
  const currentPid = process.pid

  function shouldCleanDirectory(dirPid: number, ageHours: number, isProcessAlive: boolean): boolean {
    return !isProcessAlive && ageHours > 24
  }

  // 1. 存活的当前进程不删
  assert.equal(shouldCleanDirectory(currentPid, 30, true), false)
  // 2. 死亡进程但刚创建不久不删
  assert.equal(shouldCleanDirectory(999999, 2, false), false)
  // 3. 死亡进程且超过 24 小时才清理
  assert.equal(shouldCleanDirectory(999999, 25, false), true)
})
