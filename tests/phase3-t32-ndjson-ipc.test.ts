/**
 * Phase 3 / T3.2 — 长连接 NDJSON IPC 协议（Node 端解析）
 *
 * 通过标准（docs/tasks.md T3.2）：
 *   > Node 端能持续监听并按行解析 NDJSON，无截断或粘包问题。
 *
 * 计划模块边界（src/ipc.ts，T3.2 Node 端落地时实现）：
 *   createNdjsonParser({ onEvent, onError? }) → { feed(chunk: string), end() }
 *   - 按 `\n` 切分，分块到达可跨块拼装，块内多行按序派发；
 *   - 空行忽略；非法 JSON 行交给 onError（不中断流）；end() 冲刷无换行的末行。
 *   - 帧类型见 docs/technical.md §5.1（ready / appshot / error）。
 *
 * 红/绿语义：src/ipc.ts 尚未实现，当前全部 skip；实现落地后自动激活。
 * 若实现采用不同模块/函数名，请同步本文件导入。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

const ipcReady = existsSync(new URL('../src/macos/ipc.ts', import.meta.url))
const skipReason = ipcReady
  ? false
  : 'T3.2 Node 端未实现：缺少 src/ipc.ts（落地后自动激活；模块名不同请同步本文件）'

interface ParserHarness {
  events: unknown[]
  errors: unknown[]
}

function makeHarness(): ParserHarness {
  return { events: [], errors: [] }
}

async function makeParser(harness: ParserHarness) {
  const { createNdjsonParser } = await import('../src/macos/ipc.ts')
  return createNdjsonParser({
    onEvent: (event: unknown) => harness.events.push(event),
    onError: (error: unknown) => harness.errors.push(error),
  })
}

test('单行完整事件解析（主流程）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('{"type":"ready","version":1}\n')
  assert.deepEqual(harness.events, [{ type: 'ready', version: 1 }])
  assert.equal(harness.errors.length, 0)
})

test('分块到达无截断（常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('{"type":"ap')
  parser.feed('pshot","id":"x",')
  parser.feed('"imagePath":"/tmp/a.png"}\n')
  assert.deepEqual(harness.events, [{ type: 'appshot', id: 'x', imagePath: '/tmp/a.png' }])
})

test('单块多行按序派发（粘包，常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('{"type":"ready","version":1}\n{"type":"error","code":"X","message":"m"}\n')
  assert.equal(harness.events.length, 2)
  assert.deepEqual(harness.events[0], { type: 'ready', version: 1 })
  assert.deepEqual(harness.events[1], { type: 'error', code: 'X', message: 'm' })
})

test('空行忽略（常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('\n\n{"type":"ready","version":1}\n\n')
  assert.equal(harness.events.length, 1)
})

test('非法 JSON 行进入 onError 且不中断流（常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  assert.doesNotThrow(() => parser.feed('not-json\n{"type":"ready","version":1}\n'))
  assert.equal(harness.errors.length, 1)
  assert.equal(harness.events.length, 1)
})

test('end() 冲刷无换行的末行（常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('{"type":"ready","version":1}')
  parser.end()
  assert.equal(harness.events.length, 1)
})

test('中文与转义字符正确解析（常规边界）', { skip: skipReason }, async () => {
  const harness = makeHarness()
  const parser = await makeParser(harness)
  parser.feed('{"type":"appshot","appName":"Google Chrome","windowTitle":"GitHub - \\"PR\\" 页面","imagePath":"/tmp/dsh-appshot-截图.png"}\n')
  assert.equal(harness.events.length, 1)
  const frame = harness.events[0] as { appName: string; windowTitle: string }
  assert.equal(frame.appName, 'Google Chrome')
  assert.equal(frame.windowTitle, 'GitHub - "PR" 页面')
})
