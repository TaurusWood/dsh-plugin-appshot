# dsh-plugin-appshot PRD

> 本文仅定义 macOS MVP。Windows Basic 不复制本文的窗口激活、SSE 或 Attachment Owner 合同，
> 其产品边界以 [`requirements-windows.md`](requirements-windows.md) 为准。

## 1. 产品定义

`dsh-plugin-appshot` 是 DeepSeek Harness (DSH) 的桌面上下文捕获插件。

核心能力：

> 用户在任意应用中触发全局快捷键后，自动捕获当前正在操作的应用窗口，并将截图作为上下文放入 DSH 输入框（Composer）。截图完成后由 Native Agent 唤起 DSH 窗口并聚焦输入框，由用户输入描述文本后一并提交给 Agent / Chat。

产品定位：

- 上下文快速捕获与输入助手，而不是独立的图像编辑/标注工具；
- 核心价值是“把用户当前工作窗口零摩擦交给 Agent”。

---

## 2. 目标

### MVP

- **平台支持**：支持 macOS（Desktop 客户端）。
- **运行环境**：Node.js ^22.19.0 || >=24.0.0（对齐 DSH 宿主基线）。
- **常驻后台**：macOS Native Agent（`LSUIElement = true`，无 Dock 图标常驻用户 GUI 会话）。
- **全局快捷键**：默认支持双 Command（`Left Cmd + Right Cmd` 组合触发），支持回退到普通组合键。
- **自动识别前台窗口**：自动定位并精确捕获用户触发时正在操作的应用顶层窗口，不截取无关背景与整个桌面。
- **先截后唤（防自截）**：必须在截图完成并生成 Staging 文件后，才由 Native Agent 唤起 DSH 主应用，杜绝竞态导致的“截到 DSH 自身”。
- **目标 Session 解析**：
  - 由插件客户端模块（`dsh.client`）在 Renderer 侧识别当前 UI 活跃的 `sessionId`；
  - 若当前无活跃 Session，由客户端模块引导或调用会话流程新建。
- **Composer 附件注入**：
  - 宿主插件将截图读取为字节后通过 `ctx.attachments.saveImage({ data, mediaType, name })` 持久化，获得 `ImageAttachmentRef`；
  - 宿主通过自建 SSE 通道（`ctx.webServer`）向插件客户端模块推送事件，由客户端模块在 Renderer 内部将图片挂载至 Composer Draft；
  - 触发时不自动发送消息；用户输入文本后点击 Send，截图与文本作为同一条 User Message 进入 Agent 上下文。
- **单图追加模式**：单次触发生成一张窗口截图；连续触发时支持在 Composer 中追加多张截图附件。
- **确定性所有权转移（Single Owner）**：
  - 在 `ctx.attachments.saveImage` 成功前，Staging 临时文件归 Plugin 管辖（失败时由 Plugin 销毁）；
  - 接管成功后，文件生命周期移交给 DSH，Plugin 立即清理 Staging 临时文件。
- **系统通知与权限反馈**：
  - 缺少 Screen Recording 或 Global Keyboard 权限时，弹出系统级授权引导，并终止本次操作；
  - 失败或快捷键冲突时，通过 macOS 系统通知（`UNUserNotificationCenter`）向用户展示明确提示。

### 后续规划（Non-goal in MVP）

- WebUI 支持（WebUI 运行在浏览器 Tab 内，受浏览器沙箱限制无法获取全局系统快捷键与跨应用置顶，待后续结合 Browser Extension / 本地 WebSocket 探索）。
- Windows 实施（不属于本 macOS MVP；已单独定义 [`requirements-windows.md`](requirements-windows.md)）。
- 辅助功能（Accessibility / UI Automation）结构化文本提取。
- 手动区域框选截图（Region Shot）与全屏截图（Screen Shot）。
- 自定义快捷键配置面板。
- 图片标注、涂鸦、OCR 与历史图库管理。

---

## 3. 非目标 (MVP)

MVP 坚决不做：

- WebUI 跨沙箱全局快捷键与窗口唤起。
- 图片编辑、涂鸦、裁剪、OCR。
- 截图历史管理面板与云端图库同步。
- 录屏与 GIF 录制。
- 自动定时或连续截图。
- 跨窗口/多屏幕拼图。

---

## 4. 用户流程与交互时序

```text
[用户正在前台使用任意应用 (如 Chrome / VS Code)]
                     │
                     │ 1. 触发全局快捷键 (双 Command / Left Cmd + Right Cmd)
                     ▼
┌──────────────────────────────────────────────────────────┐
│ macOS Appshot Agent.app                                  │
│                                                          │
│ 2. 识别当前 Frontmost Window                             │
│ 3. ScreenCaptureKit 完成单窗口截图                       │
│ 4. 写入 Staging File: /tmp/dsh-appshot-<uuid>.png          │
│ 5. 截图成功后，调用 macOS 原生 NSRunningApplication 唤起  │
│    并置顶 DSH 主应用 (先截后唤，杜绝自截)                 │
└────────────────────┬─────────────────────────────────────┘
                     │
                     │ 6. NDJSON IPC Event (type: "appshot")
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Node / Cordis Plugin (dsh-plugin-appshot)                │
│                                                          │
│ 7. 读取临时文件字节 (fs.readFile)                         │
│ 8. 调用 ctx.attachments.saveImage({ data, mediaType })   │
│ 9. 成功获得 ImageAttachmentRef，Plugin unlink 临时文件    │
│ 10. 通过 ctx.webServer 注册的 SSE 通道向客户端广播事件     │
└────────────────────┬─────────────────────────────────────┘
                     │
                     │ 11. SSE Event (appshot/ready)
                     ▼
┌──────────────────────────────────────────────────────────┐
│ DSH Client (插件自带 dsh.client 模块 / Renderer)          │
│                                                          │
│ 12. 接收 SSE 事件，获取当前活跃 sessionId 与 AttachmentRef │
│ 13. 将 AttachmentRef 挂载到目标 Session Composer Draft    │
│ 14. 聚焦 (Focus) Composer 输入框光标                     │
└────────────────────┬─────────────────────────────────────┘
                     ▼
[DSH 窗口已在前台，Composer 已挂载截图，光标就绪]
                     │
                     │ 15. 用户输入：“分析当前界面上的错误”
                     │ 16. 用户点击 Send
                     ▼
[文本 + 截图作为同一条 User Message 提交给 Agent 模型]
```

> **核心交互原则**：
> 1. **全自动零摩擦**：快捷键触发后无需手动选框、保存或再次上传；
> 2. **防自截硬约束**：截图完成前禁止任何唤起 DSH 的行为；
> 3. **意图确认**：截图进入 Composer 而非直接触发 Agent，用户保留补充说明或删除截图的控制权。

---

## 5. 功能需求

### FR-01 全局快捷键与状态机

- 插件在 DSH 处于后台甚至最小化时仍能稳定响应。
- macOS 默认采用“双 Command”（`Left Command` 按下 + `Right Command` 按下组合状态机），单次组合只触发一次。
- 允许配置常规组合键（如 `Cmd + Shift + 8`）作为冲突回退方案。
- 发生快捷键占用或注册冲突时，上报错误并通过系统通知提示。

### FR-02 当前窗口识别

- 触发瞬间捕获前台正在交互的活跃窗口。
- 优先级：
  ```text
  Focused / Foreground Window
  > Frontmost App Main Window (过滤透明层、Shadow、Tooltip)
  > 明确失败 (报错，不静默截取随机窗口或整屏)
  ```

### FR-03 单窗口高保真截图与原生唤起

- 严格只截取目标窗口本身。
- 多显示器场景下，以目标窗口所在屏幕为准进行捕获，不截取其他屏幕或整个虚拟桌面。
- 保持 Retina 高清分辨率与原始宽高比例。
- 截图完成后，由 Native Agent 负责调用系统原生 API 唤起 DSH 主应用。

### FR-04 附件持久化与 Composer 注入

- 宿主通过 `ctx.attachments.saveImage` 将二进制图片保存至 DSH 底层存储，获得不可变的 `ImageAttachmentRef`；
- 宿主通过自建 SSE 通道推送给客户端模块，由客户端模块在 Renderer 侧将图片追加至当前活跃 Session 的 Composer Draft。

### FR-05 确定性文件生命周期（Single Owner）

- Native Agent 将截图写入临时路径 `/tmp/dsh-appshot-<uuid>.png`。
- **所有权转移原子边界**：
  - `saveImage` 成功前：Owner 为 Plugin；
  - `saveImage` 成功后：Owner 为 DSH AttachmentStore，Plugin 立即 `unlink` 临时文件；
  - 若中途失败，Plugin 在 `finally` / `catch` 中立即清理临时文件；
  - Plugin 启动时扫描并清理上一轮由于崩溃遗留的 `/tmp/dsh-appshot-*` 孤儿文件。

### FR-06 权限管理与错误处理

- macOS 权限包含：
  1. **Screen Recording**：用于 ScreenCaptureKit 捕获；
  2. **Accessibility / Input Monitoring**：用于全局修饰键与窗口原生唤起置顶。
- 权限未授予时，Native Agent 弹出系统授权申请引导面板并终止本次截图。
- 发生异常（无权限、捕获失败、窗口受保护、无前台窗口）时，通过 macOS 系统级通知（`UNUserNotificationCenter`）向用户反馈。

---

## 7. 验收标准

1. **后台触发**：在 Chrome、VS Code、Finder、Terminal 等应用中触发双 Command，能稳定捕获其前台窗口。
2. **防自截时序**：截图绝对不包含 DSH 窗口自身，截图落盘后 DSH 窗口平滑唤起、置顶并获焦输入框。
3. **Session 挂载**：截图通过 SSE 稳定进入当前活跃 Session 的 Composer，支持连续追加。
4. **多显示器与多窗口**：双屏环境下不误截整屏；同一 App 多窗口时优先捕获当前正在操作的窗口。
5. **无多余残留**：桌面上不产生截图文件，临时 Staging 文件在 `saveImage` 后立即被删除。
6. **权限引导**：无权限时有明确的系统授权引导与系统通知，进程不崩溃。
