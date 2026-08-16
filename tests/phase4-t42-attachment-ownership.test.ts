/**
 * Phase 4 / T4.2 — Attachment 字节持久化与所有权原子转移
 *
 * 通过标准（docs/tasks.md T4.2）：
 *   > 连续截图 50 次，`/tmp` 目录下无任何未清理的 `dsh-appshot-*` 文件堆积。
 *
 * 计划模块边界（T4.2 落地时实现）：
 *   src/ingest.ts   ingestScreenshot(ctx, imagePath, appName) → Promise<ImageAttachmentRef>
 *                   （readFile → ctx.attachments.saveImage → finally unlink；单一 Owner）
 *   src/staging.ts  cleanOrphanStagingFiles(dir = '/tmp') → Promise<number>
 *                   （返回清理数量；过滤规则：startsWith('dsh-appshot-') && endsWith('.png')）
 *
 * 设计说明：清理函数接受显式目录参数以便测试（生产默认 /tmp，见 technical.md §7）。
 *
 * 红/绿语义：模块尚未实现，当前全部 skip；落地后自动激活。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DUMMY_PNG, fileExists, makeTempDir, removeDir, stagingFileName, writeFileBytes } from './helpers/fs.ts'
import { createMockCtx } from './helpers/mock-ctx.ts'

const ingestReady = existsSync(new URL('../src/ingest.ts', import.meta.url))
const stagingReady = existsSync(new URL('../src/staging.ts', import.meta.url))
const skipIngest = ingestReady
  ? false
  : 'T4.2 未实现：缺少 src/ingest.ts（落地后自动激活；模块名不同请同步本文件）'
const skipStaging = stagingReady
  ? false
  : 'T4.2 未实现：缺少 src/staging.ts（落地后自动激活；模块名不同请同步本文件）'

test('主流程：字节原样传入 saveImage，成功后立即 unlink', { skip: skipIngest }, async () => {
  const { ingestScreenshot } = await import('../src/ingest.ts')
  const dir = await makeTempDir()
  try {
    const imagePath = await writeFileBytes(dir, stagingFileName('aaa'), DUMMY_PNG)
    const ctx = createMockCtx()
    const ref = await ingestScreenshot(ctx, imagePath, 'Google Chrome')
    assert.equal(ref.attachmentId, 'att_test_0001')
    assert.equal(ctx.attachments.saveImageCalls.length, 1)
    const input = ctx.attachments.saveImageCalls[0]!
    assert.ok(input.data instanceof Uint8Array, 'saveImage 输入必须是字节 Uint8Array（AGENTS.md 硬规则 5）')
    assert.equal(input.data.length, DUMMY_PNG.length)
    assert.deepEqual([...input.data], [...DUMMY_PNG], '字节必须原样透传')
    assert.equal(input.mediaType, 'image/png')
    assert.ok(input.name?.includes('Google Chrome'), 'name 应包含应用名')
    assert.equal(await fileExists(imagePath), false, 'saveImage 成功后必须立即 unlink Staging 文件')
  } finally {
    await removeDir(dir)
  }
})

test('常规边界：saveImage 失败仍必须 unlink', { skip: skipIngest }, async () => {
  const { ingestScreenshot } = await import('../src/ingest.ts')
  const dir = await makeTempDir()
  try {
    const imagePath = await writeFileBytes(dir, stagingFileName('fail'), DUMMY_PNG)
    const ctx = createMockCtx({
      saveImage: async () => {
        throw new Error('storage full')
      },
    })
    await assert.rejects(ingestScreenshot(ctx, imagePath, 'App'), /storage full/)
    assert.equal(await fileExists(imagePath), false, '失败分支（finally）也必须清理 Staging 文件')
  } finally {
    await removeDir(dir)
  }
})

test('常规边界：源文件缺失时拒绝且不调用 saveImage', { skip: skipIngest }, async () => {
  const { ingestScreenshot } = await import('../src/ingest.ts')
  const dir = await makeTempDir()
  try {
    const ctx = createMockCtx()
    await assert.rejects(ingestScreenshot(ctx, join(dir, 'missing.png'), 'App'), { code: 'ENOENT' })
    assert.equal(ctx.attachments.saveImageCalls.length, 0)
  } finally {
    await removeDir(dir)
  }
})

test('常规边界：空文件仍透传且清理', { skip: skipIngest }, async () => {
  const { ingestScreenshot } = await import('../src/ingest.ts')
  const dir = await makeTempDir()
  try {
    const imagePath = await writeFileBytes(dir, stagingFileName('empty'), new Uint8Array(0))
    const ctx = createMockCtx()
    const ref = await ingestScreenshot(ctx, imagePath, 'App')
    assert.equal(ref.attachmentId, 'att_test_0001')
    assert.equal(ctx.attachments.saveImageCalls[0]!.data.length, 0)
    assert.equal(await fileExists(imagePath), false)
  } finally {
    await removeDir(dir)
  }
})

test('主流程：cleanOrphanStagingFiles 只清理 dsh-appshot-*.png', { skip: skipStaging }, async () => {
  const { cleanOrphanStagingFiles } = await import('../src/staging.ts')
  const dir = await makeTempDir()
  try {
    await writeFileBytes(dir, stagingFileName('a'), DUMMY_PNG)
    await writeFileBytes(dir, stagingFileName('b'), DUMMY_PNG)
    await writeFileBytes(dir, 'keep.txt', new TextEncoder().encode('x'))
    const removed = await cleanOrphanStagingFiles(dir)
    assert.equal(removed, 2)
    assert.equal(await fileExists(join(dir, 'keep.txt')), true, '无关文件不得被清理')
    assert.equal(await fileExists(join(dir, stagingFileName('a'))), false)
    assert.equal(await fileExists(join(dir, stagingFileName('b'))), false)
  } finally {
    await removeDir(dir)
  }
})

test('常规边界：目录不存在时不抛错', { skip: skipStaging }, async () => {
  const { cleanOrphanStagingFiles } = await import('../src/staging.ts')
  const dir = await makeTempDir()
  try {
    assert.equal(await cleanOrphanStagingFiles(join(dir, 'nope')), 0)
  } finally {
    await removeDir(dir)
  }
})

test('常规边界：命名规则严格匹配（.png.bak / 前缀不符不清理）', { skip: skipStaging }, async () => {
  const { cleanOrphanStagingFiles } = await import('../src/staging.ts')
  const dir = await makeTempDir()
  try {
    await writeFileBytes(dir, 'dsh-appshot-x.png', DUMMY_PNG)
    await writeFileBytes(dir, 'dsh-appshot-x.png.bak', DUMMY_PNG)
    await writeFileBytes(dir, 'x-dsh-appshot-y.png', DUMMY_PNG)
    const removed = await cleanOrphanStagingFiles(dir)
    assert.equal(removed, 1)
    assert.equal(await fileExists(join(dir, 'dsh-appshot-x.png.bak')), true)
    assert.equal(await fileExists(join(dir, 'x-dsh-appshot-y.png')), true)
  } finally {
    await removeDir(dir)
  }
})
