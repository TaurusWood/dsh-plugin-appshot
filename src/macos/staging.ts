import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export async function cleanOrphanStagingFiles(dir: string = '/tmp'): Promise<number> {
  try {
    const entries = await readdir(dir)
    let count = 0

    for (const entry of entries) {
      if (entry.startsWith('dsh-appshot-') && entry.endsWith('.png')) {
        try {
          await unlink(join(dir, entry))
          count++
        } catch {
          // 忽略单个文件清理失败
        }
      }
    }

    return count
  } catch {
    // 目录不存在时不抛错，返回 0
    return 0
  }
}
