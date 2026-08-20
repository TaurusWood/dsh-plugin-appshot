# dsh-plugin-appshot 分阶段测试套件

按 `docs/tasks.md` 每个步骤（T0.1 … T7.4）生成测试文件，仅覆盖**主流程与常规边界**。

## 运行

```bash
pnpm test              # node --test 串行运行 tests/**/*.test.ts（Node ≥22.18 原生 TS 类型剥离，零额外依赖）
pnpm test:typecheck    # tsc 校验 tests + src（当前对未实现的计划模块报错，见下）
```

> 套件以 `--test-concurrency=1` 串行执行：native 二进制不支持并发调用
> （并行触发多个 `--list-windows` 会引发 TCC/ScreenCaptureKit 抖动，
> 偶发 `SCREEN_PERMISSION_DENIED` 或空输出），串行保证结果确定性。

## 文件布局

| 文件 | 对应任务 | 说明 |
| --- | --- | --- |
| `tests/phase0-t01-plugin-pattern.test.ts` | T0.1 | 插件生命周期形态（inject/apply/dispose） |
| `tests/phase1-t11-cli-capture.test.ts` | T1.1 | CLI 截图契约（exit code / JSON / PNG 落盘） |
| `tests/phase1-t12-frontmost-filter.test.ts` | T1.2 | 窗口列表 schema + 人工命中验收 |
| `tests/phase2-t21-agent-app-bundle.test.ts` | T2.1 | Agent.app Info.plist / 签名 / 入口 |
| `tests/phase2-t22-permission-activate.test.ts` | T2.2 | 权限检测与原生唤起（人工验收） |
| `tests/phase3-t31-double-command.test.ts` | T3.1 | 双 Command 状态机（机上人工验收） |
| `tests/phase3-t32-ndjson-ipc.test.ts` | T3.2 | Node 端 NDJSON 解析（分块/粘包/非法行） |
| `tests/phase4-t41-agent-lifecycle.test.ts` | T4.1 | Agent 子进程启停 / 超时 / 异常退出 |
| `tests/phase4-t42-attachment-ownership.test.ts` | T4.2 | saveImage 字节透传 + 所有权原子转移 + 孤儿 GC |
| `tests/phase4-t43-sse-channel.test.ts` | T4.3 | SSE 路由注册 / 帧格式 / 断开 / dispose |
| `tests/phase5-t51-client-module.test.ts` | T5.1 | Renderer 客户端：挂载 Draft / 聚焦 / 无会话 |
| `tests/phase5-t52-no-self-capture.test.ts` | T5.2 | 帧契约校验 + 防自截人工验收 |
| `tests/phase6-t61-boundary-scenarios.test.ts` | T6.1 | 多显示器 / 多窗口 / Space / 通知 |
| `tests/phase6-t62-performance-stability.test.ts` | T6.2 | 连续 10 次截图无残留 |
| `tests/phase-w0-dsh-interface-gate.test.ts` | Phase W0 | Windows DSH 真机接口 Gate 门禁测试 |
| `tests/phase-w1-native-trigger-target.test.ts` | Phase W1 | Windows 左右 Ctrl 状态机与目标锁定 |
| `tests/phase-w2-two-stage-capture-staging.test.ts` | Phase W2 | Windows 两阶段置前截图与 Staging 路径安全 |
| `tests/phase-w3-node-state-machine-transport.test.ts` | Phase W3 | Windows Node 状态机、超时守卫与迟到帧防竞态 |
| `tests/phase-w4-client-draft-recovery.test.ts` | Phase W4 | Windows Client Draft 挂载与持续恢复 |
| `tests/phase-w5-packaging-acceptance.test.ts` | Phase W5 | Windows 跨平台包装配、选路与全链路验收 |
| `tests/phase7-t7*.test.ts` | T7.1–T7.4 | Post-MVP 增强功能验收占位 |
| `tests/helpers/` | — | mock ctx、临时文件、native 二进制运行/探测 |

## 红 / 绿 / skip 语义

- **红 = 验收信号**：测试断言的是该阶段**目标契约**。阶段未落地时对应用例保持红色或
  skip，落地后自动转绿。典型：`phase0` 的 `inject`/`dispose` 断言（当前模板为
  `['tools']`）、`phase1` 的 `--cli-capture` 成功契约（当前 PoC 崩溃，见已知问题）。
- **skip = 未实现或人工项**：计划模块缺失（`src/ingest.ts` 等）或必须机上人工验收的
  场景（多显示器、权限面板、防自截等），skip 消息携带激活条件或验收步骤。
- 每个文件头注释写明该任务通过标准（取自 `docs/tasks.md`）与计划模块边界。

## 计划模块边界（实现时须对齐，否则同步本套件导入）

测试按以下规划模块编写（源自 `docs/technical.md` 的设计片段；若实现采用不同模块
名/函数签名，请同步对应测试文件的导入与头注释）：

- `src/ipc.ts`：`createNdjsonParser({ onEvent, onError? }) → { feed, end }`
- `src/agent.ts`：`startAgent({ command, args, readyTimeoutMs?, onEvent?, onExit? }) → { pid, stop, wait }`
- `src/ingest.ts`：`ingestScreenshot(ctx, imagePath, appName) → Promise<ImageAttachmentRef>`
  （readFile → saveImage → finally unlink）
- `src/staging.ts`：`cleanOrphanStagingFiles(dir = '/tmp') → Promise<number>`
  （过滤规则：`startsWith('dsh-appshot-') && endsWith('.png')`；显式目录参数便于测试）
- `src/sse.ts`：`createAppshotSSEHub(ctx) → { broadcast(frame), dispose() }`
  （经 `ctx.webServer.registerUpgrade('/plugins/appshot/events', handler)` 注册，
  帧格式 `event: appshot/ready\ndata: <json>\n\n`）
- `src/client.ts`：`createAppshotClient(deps) → { start(), dispose() }`（Renderer 侧）

## 已知问题与设计假设（证据优先，均已实测）

1. **`--cli-capture` 偶发 SIGABRT（环境态抖动，非确定性缺陷）**：曾观测到 exit 134
   （stderr `Assertion failed: (did_initialize), function CGS_REQUIRE_INIT`），与
   TCC 授权流程/CG 会话初始化状态相关；当前会话实测已连续稳定通过（exit 0）。
   若复现，`phase1-t11` 对应用例会红并携带 stderr 诊断。
2. **`docs/api-grounded-review.md` 缺失**：AGENTS.md 引用该文档作为 DSH 接口真伪的
   权威依据，但仓库内不存在。`ctx.webServer.registerUpgrade` 的真实签名未核实，
   本套件按最小 socket 面（`write`/`on`/`end`）建模（见 `tests/helpers/mock-ctx.ts`），
   对接宿主时以真实签名为准。
3. **native 行为测试环境门控**：`phase1/phase6` 中执行二进制或用例先探测
   （`helpers/native-probe.ts`）——二进制缺失或屏幕录制权限未授予时自动 skip 并给出
   原因；`--list-windows` 成功才运行截图类用例。
4. **Swift 状态机（T3.1）未做 XCTest**：当前 `Package.swift` 无 test target，避免引入
   未经编译验证的测试基建。建议 T3.1 落地时把状态机提取为纯 Swift 类型并补 XCTest。
5. **类型证据**：`ImageAttachmentRef` / `SaveImageInput` 镜像自
   `@deepseek-ai/dsh-attachment@0.1.0-rc.6` 的 `lib/types/types.d.ts`（字节输入、无
   `url` 字段）；IPC/SSE 帧镜像自 `docs/technical.md` §5.1/§5.2。
