# dsh-plugin-appshot

> macOS / Windows 全局快捷键「一键截图**当前窗口**」，自动作为图片上下文挂入 DeepSeek Harness (DSH) 的 Composer —— 把当前工作窗口零摩擦交给 Agent。

[English](README.en.md) · [中文](README.md) · [Changelog](CHANGELOG.md) · [更新日志](CHANGELOG.zh-CN.md)

![macOS](https://img.shields.io/badge/macOS-14%2B-333333?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%2B-0078D4?logo=windows)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6-4f46e5)
![npm](https://img.shields.io/npm/v/dsh-plugin-appshot)
![License](https://img.shields.io/badge/license-MIT-green)

## 安装（一条命令）

```sh
dsh plugin --profile web add dsh-plugin-appshot
```

- npm 包为**预构建产物**：宿主插件 + 客户端模块 + 双平台 Native Agent（macOS `.app` 与 Windows 自包含单文件 `.exe`）已全部打包，**无需本地编译、无需构建授权**；
- 安装后**重启 dsh**，启动日志出现 `[dsh-plugin-appshot] plugin applied successfully`、`native agent ready` 即加载成功；
- macOS 首次触发截图时会弹出授权引导，需授予**屏幕录制**与**辅助功能**权限（见[权限](#权限)）；Windows 无需额外授权。

> 从源码安装（开发/贡献者）：在插件目录 `pnpm install && pnpm build && pnpm build:native`，然后在插件**父目录**执行 `dsh plugin --profile <name> add ./dsh-plugin-appshot`（`dsh plugin add` 的相对路径锚定调用目录）。

## 这是什么

DSH 版的「[Codex Appshots](https://developers.openai.com/codex/appshots)」：为 DeepSeek Harness 带来全局快捷截屏上下文体验。

**典型场景**：无论你是在浏览器中查阅文档、在 IDE 中调试代码，还是在终端中排查报错——在任何应用的任何窗口中遇到疑问，只需按下 **左 ⌘ + 右 ⌘**，当前窗口截图便会瞬间自动传递到 DSH 客户端并挂入 Composer；附上你的问题即可直接向 Agent 提问，彻底告别「手动截图 → 切换窗口 → 粘贴上传」的繁琐流程。

**截的是「当前窗口」，不是「整个屏幕」**——与 Codex 官方对 Appshots 的描述一致（*"An appshot captures the frontmost window only."*，Appshot 只截取最前面的那个窗口）：

| ✅ 截取 | ❌ 不截取 |
| --- | --- |
| 触发瞬间正在操作的那**一个**前台窗口（Chrome / VS Code / Finder / Terminal…） | 整个屏幕、桌面壁纸、菜单栏/Dock、其他窗口、后台应用 |

```text
按下 左⌘+右⌘  →  截取当前前台窗口  →  截图挂入 Composer  →  输入描述并 Send
```

目前支持 **macOS 14+**（默认双 ⌘ Command）与 **Windows 10 19041+**（默认双 Ctrl，可在设置面板自定义修饰键组合）。

## 使用

1. 在任意应用（Chrome、VS Code、Finder / 记事本、Terminal…）中按下全局快捷键——**macOS 同时按左 ⌘ 与右 ⌘**，**Windows 同时按左 Ctrl 与右 Ctrl**（可在设置面板自定义）——截的就是你眼前正在看的这**一个窗口**，不是整屏；

    **接下来两个平台的表现不同：**

    - **macOS**：截图完成落盘后 DSH 窗口自动唤起并聚焦（先截后唤，不会截到 DSH 自身；窗口唤起仅对 DSH 桌面端生效，`dsh web` 下截图仍会挂入 Composer，只是不唤起窗口）；
    - **Windows**：**DSH 保持原样、不会被激活**——截图静默进入当前会话输入框，不打断你手头的工作；成功时以快门音与缩略图飞入动画反馈（可在设置中关闭），失败时弹出**不抢焦点**的轻量浮层提示原因。

| 触发前（正在操作的前台窗口，截图为 macOS 示例） | 触发后（自动截取并挂入 Composer） |
| :---: | :---: |
| ![触发前](docs/assets/before-double-command.png) | ![触发后](docs/assets/after-double-command.png) |

3. 截图已挂载在当前会话 Composer 草稿中（可点击打开查看大图，或连续触发追加多张）；

![在 DSH 桌面端查看 Appshot 截图](docs/assets/open-app-shot-in-dsh-desktop.png)

4. 输入描述（如「分析当前界面上的这个报错」）后点击发送，截图随文本一起提交。

> 截图进入 Composer 而非直接触发 Agent——你可以补充说明、追加截图或删除不需要的附件，意图完全由你掌控。

## 特性

**双平台共有**

- **单窗口精准截图**：只截你正在看的**一个**窗口，不是整屏、不含其他窗口与桌面。
- **Composer 草稿挂载**：截图自动进入当前会话的输入框草稿，等你补充说明后随消息一起发送；可连续触发追加多张。
- **无残留**：临时 Staging 文件按「单一 Owner」合同在所有成功/失败分支清理，插件启动时自动清扫崩溃遗留。

**macOS**

- **全局双 Command 快捷键**：左 ⌘ + 右 ⌘ 组合状态机触发（与 Codex Appshots 同款），带冷却防抖，DSH 在后台/最小化时也能响应。
- **ScreenCaptureKit 单窗口截图**：过滤透明层、Shadow、Tooltip，保留 Retina 高清分辨率；多显示器下只截目标窗口所在屏幕。
- **先截后唤（防自截）**：截图完成并落盘后，才由 Native Agent 唤起并置顶 DSH 主窗口，杜绝竞态导致「截到 DSH 自己」。
- **SSE 推送挂载**：截图经宿主 `saveImage` 持久化为 DSH Attachment 后，经自建 SSE 通道推送客户端，自动挂到活跃 Session 并聚焦输入框。
- **权限反馈**：缺少 Screen Recording / Accessibility 权限时弹出系统授权引导，并用系统通知（`UNUserNotificationCenter`）提示失败原因。

**Windows**

- **双 Ctrl 快捷键（可自定义）**：左右 Ctrl 同时按触发；可在 DSH 设置面板改为 Ctrl/Alt/Shift 左右键的其他组合，配置跨重启保留。
- **鼠标屏最前窗口锁定**：截取鼠标所在显示器 Z 序最前的窗口；最前是 DSH 自身、桌面、任务栏或不可见/跨屏窗口时明确拒绝并提示，绝不误截。
- **置前 + 降级两阶段截图**：先留存窗口可见内容备份，普通置前成功后重截；置前失败时降级使用备份，尽力保住「你看到的就是截到的」。
- **静默交付（防自截反向设计）**：全程**不激活、不聚焦 DSH**；截图经 Node 内存 Pending 字节与定向 HTTP 长轮询交给锁定的客户端，挂入 Composer 后回报 `MOUNTED` 确认，不达不弃。
- **无打扰反馈**：快门音、边框闪烁与缩略图飞入任务栏动画（均可关闭）；所有失败提示均为不抢焦点的 No-Activate 浮层。

## 工作原理

系统由三方组成，数据单向流动：

```text
┌─────────────────────────┐     NDJSON IPC (stdio)     ┌──────────────────────────┐
│  macOS Native Agent      │ ────────────────────────▶  │  Node / Cordis 宿主插件    │
│  (Appshot Agent.app)     │    type: "appshot"         │  (src/)                   │
│  · 双 Command 状态机      │                            │  · fs.readFile 读字节      │
│  · 前台窗口识别           │                            │  · attachments.saveImage   │
│  · ScreenCaptureKit 截图  │                            │  · 所有权原子转移 + unlink  │
│  · 截图落盘后唤起 DSH     │                            │  · webServer SSE 广播      │
└─────────────────────────┘                            └────────────┬─────────────┘
                                                                     │ SSE (appshot/ready)
                                                                     ▼
┌─────────────────────────┐
│  DSH Client 模块 (Renderer) │
│  · 识别活跃 sessionId      │
│  · 挂载 ImageAttachmentRef │
│  · 聚焦 Composer 输入框     │
└─────────────────────────┘
```

关键设计：

- **防自截硬约束**：任何模块在截图落盘前都禁止唤起/显示/聚焦 DSH 窗口；窗口唤起是 Native 能力（`NSRunningApplication`），不是 DSH API。
- **确定性所有权转移（Single Owner）**：`saveImage` 成功前 Staging 文件归插件；成功后所有权移交 DSH AttachmentStore，插件立即 `unlink`；失败分支 `finally` 清理；启动时执行孤儿文件 GC。

## 权限

首次触发截图时，macOS 会弹出授权引导，需授予：

| 权限 | 用途 |
| --- | --- |
| **屏幕录制 (Screen Recording)** | ScreenCaptureKit 捕获前台窗口画面 |
| **辅助功能 (Accessibility)** | 全局按键状态机监听 + 窗口唤起置顶 |

拒绝授权时本次截图终止，并通过系统通知提示；可在 系统设置 → 隐私与安全性 中补授后重试。

## 限制

- 支持 **macOS 14+** 与 **Windows 10 19041+**（自包含单文件 Agent，无需安装 .NET 运行时）；WebUI 暂不支持（浏览器沙箱无法获取全局快捷键或跨应用置顶）。
- 窗口唤起仅对 DSH 桌面端（macOS）生效；`dsh web` 下截图仍可入 Composer，但不唤起/置顶窗口；Windows 按「防自截」设计不唤起 DSH，截图静默进入输入框。
- 不含区域框选、全屏截图、图片标注、OCR 与历史图库管理（均为后续规划）。
- 快捷键：macOS 默认双 Command；Windows 默认双 Ctrl，可在 DSH 设置 → 截图捕获 中自定义修饰键组合，并开关快门音与截图动画（配置跨重启保留）。

## 开发

```text
src/                 宿主插件（Cordis apply(ctx) 入口 + windows/macos 交付 + client 模块）
native/macos/        Swift Native Agent（ScreenCaptureKit + 双 Command 状态机）
native/windows/      C# Native Agent（Win32 低级键盘钩子 + GDI 双阶段截图）
docs/                requirements / technical（分平台）/ tasks / api-grounded-review
tests/               各 Phase 契约测试（node --test）
```

常用命令：

```sh
pnpm build                  # esbuild 打包宿主插件与客户端模块 → dist/
pnpm typecheck              # tsc --noEmit
pnpm test                   # 契约测试（DSH_DISABLE_AGENT_SPAWN=1 避免拉起真实 Agent）
pnpm build:native           # 构建 Appshot Agent.app（macOS）
pnpm build:native:windows   # dotnet publish 自包含单文件 exe → native/windows/bin/win-x64/（Windows）
pnpm test:native            # Windows Native 单测（dotnet test）

# Native 诊断（在 native/macos 内）
swift build && .build/debug/appshot-macos --list-windows          # 列出可捕获窗口
.build/debug/appshot-macos --cli-capture --output /tmp/test.png    # 前台窗口截图 PoC
```

依赖约束：`@deepseek-ai/cordis`（`^4.0.1`）与 `@deepseek-ai/dsh-tools`（exact `0.1.0-rc.6`，npm `latest` 是过期 0.0.1-rc.1，勿用 `npm i` 覆盖）均为 devDependencies，仅在开发期提供类型；包元数据**不声明 `peerDependencies`**——Windows 下 pnpm 会为 peer 依赖创建相对符号链接，普通用户权限（未开开发者模式）安装必然 EPERM 失败。代码只 `import type`，运行时 `ctx` 由宿主注入，插件零运行时依赖。

发布（technical-windows.md §7.4）：tag 触发 GitHub Actions 双 runner——macOS 构建 `Appshot Agent.app`、Windows 构建 `appshot-win-x64.exe`，装配机还原两端产物后 `npm publish`（`prepack` 平台感知：本机构建 Native + `CI` 环境强制双端产物 Gate，缺一即阻断）。本地 `pnpm pack` 仅产出单平台包，不作为正式发布源。

## License

本项目基于 [MIT](LICENSE) 协议开源。
