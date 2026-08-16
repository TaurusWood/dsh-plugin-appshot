/**
 * tests/helpers/fs.ts — 临时目录与 Staging 文件工具。
 */

import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 1x1 透明 PNG（67 字节）。对 mock 而言字节内容不透明——生产环境由
 * AttachmentStore 解码校验；测试只关心字节是否原样传入 saveImage。
 */
export const DUMMY_PNG: Uint8Array = Uint8Array.from(
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  ),
)

export async function makeTempDir(prefix = 'dsh-appshot-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Staging 文件命名规范：`/tmp/dsh-appshot-<uuid>.png`（docs/technical.md §7.1）。 */
export function stagingFileName(uuid: string): string {
  return `dsh-appshot-${uuid}.png`
}

export async function writeFileBytes(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
