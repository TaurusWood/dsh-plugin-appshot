# DSH 接口依据核查

> 核查基线：DSH Desktop 2.0.0，内置 `@deepseek-ai/dsh-*` `0.1.0-rc.6`
>
> 核查日期：2026-08-19
>
> 证据优先级：已安装产物源码与 README > 包元数据 > 本项目描述性文档

## 1. 核查目的

本文是 appshot 依赖 DSH 接口的权威证据链。任何 DSH Host、Client、Session、Composer 或传输接口，
只有在本文列为“已核实”后才能进入生产实现。升级 DSH 基线后必须重新核查。

## 2. 证据基线

本机安装位置：

```text
/Applications/DSH Desktop.app
```

产品版本来自 `Contents/Info.plist`：`2.0.0`。以下包版本均为 `0.1.0-rc.6`：

- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-client-connection`
- `@deepseek-ai/dsh-host-webserver`
- `@deepseek-ai/dsh-api-remotes`

已检查的安装产物：

```text
Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/
  dsh-client-runtime/lib/client.js
  dsh-client-ui-conversation/lib/client.js
  dsh-client-ui-conversation/README.zh.md
  dsh-client-connection/lib/client.js
  dsh-client-connection/README.zh.md
  dsh-host-webserver/lib/index.js
  dsh-host-webserver/README.zh.md
  dsh-api-remotes/lib/index.js
```

## 3. 已核实接口

### 3.1 Host WebServer

`ctx.webServer.register({ kind, path, handler })` 真实存在：

- `kind` 支持 `exact` 与 `prefix`；
- 重复路由会抛错；
- 返回 disposer；
- handler 接收 Node HTTP request/response；
- `ctx.webServer.registerUpgrade({ path, handler })` 也存在，但交付原始 socket，插件必须自己拥有完整协议握手与连接生命周期。

Windows Basic 仅使用 `register()` 提供普通 HTTP 长轮询和 POST，不自行实现 WebSocket framing，也不增加
`ws` 生产依赖。

安全边界：DSH WebServer 本身不提供认证、TLS 或来源策略。appshot 路由必须：

- 只在 `ctx.webServer.host === '127.0.0.1'` 时启用；
- 拒绝 `sec-fetch-site: cross-site`；
- 写接口只接受 `POST application/json`；
- POST 请求体设置 64KB 上限，字段按 schema 与长度校验；
- 不返回 CORS 允许头；
- 校验请求体大小、字段、`clientInstanceId` 与当前 Pending 所有权。

### 3.2 Desktop Client 到 Host 的 HTTP 基址

DSH Client Connection 的浏览器载体使用以下规则：

```ts
const origin = globalThis.location?.origin
const base = origin !== undefined && origin !== 'null'
  ? origin
  : 'http://dsh.internal'
```

DSH Desktop 以 `file://` 加载 Renderer，因此相对 URL 和 `EventSource('/plugins/...')` 不能作为可靠合同。
appshot Client 必须使用同一基址规则构造绝对 `fetch` URL。

`dsh-client-connection` 的浏览器下行使用 WebSocket，并明确不提供 EventSource/SSE 回退。因此 Windows Basic
采用普通 HTTP 长轮询，不使用 EventSource。

### 3.3 Session 定位

Client Runtime 已核实：

- `ctx.sessions.list.getSnapshot().current` 返回当前 UI Session；
- `ctx.sessions.binding(sessionId)` 同步返回目标 Session binding 或 `undefined`；
- binding 携带 Session scope `ctx`；
- 宿主没有可靠的“当前 UI Session”公共状态，必须由 Client 主动上报。

Windows Basic 因此同时锁定 `targetClientInstanceId` 和 `targetSessionId`。Client 挂载时必须用
`ctx.sessions.binding(frame.targetSessionId)`，不得重新读取当前 Session 作为目标。

### 3.4 Composer Draft 图片

`ConversationController` 是名为 `conversation` 的 Client Service。安装产物已核实以下方法：

- `createDraftImages(files)`：创建 browser/runtime-only Draft 描述符并登记到 `draftAttachments`；
- `draftImages(ids)`：解析仍存活的 Draft 描述符；
- `releaseDraftImage(id)` / `releaseDraftImages(images)`：释放 Draft 与 object URL；
- `conversation.input.for(binding.ctx)`：返回目标 Session 的 resident input shell；
- input shell 的 `addImages(ids)`：Composer 处于 `adjudicating/submitting` 时返回 `false`，否则追加 ID 并返回 `true`；
- input shell 的 `removeImage(id)`：从该 Session Composer Draft 中移除指定图片 ID；
- input shell 的 `snapshot.imageIds`：当前 Session Composer 中的 Draft image ID 列表。

关键生命周期事实：

- `createDraftImages` 的注释明确为 `runtime-only` / `browser-only`；
- `ConversationController` dispose 时会清空 `draftAttachments` 并撤销 object URL；
- 图片 ID 本身不能证明 Draft 仍存在；
- `addImages` 不负责按 ID 去重。

所以不得把 Composer Draft 称为“持久化存储”。Windows Basic 的正确合同是：

- Node 在 ACK 前持有唯一可重放的内存 Pending 字节；
- Composer 是成功挂载后的最终运行时 Owner；
- 重放时必须同时验证 `input.snapshot.imageIds` 包含 `draftId` 且 `draftImages([draftId])` 可解析，二者都成立才允许只补发 ACK；
- 任一验证失败都视为旧记录失效，删除本地记录并重新创建、挂载；
- 取消已开始挂载的 Pending 时，先对目标 shell 调用 `removeImage(draftId)`，再调用 `releaseDraftImage(draftId)` 释放 registry 与 object URL；
- DSH/插件进程完全退出后不恢复。

### 3.5 Host 任意事件不能直接到 Client

`@deepseek-ai/dsh-api-remotes` 使用固定 allowlist。appshot 事件不在名单内，因此：

- `ctx.emit('appshot/...')` 不会转发到 Renderer；
- 不修改 DSH 自身 allowlist；
- Windows Basic 使用自建 HTTP 路由。

### 3.6 Client 主题令牌（`--dsw-alias-*` / `data-ds-dark-theme`）

> 核查日期：2026-08-22；证据来源：Windows 本机 DSH Desktop 2.0.1 安装产物
> `resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-client-ui-theme@0.1.0-rc.7/lib/`
> （`styles/base.css`、`styles/design-platform.css`、`client.js`），属源码级证据。

DSH Renderer 内存在官方主题体系，插件 UI 不得硬编码颜色：

- `design-platform.css` 定义约 78 个语义令牌 `--dsw-alias-*`：背景分层
  `bg-base` / `bg-layer-1/2/3`、边框 `border-l1..l4`、文字 `label-primary` /
  `label-dimmed` / `label-caption`、主色 `brand-primary` / `button-primary-fill` /
  `label-primary-foreground`、交互 `interactive-bg-hover` / `button-tool-bar-fill` 等；
- 明暗切换机制：`body { … }` 为亮色默认值，`body[data-ds-dark-theme] { … }`
  整体重定义全部令牌取值；`client.js` 持有 `matchMedia('(prefers-color-scheme: dark)')`
  监听（跟随系统），同时提供用户可选外观（含 `appearance.dark`）；
- 字体栈 `--dsw-font-family` 定义于 `base.css`；
- DSH 自家组件（如 `AppearanceRow.module.css`）即以 `var(--dsw-alias-…)` 书写样式，
  这是插件 UI 的同构参考。

使用规则（appshot 设置面板已按此实现，`src/client/settings.ts`）：

- 颜色一律写 `var(--dsw-alias-…, <暗色 fallback>)`：变量随 DSH 外观（系统/用户设置）
  自动明暗翻转；旧宿主未定义令牌时退化为纯暗色，不产生回归；
- 成功/错误/警告等状态色使用 `--dsw-alias-state-success-*` / `state-error-*` /
  `state-warn-*` 系列；需要半透明底色时用
  `color-mix(in srgb, var(--dsw-alias-…) N%, transparent)` 从令牌派生，不手写 rgba；
- 主色填充上的前景（按钮文字、toggle 圆点）使用 `--dsw-alias-label-primary-foreground`
  （亮色为白、暗色为深墨，与 `button-primary-fill` 轨道自动形成对比）；
- 投影（box-shadow）在主题包中无对应令牌，保留中性黑透明即可；
- 引用前缀必须精确为 `--dsw-alias-*` / `--dsw-static-*` / `--dsw-font-family`；
  `--ds-*`（无 `w`）是另一组旧变量（仅 base.css 中字体/动效），不得混用。

## 4. Windows Basic 已冻结接口结论

| 能力 | 结论 |
| --- | --- |
| Host HTTP 路由 | 使用 `ctx.webServer.register()`，已核实 |
| Client 上行 | 使用绝对基址 `fetch`，需 Windows 真机 smoke |
| Host 下行 | HTTP 长轮询；不使用 EventSource/SSE |
| 活跃 Session | Client 上报，Node 不猜测 |
| Client 所有权 | 锁定 `clientInstanceId + sessionId` |
| 图片创建 | `createDraftImages`，runtime-only |
| Composer 挂载 | `input.for(binding.ctx).addImages([draftId])` |
| Composer 取消清理 | `input.removeImage(draftId)` + `releaseDraftImage(draftId)` |
| 重放去重 | 校验目标 Session 的 `imageIds` 和 Draft registry 后再补 ACK |
| Host Attachment | Windows Basic 不调用 `saveImage`，避免产生无法直接挂入 Draft 的孤儿 Attachment |
| 成功边界 | Composer 已挂载且 Node 收到合法 `MOUNTED` |
| 插件 UI 配色 | 引用 `--dsw-alias-*` 主题令牌（带暗色 fallback），不硬编码颜色 |

## 5. 实施 Gate

开始 Windows 交付层实现前必须完成：

1. 在 Windows DSH Desktop 2.0.0 验证 `http://dsh.internal` 自建 HTTP route 的 POST 与长轮询；
   同时记录 `file://` Renderer 的 Origin / `Sec-Fetch-Site`，以最小允许规则收口；
2. 验证目标 Session `binding`、`createDraftImages`、`addImages`、`snapshot.imageIds` 与 `draftImages`；
3. 验证 Client 插件 reload 与整个 Renderer reload 两种情况下的“验证后补 ACK／失效后重挂载”；
4. 验证多 Client 连接只向 `targetClientInstanceId` 返回 Pending；
5. 验证 DSH 升级后包版本不再是 `0.1.0-rc.6` 时能够阻止未经复核的发布。

Gate 失败时不得以类型断言、`any`、`@ts-ignore` 或无条件补 ACK 绕过。
---

## 6. Windows 真机 Gate 验证记录（2026-08-21）

> 验证环境：**DSH Desktop 2.0.1（win32 x64）**，内置全部 `@deepseek-ai/dsh-*` `0.1.0-rc.7`。
> 验证方式：插件 bundle 安装到 desktop profile 后重启加载；通过 Electron CDP
> （`--remote-debugging-port=9222`）在真实 Renderer 上下文执行验证。

### 6.1 关键事实修正：Renderer 加载方式与基址

**实测（覆盖 §3.2 旧假设）**：

- Renderer 实际以 **`http://127.0.0.1:<webServerPort>` 加载**（本机 `http://127.0.0.1:54068/?dsh-desktop-mode=compatibility&dsh-desktop-platform=win32`），
  **不是 `file://`**；compatibility 与 advanced 仅窗口外观差异，加载方式相同；
- `location.origin` 为真实 http 值（非 `"null"`），因此 `appshotUrl()` helper 的
  origin 分支生效，**不会**走到 `http://dsh.internal` fallback；
- 实测 `fetch('http://dsh.internal/...')` 在 Renderer 内 **`Failed to fetch`**（域名不可达），
  但 `fetch(new URL(path, location.origin))` 全部成功。

**结论**：交付层必须使用 `appshotUrl()` 的绝对 URL 规则（origin 优先、`dsh.internal` 仅
作为 origin 缺失/为 null 时的理论 fallback）。真机上 origin 分支即正确路径；
不应直接使用相对路径（旧 macOS 的 `EventSource('/plugins/...')` 假设不适用于 Windows）。

### 6.2 Host 自建路由真机验证（通过）

| 路由 | 实测结果 |
| --- | --- |
| `POST /plugins/appshot/session` | 200 `{"ok":true}`（Renderer 内 fetch；含 clientInstanceId/sessionId 校验） |
| `GET /plugins/appshot/pending` | 无 Pending 时挂起等待（3s 探测 abort，非 404） |
| `POST /plugins/appshot/delivery-result` | 空 body → 400 `{"error":"INVALID_FIELDS"}`（schema 校验生效） |
| webServer host | 仅监听 `127.0.0.1`（host 门禁通过） |

### 6.3 Draft API 真机验证（9/9 通过）

在真实 Renderer 上下文（通过插件 client 的注入 ctx）执行全链路：

| # | 验证项 | 结果 |
| --- | --- | --- |
| 1 | `sessions.list.getSnapshot().current` | ✅ 返回当前会话 ID（reload 后轮询恢复） |
| 2 | `sessions.binding(sessionId)` | ✅ 返回 binding |
| 3 | `binding.ctx` 可解析 | ✅ |
| 4 | `conversation.createDraftImages([file])` | ✅ 返回固定 `draftId` |
| 5 | `input.for(binding.ctx).addImages([draftId])` | ✅ accepted: true |
| 6 | `input.snapshot.imageIds` 包含 draftId | ✅ |
| 7 | `conversation.draftImages([draftId])` | ✅ resolved: 1 |
| 8 | `input.removeImage(draftId)` | ✅ 移除后 imageIds 为空 |
| 9 | `conversation.releaseDraftImage(draftId)` | ✅ 释放后 registry 为空 |

行为与 §3.4 已核实形态一致，无破坏性变更（rc.6 → rc.7）。

### 6.4 Reload 验证

- Renderer reload 后插件 bundle rev 更新（client.js 重新加载、apply 重新执行）；
- `sessionStorage` 活性记录跨 reload 保留（W4 恢复机制的基础）；
- 无活跃 Session 时 `current` 为空属正常（前置条件），UI 选中恢复后轮询可取到。

### 6.5 遗留与后续

- 多 Client 并发轮询的 `targetClientInstanceId` 隔离：状态机单测覆盖（W3.1），
  真机双 Client 场景待 W4 Client 实现后验收；
- `dsh.internal` 域名在 rc.7 真机不可达，但 helper fallback 保留以兼容未来 file:// 场景；
- 本机验证基于 `0.1.0-rc.7`，与文档基线 `0.1.0-rc.6` 的接口面已静态核查一致。

