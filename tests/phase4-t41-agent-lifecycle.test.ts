/**
 * Phase 4 / T4.1 — Native Agent 生命周期管理
 *
 * 通过标准（docs/tasks.md T4.1）：
 *   > DSH 重载或禁用插件时，Agent.app 能够安全退出，无僵尸进程残留。
 *
 * 计划模块边界（src/agent.ts，T4.1 落地时实现）：
 *   startAgent({ command, args, readyTimeoutMs?, onEvent?, onExit? })
 *     → Promise<AgentProcess>
 *   AgentProcess = { pid: number, stop(): Promise<void>, wait(): Promise<number|null> }
 *   - 启动后等待 `{"type":"ready",...}` 握手（默认超时 3s）；
 *   - stop() 发 SIGTERM 并确保进程退出；子进程自行退出时触发 onExit。
 *
 * 测试驱动：用 `node -e` 假 Agent 进程模拟（打印 ready 后驻留 / 打印 error 后退出 /
 * 永不就绪），不依赖真实 Agent.app。
 *
 * 红/绿语义：src/agent.ts 尚未实现，当前全部 skip；落地后自动激活。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

const agentReady = existsSync(new URL('../src/macos/agent.ts', import.meta.url))
const skipReason = agentReady
  ? false
  : 'T4.1 未实现：缺少 src/agent.ts（落地后自动激活；模块名不同请同步本文件）'

/** 假 Agent：打印 ready 帧后驻留。 */
const READY_FAKE = 'console.log(JSON.stringify({type:"ready",version:1,pid:process.pid})); setInterval(()=>{},1e3)'
/** 假 Agent：打印 error 帧后以 1 退出。 */
const ERROR_FAKE = 'console.log(JSON.stringify({type:"error",code:"NATIVE_AGENT_CRASHED",message:"boom"})); process.exit(1)'
/** 假 Agent：永不就绪（用于超时边界）。 */
const NEVER_READY = 'setInterval(()=>{},1e3)'

test('启动 + ready 握手成功（主流程）', { skip: skipReason }, async () => {
  const { startAgent } = await import('../src/macos/agent.ts')
  const events: unknown[] = []
  const agent = await startAgent({
    command: process.execPath,
    args: ['-e', READY_FAKE],
    onEvent: (event: unknown) => events.push(event),
  })
  try {
    assert.ok(agent.pid > 0)
    assert.equal(events.length, 1)
    assert.equal((events[0] as { type?: string }).type, 'ready')
  } finally {
    await agent.stop()
    const code = await agent.wait()
    assert.notEqual(code, null, 'stop() 后子进程必须退出，不得残留僵尸进程')
  }
})

test('ready 握手超时：拒绝启动（常规边界）', { skip: skipReason }, async () => {
  const { startAgent } = await import('../src/macos/agent.ts')
  await assert.rejects(
    startAgent({
      command: process.execPath,
      args: ['-e', NEVER_READY],
      readyTimeoutMs: 300,
    }),
    /ready/i,
    '超时未收到 ready 握手应拒绝并清理子进程',
  )
})

test('子进程异常退出：onExit 上报退出码（常规边界）', { skip: skipReason }, async () => {
  const { startAgent } = await import('../src/macos/agent.ts')
  const events: unknown[] = []
  const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = []
  const agent = await startAgent({
    command: process.execPath,
    args: ['-e', ERROR_FAKE],
    onEvent: (event: unknown) => events.push(event),
    onExit: (info: { code: number | null; signal: NodeJS.Signals | null }) => exits.push(info),
  })
  const code = await agent.wait()
  assert.equal(code, 1)
  assert.equal((events[0] as { type?: string }).type, 'error')
  assert.equal(exits[0]?.code, 1)
})

test('命令不存在：启动失败并拒绝（常规边界）', { skip: skipReason }, async () => {
  const { startAgent } = await import('../src/macos/agent.ts')
  await assert.rejects(startAgent({ command: '/nonexistent/appshot-agent' }))
})

test('缺少执行权限：自动修复权限并成功启动（自愈边界）', { skip: skipReason }, async () => {
  const { startAgent } = await import('../src/macos/agent.ts')
  const { writeFileSync, chmodSync, unlinkSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const scriptPath = join(tmpdir(), `fake-agent-${Date.now()}.sh`)
  writeFileSync(
    scriptPath,
    `#!/bin/sh\necho '{"type":"ready","version":1,"pid":'$$'}'\nwhile true; do sleep 1; done\n`,
    { mode: 0o644 },
  )
  chmodSync(scriptPath, 0o644)

  try {
    const events: unknown[] = []
    const agent = await startAgent({
      command: scriptPath,
      onEvent: (event: unknown) => events.push(event),
    })

    assert.ok(agent.pid > 0)
    assert.equal(events.length, 1)
    assert.equal((events[0] as { type?: string }).type, 'ready')

    const stats = statSync(scriptPath)
    assert.notEqual(stats.mode & 0o111, 0, '文件权限应已被修复为具有执行权限')

    await agent.stop()
  } finally {
    try {
      unlinkSync(scriptPath)
    } catch {}
  }
})

