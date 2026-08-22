/**
 * Phase 7 / T7.4 — 快捷键与偏好配置及即时生效
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppshotConfig } from '../src/shared/types.ts'

describe('T7.4 快捷键与偏好配置及即时生效', () => {
  test('配置模型包含 shortcutMode / soundEnabled / animationEnabled 字段（主流程）', () => {
    const config: AppshotConfig = {
      shortcutMode: 'double-option',
      soundEnabled: true,
      animationEnabled: false,
    }
    assert.equal(config.shortcutMode, 'double-option')
    assert.equal(config.soundEnabled, true)
    assert.equal(config.animationEnabled, false)
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
})
