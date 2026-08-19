# dsh-plugin-appshot 任务拆分与阶段测试

## 1. 拆分原则

每个阶段满足：
- 严格基于 [`api-grounded-review.md`](api-grounded-review.md) 已核实的 DSH 接口；macOS 与 Windows 的传输和 Owner 合同分开验收；
- 杜绝非官方推断接口（无 `lastActiveSessionId` 假设、无 `appshot:ready` 宿主转发假设、无 `desktopRuntime` 假设）；
- macOS 的窗口唤起由 Native Agent 执行并严格遵守“先截后唤”；Windows 不主动激活 DSH。两个平台都遵守单一 Owner 规则。

整体实施路径：
```text
Phase 0: 工程骨架与 Cordis 插件模式调整 (依赖与 inject 修正)
  ↓
Phase 1: macOS 截图与窗口识别 PoC (CLI 模式)
  ↓
Phase 2: macOS Background Agent.app 构建 (LSUIElement + 签名 + TCC + 原生唤起)
  ↓
Phase 3: 双 Command 状态机与 NDJSON IPC
  ↓
Phase 4: Node/Cordis 插件核心 (saveImage 字节流 + SSE 路由 + GC)
  ↓
Phase 5: 客户端模块 (dsh.client) 与全链路闭环 (SSE 消费 + Draft 挂载)
  ↓
Phase 6: 边界场景与鲁棒性验收
  ↓
Phase W0-W5: Windows Basic（独立 Gate 与交付路径）
```

---

# Phase 0：工程骨架与 Cordis 插件模式调整

## T0.1 插件架构模式与服务依赖改造
- **目标**：将当前的 `defineTool` 模板改造为标准 Cordis Service/Lifecycle 插件。
- **改动**：
  - 更新 `package.json`，声明 `@deepseek-ai/dsh-attachment` 等必要类型依赖；
  - 更新 `src/index.ts`：
    - `export const inject = ['attachments', 'webServer', 'sessions']`；
    - 实现 `apply(ctx)` 和 `dispose()` 生命周期；
  - 更新 `cordis.patch.yml`。
- **通过标准**：
  > 插件可被 Cordis 正常加载与卸载，类型检查 `pnpm run typecheck` 通过。

---

# Phase 1：macOS 截图与窗口识别 PoC (CLI 模式)

## T1.1 ScreenCaptureKit 单窗口截图验证
- **目标**：验证 Swift 在 CLI 模式下调用 `ScreenCaptureKit` 对指定 `SCWindow` 截图的能力。
- **输入**：`appshot-macos --cli-capture --window-id <id>`
- **输出**：生成 `/tmp/dsh-appshot-test.png` 并向 stdout 输出 JSON。
- **通过标准**：
  > 生成的 PNG 图像仅包含目标窗口，Retina 渲染清晰，不包含全屏幕或桌面背景。

## T1.2 前台窗口过滤算法 PoC
- **目标**：验证在没有硬编码 windowId 的情况下，自动从 `NSWorkspace.shared.frontmostApplication` 和 `SCShareableContent` 中准确识别目标窗口。
- **关键过滤逻辑**：
  - 匹配 `frontmostApplication.processIdentifier`；
  - 过滤 `isOnScreen == false`、尺寸过小（如 Tooltip/Shadow）、透明度异常的辅助窗口；
  - 确定顶层主工作窗口。
- **通过标准**：
  > 在 Chrome、VS Code、Finder、Terminal 处于前台时执行，均能 100% 正确命中对应的主窗口。

---

# Phase 2：macOS Background Agent.app 构建

## T2.1 Agent.app 打包与签名
- **目标**：将 Native 端构建为标准的后台 macOS Application Bundle。
- **规范**：
  - `Info.plist` 配置 `LSUIElement = true`（无 Dock 图标、无菜单栏）；
  - 固定 Bundle ID: `com.deepseek-harness.appshot-agent`；
  - 本地开发与发布签名对齐，确保代码身份稳定。
- **通过标准**：
  > Agent.app 在当前 GUI 会话中静默启动，Activity Monitor 中可见进程，Dock 栏无图标。

## T2.2 TCC 权限检测与原生窗口唤起
- **目标**：实现 Screen Recording 权限检测与原生 DSH 窗口唤起。
- **逻辑**：
  - 检测 `CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()`；
  - 缺少权限时，触发系统设置授权面板，并向 Node 输出 `SCREEN_PERMISSION_DENIED` 错误；
  - 截图成功落盘后，通过 `NSRunningApplication.runningApplications(withBundleIdentifier:)` 唤起 DSH 主应用。
- **通过标准**：
  > 授权正常时，截图完成后 DSH 窗口立即平滑唤起置顶；未授权时弹出系统授权引导。

---

# Phase 3：双 Command 状态机与 NDJSON IPC

## T3.1 全局按键状态机
- **目标**：通过原生 Event Monitor 实现双 Command（`Left Cmd + Right Cmd`）低延迟捕获。
- **状态机要求**：
  - `LeftDown + RightDown` $\rightarrow$ 触发一次；
  - 必须有任一按键释放（`KeyUp`）后才允许进入下一次触发判定；
  - 长按不重复触发。
- **通过标准**：
  > 快速按下双 Command 时稳定触发，长按 5 秒仅触发 1 次，单按 Command 绝不误触。

## T3.2 长连接 NDJSON IPC 协议
- **目标**：建立 Agent.app 与 Node 之间的流式通信。
- **事件流**：
  - Native 启动完成输出 `{"type":"ready", "version":1}`；
  - 触发截图完成输出 `{"type":"appshot", "imagePath":"...", ...}`；
  - 异常输出 `{"type":"error", ...}`。
- **通过标准**：
  > Node 端能持续监听并按行解析 NDJSON，无截断或粘包问题。

---

# Phase 4：Node/Cordis 插件核心服务

## T4.1 Native Agent 生命周期管理
- **目标**：Cordis 插件管控 Agent.app 子进程。
- **逻辑**：
  - `apply(ctx)`：异步启动 Agent.app，监听 stdout，接收 `ready` 握手；
  - `dispose()`：向子进程发送退出信号（SIGTERM/SIGINT），并确保进程完全销毁。
- **通过标准**：
  > DSH 重载或禁用插件时，Agent.app 能够安全退出，无僵尸进程残留。

## T4.2 Attachment 字节持久化与所有权原子转移
- **目标**：基于真实 `ctx.attachments.saveImage` 实现 Staging 文件生命周期管理。
- **规则**：
  - 收到 `imagePath` $\rightarrow$ `fs.readFile(imagePath)` 读入字节；
  - 调用 `ctx.attachments.saveImage({ data, mediaType: 'image/png', name: '...' })`；
  - `finally` 块中立即执行 `fs.unlink(imagePath)`；
  - 插件启动时执行 `cleanOrphanStagingFiles()`，清理历史残留。
- **通过标准**：
  > 连续截图 50 次，`/tmp` 目录下无任何未清理的 `dsh-appshot-*` 文件堆积。

## T4.3 SSE 事件通道注册
- **目标**：通过 `ctx.webServer` 提供向客户端模块推送的 SSE 路由。
- **逻辑**：
  - 注册 `/plugins/appshot/events` 路由；
  - `saveImage` 成功后向活跃客户端连接广播 `{"type":"appshot/ready", "attachmentRef": ...}`。
- **通过标准**：
  > 客户端通过 EventSource 连接该路由可稳定接收广播。

---

# Phase 5：客户端模块 (dsh.client) 与全链路闭环

## T5.1 客户端模块构建
- **目标**：构建运行在 Renderer 内的 `dsh.client` 模块。
- **逻辑**：
  - 建立与 `/plugins/appshot/events` 的 SSE 连接；
  - 收到 `appshot/ready` 后，获取当前活跃 Session，将 `ImageAttachmentRef` 追加至 Composer Draft；
  - 聚焦输入框光标。
- **通过标准**：
  > 双 Command 触发后，DSH 窗口弹至前台，Composer 已挂载截图，光标就绪。

## T5.2 防自截时序全链路验证
- **时序硬约束**：
  `按键 -> 前台窗口锁定 -> 截图落盘 -> Native 原生唤起 DSH -> IPC -> saveImage -> SSE 推送 -> Composer 挂载`
- **测试**：
  - 在 VS Code 编写代码时触发双 Command；
  - 验证：截图只包含 VS Code 窗口，绝对不包含 DSH 自身。
- **通过标准**：
  > 100% 不发生截取到 DSH 自身窗口的竞态情况。

---

# Phase 6：边界场景与鲁棒性验收

## T6.1 边界场景测试
- **多显示器**：在副屏 Chrome 上触发，只捕获副屏窗口，不截取主屏。
- **同 App 多窗口**：Chrome 打开 3 个窗口，捕获正在操作的置顶窗口。
- **全屏 Space 切换**：在全屏应用中触发，截图完成后平滑切回 DSH 所在桌面。
- **系统通知**：在无权限或窗口不可截取时，弹出 macOS 原生系统通知提示。

## T6.2 性能与稳定性
- **测试**：快速连续触发 10 次双 Command。
- **通过标准**：
  > 依次生成多张图片附件并追加到 Composer，无进程死锁，内存与 CPU 资源平稳释放。

---

# Windows Basic 实施路径

> Windows 不是 macOS Phase 4/5 的换壳移植。产品合同以
> [`requirements-windows.md`](requirements-windows.md) 为准，技术合同以
> [`technical-windows.md`](technical-windows.md) 为准。下一阶段只能在当前 Gate 通过后开始。

## W0 DSH 真机接口 Gate（阻断实施）

- **目标**：在 Windows DSH Desktop 2.0.0 / `0.1.0-rc.6` 证明交付链的真实性。
- **验证**：
  - Renderer 可通过 `http://dsh.internal` 访问自建 POST 与长轮询路由；
  - `sessions.binding`、`createDraftImages`、`addImages`、`removeImage`、`snapshot.imageIds`、`draftImages` 与 `releaseDraftImage` 行为符合证据文档；
  - Client 插件 reload 与整个 Renderer reload 分别验证“活性检查后补 ACK”和“失效后重挂载”。
- **通过标准**：
  > 以真机 smoke 记录更新 `api-grounded-review.md`；任一关键接口不符合时停止，先重新设计交付层。

## W1 Windows Native 触发、目标和通知

- **目标**：实现左右 Ctrl 状态机、物理坐标锁定、单显示器校验与 No-Activate 通知。
- **验证**：长按/重复键、注入事件、混合 DPI、跨屏、DSH/桌面/任务栏排除、通知不夺焦点且不拦截鼠标。
- **通过标准**：
  > 每次触发只产生一个候选 `captureId`；非法/跨屏目标在发送 `capture/request` 前本地失败。

## W2 两阶段截图与 Staging 安全

- **目标**：生成 visible backup，Node 接受后尝试普通置前，成功时截取新画面，失败时交付明确降级图。
- **验证**：Topmost 遮挡、置前拒绝、置前后再次跨屏、8K/20MB 上限、PNG 原子落盘、路径/文件名/签名校验与孤儿 GC。
- **通过标准**：
  > 不使用 `HWND_TOPMOST`；截图落盘前不显示任何 UI；所有成功/失败分支无 Staging 残留。

## W3 Node 状态机与定向传输

- **目标**：实现 `IDLE / IN_FLIGHT / PENDING_ACK` 、Client+Session 锁定、安全 ingest、长轮询重放与串行状态转移。
- **验证**：BUSY、15 秒 in-flight 超时、未知/取消 ID 迟到帧、两个 Client 同时轮询、Agent 在 `PENDING_ACK` 退出、dispose 和重复 ACK 元组。
- **通过标准**：
  > 同时最多一张 Pending；非目标 Client 无法读取图片；只有完整匹配的 `MOUNTED` 能释放 Pending。

## W4 Client Draft 挂载、恢复与取消

- **目标**：在锁定 Session 中创建/挂载 Draft，完成快速+低频持续恢复、无 Session 认领、活性验证和取消清理。
- **验证**：Composer busy、Session 删除/改绑、长轮询断线、ACK 丢失、Client/Renderer reload、二次快捷键取消与 `MOUNTED` 竞态。
- **通过标准**：
  > 不调用 `window.focus()`；可验证已挂载状态不重复；不可判定的 mount/ACK 崩溃窗口按需求 §8.1 优先不丢图处理；取消先生效时从 Composer 和 Draft registry 一并清理，`MOUNTED` 先生效时不撤销已成功交付。

## W5 跨平台包装配与真机验收

- **目标**：macOS 与 Windows runner 分别生成 Native artifact，统一装配 npm 包。
- **验证**：两个 Native 产物的包内存在性/可执行性、平台选择、安装/卸载、Windows 10/11 x64 与 macOS 基线回归。
- **通过标准**：
  > 只有双平台 build 和真机核心场景通过后才允许发布；单平台本地 `npm pack` 不是正式发布源。

# 后续增强（非 Windows Basic）

- Accessibility / UI Automation 结构化文本提取；
- 区域框选、全屏截图或跨屏截图；
- 自定义快捷键配置面板。
