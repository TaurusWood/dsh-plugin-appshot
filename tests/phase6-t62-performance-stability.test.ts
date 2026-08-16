/**
 * Phase 6 / T6.2 — 性能与稳定性
 *
 * 通过标准（docs/tasks.md T6.2）：
 *   > 快速连续触发 10 次双 Command，依次生成多张图片附件并追加到 Composer，
 *   > 无进程死锁，内存与 CPU 资源平稳释放。
 *
 * 自动化覆盖（可执行部分）：Node 侧连续 10 次 ingestScreenshot —— 全部成功、
 * 无 Staging 残留（对照 T4.2 的 50 次验收，此处在 10 次量级验证主流程 + 常规边界）。
 * 系统级「快速 10 次双 Command」为机上人工验收（文末用例）。
 *
 * 红/绿语义：依赖 src/ingest.ts（T4.2），当前全部 skip；落地后自动激活。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { DUMMY_PNG, fileExists, makeTempDir, removeDir, stagingFileName, writeFileBytes } from './helpers/fs.ts'
import { createMockCtx } from './helpers/mock-ctx.ts'

const ingestReady = existsSync(new URL('../src/ingest.ts', import.meta.url))
const skipReason = ingestReady
  ? false
  : 'T6.2 自动化部分依赖 src/ingest.ts（T4.2 未实现，落地后自动激活）'

test('连续 10 次 ingestScreenshot：全部成功且无 Staging 残留（主流程）', { skip: skipReason }, async () => {
  const { ingestScreenshot } = await import('../src/ingest.ts')
  const dir = await makeTempDir()
  try {
    const ctx = createMockCtx()
    const paths: string[] = []
    for (let i = 0; i < 10; i++) {
      paths.push(await writeFileBytes(dir, stagingFileName(`p${i}`), DUMMY_PNG))
    }
    const refs: Array<{ attachmentId: string }> = []
    for (const path of paths) {
      refs.push(await ingestScreenshot(ctx, path, `App ${refs.length}`))
    }
    assert.equal(refs.length, 10)
    assert.equal(ctx.attachments.saveImageCalls.length, 10)
    for (const path of paths) {
      assert.equal(await fileExists(path), false, '每次截图后 Staging 文件必须清理')
    }
    const leftovers = (await readdir(dir)).filter((f) => f.startsWith('dsh-appshot-'))
    assert.deepEqual(leftovers, [], '10 次连续截图后不应有任何 dsh-appshot-* 残留')
  } finally {
    await removeDir(dir)
  }
})

test('手动：快速连续 10 次双 Command（系统级稳定性验收）', {
  skip: '人工验收：快速连续触发双 Command 10 次，核对（1）Composer 依次追加 10 张截图附件；（2）无进程死锁；（3）活动监视器中内存/CPU 平稳释放、无异常增长',
}, () => {})
