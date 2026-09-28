/**
 * src/client/w0.ts — W0 真机验证：DSH Draft API 全链路（仅验证模式激活）。
 *
 * 验证 DSH 0.1.7 Draft API：
 * 1. mainSessionId(list) / sessions.scope(sessionId)；
 * 2. conversation.createDrafts(sessionId, files) → 固定 draftId；
 * 3. input.for(scope).addAttachments([draftId]) → true/false；
 * 4. input.snapshot.attachmentIds 包含 draftId；
 * 5. conversation.resolveDraftAttachments([draftId]) 可解析；
 * 6. input.removeAttachment(draftId) + conversation.releaseDraftAttachment(draftId) 清理。
 * 结果写入 sessionStorage 并经 POST 回报到 Host 路由 /plugins/appshot/w0-report。
 */

import { mainSessionId, type AppshotClientCtx } from './context.ts'

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
    let sessionId = mainSessionId(snapshot)
    const pollStart = Date.now()
    while (sessionId === undefined && Date.now() - pollStart < 12000) {
      await new Promise((r) => setTimeout(r, 500))
      snapshot = ctx.sessions.list.getSnapshot()
      sessionId = mainSessionId(snapshot)
    }
    record('mainSessionId(list)', typeof sessionId === 'string', {
      sessionId,
      idsCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : undefined,
      idsSample: Array.isArray(snapshot.ids) ? snapshot.ids.slice(0, 5) : undefined,
    })
    if (sessionId === undefined) {
      record('W0 前置：存在活跃 Session', false, { hint: '请在 DSH 中打开一个会话后重试', idsCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : undefined })
      await reportW0Results(results)
      return results
    }

    const scope = ctx.sessions.scope(sessionId)
    record('sessions.scope(sessionId)', scope !== undefined, { sessionId })
    if (scope === undefined) {
      await reportW0Results(results)
      return results
    }

    // 3. createDrafts：创建 1x1 像素 PNG
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
    let drafts: readonly { id: string }[]
    try {
      drafts = ctx.conversation.createDrafts(sessionId, [file])
      record('createDrafts(sessionId, files)', drafts.length === 1 && typeof drafts[0]?.id === 'string', {
        count: drafts.length,
        id: drafts[0]?.id,
      })
    } catch (err) {
      record('createDrafts(sessionId, files)', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }
    if (drafts.length !== 1 || drafts[0] === undefined) {
      await reportW0Results(results)
      return results
    }
    const draftId = drafts[0].id

    let accepted: boolean
    try {
      const input = ctx.conversation.input.for(scope)
      accepted = input.addAttachments([draftId])
      record('input.for(scope).addAttachments([draftId])', typeof accepted === 'boolean', { accepted })
    } catch (err) {
      record('input.for(scope).addAttachments([draftId])', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }

    let attachmentIds: readonly string[]
    try {
      attachmentIds = ctx.conversation.input.for(scope).snapshot.attachmentIds
      record('input.snapshot.attachmentIds 包含 draftId', attachmentIds.includes(draftId), { attachmentIds })
    } catch (err) {
      record('input.snapshot.attachmentIds 包含 draftId', false, { error: String(err) })
      await reportW0Results(results)
      return results
    }

    let draftAlive = false
    try {
      const resolved = ctx.conversation.resolveDraftAttachments([draftId])
      draftAlive = resolved.length === 1
      record('conversation.resolveDraftAttachments([draftId])', draftAlive, { resolved: resolved.length })
    } catch (err) {
      record('conversation.resolveDraftAttachments([draftId])', false, { error: String(err) })
    }

    try {
      const input = ctx.conversation.input.for(scope)
      const removed = input.removeAttachment(draftId)
      const afterRemove = input.snapshot.attachmentIds
      record('input.removeAttachment(draftId)', removed && !afterRemove.includes(draftId), { afterRemove })
    } catch (err) {
      record('input.removeAttachment(draftId)', false, { error: String(err) })
    }
    try {
      ctx.conversation.releaseDraftAttachment(draftId)
      const afterRelease = ctx.conversation.resolveDraftAttachments([draftId])
      record('conversation.releaseDraftAttachment(draftId)', afterRelease.length === 0, { afterRelease: afterRelease.length })
    } catch (err) {
      record('conversation.releaseDraftAttachment(draftId)', false, { error: String(err) })
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
