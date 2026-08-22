# AGENTS.md

本文件是 Coding Agent 的快速入口。它只保留高权重约束和导航；详细技术实现规则从
[`docs/technical.md`](docs/technical.md) 进入，产品需求与边界从
[`docs/requirements.md`](docs/requirements.md) 进入，分阶段实施计划从
[`docs/tasks.md`](docs/tasks.md) 进入，DSH 接口依据核查从
[`docs/api-grounded-review.md`](docs/api-grounded-review.md) 进入。Windows Basic 单独以
[`docs/requirements-windows.md`](docs/requirements-windows.md) 和
[`docs/technical-windows.md`](docs/technical-windows.md) 为产品/技术权威文档。

## 项目概述

`dsh-plugin-appshot` 是 DeepSeek Harness (DSH) 的桌面上下文捕获插件。当前 macOS 路径已有实现，
Windows Basic 处于已闭合的规格/待实施状态。两个平台共用“截图进入 Composer Draft、不自动发送”的产品目标，
但截图对象、窗口激活、传输和图片 Owner 合同按平台分开，不得交叉套用。
运行环境对齐 DSH 宿主基线：Node.js **^22.19.0 || >=24.0.0**。

系统由 Native Agent、Node/Cordis 宿主插件和 DSH Client 模块三方组成：

- **macOS Native Agent**（`native/macos`，Swift）：全局双 Command 状态机、前台窗口识别与过滤、
  ScreenCaptureKit 单窗口截图写 Staging 文件、截图落盘后原生唤起 DSH 主窗口（**先截后唤**）。
- **Node / Cordis 宿主插件**（`src/`）：管理 Agent 子进程生命周期、`fs.readFile` 读字节并调用
  `ctx.attachments.saveImage`、经 `ctx.webServer` 注册 SSE 通道广播、启动时孤儿 Staging 文件 GC。
- **DSH Client 模块**（`dsh.client` / Renderer）：消费 SSE、维护 UI 活跃 `sessionId`、将
  `ImageAttachmentRef` 挂载到目标 Session 的 Composer Draft 并聚焦输入框。
- **Windows Native Agent**（规划中，C# / Win32）：左右 Ctrl 触发、鼠标下窗口锁定、单显示器校验、
  普通置前与可见内容降级截图，不激活 DSH。
- **Windows Host/Client 交付**（规划中）：Node 在 ACK 前保留唯一内存 Pending 字节，通过定向 HTTP 长轮询
  交给锁定 Client；Client 使用 runtime-only Draft API 挂载并返回 `MOUNTED`，Windows 不调用 `saveImage`。

当前状态：macOS Host/Client/Native 已有代码，其真实运行结果仍以当前测试与 DSH 验收为准；
Windows 代码尚未实施，不得把 Windows 文档中的伪代码、协议或 Gate 描述成已完成功能。

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

- **macOS 数据流**：`Staging` → Node 字节 → `ImageAttachmentRef` → 现有 SSE 通道 → Composer Draft。
- **Windows 数据流**：`Staging` → Node 内存 Pending 字节 → 定向 HTTP 长轮询 → runtime-only Draft → `MOUNTED`。
- **防自截**：macOS 仅能在截图落盘后原生唤起 DSH；Windows 截图落盘前不得显示通知，落盘后也不主动激活 DSH。
- **DSH 真实接口面**：已核实 `ctx.webServer.register()` / `registerUpgrade()`、Client Session binding 和
  Conversation runtime-only Draft API；具体基线与生命周期以 `docs/api-grounded-review.md` 为准。
  `lastActiveSessionId`、自定义 Host 事件自动转发、`desktopRuntime` 窗口方法均无依据；
  `ctx.emit` 的 appshot 事件不在固定 allowlist 中。

## 不可违反的硬规则

1. 禁止 `any`、`@ts-ignore`；修复类型定义和调用边界。
2. **防自截**：对已进入捕获的任务，截图完成落盘前禁止唤起、显示或聚焦 DSH，也禁止显示可进入画面的自有通知；前置校验确定不会继续截图后才可提示失败。
3. **单一 Owner**：Staging 临时文件在所有成功/失败分支都必须清理；macOS 的最终 Owner 是 AttachmentStore，Windows 的 ACK 前 Owner 是 Node Pending、ACK 后是 Composer 运行时 Draft。
4. 禁止使用 `docs/api-grounded-review.md` 判定为不存在的宿主接口
   （`lastActiveSessionId`、`appshot:ready` 事件桥、Composer 注入公共 API、`desktopRuntime` 窗口方法）。
5. macOS 调用 `ctx.attachments.saveImage` 时输入必须是**字节**（`Uint8Array`），不是文件路径；
   `ImageAttachmentRef` 没有 `url` 字段。Windows Basic 禁止调用 `saveImage`。
6. 宿主侧不猜测"活跃会话"：只处理明确给定的 `sessionId`；活跃会话由客户端模块在 Renderer 侧
   识别并经自建通道上报。
7. `package.json` **不得声明 `peerDependencies`**：Windows 下 pnpm 会为 peer 依赖在包内创建
   **相对路径符号链接**，未开开发者模式的普通用户权限必然 EPERM（0.2.0 曾因此全员安装失败）。
   `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 以 devDependencies 提供类型；代码仍然只允许
   `import type`（编译期擦除），禁止运行时导入 cordis 值；`ctx` 由宿主注入，运行时零依赖。
8. 禁止裸 `npm i @deepseek-ai/dsh-tools`（npm `latest` 是过期 0.0.1-rc.1）；保持
   `0.1.0-rc.6` 精确版本，所有 `@deepseek-ai/dsh-*` 在同一 `0.1.0-rc.x` 线上，避免双模块副本。
9. 纯 ESM：`package.json` 必须 `"type": "module"`；tsc 用 `module: esnext` +
   `moduleResolution: bundler` 保留 bare specifier。
10. 注册是 effect：`ctx.tools.register()` / `ctx.on()` 卸载自动清理；自有资源
    （子进程、定时器、连接）必须包在 `ctx.effect(() => {…; return cleanup})` 或 `dispose()` 中。
11. 加载顺序靠服务依赖（`inject`），不靠文件顺序；需要 `ctx.tools` / `attachments` / `webServer`
    等服务时必须显式声明 inject。
12. `cordis.patch.yml` 的 `name` 是包名（走 node_modules 解析），不是相对路径。
13. Windows Client 必须使用 `http://dsh.internal` 基址规则的绝对 URL 和普通 HTTP 长轮询，不得复制 macOS 的相对 EventSource/SSE 假设。
14. `createDraftImages` 只是 Renderer runtime-only registry；未同时验证目标 Composer `imageIds` 和 Draft registry 时，不得仅凭本地 ID 补 ACK。

## 状态与数据边界

- 数据与状态必须有唯一 owner；三方之间不维护需要双向同步的副本。
- macOS：Staging 在 `saveImage` 成功前归 Plugin，成功后转移给 DSH AttachmentStore。
- Windows：Staging 被读入后立即删除；`MOUNTED` 前 Node Pending 字节是唯一可重放副本，之后 Composer Draft 是最终运行时 Owner。
- 活跃 Session 与 Composer Draft 是 Renderer 私有状态：宿主不持有、不猜测、不写入；
  客户端模块负责读取并上报 `sessionId`。
- `ImageAttachmentRef` 是 DSH 的不透明持久化引用
  （`attachmentId` / `mediaType` / `bytes` / `width` / `height` / `name?`），不是路径、URL
  或 base64；该规则适用于 macOS Attachment 路径，Windows Basic 直接传递 Pending 字节，不创建此引用。

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

- `src/`：宿主插件源码；`index.ts` 是当前 Cordis `apply(ctx)` 入口。
- `native/macos/`：Swift Package（可执行目标 `appshot-macos`）；`Sources/main.swift` 为 CLI 截图
  PoC；`.build/` 是 Swift 构建产物，不得提交。
- `docs/`：`requirements.md` / `technical.md`（macOS）、`requirements-windows.md` / `technical-windows.md`（Windows Basic）、
  `tasks.md`（分阶段验收）、`api-grounded-review.md`（DSH 接口真伪的权威依据）。
- `dist/`：构建产物；发布 `files` 含 `dist`、`cordis.patch.yml` 与两端 Native 产物
  （`native/macos/.build/Appshot Agent.app`、`native/windows/bin/win-x64`）。
- `cordis.patch.yml`：bundle 层注入；`name` 用包名。
- `package.json`：`@deepseek-ai/dsh-tools`（devDep，exact `0.1.0-rc.6`，`next` tag 线）、
  `@deepseek-ai/cordis`（devDep `^4.0.1`，仅类型）；不声明 `peerDependencies`（见硬规则 7）。

依赖方向：`src/` → `@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis`（仅类型）；Native Agent 是独立平台工程，
与 Node 侧只通过 NDJSON IPC 契约通信；宿主插件不反向依赖 Renderer
私有代码。

## Git

执行 commit 时必须使用 Conventional Commits，类型仅限：`feat`、`fix`、`docs`、`style`、
`refactor`、`perf`、`test`、`chore`。除非用户明确要求，不执行 commit、reset、checkout 或清理
用户修改。构建产物必须遵守现有 `.gitignore`；创建 Windows 工程时先补充 `bin/obj` 忽略规则，
不得把 `dist/`、`native/macos/.build/` 或 Windows 构建产物作为普通源码提交。
