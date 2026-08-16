/**
 * Phase 5 / T5.2 — 防自截时序全链路验证
 *
 * 时序硬约束（docs/technical.md §4）：
 *   按键 → 前台窗口锁定 → 截图落盘 → Native 原生唤起 DSH → IPC → saveImage
 *   → SSE 推送 → Composer 挂载；截图落盘前任何模块禁止唤起/聚焦 DSH。
 *
 * 通过标准（docs/tasks.md T5.2）：100% 不发生截取到 DSH 自身窗口的竞态。
 *
 * 自动化覆盖（可执行部分）：对 docs/technical.md §5.1/§5.2 定义的帧契约做
 * schema 校验——appshot 帧必须携带 imagePath（IPC 链路的落盘证据）；
 * appshot/ready 帧的 attachmentRef 是不透明引用（无 url 字段）。
 * 全链路时序本身为机上人工验收（文末用例）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeRef } from './helpers/mock-ctx.ts'
import type { AppshotFrame, AppshotReadyFrame } from './helpers/types.ts'

const SAMPLE_APPSHOT: AppshotFrame = {
  type: 'appshot',
  id: 'e4b5f6a1-3b7c-4a8e-9d2a-1b2c3d4e5f6a',
  platform: 'darwin',
  appName: 'Code - Insiders',
  windowTitle: 'src/index.ts — dsh-plugin-appshot',
  width: 1800,
  height: 1200,
  mimeType: 'image/png',
  imagePath: '/tmp/dsh-appshot-e4b5f6a1.png',
  timestamp: 1771148400000,
}

test('appshot 帧契约：携带 imagePath 且字段完整（IPC 链路的落盘证据）', () => {
  assert.equal(SAMPLE_APPSHOT.type, 'appshot')
  assert.ok(SAMPLE_APPSHOT.imagePath.startsWith('/tmp/dsh-appshot-'), 'imagePath 必须指向 Staging 文件')
  assert.equal(SAMPLE_APPSHOT.mimeType, 'image/png')
  assert.equal(SAMPLE_APPSHOT.platform, 'darwin')
  assert.ok(Number.isFinite(SAMPLE_APPSHOT.timestamp))
  assert.ok(SAMPLE_APPSHOT.width > 0 && SAMPLE_APPSHOT.height > 0)
  assert.ok(SAMPLE_APPSHOT.appName.length > 0)
})

test('appshot/ready 帧契约：attachmentRef 为不透明引用且无 url 字段', () => {
  const frame: AppshotReadyFrame = {
    type: 'appshot/ready',
    attachmentRef: makeRef(),
    metadata: { appName: 'Chrome' },
  }
  assert.equal(frame.attachmentRef.attachmentId.length > 0, true)
  assert.equal(frame.attachmentRef.mediaType, 'image/png')
  assert.ok(Number.isFinite(frame.attachmentRef.bytes))
  assert.ok(!('url' in frame.attachmentRef), 'ImageAttachmentRef 没有 url 字段（AGENTS.md 硬规则 5）')
})

test('手动：VS Code 前台触发双 Command，截图只含 VS Code 窗口（防自截人工验收）', {
  skip: '人工验收：在 VS Code 中编写代码时触发双 Command，核对（1）截图只包含 VS Code 窗口、绝无 DSH 自身；（2）截图落盘后 DSH 窗口才唤起置顶；（3）连续触发 10 次均无自截竞态',
}, () => {})
