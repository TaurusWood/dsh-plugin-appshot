/**
 * src/client/settings.ts — DSH 设置面板中的 Appshot 配置区（React，纯 createElement 编写）。
 */

import React, { useState, useEffect } from 'react'
import type { AppshotConfig } from '../shared/types.ts'

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
