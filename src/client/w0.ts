/**
 * src/client/w0.ts — W0 真机验证：DSH Draft API 全链路（仅验证模式激活）。
 *
 * 验证 DSH Draft API 行为（api-grounded-review.md §3.4 已核实形态）：
 * 1. sessions.list.getSnapshot().current / sessions.binding(sessionId)；
 * 2. conversation.createDraftImages(files) → 固定 draftId；
 * 3. input.for(binding.ctx).addImages([draftId]) → true/false；
 * 4. input.snapshot.imageIds 包含 draftId；
 * 5. conversation.draftImages([draftId]) 可解析；
 * 6. input.removeImage(draftId) + conversation.releaseDraftImage(draftId) 清理。
 * 结果写入 sessionStorage 并经 POST 回报到 Host 路由 /plugins/appshot/w0-report。
 */

import type { AppshotClientCtx } from './context.ts'

export interface W0VerifyResult {
  name: string
  ok: boolean
  detail: unknown
}

export async function runW0DraftVerify(ctx: AppshotClientCtx): Promise<W0VerifyResult[]> {
  const results: W0VerifyResult[] = []
  const record = (name: string, ok: boolean, detail: unknown) => results.push({ name, ok, detail })

  try {
    // 1. 定位当前活跃 Session（Renderer reload 后 UI 恢复选中需要时间，轮询等待）
    let snapshot = ctx.sessions.list.getSnapshot()
    let sessionId: string | undefined = snapshot.current
    const pollStart = Date.now()
    while (!sessionId && Date.now() - pollStart < 12000) {
      await new Promise((r) => setTimeout(r, 500))
      snapshot = ctx.sessions.list.getSnapshot()
      sessionId = snapshot.current
    }
    record('sessions.list.getSnapshot().current', typeof sessionId === 'string', {
      current: sessionId,
      idsCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : undefined,
      idsSample: Array.isArray(snapshot.ids) ? snapshot.ids.slice(0, 5) : undefined,
    })
    if (!sessionId) {
      record('W0 前置：存在活跃 Session', false, { hint: '请在 DSH 中打开一个会话后重试', idsCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : undefined })
      await reportW0Results(results)
      return results
    }

    // 2. sessions.binding 解析目标 Session
    const binding = ctx.sessions.binding(sessionId)
    record('sessions.binding(sessionId)', !!binding, { sessionId })
    if (!binding) {
      record('binding.ctx 可解析', false, {})
      await reportW0Results(results)
      return results
    }
    record('binding.ctx 可解析', true, { hasCtx: !!binding.ctx })

    // 3. createDraftImages：创建 1x1 像素 PNG
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ])
    const file = new File([pngBytes], 'w0-verify.png', { type: 'image/png' })
    let drafts: readonly { id: string; file: File }[]
    try {
      drafts = ctx.conversation.createDraftImages([file])
      record('createDraftImages(files)', drafts.length === 1 && typeof drafts[0].id === 'string', {
        count: drafts.length,
        id: drafts[0]?.id,
      })
    } catch (err) {
      record('createDraftImages(files)', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }
    if (drafts.length !== 1) {
      await reportW0Results(results)
      return results
    }
    const draftId = drafts[0].id

    // 4. addImages 挂入 Composer
    let accepted: boolean
    try {
      const input = ctx.conversation.input.for(binding.ctx)
      accepted = input.addImages([draftId])
      record('input.for(binding.ctx).addImages([draftId])', typeof accepted === 'boolean', { accepted })
    } catch (err) {
      record('input.for(binding.ctx).addImages([draftId])', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }

    // 5. snapshot.imageIds 活性验证
    let imageIds: readonly string[]
    try {
      const shell = ctx.conversation.input.for(binding.ctx) as unknown as { snapshot: { imageIds: readonly string[] } }
      imageIds = shell.snapshot.imageIds
      record('input.snapshot.imageIds 包含 draftId', imageIds.includes(draftId), { imageIds })
    } catch (err) {
      record('input.snapshot.imageIds 包含 draftId', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }

    // 6. draftImages registry 活性验证
    let draftAlive = false
    try {
      const resolved = ctx.conversation.draftImages([draftId])
      draftAlive = resolved.length === 1
      record('conversation.draftImages([draftId])', draftAlive, { resolved: resolved.length })
    } catch (err) {
      record('conversation.draftImages([draftId])', false, { error: String(err) })
    }

    // 7. 取消清理：removeImage + releaseDraftImage
    try {
      const input = ctx.conversation.input.for(binding.ctx) as unknown as { removeImage(id: string): void }
      input.removeImage(draftId)
      const afterRemove = (ctx.conversation.input.for(binding.ctx) as unknown as { snapshot: { imageIds: readonly string[] } }).snapshot.imageIds
      record('input.removeImage(draftId)', !afterRemove.includes(draftId), { afterRemove })
    } catch (err) {
      record('input.removeImage(draftId)', false, { error: String(err) })
    }
    try {
      ctx.conversation.releaseDraftImage(draftId)
      const afterRelease = ctx.conversation.draftImages([draftId])
      record('conversation.releaseDraftImage(draftId)', afterRelease.length === 0, { afterRelease: afterRelease.length })
    } catch (err) {
      record('conversation.releaseDraftImage(draftId)', false, { error: String(err) })
    }
  } catch (err) {
    record('W0 验证整体执行', false, { error: String(err) })
  }

  await reportW0Results(results)
  return results
}

async function reportW0Results(results: W0VerifyResult[]): Promise<void> {
  // 1. 写入 sessionStorage（同 origin 跨 reload 保留，CDP 可直接读取）
  try {
    sessionStorage.setItem('w0-results', JSON.stringify({ results, ts: Date.now(), href: globalThis.location?.href }))
  } catch (err) {
    console.error('[dsh-plugin-appshot:client] W0 results sessionStorage write failed:', err)
  }
  // 2. 尝试 POST 回报（路由存在时成功；不存在时忽略）
  try {
    const origin = globalThis.location?.origin
    const base = origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
    await fetch(new URL('/plugins/appshot/w0-report', base).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results, ts: Date.now(), href: globalThis.location?.href }),
    })
  } catch (err) {
    console.warn('[dsh-plugin-appshot:client] W0 verify POST report failed (results kept in sessionStorage):', err)
  }
  console.log('[dsh-plugin-appshot:client] W0 verify results:', JSON.stringify(results, null, 2))
}
