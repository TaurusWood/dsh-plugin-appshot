# dsh-plugin-appshot 技术方案

> 本文仅覆盖 macOS 技术路径。Windows Basic 的 Native、HTTP 长轮询、Pending/ACK 和发布合同以
> [`technical-windows.md`](technical-windows.md) 为准；DSH 接口真伪统一以 [`api-grounded-review.md`](api-grounded-review.md) 为准。

## 1. 架构目标

在 DeepSeek Harness (DSH) 的 Node.js (^22.19.0 || >=24.0.0) / Cordis 插件体系中实现 macOS 桌面窗口上下文捕获。

核心交互：
- 用户按全局双 Command 快捷键（`Left Cmd + Right Cmd`）；
- Native Agent 自动定位前台窗口并完成高保真截图；
- 截图完成后，Native Agent 调用系统 API 唤起 DSH 主窗口；
- 宿主插件将图片读取为字节并调用 `ctx.attachments.saveImage` 持久化；
- 宿主通过自建 SSE 通道向客户端模块推送 `appshot/ready` 事件；
- 客户端模块在 Renderer 内部将图片挂载至目标 Session 的 Composer Draft 并聚焦输入框。

---

## 2. 总体架构与分层职责

系统由 **macOS Native Agent**、**Node / Cordis 宿主插件** 与 **DSH Client (插件客户端模块)** 三方协同组成：

```text
┌─────────────────────────────────────────────────────────────┐
│  macOS Native Sidecar (Appshot Agent.app)                   │
│  - LSUIElement = true (无 Dock 图标常驻用户 GUI 会话)         │
│  - Bundle ID: com.deepseek-harness.appshot-agent (稳定签名)  │
│  - TCC 权限申请与检测 (Screen Recording, Accessibility)       │
│  - 全局键盘事件监听 (Double-Command State Machine)           │
│  - 前台窗口精确识别 (Frontmost App + AX/Window List 过滤)    │
│  - ScreenCaptureKit 截图 -> Staging File                    │
│  - 截图完成后调用 NSRunningApplication 唤起 DSH 主窗口 (先截后唤)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ 长连接 stdio (NDJSON IPC)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Node / Cordis Plugin (dsh-plugin-appshot)                  │
│  - Agent.app 进程生命周期管理 (apply 启动 / dispose 终止)     │
│  - Staging File 读取字节 (fs.readFile)                      │
│  - 调用 ctx.attachments.saveImage({ data, mediaType, name })│
│  - 成功获取 ImageAttachmentRef 后立即 unlink Staging 临时文件 │
│  - 通过 ctx.webServer 注册 SSE 路由向 Client 广播事件        │
│  - 启动时执行 cleanOrphanStagingFiles 垃圾回收              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ SSE Event Stream (/plugins/appshot/events)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  DSH Client (插件 dsh.client 模块 / Renderer)               │
│  - 维护 UI 活跃 sessionId                                    │
│  - 监听 SSE 推送的 appshot/ready 事件                       │
│  - 将 ImageAttachmentRef 挂载至目标 Session 的 Composer Draft│
│  - 聚焦输入框光标                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 详细职责划分

### 3.1 macOS Native Agent (`Appshot Agent.app`)
1. **进程模型**：作为 macOS Background Application (`LSUIElement=true`) 运行在当前登录用户的 GUI 会话中，不占 Dock 栏；
2. **代码签名与 TCC**：拥有固定的 Bundle Identifier (`com.deepseek-harness.appshot-agent`) 与统一代码签名，确保 Screen Recording 与 Input Monitoring 权限长期稳定；
3. **全局修饰键状态机**：利用 macOS 原生 Event Monitor / `CGEventTap` 持续捕获 `Left Command` 与 `Right Command` 按下/释放状态，防长按重复触发；
4. **窗口识别与捕获**：
   - 快捷键命中瞬间，立即锁定前台应用 (`NSWorkspace.frontmostApplication`)；
   - 过滤掉阴影窗口、菜单栏弹窗、Tooltip、透明渲染层；
   - 通过 `ScreenCaptureKit` (`SCScreenshotManager.captureImage`) 获取单窗口图像；
   - 将图片写入临时文件 `/tmp/dsh-appshot-<uuid>.png`；
5. **原生窗口唤起（防自截硬约束）**：
   - **必须在截图完成并确认 Staging 文件写盘后**，才调用 `NSRunningApplication` 唤起 DSH 主应用（通过 DSH 主应用的 Bundle ID 激活并置顶）；
6. **双运行模式**：
   - `daemon` 模式：生产常驻运行，长连接 NDJSON 通信；
   - `cli` 模式（如 `--cli-capture`）：单次执行并输出 JSON，用于自动化测试与单步 PoC。

### 3.2 Node / Cordis 插件 (`dsh-plugin-appshot`)
1. **服务注入与生命周期**：
   ```ts
   export const name = 'dsh-plugin-appshot'
   export const inject = ['attachments', 'webServer', 'sessions']
   ```
   在 Cordis `apply(ctx)` 时拉起 Agent.app 子进程并注册 SSE 路由；在 `dispose()` 时安全退出子进程。
2. **Attachment 真实对接与所有权原子转移**：
   ```ts
   import { readFile, unlink } from 'node:fs/promises'
   import type { Context } from '@deepseek-ai/cordis'
   import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

   async function ingestScreenshot(
     ctx: Context,
     imagePath: string,
     appName: string,
   ): Promise<ImageAttachmentRef> {
     try {
       const data = await readFile(imagePath)
       return await ctx.attachments.saveImage({
         data,
         mediaType: 'image/png',
         name: `${appName} 窗口截图.png`,
       })
     } finally {
       // 单一 Owner：成功持久化或失败均由插件立即清理 Staging 文件
       await unlink(imagePath).catch(() => {})
     }
   }
   ```
3. **SSE 通道广播**：
   通过 `ctx.webServer.registerUpgrade('/plugins/appshot/events', ...)` 建立宿主向客户端模块推送事件的专用 SSE 通道；
4. **启动时孤儿文件 GC**：扫描并清理历史遗留的 `/tmp/dsh-appshot-*` 临时文件。

### 3.3 DSH Client (插件自带 `dsh.client` 模块)
1. 运行在 DSH 客户端（Renderer 进程）内；
2. 订阅 `/plugins/appshot/events` SSE 流；
3. 收到 `appshot/ready` 事件后，读取当前活跃 `sessionId`，将 `ImageAttachmentRef` 追加至当前 Session 的 Composer Draft 列表；
4. 聚焦输入框光标。

---

## 4. 关键时序硬约束（防自截 Race Condition）

```text
[用户按键 Left Cmd + Right Cmd]
               │
               ▼
[Native 捕获并锁定前台窗口]
               │
               ▼
[ScreenCaptureKit 完成截图并落盘 Staging 文件]
               │
               ▼
[Native Agent 调用 NSRunningApplication 唤起 DSH 主应用]
               │
               ▼
[Native 通过 NDJSON 发送 appshot 事件给 Node 宿主]
               │
               ▼
[Node 读取字节并调用 ctx.attachments.saveImage]
               │
               ▼
[Node unlink Staging 临时文件]
               │
               ▼
[Node 通过 SSE 推送 appshot/ready 给 Client 模块]
               │
               ▼
[Client 模块在 Renderer 内将 ImageAttachmentRef 挂载至 Composer Draft]
```

> **硬性约束**：在 Native 截图完成并落盘前，系统任何模块绝对禁止唤起、显示或聚焦 DSH 窗口。

---

## 5. 通信协议

### 5.1 Native $\leftrightarrow$ Node: NDJSON IPC 契约 (长连接 stdio)

#### Agent 就绪 (`ready`)
```json
{
  "type": "ready",
  "version": 1,
  "bundleId": "com.deepseek-harness.appshot-agent",
  "pid": 12345
}
```

#### 截图完成 (`appshot`)
```json
{
  "type": "appshot",
  "id": "e4b5f6a1-3b7c-4a8e-9d2a-1b2c3d4e5f6a",
  "platform": "darwin",
  "appName": "Google Chrome",
  "windowTitle": "GitHub - Pull Requests",
  "width": 1800,
  "height": 1200,
  "mimeType": "image/png",
  "imagePath": "/tmp/dsh-appshot-e4b5f6a1.png",
  "timestamp": 1771148400000
}
```

#### 错误通知 (`error`)
```json
{
  "type": "error",
  "id": "e4b5f6a1-3b7c-4a8e-9d2a-1b2c3d4e5f6a",
  "code": "SCREEN_PERMISSION_DENIED",
  "message": "Screen capture permission is not granted."
}
```

### 5.2 Node $\rightarrow$ Client: SSE 通道广播协议 (`/plugins/appshot/events`)

```ts
interface AppshotReadyFrame {
  type: 'appshot/ready';
  attachmentRef: {
    attachmentId: string;
    mediaType: 'image/png';
    bytes: number;
    width: number;
    height: number;
    name?: string;
  };
  metadata: {
    appName: string;
    windowTitle?: string;
  };
}
```

---

## 6. 统一错误模型

```text
SCREEN_PERMISSION_DENIED      // 未获得屏幕录制权限
KEYBOARD_PERMISSION_DENIED    // 未获得全局输入监听权限
NO_FOREGROUND_WINDOW          // 未检测到有效的前台应用窗口
WINDOW_NOT_CAPTURABLE         // 窗口最小化或受系统保护 (DRM)
CAPTURE_FAILED                // ScreenCaptureKit 截图失败
ATTACHMENT_SAVE_FAILED        // ctx.attachments.saveImage 失败
SHORTCUT_CONFLICT             // 全局按键注册冲突
NATIVE_AGENT_CRASHED          // Agent 子进程异常退出
```

- 当发生 `SCREEN_PERMISSION_DENIED` 时，Native Agent 主动调用系统授权面板引导用户；
- 发生异常时，通过 macOS 系统通知 (`UNUserNotificationCenter`) 向用户提示。

---

## 7. 临时文件与生命周期管理

1. **命名规范**：`/tmp/dsh-appshot-${crypto.randomUUID()}.png`；
2. **所有权移交规则**：
   - `saveImage` 成功前：Plugin 是唯一 Owner；
   - `saveImage` 返回成功后：文件所有权移交给 DSH 底层存储，Plugin 立即执行 `unlink` 清理 Staging 临时文件；
   - 异常分支：`finally` 块保证 `unlink` 触发；
3. **Orphan GC**：插件初始化时执行目录扫描：
   ```ts
   async function cleanOrphanStagingFiles() {
     const files = await fs.promises.readdir('/tmp');
     for (const f of files) {
       if (f.startsWith('dsh-appshot-') && f.endsWith('.png')) {
         await fs.promises.unlink(`/tmp/${f}`).catch(() => {});
       }
     }
   }
   ```
