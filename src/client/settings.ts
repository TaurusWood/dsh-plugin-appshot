/**
 * src/client/settings.ts — DSH 设置面板中的 Appshot 配置区（React，纯 createElement 编写）。
 */

import React, { useState, useEffect } from 'react'
import type { AppshotConfig, WindowsModifierKey } from '../shared/types.ts'

const h = React.createElement

const MODIFIER_LABELS: Record<WindowsModifierKey, string> = {
  lctrl: '左 Ctrl',
  rctrl: '右 Ctrl',
  lalt: '左 Alt',
  ralt: '右 Alt',
  lshift: '左 Shift',
  rshift: '右 Shift',
}

/** event.code → 修饰键池（Win 键因开始菜单副作用排除，Shift 已知会切输入法，由用户自行取舍） */
const MODIFIER_CODES: Record<string, WindowsModifierKey> = {
  ControlLeft: 'lctrl',
  ControlRight: 'rctrl',
  AltLeft: 'lalt',
  AltRight: 'ralt',
  ShiftLeft: 'lshift',
  ShiftRight: 'rshift',
}

// 颜色统一引用 DSH 主题令牌（@deepseek-ai/dsh-client-ui-theme design-platform.css，
// body[data-ds-dark-theme] 随系统/用户外观切换取值）；fallback 为原暗色值，
// 旧宿主未定义令牌时退化为纯暗色外观。
const selectStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-3, #27272a)',
  color: 'var(--dsw-alias-label-primary, #fafafa)',
  border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
  borderRadius: '8px',
  padding: '6px 12px',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer',
}

export function AppshotSettingsSection() {
  const isWinClient = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent || '')
  const [config, setConfig] = useState<AppshotConfig>({
    platform: isWinClient ? 'win32' : 'darwin',
    shortcutMode: isWinClient ? 'double-ctrl' : 'dual-cmd',
    windowsHotkeys: { left: 'lctrl', right: 'rctrl' },
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
            shortcutMode: data.shortcutMode ?? (isWin ? 'double-ctrl' : 'dual-cmd'),
            windowsHotkeys: data.windowsHotkeys ?? { left: 'lctrl', right: 'rctrl' },
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
  const hotkeys = config.windowsHotkeys ?? { left: 'lctrl', right: 'rctrl' }

  // 录键控件：点击进入录制 → 依次按住两个修饰键即完成录入（ESC / 失焦取消）
  const [recording, setRecording] = useState(false)
  const [pendingKey, setPendingKey] = useState<WindowsModifierKey | null>(null)

  const cancelRecording = () => {
    setRecording(false)
    setPendingKey(null)
  }

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        cancelRecording()
        return
      }
      const mod = MODIFIER_CODES[e.code]
      if (!mod) return
      if (pendingKey === null) {
        setPendingKey(mod)
        return
      }
      if (pendingKey === mod) return
      void handleUpdate({ windowsHotkeys: { left: pendingKey, right: mod } })
      cancelRecording()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      // 只按了一个键就松开：重置，等待重新按住两个键
      if (pendingKey !== null && MODIFIER_CODES[e.code] === pendingKey) {
        setPendingKey(null)
      }
    }
    const onBlur = () => cancelRecording()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording, pendingKey])

  return h('div', {
    style: {
      padding: '24px',
      maxWidth: '680px',
      color: 'var(--dsw-alias-label-primary, #e4e4e7)',
      fontFamily: 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
      fontSize: '14px',
      lineHeight: 1.5,
    },
  },
    // 头部区域
    h('div', { style: { marginBottom: '24px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
        h('h2', { style: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #fafafa)' } }, '截图捕获 (Appshot)'),
        savedBadge ? h('span', {
          style: {
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, rgb(34, 197, 94)) 15%, transparent)',
            color: 'var(--dsw-alias-state-success-secondary, #4ade80)',
            border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, rgb(34, 197, 94)) 30%, transparent)',
            transition: 'all 0.2s',
          },
        }, '✓ 已即时生效') : null,
      ),
      h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary, #a1a1aa)', fontSize: '13px' } },
        isWin
          ? '按下快捷键，截取鼠标所在屏幕最前面的窗口，截图会自动出现在 DSH 的输入框里，随下一条消息一起发送。最前面是 DSH 自己的窗口时不会截图。'
          : '按下快捷键，截取当前最前面的窗口，截图会自动出现在 DSH 的输入框里，随下一条消息一起发送。',
      ),
    ),

    // 主配置卡片
    h('div', {
      style: {
        background: 'var(--dsw-alias-bg-layer-2, #18181b)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))',
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
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06))',
        },
      },
        h('div', null,
          h('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-label-primary, #f4f4f5)', marginBottom: '2px' } }, '触发快捷键'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #71717a)' } }, '在任何应用里按下即可截图的全局快捷键'),
          // 录键控件（仅 Windows 且选择自定义时展开）
          isWin && config.shortcutMode === 'custom'
            ? h('div', { style: { marginTop: '10px' } },
                h('button', {
                  onClick: () => (recording ? cancelRecording() : (setPendingKey(null), setRecording(true))),
                  style: {
                    background: recording
                      ? 'var(--dsw-alias-button-primary-fill, #3b82f6)'
                      : 'var(--dsw-alias-bg-layer-3, #27272a)',
                    color: recording
                      ? 'var(--dsw-alias-label-primary-foreground, #ffffff)'
                      : 'var(--dsw-alias-label-primary, #fafafa)',
                    border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
                    borderRadius: '8px',
                    padding: '6px 14px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    outline: 'none',
                  },
                },
                  recording
                    ? pendingKey
                      ? `已录入「${MODIFIER_LABELS[pendingKey]}」，请按第二个修饰键…`
                      : '请同时按住两个修饰键…（ESC 取消）'
                    : `${MODIFIER_LABELS[hotkeys.left]} + ${MODIFIER_LABELS[hotkeys.right]}　点击修改`,
                ),
                h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #71717a)', marginTop: '6px' } },
                  '支持 Ctrl / Alt / Shift 左右键任意组合；不含 Win 键。含 Shift 的组合可能与输入法切换冲突，请自行取舍。'),
              )
            : null,
        ),
        h('select', {
          value: config.shortcutMode,
          disabled: loading || saving,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            handleUpdate({ shortcutMode: e.target.value as AppshotConfig['shortcutMode'] }),
          style: selectStyle,
        },
          ...(isWin
            ? [
                h('option', { key: 'ctrl', value: 'double-ctrl' }, '双 Ctrl 同时按（默认）'),
                h('option', { key: 'custom', value: 'custom' }, '自定义修饰键组合'),
              ]
            : [
                h('option', { key: 'dual-cmd', value: 'dual-cmd' }, '左右 ⌘ Command 同时按（默认）'),
                h('option', { key: 'double-cmd', value: 'double-cmd' }, '双击 ⌘ Command'),
                h('option', { key: 'dual-opt', value: 'dual-option' }, '左右 ⌥ Option 同时按'),
                h('option', { key: 'double-opt', value: 'double-option' }, '双击 ⌥ Option'),
                h('option', { key: 'double-ctrl', value: 'double-control' }, '双击 ⌃ Control'),
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
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06))',
        },
      },
        h('div', null,
          h('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-label-primary, #f4f4f5)', marginBottom: '2px' } }, '快门提示音'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #71717a)' } },
            '截图成功后播放清脆的快门提示音',
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
              background: config.soundEnabled ? 'var(--dsw-alias-button-primary-fill, #3b82f6)' : 'var(--dsw-alias-button-tool-bar-fill, #3f3f46)',
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
                background: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
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
          h('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-label-primary, #f4f4f5)', marginBottom: '2px' } }, '截图动画反馈'),
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #71717a)' } }, '截图成功后被截窗口边框闪一下，缩略图飞向任务栏的 DSH 图标'),
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
              background: config.animationEnabled ? 'var(--dsw-alias-button-primary-fill, #3b82f6)' : 'var(--dsw-alias-button-tool-bar-fill, #3f3f46)',
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
                background: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
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
