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

## 5. 实施 Gate

开始 Windows 交付层实现前必须完成：

1. 在 Windows DSH Desktop 2.0.0 验证 `http://dsh.internal` 自建 HTTP route 的 POST 与长轮询；
   同时记录 `file://` Renderer 的 Origin / `Sec-Fetch-Site`，以最小允许规则收口；
2. 验证目标 Session `binding`、`createDraftImages`、`addImages`、`snapshot.imageIds` 与 `draftImages`；
3. 验证 Client 插件 reload 与整个 Renderer reload 两种情况下的“验证后补 ACK／失效后重挂载”；
4. 验证多 Client 连接只向 `targetClientInstanceId` 返回 Pending；
5. 验证 DSH 升级后包版本不再是 `0.1.0-rc.6` 时能够阻止未经复核的发布。

Gate 失败时不得以类型断言、`any`、`@ts-ignore` 或无条件补 ACK 绕过。
