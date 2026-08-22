import { readFile, unlink } from 'node:fs/promises'
import type { ImageAttachmentRef, SaveImageInput } from '../shared/types.ts'

export interface AttachmentService {
  saveImage(input: SaveImageInput): Promise<ImageAttachmentRef>
}

export interface IngestContext {
  attachments: AttachmentService
}

export async function ingestScreenshot(
  ctx: IngestContext,
  imagePath: string,
  appName: string,
): Promise<ImageAttachmentRef> {
  try {
    const data = await readFile(imagePath)
    const input: SaveImageInput = {
      data,
      mediaType: 'image/png',
      name: `${appName} 窗口截图.png`,
    }
    return await ctx.attachments.saveImage(input)
  } finally {
    await unlink(imagePath).catch(() => {})
  }
}
