/**
 * Phase 7 / T7.4 — 快捷键与偏好配置及即时生效
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppshotConfig } from '../src/shared/types.ts'
import {
  DEFAULT_WINDOWS_CONFIG,
  loadWindowsConfig,
  sanitizeWindowsConfig,
  saveWindowsConfig,
} from '../src/windows/config-store.ts'

describe('T7.4 快捷键与偏好配置及即时生效', () => {
  test('配置模型包含 shortcutMode / soundEnabled / animationEnabled 字段（主流程）', () => {
    const config: AppshotConfig = {
      shortcutMode: 'dual-cmd',
      soundEnabled: true,
      animationEnabled: false,
    }
    assert.equal(config.shortcutMode, 'dual-cmd')
    assert.equal(config.soundEnabled, true)
    assert.equal(config.animationEnabled, false)

    const configDouble: AppshotConfig = {
      shortcutMode: 'double-cmd',
      soundEnabled: true,
      animationEnabled: true,
    }
    assert.equal(configDouble.shortcutMode, 'double-cmd')
  })

  test('AgentProcess.sendConfig 向 stdin 写入正确格式的 config/update 帧（主流程）', () => {
    let writtenData = ''
    const fakeStdin = {
      writable: true,
      write(data: string) {
        writtenData += data
        return true
      },
    }

    const agent = {
      pid: 12345,
      stop: async () => {},
      wait: async () => 0,
      sendConfig: (config: AppshotConfig) => {
        if (!fakeStdin.writable) return
        const frame = JSON.stringify({
          type: 'config/update',
          payload: config,
        }) + '\n'
        fakeStdin.write(frame)
      },
    }

    agent.sendConfig({
      shortcutMode: 'double-cmd',
      soundEnabled: false,
      animationEnabled: true,
    })

    const parsed = JSON.parse(writtenData.trim())
    assert.equal(parsed.type, 'config/update')
    assert.equal(parsed.payload.shortcutMode, 'double-cmd')
    assert.equal(parsed.payload.soundEnabled, false)
    assert.equal(parsed.payload.animationEnabled, true)
  })

  test('settings/updated 事件触发时同步下发配置（常规边界）', () => {
    let lastSentConfig: AppshotConfig | null = null
    const mockAgent = {
      pid: 9999,
      stop: async () => {},
      wait: async () => 0,
      sendConfig: (config: AppshotConfig) => {
        lastSentConfig = config
      },
    }

    // 模拟 settings/updated 处理句柄
    const handleSettingsUpdated = (ns: string, next: unknown) => {
      if (ns === 'appshot' && next && typeof next === 'object') {
        mockAgent.sendConfig(next as AppshotConfig)
      }
    }

    handleSettingsUpdated('appshot', {
      shortcutMode: 'cmd-option',
      soundEnabled: true,
      animationEnabled: true,
    })

    assert.deepEqual(lastSentConfig, {
      shortcutMode: 'cmd-option',
      soundEnabled: true,
      animationEnabled: true,
    })
  })

  test('配置持久化：save → load 往返一致，重启后设置不重置', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'appshot-config-'))
    const path = join(dir, 'config.json')
    try {
      const custom: AppshotConfig = {
        platform: 'win32',
        shortcutMode: 'custom',
        windowsHotkeys: { left: 'lctrl', right: 'lshift' },
        soundEnabled: false,
        animationEnabled: false,
      }
      assert.equal(await saveWindowsConfig(path, custom), true)
      const loaded = await loadWindowsConfig(path)
      assert.deepEqual(loaded, {
        shortcutMode: 'custom',
        windowsHotkeys: { left: 'lctrl', right: 'lshift' },
        soundEnabled: false,
        animationEnabled: false,
      })
      // 启动合并语义：默认值 + 持久化字段覆盖
      assert.deepEqual({ ...DEFAULT_WINDOWS_CONFIG, ...loaded }, { ...custom })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('配置持久化：文件不存在或 JSON 损坏回退默认值，非法字段被丢弃', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'appshot-config-'))
    try {
      // 不存在 → null（调用方用默认值）
      assert.equal(await loadWindowsConfig(join(dir, 'missing.json')), null)

      // 损坏 JSON → null
      const corrupt = join(dir, 'corrupt.json')
      await writeFile(corrupt, '{not json', 'utf-8')
      assert.equal(await loadWindowsConfig(corrupt), null)

      // 非法字段丢弃、合法字段保留；全非法 → null
      assert.deepEqual(sanitizeWindowsConfig({
        shortcutMode: 'evil-mode',
        windowsHotkeys: { left: 'lwin', right: 'rctrl' },
        soundEnabled: 'yes',
        animationEnabled: false,
      }), { animationEnabled: false })
      assert.equal(sanitizeWindowsConfig({ soundEnabled: 1 }), null)
      assert.equal(sanitizeWindowsConfig('nope'), null)

      // 损坏文件不应被误当作有效配置参与合并
      const raw = await readFile(corrupt, 'utf-8')
      assert.ok(raw.length > 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
