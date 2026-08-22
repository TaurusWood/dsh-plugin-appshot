# dsh-plugin-appshot Windows Basic 需求说明

> 状态：Closed Specification（DSH 接口实现仍受第 9 节 Windows 真机 Gate 约束）
>
> 适用范围：Windows 10/11 x64 Desktop
>
> 文档职责：定义 Windows Basic 的产品交互、行为边界、失败语义和验收条件；具体 Win32、截图 API、构建方式由技术方案承接。

## 1. 文档关系与变更背景

- [`requirements.md`](requirements.md) 仍以 macOS MVP 为主，并将 Windows 列为后续规划；本文件单独定义 Windows Basic 的产品合同。
- 本文件与 [`technical-windows.md`](technical-windows.md) 共同构成 Windows 平台实现基线；在 Windows Basic 的产品行为上，以本文件为准；技术文档不得静默扩大承诺。
- 放弃 Windows 流程中的 Host `saveImage`：Node 在 ACK 前保存唯一可重放的内存 Pending 字节，Client 端通过 `createDraftImages` 挂入 Composer Draft；Composer 成为最终运行时 Owner，宿主不产生孤儿 Attachment。
- DSH 接口形态以 [`api-grounded-review.md`](api-grounded-review.md) 为权威依据；升级 DSH 基线后必须重新核查。
- Windows Desktop 传输使用普通 HTTP 长轮询与 POST，不使用相对路径 EventSource/SSE。

## 2. 产品目标

### 2.1 核心使用场景

用户已经在 DSH 中打开一个目标会话，随后切换到其他桌面应用查看内容。当用户看到不理解的界面、错误或现象时，同时按下左右 Ctrl。目标为**鼠标所在显示器上 Z 序最靠前的可捕获窗口**；当存在多个互不遮挡的并列最前窗口（如分屏）时，取**鼠标所在的窗口**。目标窗口必须完整位于鼠标所在显示器内；插件捕获该窗口并将图片加入触发前由 DSH Client 明确上报的目标会话 Composer，等待用户补充文字后一起发送。

### 2.2 Windows Basic 的价值

- 用一次明确快捷键把当前关注窗口交给 DSH；
- 不要求用户保存文件、切换 DSH、上传图片或操作第三方截图工具；
- 优先保证“有一张可用截图并明确告知交付结果”，不承诺无遮挡、离屏或受保护内容捕获；
- 截图只进入 Composer Draft，不自动发送消息。

### 2.3 成功定义

一次截图只有同时满足以下 1–4 项才算数据交付成功；第 5 项是正常交互闭环：

1. Native Agent 识别并捕获合法目标窗口；
2. PNG 已原子落盘，由宿主校验并安全读取为内存 Pending 字节，立即清理 Staging 文件；
3. Renderer 将图片成功加入锁定 Client 的目标 Session Composer Draft（成为最终运行时 Owner）；
4. Client 回传交付确认（`MOUNTED`）；
5. 用户收到“不抢焦点”的成功通知。

仅完成截图或仅将图片交给 HTTP 长轮询响应，不得提示“已加入 DSH”。
Native 在 `MOUNTED` 后异常退出不得回滚已完成的数据交付或重新挂载；Node 在 Agent 恢复后补发最终状态。
若 Agent 在有界重启后仍无法工作，以 DSH 插件状态/日志明确标记“图片已交付，桌面通知降级”。

## 3. 已冻结的产品决策

| 决策面 | Windows Basic 合同 |
| --- | --- |
| 默认快捷键 | 左 Ctrl 与右 Ctrl 同时按下；不是双击同一个 Ctrl |
| 目标窗口 | 鼠标所在显示器上 Z 序最靠前的可捕获顶层窗口；多个互不遮挡的并列最前窗口（如分屏）时取鼠标下的窗口 |
| 目标显示器 | 触发瞬间鼠标指针所在显示器（Z 序裁决限定在该屏内） |
| 跨屏 | 禁止跨屏截图、拼接或静默裁剪 |
| 选择交互 | 不显示全屏选择层，不提供窗口 hover 选择或区域框选 |
| 遮挡处理 | 尝试把目标窗口正常置前后截图；不临时设为 Always-on-top |
| 置前后窗口层级 | 置前成功后保持系统当前的普通 Z-order，不尝试恢复触发前遮挡关系 |
| 置前失败 | 使用触发时目标矩形的可见屏幕内容作为降级截图，并明确提示可能包含遮挡物 |
| DSH 激活 | 不要求截图后自动置顶或聚焦 DSH，Client 严禁调用 `window.focus()` |
| 用户反馈 | 使用不抢焦点且鼠标穿透的轻量通知区分成功、等待、降级和失败 |
| 交付可靠性 | 同时最多一张 pending；Composer 成功挂载并确认后才结束；支持长轮询重放、低频持续恢复和二次快捷键取消 |
| 交付目标 | 触发时同时锁定 `targetClientInstanceId + targetSessionId`，禁止广播错投 |
| 图片 Owner | ACK 前 Node Pending 字节是唯一可重放副本；ACK 后 Composer Draft 是最终运行时 Owner |
| 第三方工具 | 首期不依赖 ShareX、Flameshot 或 Snipping Tool 等外部截图应用 |

## 4. 前置条件

- DSH Desktop 正在运行，插件及 Windows Native Agent 已就绪；
- 至少一个 DSH Renderer Client 已注册；若没有可锁定 Client，Node 必须在截图前拒绝请求并提示打开 DSH；
- 用户通常已在 DSH 中打开一个活跃 Session；DSH 可以最小化或位于后台；
- 鼠标所在显示器上存在可捕获的顶层窗口，且 Z 序最靠前的目标窗口完整位于该显示器内；
- 当前桌面不是锁屏、UAC Secure Desktop 或其他隔离桌面；
- 当前没有尚未完成交付的截图。

前置条件不满足时必须明确通知，不能静默无响应。
Agent 二进制缺失或完全无法启动时无法接管全局快捷键，这一类启动故障通过 DSH 插件状态/日志报告；不承诺在 DSH 窗口之外弹出通知。

## 5. 核心交互流程

```text
[用户在目标窗口可见区域上移动鼠标]
                 │
                 │ 同时按下 Left Ctrl + Right Ctrl
                 ▼
[Hook 抓取坐标，工作线程同步隐藏旧通知]
                 │
                 ▼
[使用触发时 cursorPoint 选定显示器，取屏内 Z 序最靠前可捕获窗口（并列取鼠标下），校验目标并保存 visible backup]
                 │
                 ├─ 无合法目标、DSH 自身、桌面、任务栏 ──> 失败通知，结束
                 ├─ 目标窗口跨越多个显示器 ─────────────> 提示移回单屏，结束
                 │
                 ▼
[发送 capture/request；Node 锁定 targetClientInstanceId + targetSessionId]
                 │
                 ├─ 无已注册 Client ──> 返回 NO_CLIENT，释放 backup，结束
                 ├─ Node 返回 BUSY ──> 释放 backup，不改变窗口层级，结束
                 │
                 ▼
[尝试将目标窗口正常置前，不强制 Always-on-top]
                 │
                 ├─ 置前成功 ──> 等待 DWM 重绘同步 ──> 截取目标窗口
                 │
                 └─ 置前失败 ──> 使用降级备份，并标记 visible-fallback
                 ▼
[PNG 原子落盘并发送 captureId + imagePath]
                 │
                 ▼
[Node 校验 captureId、路径和文件名，读取图片字节至内存 pendingCapture，立即清理 Staging 文件]
                 │
                 ▼
[目标 Client 通过 HTTP 长轮询取得或重取 appshot/ready]
                 │
                 ├─ 无 Session / Composer 繁忙 / 长轮询断线
                 │        └─ 保留内存 pending，显示“等待 DSH”，持续重试恢复
                 │
                 └─ Composer 挂载成功 ──> Client 发送 MOUNTED 交付确认
                                         │
                                         ▼
                              [清除 Node 内存 pending，显示成功通知]
```

### 5.1 快捷键行为

- 当一个 Ctrl 已按下，另一个 Ctrl 在有效组合时间窗内按下时触发；
- 两个 Ctrl 必须全部释放后才能重新触发；
- 忽略系统长按产生的重复 `keydown` 和默认被判定为注入的键盘事件；
- Hook 只识别并投递触发信号，不在回调内执行窗口查询、截图或 I/O；由工作线程发送 `capture/request`；
- 截图处理中或存在 Pending 时不排队新任务；`IN_FLIGHT` 期间的重复触发只记录忙碌，不在当前图片落盘前显示 UI；
- 当 Native 已收到 `WAITING_DSH` 时，再次同时按下左右 Ctrl 表示取消当前 Pending，不触发新截图；
- 不吞掉 Ctrl 按键，不改变当前应用原有键盘输入语义。

### 5.2 目标窗口识别

- 以触发瞬间的鼠标坐标确定**操作显示器**，不在后续异步线程重新读取鼠标位置；
- Hook 不在回调内执行窗口查询；窗口在工作线程首次调度时按当时的 Z 序解析。若目标在这个短暂窗口内关闭、移动或层级改变，以解析时的 Z 序为准；不改用新鼠标位置，无合法目标则失败；
- 在执行窗口枚举之前，Native 必须同步隐藏自身所有活动通知窗口，防止误将自身计入 Z 序候选；
- 按 Z 序（顶→底）枚举顶层窗口，取鼠标所在显示器上第一个通过过滤的可捕获窗口作为目标；
- **并列裁决**：存在多个互不遮挡（完全可见）的并列最前窗口（如分屏）时，取鼠标坐标下的顶层窗口；鼠标下窗口不在并列集合时取 Z 序第一个；全部被遮挡的极端层叠场景退化取 Z 序第一个；
- 排除：
  - DSH 自身窗口：**若 DSH 是该屏 Z 序最前的有效窗口，直接拒绝截图**（用户正在使用 DSH，不跳选其后的窗口）；DSH 位于其他窗口之后时仍计为遮挡源；
  - Native Agent 的提示窗口；
  - 桌面、任务栏、开始菜单等系统 Shell 表面；
  - 隐藏、最小化、Cloaked 或无有效可视边界的窗口；
- Z 序最靠前的目标若跨越多个显示器，按跨屏合同失败提示（不裁剪、不拼接、不跳选下一个）。

### 5.3 单显示器与禁止跨屏

- 目标显示器由触发瞬间的鼠标位置确定；
- 目标窗口的有效捕获边界必须完整位于该显示器的 `MONITORINFO.rcMonitor` 内；不得使用排除任务栏后的 `rcWork` 判定跨屏；系统阴影和透明外边距不计入跨屏判断；
- 若有效边界与第二块显示器相交：
  - 不截图；
  - 不拼接；
  - 不只截鼠标所在屏幕的残缺窗口；
  - 通知用户“目标窗口跨越多个显示器，请将窗口移至单一显示器后重试”；
- 多显示器缩放比例不同不改变上述合同。所有命中、边界和截图裁剪必须在同一物理像素坐标系完成。

### 5.4 置前与截图语义

- Agent 可以尝试把目标窗口提升到普通非 Topmost 窗口层级的顶部；
- 禁止为截图临时设置或持久改变目标窗口的 Always-on-top 状态；
- 置前成功后不恢复触发前 Z-order；目标保持普通窗口层级，用户可继续查看/操作该窗口；
- 置前成功后，等待 DWM 垂直同步完成重绘，重新检查边界与跨屏，再截取有效窗口边界；
- 若存在与目标相交的 Topmost 窗口或置前被拒，使用触发瞬间保存的可见画面降级，不把该结果声称为“无遮挡窗口截图”；
- 降级截图可以包含目标矩形上方的遮挡窗口像素，通知必须说明“未能置前，已按当前可见内容截图”。

### 5.5 DSH 窗口行为

- DSH 可以最小化或位于后台，只要 DSH 进程、Client 和 Native Agent 仍在运行；
- 截图成功后不强制恢复、置顶或聚焦 DSH；
- Client 严禁调用 `window.focus()`；
- DSH 完全退出后 Agent 不再工作，不支持离线截图后等待下次启动导入。

### 5.6 通知状态

通知必须不抢夺当前应用焦点、不拦截鼠标输入，并在触发新截图时同步隐藏。`WS_EX_TRANSPARENT` 仅是候选实现细节，不能单独作为行为保证。

为避免自截，对已被 Node 接受的截图，在目标图片完成捕获并原子落盘前，禁止显示任何通知、提示条或 DSH 窗口。
目标非法、跨屏、`NO_CLIENT` 或 `BUSY` 在确定本次不会继续截图后可通知；若 `BUSY` 对应另一个仍在捕获的任务，通知必须延后到该图片落盘或任务终止后显示。

| 状态 | 通知文案语义 | 触发条件 |
| --- | --- | --- |
| 等待交付 | 截图已保存，等待 DSH 接收 | 图片字节已进入 Node Pending，等待 Client 挂载 |
| 成功 | 截图已加入 DSH | Client 已挂入 Composer 并回传 MOUNTED |
| 降级成功 | 已按当前可见内容截图并加入 DSH，图片可能包含遮挡 | 使用 visible-fallback 且已挂载成功 |
| 忙碌 | 上一张截图仍在等待 DSH | 已存在 in-flight 或 pending |
| 失败 | 明确说明失败原因和可执行恢复动作 | 目标非法、跨屏、受保护、捕获失败等 |

等待通知同时显示“再次按左右 Ctrl 取消”。若触发时没有 Session，则显示
“请在 DSH 打开目标会话，截图将自动继续交付”；用户之后在同一目标 Client 聚焦某个 Session，
即构成对该 Session 的明确认领。

---

## 6. 截图交付与恢复合同

### 6.1 目标 Client、Session 所有权与防错投

- 活跃 Session 是 Renderer 私有状态，Client 是唯一状态 Owner；
- 每个 Renderer 在 `sessionStorage` 生成并保存独立 `clientInstanceId`；Client 在初始化、窗口获得焦点和活跃 Session 变化时，通过 `POST /plugins/appshot/session` 上报；
- Node 接受 `capture/request` 时同时锁定 `targetClientInstanceId` 与 `targetSessionId`；
- Pending 只允许目标 Client 的长轮询取得，`MOUNTED` 必须携带并匹配同一 Client 与 Session；
- **防错投递规则**：
  - 触发时无 Session：Pending 仍锁定目标 Client；Client 只能在用户之后聚焦明确 Session 时，携带当前 `captureId` 上报 `claimPendingCaptureId`；
  - 原目标 Session 被删除（Client 返回 `SESSION_MISMATCH`）：Node 标记为 `REBIND_REQUIRED`；同样只允许目标 Client 在用户后续聚焦明确 Session 时携带 `claimPendingCaptureId` 改绑；
  - 初始化重放、后台心跳或普通 Session 上报不构成认领，不得静默改投。

### 6.2 单 pending 模型与迟到帧防竞态

- 同一插件实例同时最多存在一个 `inFlightCapture` 或 `pendingCapture`；
- 每次截图生成唯一 `captureId`；
- Node 维护 `cancelledCaptureIds`（保留 60 秒）与 `completedCaptures`（保留 50 个完整的 Client/Session 完成元组）；
- 超时或取消的任务，其迟到 `appshot` 帧仅对已通过实例目录与文件名校验的路径执行 `unlink`，绝不交付并绝不改变状态机。
- 新请求必须等待 Node 的 `IN_FLIGHT` 接受确认；收到 `BUSY` 时 Native 释放 visible backup，不得置前、编码或写盘。
- 没有已注册 Client 时 Node 返回 `NO_CLIENT`，不创建 `IN_FLIGHT`；Native 释放 backup 并提示用户打开 DSH 后重试。

### 6.3 交付确认（Delivery Result）语义

- `MOUNTED` 确认表示指定 `captureId` 的图片已经成功加入某个明确 Session 的 Composer Draft；
- Client 在 `sessionStorage` 保存 `{ captureId, clientInstanceId, targetSessionId, draftId }`；重放时必须同时验证目标 Composer 的 `imageIds` 包含该 ID，且 `conversation.draftImages([draftId])` 仍可解析，验证通过才只补发 `MOUNTED`；否则删除失效记录并重新挂载；
- Node 仅在收到合法的 `MOUNTED` 交付确认后清除 pending，释放内存字节，并发送最终成功通知。
- Node 以 `{ captureId, clientInstanceId, targetSessionId }` 作为完成幂等键；只按 `captureId` 判断不合法。

### 6.4 持续自动恢复

- **Composer 繁忙**：采用两阶段恢复（前 5 次每 500ms 快速重试；之后每 3 秒低频持续重试）；同一个仍有效的 Draft 只创建一次，繁忙时只重试 `addImages`，直到 `MOUNTED`、dispose 或用户取消；
- **长轮询断线**：Node 保留 pending 内存字节；目标 Client 恢复轮询后取得同一 Pending；
- **ACK 发送失败**：Client 按指数退避（1s → 2s → 4s）持续重试；
- **用户取消**：Native 处于 `WAITING_DSH` 时，二次左右 Ctrl 发送取消 IPC；Node 将 Pending 置为 cancelled 并通过后续长轮询通知目标 Client 停止重试。取消与合法 `MOUNTED` 以 Node 先处理者为准；若取消先生效，Client 必须从 Composer 移除已添加的 `draftId` 并释放 Draft 资源；
- **插件 dispose**：停止重试、释放内存、结束所有长轮询；不承诺跨进程恢复。

---

## 7. 文件、数据与资源边界

- Native 只向当前插件实例分配的 Staging 目录写入 PNG（写入 `.partial` 后原子重命名为 `.png`）；
- Node 必须验证路径属于当前实例目录（`realpath` + `relative` 校验，排除符号链接与重解析点），且最终文件名严格等于 `${captureId}.png`；
- 单图最大像素数为 $7680 \times 4320$（允许横竖对调），PNG 最大 20MB；Node 必须校验 PNG IHDR 宽高与 IPC 元数据一致；
- Node 读取图片字节进入内存 pendingCapture 后，**立即 unlink 删除 Staging 文件**；
- pendingCapture 在 ACK 前保存唯一可重放字节；Client 挂入 Draft 并 ACK 后，Composer 成为最终运行时 Owner；Draft 不承诺跨 DSH/Renderer 完全退出持久化；
- MOUNTED、失败、取消和 dispose 都必须释放内存字节、位图、定时器和 IPC 状态；
- 不在桌面、图片目录或第三方应用目录留下截图文件。

---

## 8. 明确非目标与不支持边界

Windows Basic 不做：

- 跨显示器窗口截图、跨屏拼接或残缺窗口静默裁剪；
- 全屏选择层、鼠标 hover 选窗、矩形区域框选或自由形状截图；
- 捕获最小化、完全被遮挡、离屏或其他虚拟桌面中的窗口；
- 保证 Always-on-top 遮挡下的完整窗口内容；
- 保证 Tooltip、菜单、悬停动画等焦点敏感瞬时状态在置前后不变；
- UAC Secure Desktop、锁屏、DRM、受保护视频或高权限隔离窗口；
- 强制抢夺 DSH 前台焦点；
- OCR、标注、涂鸦、裁剪编辑、截图历史或录屏；
- ARM64 Windows；
- 依赖用户预装或随插件捆绑第三方截图应用；
- DSH 完全退出后的离线截图与跨重启恢复。

### 8.1 Exactly-once 的不可消除竞态窗口

现有 DSH Draft API 没有与 Node Pending 共享的持久化事务。若 Client 的 `addImages` 已成功，但
`MOUNTED` 尚未到达 Node，此时 Renderer 恰好崩溃，或用户恰好已提交/删除该 Draft，恢复后只凭
`sessionStorage` 与 runtime-only registry 无法可靠区分这些结果。Windows Basic 选择 **at-least-once，优先不丢图**：

- Node 未收到 ACK 时继续保留 Pending；
- 恢复后无法证明 Draft 仍存在时重新挂载；
- 这个极窄竞态中可能出现一张用户可手动删除的重复图，但不允许静默丢图或假 ACK；
- 若未来 DSH 提供持久化 Draft transaction/idempotency API，再将该边界升级为 exactly-once。

---

## 9. 实施 Gate 与验证规范

本机 DSH Desktop 2.0.0 / `0.1.0-rc.6` 的静态证据已记录于 [`api-grounded-review.md`](api-grounded-review.md)。生产实现前仍需在 Windows 真机验证：

1. `http://dsh.internal` 下自建 POST 与长轮询路由可由 Desktop Renderer 访问；
2. `createDraftImages`、目标 Session `addImages`、`snapshot.imageIds` 与 `draftImages` 的行为与核查证据一致；
3. Client 插件 reload 时已挂载且仍可验证的 Draft 不重复，整个 Renderer reload 后失效记录会按第 8.1 节优先不丢图地重新挂载，而非假 ACK；
4. 两个 Client 同时轮询时只有 `targetClientInstanceId` 能取得 Pending；
5. 无已注册 Client 时截图前返回 `NO_CLIENT`；无 Session 时只能由已锁定 Client 后续明确认领；
6. BUSY、超时 cancel、迟到帧、用户取消和 Agent 在 `PENDING_ACK` 期间退出均不会丢失或错投图片；
7. 取消先于 `MOUNTED` 生效时，Client 能从目标 Composer 移除 `draftId` 并释放 Draft registry/object URL；`MOUNTED` 先生效时不自动撤销。
8. Agent 启动超时/重启有界；`PENDING_ACK` 期间 Agent 退出不丢图，恢复后可补发已交付但未确认呈现的最终通知。
