# AGENTS.md

本文件是 Coding Agent 的快速入口。它只保留高权重约束和导航；详细技术实现规则从
[`docs/technical.md`](docs/technical.md) 进入，产品需求与边界从
[`docs/requirements.md`](docs/requirements.md) 进入，分阶段实施计划从
[`docs/tasks.md`](docs/tasks.md) 进入，\*\*DSH 接口依据核查（接口真伪的权威证据链）从

## 项目概述

`dsh-plugin-appshot` 是 DeepSeek Harness (DSH) 的 macOS 桌面上下文捕获插件：用户触发全局快捷键后，
Native Agent 自动截取当前前台窗口，宿主插件将截图持久化为 Attachment 并经 SSE 推送给客户端模块，
挂载到当前会话 Composer，随用户输入的文本一起作为同一条 User Message 提交给 Agent。
运行环境对齐 DSH 宿主基线：Node.js **^22.19.0 || >=24.0.0**。

系统由三方组成（职责边界见 `docs/technical.md` §2）：

- **macOS Native Agent**（`native/macos`，Swift）：全局双 Command 状态机、前台窗口识别与过滤、
  ScreenCaptureKit 单窗口截图写 Staging 文件、截图落盘后原生唤起 DSH 主窗口（**先截后唤**）。
- **Node / Cordis 宿主插件**（`src/`）：管理 Agent 子进程生命周期、`fs.readFile` 读字节并调用
  `ctx.attachments.saveImage`、经 `ctx.webServer` 注册 SSE 通道广播、启动时孤儿 Staging 文件 GC。
- **DSH Client 模块**（`dsh.client` / Renderer）：消费 SSE、维护 UI 活跃 `sessionId`、将
  `ImageAttachmentRef` 挂载到目标 Session 的 Composer Draft 并聚焦输入框。

当前状态：`src/index.ts` 仍是脚手架 `defineTool` 模板，按 `docs/tasks.md` Phase 0 改造为
生命周期插件（`inject = ['attachments', 'webServer', 'sessions']` + `apply`/`dispose`）；
Native 端已具备 CLI 截图 PoC（`--cli-capture` / `--list-windows`）。

## 工作原则

- **KISS**：优先最小实现；不为一次性需求增加抽象、配置项或未来扩展点。
- **证据优先**：禁止猜测。**DSH 接口只认 `docs/api-grounded-review.md` 核实过的真实形态**；
  文档声称 ≠ 事实，证据优先级为 **源码 > 生成段 > 描述性文字**。需求、代码或文档不足时，
  指出缺失信息和影响，先确认再设计。
- **渐进演进**：保护现有 worktree 和用户修改；不推倒重来，不顺手搬迁无关代码。
- **旧代码警告**：现有 `defineTool` 模板只能作为"宿主注册机制"的参考，不能作为 appshot
  目标结构或风格参考。
- **设计先行**：架构、数据模型、权限、产品边界或技术选型存在歧义时（例如"进草稿"与
  "直接进上下文"二选一），先确认边界，不直接编码。
- **可追溯**：修改应有明确范围、验证证据和未覆盖项；发现接口推断或文档与源码冲突时停止并上报。

## 架构快速定向

- 三方数据流：`Staging 文件 (Native)` → `字节 (Node fs.readFile)` → `ImageAttachmentRef (DSH)`
  → `SSE 帧 (Node → Client 自建通道)` → `Composer Draft (Renderer)`。
- **先截后唤（防自截）硬约束**：Native 截图完成并确认 Staging 文件写盘前，系统任何模块
  绝对禁止唤起、显示或聚焦 DSH 窗口；窗口唤起是 Native 能力（`NSRunningApplication`），
  不是 DSH API。
- **确定性所有权转移（Single Owner）**：`saveImage` 成功前 Staging 文件归 Plugin；成功后所有权
  移交 DSH AttachmentStore，Plugin 立即 `unlink`；失败分支 `finally` 清理；启动时执行
  `cleanOrphanStagingFiles()`。
- **DSH 真实接口面（核查结论）**：只有 `ctx.attachments`、`ctx.sessions`、`ctx.tools` 三个接口
  真实存在；`lastActiveSessionId`、`appshot:ready` 事件桥、Composer 注入公共 API、
  `desktopRuntime` 窗口方法均无依据，禁止使用。宿主 → 客户端事件转发是固定 allowlist，
  插件 `ctx.emit` 任意事件不会到达 Renderer；推送只能走自建
  `ctx.webServer.registerUpgrade()` SSE 通道。

## 不可违反的硬规则

1. 禁止 `any`、`@ts-ignore`；修复类型定义和调用边界。
2. **防自截**：截图完成落盘前，禁止任何唤起、显示或聚焦 DSH 窗口的行为。
3. **单一 Owner**：Staging 临时文件按"所有权原子转移"规则管理，任何成功/失败分支都不留残留。
4. 禁止使用 `docs/api-grounded-review.md` 判定为不存在的宿主接口
   （`lastActiveSessionId`、`appshot:ready` 事件桥、Composer 注入公共 API、`desktopRuntime` 窗口方法）。
5. `ctx.attachments.saveImage` 的输入是**字节**（`Uint8Array`），不是文件路径；
   `ImageAttachmentRef` 没有 `url` 字段。
6. 宿主侧不猜测"活跃会话"：只处理明确给定的 `sessionId`；活跃会话由客户端模块在 Renderer 侧
   识别并经自建通道上报。
7. `@deepseek-ai/cordis` 是 peerDependency：代码中只允许 `import type`（编译期擦除），
   禁止运行时导入 cordis 值；`ctx` 由宿主注入。
8. 禁止裸 `npm i @deepseek-ai/dsh-tools`（npm `latest` 是过期 0.0.1-rc.1）；保持
   `0.1.0-rc.6` 精确版本，所有 `@deepseek-ai/dsh-*` 在同一 `0.1.0-rc.x` 线上，避免双模块副本。
9. 纯 ESM：`package.json` 必须 `"type": "module"`；tsc 用 `module: esnext` +
   `moduleResolution: bundler` 保留 bare specifier。
10. 注册是 effect：`ctx.tools.register()` / `ctx.on()` 卸载自动清理；自有资源
    （子进程、定时器、连接）必须包在 `ctx.effect(() => {…; return cleanup})` 或 `dispose()` 中。
11. 加载顺序靠服务依赖（`inject`），不靠文件顺序；需要 `ctx.tools` / `attachments` / `webServer`
    等服务时必须显式声明 inject。
12. `cordis.patch.yml` 的 `name` 是包名（走 node_modules 解析），不是相对路径。

## 状态与数据边界

- 数据与状态必须有唯一 owner；三方之间不维护需要双向同步的副本。
- Staging 文件 owner 转移是原子的：Plugin（`saveImage` 成功前）→ DSH AttachmentStore
  （成功后），转移点之外不存在并行 owner。
- 活跃 Session 与 Composer Draft 是 Renderer 私有状态：宿主不持有、不猜测、不写入；
  客户端模块负责读取并上报 `sessionId`。
- `ImageAttachmentRef` 是 DSH 的不透明持久化引用
  （`attachmentId` / `mediaType` / `bytes` / `width` / `height` / `name?`），不是路径、URL
  或 base64；客户端取图走 `session.attachment` RPC（客户端侧读取路径）。

## 沟通与 CR

- 拒绝猜测，透明说明假设、风险、阻断和未覆盖场景。
- 涉及 DSH 接口、架构或数据模型时，先输出问题与取舍（对照 `docs/api-grounded-review.md`
  的证据链），获得确认后再改代码。
- 产品语义歧义（如"进草稿"与"直接进上下文"二选一）需要 PRD 层面决策，不得自行替用户决定。
- 用户要求检查、CR 或 review 时，按 `docs/api-grounded-review.md` 校验 change set 中的
  DSH 接口调用是否真实存在，并核对可信基线；发现接口推断立即指出。

## 常用命令

```bash
pnpm build                 # tsc → dist/index.js（纯 ESM）
pnpm typecheck             # tsc --noEmit

# Native（在 native/macos 目录内执行）
swift build                                    # 构建 appshot-macos 可执行文件
.build/debug/appshot-macos --list-windows      # 列出可捕获窗口（诊断模式）
.build/debug/appshot-macos --cli-capture --output /tmp/dsh-appshot-test.png  # 前台窗口截图 PoC

# 安装与验证（在插件的父目录执行；相对路径锚定调用目录）
dsh plugin --profile my-profile add ./dsh-plugin-appshot
dsh --profile my-profile                        # 观察 "[dsh-plugin-appshot] registered ..."
```

## 目录与依赖速查

- `src/`：宿主插件源码；`index.ts` 是 Cordis `apply(ctx)` 入口（当前为 defineTool 模板，待改造）。
- `native/macos/`：Swift Package（可执行目标 `appshot-macos`）；`Sources/main.swift` 为 CLI 截图
  PoC；`.build/` 是 Swift 构建产物，不得提交。
- `docs/`：`requirements.md`（PRD）、`technical.md`（技术方案）、`tasks.md`（Phase 拆分与验收）、
  `api-grounded-review.md`（DSH 接口核查，接口真伪的权威依据）。
- `dist/`：tsc 构建产物；发布 `files` 仅含 `dist` 与 `cordis.patch.yml`。
- `cordis.patch.yml`：bundle 层注入；`name` 用包名。
- `package.json`：`@deepseek-ai/dsh-tools`（exact `0.1.0-rc.6`，`next` tag 线）、
  `@deepseek-ai/cordis`（peerDep，仅类型）。

依赖方向：`src/` → `@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis`（仅类型）；Native 端是独立
Swift Package，与 Node 侧无代码依赖，只通过 NDJSON IPC 契约通信；宿主插件不反向依赖 Renderer
私有代码。

## Git

执行 commit 时必须使用 Conventional Commits，类型仅限：`feat`、`fix`、`docs`、`style`、
`refactor`、`perf`、`test`、`chore`。除非用户明确要求，不执行 commit、reset、checkout 或清理
用户修改。当前目录尚未初始化 Git 仓库，且无 `.gitignore`：`dist/` 与 `native/macos/.build/`
为构建产物，如需纳入版本管理应先与用户确认建立 `.gitignore`。
