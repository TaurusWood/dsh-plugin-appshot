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
    list: { getSnapshot(): { current: string | undefined } }
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
  const [config, setConfig] = useState<AppshotConfig>({
    shortcutMode: 'double-cmd',
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
          setConfig({
            shortcutMode: data.shortcutMode ?? 'double-cmd',
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
        '自动捕获 macOS 前台目标窗口并挂载到当前会话 Composer 输入框。',
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
          h('option', { value: 'double-cmd' }, '双击 ⌘ Command（或左右 ⌘ 同时按）'),
          h('option', { value: 'double-option' }, '双击 ⌥ Option（或左右 ⌥ 同时按）'),
          h('option', { value: 'double-control' }, '双击 ⌃ Control'),
          h('option', { value: 'cmd-option' }, '⌘ Command + ⌥ Option 组合键'),
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
          h('div', { style: { fontSize: '12px', color: '#71717a' } }, '截图落盘后播放轻快的 macOS 原生快门音效反馈'),
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

export function apply(ctx: AppshotClientCtx) {
  console.log('[dsh-plugin-appshot:client] client plugin applying...')

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

  // 2. 建立 SSE 连接接收截图挂载事件
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

  console.log('[dsh-plugin-appshot:client] client plugin applied successfully')
}
