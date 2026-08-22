import React, { useState, useEffect } from 'react'
import type { AppshotReadyFrame } from './sse.ts'
import type { AppshotConfig, ImageAttachmentRef } from './types.ts'

// ===== 运行时类型：镜像自宿主包 .d.ts 的本地收窄面（禁 any/@ts-ignore）=====
// 证据：dsh-client-runtime/lib/types/client/{sessions/service,session/contract}.d.ts
//       dsh-client-ui-conversation/lib/types/client/{service,contract/slots,input/contract}.d.ts
//       dsh-client-ui-slots/lib/types/client/contract/slots.d.ts

interface SessionInputFacade {
  addImages(ids: readonly string[]): boolean
  notify(level: 'info' | 'error', text: string): void
}

interface ConversationFace {
  input: {
    /** 解析某会话作用域 ctx 的输入机 */
    for(actx: unknown): SessionInputFacade
  }
  /** 公开面 IConversation 无此方法；运行时 ctx.conversation 即 ConversationController 实例 */
  createDraftImages(files: readonly File[]): readonly { id: string; file: File }[]
  /** 解析仍存活的 Draft 描述符（api-grounded-review.md §3.4 已核实） */
  draftImages(ids: readonly string[]): readonly unknown[]
  /** 释放 Draft 与 object URL（api-grounded-review.md §3.4 已核实） */
  releaseDraftImage(id: string): void
}

interface SlotsService {
  inject(name: string, factory: () => unknown): void
  register(descriptor: {
    name: string
    id: string
    order?: number
    label?: () => string
    inject?: () => unknown
  }, component: unknown): unknown
}

interface AppshotClientCtx {
  sessions: {
    list: { getSnapshot(): { current: string | undefined; ids?: readonly string[] } }
    binding(id: string): { ctx: unknown } | undefined
  }
  conversation: ConversationFace
  slots?: SlotsService
  effect(fn: () => () => void): void
}

// ===== 纯工厂（保持原签名，tests/phase5-t51 依赖它，勿动）=====

export interface ComposerService {
  appendDraft(sessionId: string, ref: ImageAttachmentRef): void
  focus(): void
}

export interface ClientDependencies {
  subscribe(onFrame: (frame: unknown) => void): () => void
  getActiveSessionId(): string | null
  composer: ComposerService
  onNeedSession?: () => void
}

export interface AppshotClient {
  start(): void
  dispose(): void
}

export function createAppshotClient(deps: ClientDependencies): AppshotClient {
  let unsubscribe: (() => void) | null = null

  const handleFrame = (frame: unknown) => {
    if (!frame || typeof frame !== 'object') return
    const candidate = frame as Partial<AppshotReadyFrame>
    if (candidate.type !== 'appshot/ready') return
    if (!candidate.attachmentRef || typeof candidate.attachmentRef !== 'object') return

    const activeSessionId = deps.getActiveSessionId()
    if (!activeSessionId) {
      deps.onNeedSession?.()
      return
    }

    deps.composer.appendDraft(activeSessionId, candidate.attachmentRef)
    deps.composer.focus()
  }

  return {
    start() {
      if (unsubscribe) return
      unsubscribe = deps.subscribe(handleFrame)
    },
    dispose() {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    },
  }
}

// ===== React 设置面板组件 (DSH Settings Section，纯 createElement 编写，Node.js 原生友好) =====

const h = React.createElement

export function AppshotSettingsSection() {
  const isWinClient = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent || '')
  const [config, setConfig] = useState<AppshotConfig>({
    platform: isWinClient ? 'win32' : 'darwin',
    shortcutMode: isWinClient ? 'double-ctrl' : 'double-cmd',
    soundEnabled: true,
    animationEnabled: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedBadge, setSavedBadge] = useState(false)

  // 1. 初始化拉取当前配置
  useEffect(() => {
    let unmounted = false
    fetch('/plugins/appshot/config')
      .then((res) => res.json())
      .then((data: AppshotConfig) => {
        if (!unmounted && data && typeof data === 'object') {
          const isWin = data.platform === 'win32' || isWinClient
          setConfig({
            platform: isWin ? 'win32' : 'darwin',
            shortcutMode: data.shortcutMode ?? (isWin ? 'double-ctrl' : 'double-cmd'),
            soundEnabled: data.soundEnabled ?? true,
            animationEnabled: data.animationEnabled ?? true,
          })
          setLoading(false)
        }
      })
      .catch((err) => {
        console.warn('[dsh-plugin-appshot:client] failed to fetch config:', err)
        if (!unmounted) setLoading(false)
      })
    return () => {
      unmounted = true
    }
  }, [])

  // 2. 更新并保存配置
  const handleUpdate = async (patch: Partial<AppshotConfig>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    setSaving(true)
    try {
      const res = await fetch('/plugins/appshot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        setSavedBadge(true)
        setTimeout(() => setSavedBadge(false), 2000)
      }
    } catch (err) {
      console.error('[dsh-plugin-appshot:client] failed to save config:', err)
    } finally {
      setSaving(false)
    }
  }

  const isWin = config.platform === 'win32' || isWinClient

  return h('div', {
    style: {
      padding: '24px',
      maxWidth: '680px',
      color: '#e4e4e7',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      lineHeight: 1.5,
    },
  },
    // 头部区域
    h('div', { style: { marginBottom: '24px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
        h('h2', { style: { margin: 0, fontSize: '18px', fontWeight: 600, color: '#fafafa' } }, '截图捕获 (Appshot)'),
        savedBadge ? h('span', {
          style: {
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: 'rgba(34, 197, 94, 0.15)',
            color: '#4ade80',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            transition: 'all 0.2s',
          },
        }, '✓ 已即时生效') : null,
      ),
      h('p', { style: { margin: 0, color: '#a1a1aa', fontSize: '13px' } },
        isWin
          ? '自动捕获 Windows 前台目标窗口并挂载到当前会话 Composer 输入框。'
          : '自动捕获 macOS 前台目标窗口并挂载到当前会话 Composer 输入框。',
      ),
    ),

    // 主配置卡片
    h('div', {
      style: {
        background: '#18181b',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
      },
    },
      // 项 1: 触发快捷键
      h('div', {
        style: {
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        },
      },
        h('div', null,
          h('div', { style: { fontWeight: 500, color: '#f4f4f5', marginBottom: '2px' } }, '触发快捷键'),
          h('div', { style: { fontSize: '12px', color: '#71717a' } }, '在任意应用前台触发窗口截屏的全局按键组合'),
        ),
        h('select', {
          value: config.shortcutMode,
          disabled: loading || saving,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleUpdate({ shortcutMode: e.target.value as AppshotConfig['shortcutMode'] }),
          style: {
            background: '#27272a',
            color: '#fafafa',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '6px 12px',
            fontSize: '13px',
            outline: 'none',
            cursor: 'pointer',
          },
        },
          ...(isWin
            ? [
                h('option', { key: 'ctrl', value: 'double-ctrl' }, '左右 Ctrl 同时按（默认）'),
              ]
            : [
                h('option', { key: 'cmd', value: 'double-cmd' }, '双击 ⌘ Command（或左右 ⌘ 同时按）'),
                h('option', { key: 'opt', value: 'double-option' }, '双击 ⌥ Option（或左右 ⌥ 同时按）'),
                h('option', { key: 'ctrl', value: 'double-control' }, '双击 ⌃ Control'),
                h('option', { key: 'combo', value: 'cmd-option' }, '⌘ Command + ⌥ Option 组合键'),
              ]
          ),
        ),
      ),

      // 项 2: 快门音效
      h('div', {
        style: {
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        },
      },
        h('div', null,
          h('div', { style: { fontWeight: 500, color: '#f4f4f5', marginBottom: '2px' } }, '快门提示音'),
          h('div', { style: { fontSize: '12px', color: '#71717a' } },
            isWin
              ? '截图落盘后播放提示音效反馈'
              : '截图落盘后播放轻快的 macOS 原生快门音效反馈',
          ),
        ),
        h('label', { style: { position: 'relative', display: 'inline-block', width: '42px', height: '24px', cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: config.soundEnabled,
            disabled: loading || saving,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleUpdate({ soundEnabled: e.target.checked }),
            style: { opacity: 0, width: 0, height: 0, margin: 0 },
          }),
          h('span', {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: config.soundEnabled ? '#3b82f6' : '#3f3f46',
              borderRadius: '24px',
              transition: 'all 0.2s',
            },
          },
            h('span', {
              style: {
                position: 'absolute',
                content: '""',
                height: '18px',
                width: '18px',
                left: config.soundEnabled ? '21px' : '3px',
                bottom: '3px',
                background: '#ffffff',
                borderRadius: '50%',
                transition: 'all 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              },
            }),
          ),
        ),
      ),

      // 项 3: 闪光动画
      h('div', {
        style: {
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
        h('div', null,
          h('div', { style: { fontWeight: 500, color: '#f4f4f5', marginBottom: '2px' } }, '闪烁视觉反馈'),
          h('div', { style: { fontSize: '12px', color: '#71717a' } }, '截图时在被捕获的目标窗口上方快速闪烁高亮动画'),
        ),
        h('label', { style: { position: 'relative', display: 'inline-block', width: '42px', height: '24px', cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: config.animationEnabled,
            disabled: loading || saving,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleUpdate({ animationEnabled: e.target.checked }),
            style: { opacity: 0, width: 0, height: 0, margin: 0 },
          }),
          h('span', {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: config.animationEnabled ? '#3b82f6' : '#3f3f46',
              borderRadius: '24px',
              transition: 'all 0.2s',
            },
          },
            h('span', {
              style: {
                position: 'absolute',
                content: '""',
                height: '18px',
                width: '18px',
                left: config.animationEnabled ? '21px' : '3px',
                bottom: '3px',
                background: '#ffffff',
                borderRadius: '50%',
                transition: 'all 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              },
            }),
          ),
        ),
      ),
    ),
  )
}

// ===== 客户端插件入口：真实 Composer 挂载 + 设置面板注册 =====

export const inject = ['sessions', 'conversation', 'slots']

function isReadyFrame(frame: unknown): frame is AppshotReadyFrame {
  if (!frame || typeof frame !== 'object') return false
  const candidate = frame as Partial<AppshotReadyFrame>
  return (
    candidate.type === 'appshot/ready' &&
    !!candidate.attachmentRef &&
    typeof candidate.attachmentRef.attachmentId === 'string' &&
    typeof candidate.attachmentRef.mediaType === 'string'
  )
}

// ===== W0 真机验证：Draft API 全链路（仅验证模式激活） =====

interface W0VerifyResult {
  name: string
  ok: boolean
  detail: unknown
}

/**
 * 验证 DSH Draft API 行为（api-grounded-review.md §3.4 已核实形态）：
 * 1. sessions.list.getSnapshot().current / sessions.binding(sessionId)；
 * 2. conversation.createDraftImages(files) → 固定 draftId；
 * 3. input.for(binding.ctx).addImages([draftId]) → true/false；
 * 4. input.snapshot.imageIds 包含 draftId；
 * 5. conversation.draftImages([draftId]) 可解析；
 * 6. input.removeImage(draftId) + conversation.releaseDraftImage(draftId) 清理。
 * 结果经 POST 回报到 Host 路由 /plugins/appshot/w0-report。
 */
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

// ===== Windows Basic Client 交付运行时（HTTP 长轮询 + 两阶段 Draft 恢复 + 严禁 window.focus） =====

function appshotUrl(path: string): URL {
  const origin = globalThis.location?.origin
  const base = origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
  return new URL(path, base)
}

/** ACK 指数退避间隔（1s → 2s → 4s 封顶；spec §4.4.3）。纯函数便于单测。 */
export function ackBackoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 4000)
}

function getClientInstanceId(): string {
  if (typeof sessionStorage === 'undefined') return 'client-fallback-id'
  let id = sessionStorage.getItem('dsh-appshot-client-id')
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem('dsh-appshot-client-id', id)
  }
  return id
}

interface DraftCacheRecord {
  captureId: string
  sessionId: string
  draftId: string
  mountedAt: number
}

function getCachedDraft(captureId: string): DraftCacheRecord | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`dsh-appshot-draft-${captureId}`)
    return raw ? (JSON.parse(raw) as DraftCacheRecord) : null
  } catch {
    return null
  }
}

const DRAFT_INDEX_KEY = 'dsh-appshot-draft-index'

function setCachedDraft(captureId: string, record: DraftCacheRecord): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(`dsh-appshot-draft-${captureId}`, JSON.stringify(record))
    // 维护最近 50 条已挂载记录索引（technical-windows.md §4.4.2）
    const rawIndex = sessionStorage.getItem(DRAFT_INDEX_KEY)
    let index: string[] = []
    try {
      const parsed = JSON.parse(rawIndex ?? '[]') as unknown
      if (Array.isArray(parsed)) index = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      index = []
    }
    if (!index.includes(captureId)) index.push(captureId)
    if (index.length > 50) {
      const overflow = index.slice(0, index.length - 50)
      index = index.slice(index.length - 50)
      for (const old of overflow) sessionStorage.removeItem(`dsh-appshot-draft-${old}`)
    }
    sessionStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index))
  } catch {
    // ignore
  }
}

function removeCachedDraft(captureId: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(`dsh-appshot-draft-${captureId}`)
  } catch {
    // ignore
  }
}

function isWindowsPlatform(): boolean {
  if (typeof navigator !== 'undefined') {
    if (navigator.platform && /win/i.test(navigator.platform)) return true
    if (navigator.userAgent && /windows/i.test(navigator.userAgent)) return true
  }
  if (typeof location !== 'undefined' && location.search && location.search.includes('platform=win32')) {
    return true
  }
  return false
}

function applyWindowsClient(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] applying windows client runtime (long polling + silent draft)...')
  const clientInstanceId = getClientInstanceId()
  let aborted = false
  let currentSessionId: string | undefined = undefined
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  // 1. Session 同步与上报（POST /plugins/appshot/session）
  //    携带 claimPendingCaptureId 时返回认领响应（technical-windows.md §4.1.2）：
  //    响应 { captureId, targetSessionId } 必须与本地活动记录一致后才允许继续挂载。
  const syncSession = async (claimPendingCaptureId?: string): Promise<
    { captureId: string; targetSessionId: string | null } | null
  > => {
    if (aborted) return null
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (sessionId !== currentSessionId || claimPendingCaptureId) {
      currentSessionId = sessionId
      if (sessionId) {
        try {
          const body: { sessionId: string; clientInstanceId: string; claimPendingCaptureId?: string } = {
            sessionId,
            clientInstanceId,
          }
          if (claimPendingCaptureId) body.claimPendingCaptureId = claimPendingCaptureId
          const res = await fetch(appshotUrl('/plugins/appshot/session').toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (res.status === 200 && claimPendingCaptureId) {
            const data = (await res.json()) as { captureId?: unknown; targetSessionId?: unknown }
            if (typeof data.captureId === 'string' && (typeof data.targetSessionId === 'string' || data.targetSessionId === null)) {
              return { captureId: data.captureId, targetSessionId: data.targetSessionId }
            }
          }
        } catch {
          // ignore network errors
        }
      }
    }
    return null
  }

  // 显式认领：仅当本 Client 有待认领帧 且 用户聚焦了明确 Session 时发送 claim
  // （technical-windows.md §4.1.2：初始化重放、后台心跳或普通 Session 切换不改绑）
  const tryClaimPending = async () => {
    if (aborted || pendingClaims.size === 0) return
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (!sessionId) return
    for (const [captureId] of pendingClaims) {
      const claimResult = await syncSession(captureId)
      if (claimResult && claimResult.captureId === captureId) {
        // 认领成功：仅在响应与本地活动记录一致后继续挂载（由 handleReadyFrame 重新取帧驱动）
        pendingClaims.delete(captureId)
        console.log('[dsh-plugin-appshot:client] claim accepted for', captureId, '->', claimResult.targetSessionId)
      }
    }
  }

  const sessionCheckTimer = setInterval(() => {
    void syncSession()
    void tryClaimPending()
  }, 1000)
  void syncSession()

  // 2. 发送交付结果（POST /plugins/appshot/delivery-result）
  //    指数退避重试（1s → 2s → 4s 封顶，最多 4 次）确保 Node 确认（technical-windows.md §4.4.3）
  const sendDeliveryResult = async (
    captureId: string,
    targetSessionId: string,
    status: 'MOUNTED' | 'BUSY' | 'NO_SESSION' | 'SESSION_MISMATCH',
  ) => {
    let delay = 1000
    for (let attempt = 0; attempt < 4; attempt++) {
      if (aborted) return
      try {
        const res = await fetch(appshotUrl('/plugins/appshot/delivery-result').toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captureId, clientInstanceId, targetSessionId, status }),
        })
        // 200 = 已接受（CLEARED_SUCCESS / IGNORED_DUPLICATE / HELD_PENDING）；409 = 冲突（不再重试）
        if (res.status === 200 || res.status === 409) return
      } catch (err) {
        console.warn('[dsh-plugin-appshot:client] delivery result post failed (attempt ' + attempt + '):', err)
      }
      await new Promise((r2) => setTimeout(r2, delay))
      delay = Math.min(delay * 2, 4000)
    }
    console.warn('[dsh-plugin-appshot:client] delivery result not confirmed after retries:', captureId)
  }

  // 3. 处理 appshot/ready 帧与两阶段重试
  let pendingRetry: {
    captureId: string
    targetSessionId: string
    draftId: string
    retryCount: number
  } | null = null

  // 待认领集合：无 Session / SESSION_MISMATCH 时记录，用户聚焦明确 Session 后显式认领
  // （technical-windows.md §4.1.2：初始化重放、后台心跳或普通 Session 上报不构成认领）
  const pendingClaims = new Map<string, { captureId: string; draftId: string | null }>()

  const scheduleRetry = (captureId: string, targetSessionId: string, draftId: string, count: number) => {
    if (aborted) return
    if (retryTimer) clearTimeout(retryTimer)
    const delay = count <= 5 ? 500 : 3000
    retryTimer = setTimeout(async () => {
      if (aborted || !pendingRetry || pendingRetry.captureId !== captureId) return
      const binding = ctx.sessions.binding(targetSessionId)
      if (!binding) {
        await sendDeliveryResult(captureId, targetSessionId, 'SESSION_MISMATCH')
        return
      }
      try {
        const input = ctx.conversation.input.for(binding.ctx)
        const accepted = input.addImages([draftId])
        if (accepted) {
          setCachedDraft(captureId, { captureId, sessionId: targetSessionId, draftId, mountedAt: Date.now() })
          pendingRetry = null
          await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
        } else {
          pendingRetry.retryCount++
          await sendDeliveryResult(captureId, targetSessionId, 'BUSY')
          scheduleRetry(captureId, targetSessionId, draftId, pendingRetry.retryCount)
        }
      } catch (err) {
        console.error('[dsh-plugin-appshot:client] retry mount failed:', err)
      }
    }, delay)
  }

  const handleReadyFrame = async (frame: {
    captureId: string
    targetClientInstanceId: string
    targetSessionId: string | null
    dataBase64: string
    metadata?: { appName?: string; mediaType?: string }
  }) => {
    if (frame.targetClientInstanceId !== clientInstanceId) return
    const { captureId, targetSessionId, dataBase64 } = frame

    // 1. 无 Session 时记录待认领（等待用户聚焦明确 Session 后显式认领，不改绑）
    if (!targetSessionId) {
      pendingClaims.set(captureId, { captureId, draftId: null })
      await sendDeliveryResult(captureId, '', 'NO_SESSION')
      return
    }

    // 2. 双重活性验证（防假 ACK）
    const cached = getCachedDraft(captureId)
    if (cached && cached.sessionId === targetSessionId) {
      const binding = ctx.sessions.binding(targetSessionId)
      if (binding) {
        const shell = ctx.conversation.input.for(binding.ctx) as unknown as { snapshot?: { imageIds?: readonly string[] } }
        const imageIds = shell.snapshot?.imageIds ?? []
        const activeDrafts = ctx.conversation.draftImages([cached.draftId])
        if (imageIds.includes(cached.draftId) && activeDrafts.length === 1) {
          // 双重验证均通过，安全补发 ACK
          await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
          return
        }
      }
      // 失效缓存，清除重挂载
      removeCachedDraft(captureId)
    }

    // 3. 解析目标 Session Binding
    const binding = ctx.sessions.binding(targetSessionId)
    if (!binding) {
      // 原目标 Session 已删除/改绑：标记待认领（REBIND_REQUIRED），仅允许显式 claim 改绑
      pendingClaims.set(captureId, { captureId, draftId: null })
      await sendDeliveryResult(captureId, targetSessionId, 'SESSION_MISMATCH')
      return
    }

    // 4. 创建 Draft 并静默挂载（不抢焦点、不调用 window.focus）
    try {
      const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0))
      const fileName = `${frame.metadata?.appName ?? 'appshot'}.png`
      const file = new File([bytes], fileName, { type: 'image/png' })
      const [draft] = ctx.conversation.createDraftImages([file])
      if (!draft) return

      const input = ctx.conversation.input.for(binding.ctx)
      const accepted = input.addImages([draft.id])
      if (accepted) {
        setCachedDraft(captureId, { captureId, sessionId: targetSessionId, draftId: draft.id, mountedAt: Date.now() })
        await sendDeliveryResult(captureId, targetSessionId, 'MOUNTED')
      } else {
        pendingRetry = { captureId, targetSessionId, draftId: draft.id, retryCount: 1 }
        await sendDeliveryResult(captureId, targetSessionId, 'BUSY')
        scheduleRetry(captureId, targetSessionId, draft.id, 1)
      }
    } catch (err) {
      console.error('[dsh-plugin-appshot:client] windows silent mount failed:', err)
    }
  }

  // 4. 用户取消处理（appshot/cancelled）
  const handleCancelledFrame = (captureId: string) => {
    if (pendingRetry && pendingRetry.captureId === captureId) {
      if (retryTimer) clearTimeout(retryTimer)
      const { targetSessionId, draftId } = pendingRetry
      pendingRetry = null
      const binding = ctx.sessions.binding(targetSessionId)
      if (binding) {
        try {
          const input = ctx.conversation.input.for(binding.ctx) as unknown as { removeImage?(id: string): void }
          input.removeImage?.(draftId)
          ctx.conversation.releaseDraftImage(draftId)
        } catch {
          // ignore
        }
      }
    }
    removeCachedDraft(captureId)
    pendingClaims.delete(captureId)
  }

  // 5. 长轮询主循环（GET /plugins/appshot/pending）
  let knownCaptureId: string | null = null
  let knownTargetSessionId: string | null = null
  let backoffDelay = 1000

  const pollLoop = async () => {
    while (!aborted) {
      try {
        const url = appshotUrl('/plugins/appshot/pending')
        url.searchParams.set('clientInstanceId', clientInstanceId)
        if (knownCaptureId) url.searchParams.set('knownCaptureId', knownCaptureId)
        if (knownTargetSessionId) url.searchParams.set('knownTargetSessionId', knownTargetSessionId)

        const res = await fetch(url.toString(), { method: 'GET' })
        backoffDelay = 1000 // 成功收到 HTTP 响应重置退避

        if (res.status === 200) {
          const body = (await res.json()) as Record<string, unknown>
          if (body.type === 'appshot/ready') {
            const readyFrame = body as unknown as Parameters<typeof handleReadyFrame>[0]
            knownCaptureId = readyFrame.captureId
            knownTargetSessionId = readyFrame.targetSessionId
            await handleReadyFrame(readyFrame)
          } else if (body.type === 'appshot/cancelled') {
            const cancelledId = typeof body.captureId === 'string' ? body.captureId : ''
            handleCancelledFrame(cancelledId)
            knownCaptureId = null
            knownTargetSessionId = null
          } else if (body.type === 'appshot/completed') {
            knownCaptureId = null
            knownTargetSessionId = null
          }
        } else if (res.status === 204) {
          // 无 Pending，继续下一轮
        } else if (res.status === 409) {
          knownCaptureId = null
          knownTargetSessionId = null
        }
      } catch {
        if (aborted) break
        // 断线退避（1s → 2s → 4s 封顶）
        await new Promise((r) => setTimeout(r, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, 4000)
      }
    }
  }

  void pollLoop()

  ctx.effect(() => () => {
    aborted = true
    clearInterval(sessionCheckTimer)
    if (retryTimer) clearTimeout(retryTimer)
  })
}

/** macOS 原生 SSE 交付模式 */
function applyMacosClient(ctx: AppshotClientCtx) {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    console.warn('[dsh-plugin-appshot:client] no browser EventSource; client half disabled')
    return
  }

  const es = new EventSource('/plugins/appshot/events')

  const handleFrame = async (frame: unknown) => {
    if (!isReadyFrame(frame)) return

    const current = ctx.sessions.list.getSnapshot().current
    if (!current) {
      console.warn('[dsh-plugin-appshot:client] no active session; attachment saved on host, not mounted')
      return
    }

    const binding = ctx.sessions.binding(current)
    if (!binding) {
      console.warn('[dsh-plugin-appshot:client] active session binding unavailable:', current)
      return
    }

    if (!frame.dataBase64) {
      ctx.conversation.input.for(binding.ctx).notify('error', '截图帧缺少图像字节，无法挂载草稿')
      return
    }

    try {
      const bytes = Uint8Array.from(atob(frame.dataBase64), (c) => c.charCodeAt(0))
      const file = new File([bytes], frame.attachmentRef.name ?? '窗口截图.png', {
        type: frame.attachmentRef.mediaType,
      })
      const [draft] = ctx.conversation.createDraftImages([file])
      const accepted = ctx.conversation.input.for(binding.ctx).addImages([draft.id])
      if (!accepted) {
        ctx.conversation.input.for(binding.ctx).notify('info', 'Composer 繁忙，截图已保存为附件，未挂入草稿')
        return
      }
      console.log('[dsh-plugin-appshot:client] draft image mounted:', draft.id)

      if (typeof window !== 'undefined') {
        window.focus()
      }
      const input = document.querySelector('textarea, [contenteditable="true"]') as HTMLElement | null
      input?.focus()
    } catch (err) {
      ctx.conversation.input.for(binding.ctx).notify('error', `截图挂载失败: ${String(err)}`)
    }
  }

  es.addEventListener('appshot/ready', (event) => {
    const msg = event as MessageEvent
    try {
      void handleFrame(JSON.parse(msg.data))
    } catch (err) {
      console.error('[dsh-plugin-appshot:client] failed to parse SSE event:', err)
    }
  })

  es.onerror = () => {
    console.warn('[dsh-plugin-appshot:client] SSE connection error (will auto-reconnect)')
  }

  ctx.effect(() => {
    return () => {
      es.close()
    }
  })
}

export function apply(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] client plugin applying...')

  // ===== W0 真机验证钩子（仅 sessionStorage['w0-verify']==='1' 时激活；生产默认关闭） =====
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('w0-verify') === '1') {
    void runW0DraftVerify(ctx).catch((err) => {
      console.error('[dsh-plugin-appshot:client] W0 verify failed:', err)
    })
  }

  // 1. 注册 DSH 设置面板中的 "截图 (Appshot)" 配置项
  if (ctx.slots?.inject) {
    try {
      ctx.slots.inject('settings.section', () =>
        ctx.slots!.register(
          {
            name: 'settings.section',
            id: 'appshot',
            order: 120,
            label: () => '截图 (Appshot)',
            inject: () => ({}),
          },
          AppshotSettingsSection,
        ),
      )
      console.log('[dsh-plugin-appshot:client] settings section registered into DSH Settings shell')
    } catch (err) {
      console.warn('[dsh-plugin-appshot:client] failed to register settings section:', err)
    }
  }

  // 2. 平台分流交付：Windows 走自建 HTTP 长轮询 + 静默 Draft，macOS 走 SSE + 原生唤起
  if (isWindowsPlatform()) {
    applyWindowsClient(ctx)
  } else {
    applyMacosClient(ctx)
  }

  console.log('[dsh-plugin-appshot:client] client plugin applied successfully')
}

