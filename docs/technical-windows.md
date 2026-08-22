# dsh-plugin-appshot Windows Basic 技术方案与架构规格

> 状态：Closed Specification。DSH 静态接口已按 Desktop 2.0.0 / `0.1.0-rc.6` 核查；生产实现仍须通过第 9 节 Windows 真机 Gate。

## 1. 架构目标与产品合同对齐

本技术方案承接 [`requirements-windows.md`](requirements-windows.md) 定义的 **Windows Basic** 产品需求与设计决策，替代原有的 WGC 强制无遮挡与强制置顶 DSH 方案。

### 1.1 核心产品合同
1. **触发方式**：**左右 Ctrl 同时按下（`Left Ctrl + Right Ctrl`）**，进入时间窗后触发，双键完全释放后方可再次激活；
2. **目标窗口**：Hook 只在触发时采样鼠标物理坐标；工作线程同步隐藏通知后，在该固定坐标上解析可捕获顶层窗口，拒绝全屏选择层或重新读取鼠标位置；
3. **单显示器与禁止跨屏**：目标显示器由鼠标坐标决定，目标窗口有效边界必须完整位于该显示器内；**跨屏窗口直接报错拒绝**，严禁跨屏截图、拼接或静默裁剪；
4. **两阶段截图与可见降级**：
   - 触发瞬间捕获目标矩形在屏幕上的**可见画面作为降级备份**；
   - 尝试将目标窗口**普通置前（Normal Bring-to-Top，严禁临时设为 Always-on-top）**；
   - 置前成功且重绘完成后截取目标窗口；若置前被拒或存在 Topmost 遮挡，使用可见备份降级，并明确标记 `isFallback: true`；
5. **不抢焦点与轻量反馈**：不强制唤起或置顶 DSH；**Client 严禁调用 `window.focus()`**；所有状态通过不夺焦点、不拦截鼠标输入的轻量通知呈现；
6. **单 Pending、最终运行时 Owner 与严格交付闭环**：
   - 全流程以 `captureId` 标识；
   - **Owner 转移**：Node 在 ACK 前持有唯一可重放的内存 Pending 字节；Client 通过 `createDraftImages` 加入 Composer 后，Composer 成为最终运行时 Owner；Windows 不调用 Host `saveImage`；
   - **交付确认闭环**：Client 将图片挂载至 Composer Draft 成功并向 Node 回传 `MOUNTED` 交付结果后，Node 清除 Pending 内存字节并向 Native 发送成功通知。

---

## 2. 总体架构与端到端数据流

```text
┌──────────────────────────────────────────────────────────────────┐
│  Windows Native Agent (appshot-win-x64.exe)                      │
│  - WinExe 无控制台后台进程，Per-Monitor V2 高 DPI 感知            │
│  - WH_KEYBOARD_LL 低级键盘钩子 (零 I/O，工作线程发送 NDJSON)      │
│  - 先同步隐藏所有活动通知窗口，再执行 WindowFromPoint 命中目标   │
│  - DWM 扩展边界计算 (DWMWA_EXTENDED_FRAME_BOUNDS) 与跨屏判定     │
│  - 阶段 1：截取当前屏幕可见画面作为 fallback 备份                │
│  - 阶段 2：普通置前 (SetWindowPos) 与 DWM 同步等待               │
│  - GDI BitBlt 捕获屏幕可见矩形，WIC 编码 PNG 并原子落盘 │
│  - No-Activate 且不拦截鼠标的原生轻量浮动通知       │
│  - 响应 stdin cancel 与 shutdown 指令                            │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  │ 双向 stdio (NDJSON IPC)
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Node / Cordis 宿主插件 (dsh-plugin-appshot)                      │
│  - 平台适配层：管理 Windows Agent 子进程生命周期与实例临时目录   │
│  - 全量状态机：IDLE / IN_FLIGHT / PENDING_ACK，超时与迟到帧防竞态 │
│  - 接受 capture/request 时锁定 targetClientInstanceId + Session  │
│  - 安全 Ingest：realpath / reparse 校验 -> 读入内存 -> unlink    │
│  - 内存 Pending 字节管理，按 Client 定向的 HTTP 长轮询重放       │
│  - Session / pending poll / delivery-result / cancel HTTP 路由   │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  │ HTTP long poll & POST routes
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  DSH Client (插件 dsh.client 模块 / Renderer)                    │
│  - 维护 UI 活跃 sessionId 并主动向 Node 注册上报                 │
│  - 以绝对 dsh.internal 基址长轮询 appshot/ready                 │
│  - 将图像字节转为 File 并挂载至 Composer Draft (不抢焦点)        │
│  - 挂载成功后向 Node 发送 MOUNTED 交付确认                       │
│  - 验证 Draft registry + Session imageIds 后幂等补 ACK          │
│  - 持续重试（前 5 次 500ms + 每 3 秒低频）与显式取消            │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 详细交互时序图

```text
[用户鼠标悬停目标窗口] ──> 同时按下 Left Ctrl + Right Ctrl
                               │
                               ▼
            [Native Hook 抓取物理坐标 pt，投递工作线程队列]
                               │
                               ▼
            [Native 同步隐藏通知，锁定 pt/monitor/HWND，校验目标]
                               │
                  ├─目标非法/跨屏─> [Native 本地失败通知，结束]
                               │
                               ▼
                  [保存触发瞬间 visible backup]
                               │
                               ▼
            [Native 向 Node 发送 capture/request]
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
            [Node 接受请求]          [Node 返回 BUSY / NO_CLIENT]
                  │                         │
            [锁定 Client + Session]     [Native 释放 backup]
            [状态置 IN_FLIGHT]          [不置前、不编码，结束]
                  │
            [Node 返回 IN_FLIGHT 接受确认]
                               │
                               ▼
            [阶段 2: 尝试普通置前目标窗口 (Normal Bring-to-Top)]
                               │
                   ┌───────────┴───────────┐
                   ▼                       ▼
            [置前成功且无 Topmost 遮挡]  [置前失败 / 存在 Topmost 遮挡]
                   │                       │
            [DWM 同步等待 (30~80ms)]       │
            [重新校验边界与跨屏]           │
            [捕获最新窗口像素]             │
                   │                       │
                   │              [使用阶段 1 备份，标记 isFallback]
                   │                       │
                   └───────────┬───────────┘
                               ▼
            [PNG 原子落盘 (<uuid>.partial -> <uuid>.png)]
                               │
                               ▼
            [Native 发送 NDJSON appshot 帧给 Node]
                               │
                               ▼
            [Node 校验路径安全性，读取图片字节进入内存 pendingCapture，立即 unlink 删除 Staging 文件]
                               │
            [Node 状态更新为 PENDING_ACK，向 Native 下发 WAITING_DSH 状态]
                               │
                               ▼
            [目标 Client 的 HTTP 长轮询取得 appshot/ready (含图片 Base64 字节)]
                               │
                   ┌───────────┴───────────┐
                   ▼                       ▼
            [Client 挂载成功]        [Composer 繁忙 / 无 Session]
                   │                       │
            [Client 发送 MOUNTED]    [Client 本地暂存该帧，启动持续重试]
                   │                       │
                   │                 [Node 保持 PENDING_ACK 状态]
                   ▼
            [Node 收到 MOUNTED，释放内存 pending 字节，清除状态，向 Native 下发 SUCCESS]
                   │
                   ▼
            [Native 显示“已加入 DSH”轻量通知 (不抢焦点)]
```

---

## 3. Native Agent (Win32) 核心技术实现规范

### 3.1 运行环境与分发选型
- **开发语言与运行时**：C# (.NET 8.0)；
- **目标框架 (TFM)**：`net8.0-windows10.0.19041.0`；
- **分发形态**：**首期锁定 Self-Contained 单文件发布**（`win-x64`）：
  ```bash
  dotnet publish native/windows/AppshotWin.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o bin/win-x64
  ```
- **DPI 感知**：进程入口显式调用：
  ```csharp
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  ```
  App Manifest 显式声明 `<dpiAwareness>PerMonitorV2</dpiAwareness>`。

**启动与重启策略**：

- Node 启动 Agent 后 5 秒内未收到 `ready`，视为启动失败，终止该子进程；
- 空闲态或 `PENDING_ACK` 期间异常退出时，按 1s → 2s → 4s 最多重启 3 次；稳定运行 60 秒后重置重启计数；
- Hook、消息泵或 DPI 初始化失败时，Agent 在尚可显示 UI 时发送 `fatal` 帧、显示一次 No-Activate 错误后退出；二进制缺失/无法 spawn 只能在 DSH 插件状态/日志报告，不伪造原生通知；
- `PENDING_ACK` 不属于 Agent；Agent 退出时 Node 继续交付。恢复后同步 `WAITING_DSH`，或从 `completedCaptures` 补发未呈现的 `SUCCESS/FALLBACK_SUCCESS`；通知失败不回滚 `MOUNTED`。

### 3.2 左右 Ctrl 全局按键状态机
1. **线程与 Hook 模型**：
   - 专用后台 UI 线程启动标准 Windows 消息泵（`GetMessage` / `TranslateMessage` / `DispatchMessage`）；
   - 调用 `SetWindowsHookExW(WH_KEYBOARD_LL, ...)` 安装低级键盘钩子；
   - **Hook 回调零 I/O 约束**：
     - Hook 回调内**唯一允许**的同步操作为获取鼠标物理坐标 `GetCursorPos(out var pt)` 并记录时间戳，耗时 $< 0.05\text{ms}$；
     - 命中触发时，仅生成 `captureId` 并将 `{ captureId, pt, timestamp }` 投递到工作线程队列；
     - **严禁在 Hook 回调内写 stdout I/O**；处理后立即调用 `CallNextHookEx` 返回；
     - 由**工作线程**负责目标锁定、visible backup 与 `capture/request` NDJSON；Hook 不等待 Node。
2. **状态判定逻辑**：
   - 监听虚拟键码 `VK_LCONTROL` (0xA2) 与 `VK_RCONTROL` (0xA3)；
   - **长按重复过滤**：在内存维护 `isLeftDown` 与 `isRightDown`，收到重复按键脉冲直接丢弃；
   - **注入事件过滤**：检查 `flags & LLKHF_INJECTED`，默认忽略非物理按键注入；
   - **组合时间窗**：一侧 Ctrl 已按下，另一侧 Ctrl 在 $300\text{ms}$ 内按下判定为触发；
   - **重置与冷却**：触发后进入 $500\text{ms}$ 冷却期，且必须在 `isLeftDown` 和 `isRightDown` **均收到 `WM_KEYUP`** 恢复为 `false` 后才重新允许触发。

### 3.3 触发坐标锁定与目标规范化
1. **先同步隐藏通知并锁定 visible backup**：
   - 工作线程从队列取出触发事件后，第一步同步隐藏所有活动通知窗口；
   - 使用 Hook 采样的 `cursorPt` 确定**操作显示器**（`MonitorFromPoint` → `rcMonitor`），随后完成 Z 序目标裁决、边界校验并立刻保存 visible backup；
   - 随后发送 `capture/request`，在收到 Node 的 `IN_FLIGHT` 接受确认前，严禁置前、编码或写盘；
   - 收到 `BUSY` / `NO_CLIENT` 或 1000ms 内未收到接受确认时，释放 backup 并结束，不改变目标窗口层级；`NO_CLIENT` 明确提示打开 DSH 后重试。
2. **Z 序目标裁决（EnumWindows）**：
   - `EnumWindows` 按 Z 序（顶→底）枚举顶层窗口；过滤不可见（`!IsWindowVisible`）、最小化（`IsIconic`）、Cloaked（`DWMWA_CLOAKED`）与桌面/任务栏类名（`Progman`/`WorkerW`/`Shell_TrayWnd`/`Shell_SecondaryTrayWnd`）后，收集与 `rcMonitor` 相交的窗口；
   - 遮挡判定：候选与所有更高 Z 序可见窗口的边界做矩形相交，无相交即"完全可见"；
   - 裁决（纯逻辑，可单测）：唯一完全可见候选 → 它；多个并列完全可见（如分屏）→ 鼠标下顶层窗口（`WindowFromPoint` + `GA_ROOT`，不在并列集合则取第一个）；全部被遮挡 → Z 序第一个；
   - DSH 自身窗口（`--dsh-pid`）：**为该屏 Z 序最前的有效窗口时直接以 `DSH_WINDOW` 拒绝**（不跳选其后的窗口）；位于其他窗口之后时仅计为遮挡源；
   - 无任何候选时显示 `NO_TARGET_WINDOW` 本地失败通知，不发送 `capture/request`；
3. **有效捕获边界与跨屏判定**：
   - 通过 DWM 获取排除阴影后的真实可视物理外框 `DWMWA_EXTENDED_FRAME_BOUNDS`（失败用 `GetWindowRect` 兜底）；
   - 使用完整显示器物理边界 `MONITORINFO.rcMonitor`；`rcWork` 仅用于通知定位；
   - **跨屏硬约束**：若选中目标外框超出 `rcMonitor`，直接显示 `WINDOW_ACROSS_MONITORS` 本地失败通知并终止（不裁剪、不拼接、不跳选下一个），不发送 `capture/request`。

### 3.4 截图两阶段执行（置前与可见降级）

1. **尺寸与分辨率上限防护**：
   - 最大像素数为 $7680 \times 4320 = 33{,}177{,}600$；横屏尺寸不超过 $7680 \times 4320$，竖屏允许对调；编码后 PNG 上限 $20\text{MB}$；超限返回 `IMAGE_TOO_LARGE`；
   - 位图分配前使用 checked arithmetic 校验 `width * height * 4`，避免整数溢出；最坏情况备份+最终位图的短暂峰值约 253MiB，最终位图创建后立即释放不再使用的 backup；
2. **阶段 1：可见屏幕备份 (Visible Backup)**：
   - 使用 `GetDC(nullptr)` + `CreateCompatibleBitmap` + `BitBlt(..., SRCCOPY | CAPTUREBLT)` 捕获 DWM 边界对应的屏幕可见物理像素；
   - 本阶段在 `capture/request` 发送前完成；Node 拒绝时立即释放；
3. **阶段 2：普通置前 (Normal Bring-to-Top)**：
   - 调用 `SetWindowPos(topHwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)` 与 `BringWindowToTop(topHwnd)`；
   - **安全红线**：**严禁使用 `HWND_TOPMOST`**；
   - 置前成功后不缓存或恢复原 Z-order；失败或编码失败也不尝试回放整个系统窗口层级，避免引入更大的竞态与误操作；
4. **阶段 3：遮挡检测、DWM 同步与二次校验**：
   - **Topmost 遮挡检测**：通过 `GetWindow(topHwnd, GW_HWNDPREV)` 向上检查同屏是否存在可见、未最小化且与目标外框相交的 `WS_EX_TOPMOST` 窗口；
   - **置前成功判定**：若置前失败或存在 Topmost 遮挡，直接使用 `bitmapBackup` 降级，`isFallback = true`；
   - **重绘同步与二次校验**：若判定置前成功且无遮挡：
     - 调用 `DwmFlush()` 等待垂直同步并辅以有界延时（$30\sim 80\text{ms}$）；
     - **重新读取** `DWMWA_EXTENDED_FRAME_BOUNDS` 并**再次执行单显示器跨屏校验**（防止置前动画跨屏）；
     - 使用与阶段 1 相同的 `BitBlt` 路径截取最新屏幕可见矩形作为最终位图，`isFallback = false`；
5. **WIC 编码与原子写入**：
   - 使用 Windows Imaging Component (WIC) 编码为标准 PNG；
   - 写入临时文件 `${stagingDir}\${uuid}.partial` 并 `Flush(true)`；
   - 调用原子重命名 `MoveFileEx(src, dst, MOVEFILE_REPLACE_EXISTING)` 生成 `${uuid}.png`；
   - 显式释放位图与句柄。

Windows Basic 不引入 WGC / Desktop Duplication 作为首期捕获路径。`BitBlt` 捕获的是桌面实际组合后像素，
与“置前后可见内容／置前失败备份”合同一致；黑屏、DRM、硬件 overlay 或系统隔离内容按非目标失败，不再静默切换另一套截图 API。

### 3.5 不抢焦点轻量通知
- **防自截约束**：已进入 `IN_FLIGHT` 的截图在落盘前严禁弹出任何 UI；前置校验失败只在确定不会继续截图后通知；与另一个 `IN_FLIGHT` 任务冲突的 BUSY 通知延后至当前捕获落盘或终止后；
- **显示模式**：
  - 通知窗口采用 `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST`，显示时使用 `SW_SHOWNOACTIVATE` / `SWP_NOACTIVATE`；
  - 可使用 `WS_EX_TRANSPARENT` 与 `WM_NCHITTEST` 辅助实现输入穿透，但正确性依赖触发前同步隐藏和 Windows 真机输入测试，不能仅由样式位推断；
  - 触发新截图瞬间，工作线程首先无条件隐藏旧通知；
- **状态通知类型**：
  - `WAITING_DSH`：“截图已保存，正在同步至 DSH...”；
  - `SUCCESS`：“截图已成功加入 DSH 会话”；
  - `FALLBACK_SUCCESS`：“已按当前可见内容截图（可能包含遮挡）并加入 DSH”；
  - `BUSY`：“上一张截图正在处理中，请稍候”；
  - `ACROSS_MONITORS`：“目标窗口跨越多个显示器，请移至单屏后重试”；
  - `ERROR`：“截图失败：{reason}”。

---

## 4. 宿主与客户端交付可靠性规格

### 4.1 HTTP 传输、Client 注册与目标锁定

1. **传输基址**：Client 不使用相对 URL 或 EventSource，统一通过以下 helper 构造绝对 URL：
   ```ts
   function appshotUrl(path: string): URL {
     const origin = globalThis.location?.origin
     const base = origin !== undefined && origin !== 'null'
       ? origin
       : 'http://dsh.internal'
     return new URL(path, base)
   }
   ```
2. **Client Session 上报 (`POST /plugins/appshot/session`)**：
   ```json
   {
     "sessionId": "sess_abc123",
     "clientInstanceId": "client-uuid-456",
     "claimPendingCaptureId": null
   }
   ```
   - `clientInstanceId` 在每个 Renderer 的 `sessionStorage` 中生成并保留；不同窗口不得复用；
   - Client 在初始化、窗口获得焦点、活跃 Session 变化时上报；Node 以服务端接收时间更新 `lastActiveClient`；
   - `claimPendingCaptureId` 只在本 Client 已收到未绑定/`REBIND_REQUIRED` 帧，且用户之后将 DSH 窗口带到前台并聚焦明确 Session 时发送；初始化、后台心跳或无 Pending 的普通 Session 切换不改绑；
   - 认领成功响应必须返回 `{ captureId, targetSessionId }`；Client 只在响应与本地活动记录一致后继续挂载。
3. **目标锁定**：Node 接受 Native `capture/request` 时同时固化
   `targetClientInstanceId` 与 `targetSessionId`。后续普通 Client/Session 活动不得改变二者。
4. **长轮询 (`GET /plugins/appshot/pending?clientInstanceId=...&knownCaptureId=...&knownTargetSessionId=...`)**：
   - 每个 Client 同时最多一个 waiter；新请求替换旧 waiter；
   - 仅目标 Client 能取得 Pending；其他 Client 返回 `204`；
   - 无 Pending 时最多等待 20 秒后返回 `204`，Client 立即开启下一轮；断线按 1s、2s、4s 封顶重试；
   - Pending 存在且 `knownCaptureId` 不匹配时，返回 `200 application/json` 的 `appshot/ready`；Client 收到后继续以该 ID 长轮询，防止同一 Renderer 重复创建 Draft；
   - `knownCaptureId` 与当前 Pending 匹配时，服务端等待状态变化；20 秒内无变化返回 `204`；
   - 每次长轮询首先查询有界终态集合：ID 在 `cancelledCaptureIds` 中返回 `appshot/cancelled`；完整 Client/Session 元组在 `completedCaptures` 中返回 `appshot/completed`；仅 ID 相同但 `clientInstanceId` / `knownTargetSessionId` 不同时返回 `409`；
   - Client 插件重载且没有活动处理记录时，不携带 `knownCaptureId`，Node 重放同一 Pending；重载前已挂载的情况必须先走第 4.4 节的 Draft 活性验证。
5. **路由安全**：仅在 `ctx.webServer.host === '127.0.0.1'` 时启用；拒绝
   `sec-fetch-site: cross-site`；POST 只接受 `application/json` 且请求体上限 64KB；不发送 CORS 允许头；校验所有 UUID/状态枚举/字符串长度；所有路由随插件 dispose 注销。
   `file://` Renderer 实际携带的 Origin / Fetch Metadata 必须在 Windows Gate 记录；不得为通过 Gate 而开启宽泛 CORS。

### 4.2 全量状态机与迟到帧防竞态矩阵

Node 宿主维护以下并发状态模型：

```ts
type CaptureState =
  | { type: 'IDLE' }
  | { type: 'IN_FLIGHT'; captureId: string; targetClientInstanceId: string; targetSessionId: string | null; startedAt: number }
  | { type: 'PENDING_ACK'; captureId: string; targetClientInstanceId: string; targetSessionId: string | null; payload: Uint8Array; metadata: CaptureMetadata; rebindRequired: boolean }
```

宿主同时维护两个有界集合：
- `cancelledCaptureIds`: 最近超时/取消的 ID（保留 60 秒 TTL）；
- `completedCaptures`: 最近 50 个 `{ captureId, clientInstanceId, sessionId, finalNativeStatus, notificationPresented }` 完成记录；重复 ACK 必须完整匹配，Agent 重启时可补发未确认呈现的最终状态。

#### 全量状态转换表

| 当前状态 | 触发事件 / 输入 | 目标状态 | 附带动作与处理规范 |
| :--- | :--- | :--- | :--- |
| **`IDLE`** | `capture/request` 时无已注册 Client | **`IDLE`** | 返回同 ID 的 `status: NO_CLIENT`；Native 释放 backup 并提示打开 DSH |
| **`IDLE`** | 收到 Native `capture/request` | **`IN_FLIGHT`** | 锁定 Client + Session；返回同 ID 的 `status: IN_FLIGHT`；记录 `startedAt`，启动 15000ms 守卫 |
| **`IN_FLIGHT`** | 收到当前 `captureId` 的 `appshot` | **`PENDING_ACK`** | 校验 ID、路径、`${captureId}.png` 文件名、大小与 PNG 签名；读取 `payload` 后 `unlink`；唤醒目标 Client waiter；向 Native 下发 `WAITING_DSH` |
| **`IN_FLIGHT`** | 收到当前 `captureId` 的 `error` | **`IDLE`** | 清除超时守卫，向 Native 下发 `status: RESET`，释放并发锁 |
| **`IN_FLIGHT`** | 路径校验失败 / 读文件失败 | **`IDLE`** | 记录错误日志，向 Native 下发 `status: ERROR`；未产生 Pending，不向 Client 伪造交付事件 |
| **`IN_FLIGHT`** | Agent 子进程退出 (`exit`) | **`IDLE`** | 清理当前状态，释放并发锁 |
| **`IN_FLIGHT`** | 15000ms 超时 | **`IDLE`** | ID 加入 cancelled；向 Native 发 `cancel: TIMEOUT`；释放状态 |
| **`IN_FLIGHT` / `PENDING_ACK`** | 新 `capture/request` | **保持原状态** | 向新 ID 返回 `status: BUSY`；Native 必须释放 backup，禁止置前/编码 |
| **任意状态** | 已取消/未知 ID 的迟到 `appshot` | **保持原状态** | 只有路径位于实例目录且 basename 与帧 ID 完全一致时才 `unlink`；不读取、不交付 |
| **`PENDING_ACK`** | 目标 Client 长轮询 | **保持原状态** | 返回同一 Pending；非目标 Client 返回 204 |
| **`PENDING_ACK`** | `targetSessionId` 为空或 `rebindRequired` 且收到合法显式 claim | **`PENDING_ACK`** | 仅绑定已锁定 Client 上报的 Session，清除 rebind，唤醒该 Client waiter |
| **`PENDING_ACK`** | 目标 Client 返回 `BUSY` / `NO_SESSION` | **`PENDING_ACK`** | 保留 payload 和原目标；不改绑，等待 Client 重试或明确 claim |
| **`PENDING_ACK`** | `SESSION_MISMATCH` | **`PENDING_ACK`** | 保留原目标并标记 rebind；只有合法显式 claim 才能改绑 |
| **`PENDING_ACK`** | 合法 `MOUNTED` 元组 | **`IDLE`** | 记录包含最终 Native 状态的完成记录，释放 payload，向 Native 发送 `SUCCESS/FALLBACK_SUCCESS`；通知失败不回滚交付 |
| **`PENDING_ACK`** | 非目标 Client/Session 或非当前 ID 的 Delivery Result | **保持原状态** | 返回 403/409，不改变目标或 payload |
| **任意状态** | 已完成元组的重复 `MOUNTED` | **保持原状态** | 返回 HTTP 200；ID 相同但 Client/Session 不同则 409 |
| **任意状态** | Native `status/presented` 匹配完成记录 | **保持原状态** | 将 `notificationPresented` 标记为 true；非完成 ID 忽略并记录诊断 |
| **`PENDING_ACK`** | Native 二次快捷键取消 | **`IDLE`** | 与 `MOUNTED` 按 Node 事件先后原子裁决；取消先生效则释放 payload，记录 cancelled，唤醒目标 waiter，通知 Native `CANCELLED_BY_USER` |
| **`PENDING_ACK`** | Agent 退出 | **`PENDING_ACK`** | 保留 payload，重启 Agent；恢复后同步 `WAITING_DSH`，不影响 Client 交付 |
| **任意状态** | 插件 dispose | **销毁** | 释放 payload、位图、计时器和 waiters；关闭 Agent |

### 4.3 Owner 策略与长轮询响应

1. **Owner 规则**：Node 在 ACK 前持有唯一可重放字节；Composer 挂载并 ACK 后成为最终运行时 Owner。
   `createDraftImages` 是 runtime-only，文档不得称其为持久化存储。
2. **`appshot/ready` 响应结构**：
   ```ts
   interface AppshotReadyEventFrame {
     type: 'appshot/ready';
     captureId: string;
     targetClientInstanceId: string;
     targetSessionId: string | null;
     isFallback: boolean;
     fallbackReason: string | null;
     dataBase64: string; // Base64 图像字节，供 Client 创建 Draft File
     metadata: {
       appName: string;
       windowTitle?: string;
       mediaType: 'image/png';
       width: number;
       height: number;
       bytes: number;
       timestamp: number;
     };
   }
   ```
   - PNG 字节上限 20MB，Base64 响应理论上限为约 26.7MB（不含 JSON 元数据）；同时只序列化一个 Pending，响应结束后及时释放临时 Base64 字符串；
   - Base64 只是 HTTP 序列化期的短暂副本，Node 内存中的 `Uint8Array` 仍是 ACK 前唯一可重放源；不得在其他状态容器长期保留 Base64。
3. **Client 端挂载与不抢焦点约束**：
   - Client 必须先校验 `frame.targetClientInstanceId === clientInstanceId`；`targetSessionId` 为空时只保留活动记录并等待第 4.1 节的明确认领，不得挂载；
   - 使用 `ctx.sessions.binding(frame.targetSessionId)` 获取锁定目标，禁止使用当前 UI Session 替代；
   - 解码 File 后调用 `createDraftImages([file])`，再对目标 binding 调用 `input.for(binding.ctx).addImages([draft.id])`；
   - **Windows 专用规则**：**严禁调用 `window.focus()` 或主动激活 DSH 窗口**，保持静默挂载到草稿；
   - 挂载完成后，立即向 Node 回传 `MOUNTED` 交付确认。

### 4.4 持续恢复、真实 Draft 验证与交付结果
1. **两阶段持续恢复机制**：
   - Client 收到帧后立即在 `sessionStorage` 写入轻量活动记录
     `{ captureId, clientInstanceId, targetSessionId, draftId?: string, phase: 'received' | 'created' | 'mounted' }`；不持久化 Base64/File；
   - 对同一个仍有效的活动记录**只调用一次 `createDraftImages`** 获得固定 `draftId`；Composer busy 时只重试 `addImages`，仅当 Draft registry 已失效并从 Node 重放 Pending 后才允许重新创建；
   - **两阶段重试**：
     1. **快速重试阶段**：若 Composer 繁忙，每 500ms 重试调用 `addImages([draftId])`，最多 5 次；
     2. **低频持续重试阶段**：若仍繁忙，降为每 3 秒低频轮询一次，直至挂载成功、插件 dispose 或用户取消；
   - 挂载成功后先写入完整 Draft 记录，再发送 `MOUNTED`；
   - 发送 Delivery Result 时采用指数退避（1s → 2s → 4s 封顶）持续重试，确保 Node 确认。
2. **重放验证**：
   - `sessionStorage` 保存当前活动记录与最近 50 条已挂载记录；
   - 重放时读取目标 input shell；只有 `shell.snapshot.imageIds.includes(draftId)` 且
     `ctx.conversation.draftImages([draftId]).length === 1` 同时成立，才补发 ACK；
   - 记录处于 `received/created` 或任一活性条件失败时，Client 删除失效 `draftId`，不携带 `knownCaptureId` 重新请求 Pending 字节，再创建和挂载，禁止假 ACK。
3. **交付结果通信协议 (`POST /plugins/appshot/delivery-result`)**：
   - 请求载荷：
     ```json
     {
       "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
       "clientInstanceId": "client-uuid-456",
       "targetSessionId": "sess_abc123",
       "status": "MOUNTED"
     }
     ```
   - `status` 取值：`MOUNTED`、`BUSY`、`NO_SESSION`、`SESSION_MISMATCH`。
4. **用户取消与竞态收口**：
   - Native 在 `WAITING_DSH` 状态再次检测到左右 Ctrl 时，通过 IPC 发送 `cancel/request`，不生成新 `captureId`；
   - Node 对取消与 `MOUNTED` 使用同一串行状态转移，先处理者生效；
   - 取消先生效时，长轮询返回 `appshot/cancelled`。Client 停止 `addImages`/ACK 重试；若 `draftId` 已加入目标 shell，调用 `shell.removeImage(draftId)`，然后调用 `conversation.releaseDraftImage(draftId)` 并删除本地记录；
   - `MOUNTED` 先生效时，二次快捷键取消返回“已完成，如需请在 DSH 草稿中删除”，不撤销已确认的交付。

---

## 5. IPC 通信协议定义 (NDJSON)

### 5.1 启动参数
```bash
appshot-win-x64.exe --mode daemon --staging-dir "C:\Users\User\AppData\Local\Temp\dsh-appshot\1234-uuid" --dsh-pid 12340
```

### 5.2 Native $\rightarrow$ Node 通信协议

#### 1. 就绪通知 (`ready`)
```json
{
  "type": "ready",
  "version": 1,
  "platform": "win32",
  "pid": 15420
}
```

#### 2. 截图接受请求 (`capture/request`)
```json
{
  "type": "capture/request",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "timestamp": 1771148400000
}
```

#### 3. 截图完成 (`appshot`)
```json
{
  "type": "appshot",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "platform": "win32",
  "appName": "msedge.exe",
  "windowTitle": "GitHub - Pull Requests",
  "width": 1920,
  "height": 1080,
  "mimeType": "image/png",
  "imagePath": "C:\\Users\\User\\AppData\\Local\\Temp\\dsh-appshot\\1234-uuid\\c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.png",
  "isFallback": false,
  "fallbackReason": null,
  "timestamp": 1771148400500
}
```

#### 4. 错误通知 (`error`)
```json
{
  "type": "error",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "code": "WINDOW_ACROSS_MONITORS",
  "message": "The target window spans multiple monitors."
}
```

#### 5. Pending 用户取消请求 (`cancel/request`)
```json
{
  "type": "cancel/request",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "reason": "USER_REQUEST"
}
```
*此帧只允许 Native 在 `WAITING_DSH` 时发送；Node 仅在同 ID 仍处于 `PENDING_ACK` 时接受。*

#### 6. 最终通知已呈现 (`status/presented`)
```json
{
  "type": "status/presented",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "state": "SUCCESS"
}
```
*Native 只在 `SUCCESS` / `FALLBACK_SUCCESS` 通知窗口已成功显示后发送；Node 据此停止 Agent 重启后的最终通知补发。*

#### 7. Agent 致命初始化错误 (`fatal`)
```json
{
  "type": "fatal",
  "code": "KEYBOARD_HOOK_INIT_FAILED",
  "message": "Failed to install the global keyboard hook."
}
```
*`fatal` 不携带 `captureId`，只用于 Agent 级初始化失败；发送后 Agent 退出，Node 进入有界重启流程。*

### 5.3 Node $\rightarrow$ Native 指令协议 (stdin)

#### 1. 状态同步指令 (`status`)
```json
{
  "type": "status",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "state": "SUCCESS"
}
```
*`IN_FLIGHT` 表示 Node 已接受该请求；`BUSY` / `NO_CLIENT` 表示截图前拒绝。其余值为 `WAITING_DSH`、`SUCCESS`、`FALLBACK_SUCCESS`、`CANCELLED_BY_USER`、`RESET`、`ERROR`。所有状态必须携带对应 `captureId`。*

#### 2. 取消截图任务指令 (`cancel`)
```json
{
  "type": "cancel",
  "captureId": "c1a2b3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "reason": "TIMEOUT"
}
```
*Native 使用协作取消：在窗口命中、置前、捕获、编码和写盘阶段之间检查取消标记。无法中断的同步系统调用允许完成，但其迟到文件必须上报并由 Node 安全清理，且不得显示成功通知。*

#### 3. 优雅退出指令 (`shutdown`)
```json
{"type":"shutdown"}
```

---

## 6. 安全边界与临时文件生命周期

1. **权限隔离**：Agent 以标准 Medium Integrity Level 运行，**坚决不提权**；
2. **不支持边界**：UAC Secure Desktop、锁屏界面、DRM 硬件保护内容、跨多显示器窗口；
3. **Staging 临时文件安全管理与防路径穿越**：
   - 实例子目录：`%TEMP%\dsh-appshot\<pid>-<instanceId>\`；
   - **严格路径白名单校验**：
     ```ts
     import { realpath } from 'node:fs/promises'
     import { basename, relative, resolve } from 'node:path'

     async function validateStagingPath(stagingDir: string, imagePath: string, captureId: string): Promise<string> {
       const realStaging = await realpath(stagingDir)
       const realImage = await realpath(resolve(imagePath))
       const rel = relative(realStaging, realImage)
       if (rel.startsWith('..') || rel.includes(':') || basename(realImage) !== `${captureId}.png`) {
         throw new Error(`Security Alert: Invalid staging path ${imagePath}`)
       }
       return realImage
     }
     ```
   - 调用前必须用统一 UUID parser 校验 `captureId`，不得用宽松正则或字符串替换构造文件名；
   - `stat` 后先校验最大 20MB，再读取并检查 PNG signature + IHDR；IHDR 宽高必须符合第 3.4 节像素上限并与 IPC 元数据一致，`bytes` 必须匹配实际长度；
   - **单所有权管理**：只有 `validateStagingPath` 成功返回的 `realImage` 可进入读取/清理流程；Node 读取字节后立即 `unlink(realImage)`，后续失败分支在 `finally` 中仅清理该已验证路径；校验失败时绝不对输入原路径执行 `unlink`；
   - **PID + Lock 双重检查孤儿 GC**：
     - 每个实例目录内写入 `instance.lock` 记录 Owner PID；
     - GC 扫描时，通过系统 API 检查该 PID 进程是否存活；**仅当 Owner PID 进程已死亡且目录修改时间 > 24 小时 时**，才执行递归删除，彻底防止误删长期空闲的活跃实例目录。

---

## 7. 构建、打包与配置规划

1. **平台配置规范**：
   - Windows 平台默认快捷键配置为 `hotkey: 'dual-control'`；
   - macOS 平台保持 `hotkey: 'double-cmd'`；
   - 跨平台读取时按操作系统提供默认 fallback。
2. **工程结构**：
   ```text
   native/windows/
   ├── AppshotWin.csproj
   ├── Program.cs
   ├── Hotkey/
   │   └── DualCtrlHook.cs
   ├── Capture/
   │   ├── TargetWindowFinder.cs
   │   ├── ScreenCapturer.cs
   │   └── WicEncoder.cs
   └── UI/
       └── NoActivateToast.cs
   ```
3. **构建命令**：
   ```bash
   dotnet publish native/windows/AppshotWin.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o bin/win-x64
   ```
4. **发布产物矩阵**：
   - `build-macos`：在 macOS runner 编译、签名并上传 macOS Agent artifact；
   - `build-windows`：在 Windows x64 runner 执行上述 `dotnet publish`，运行 Native 单测/冒烟并上传 Windows artifact；
   - `assemble-package`：在任一 Node 22.19+ runner 下载两个 artifact，再执行 `pnpm build` 与 `npm pack`；发布任务不在装配机上跨平台编译 Native。
5. **包内容 Gate**：`package.json.files` 必须同时包含两端运行产物；对 `npm pack --json` 结果解包检查，缺失任一平台、带入 `.build`/调试符号或产物不可执行都阻断发布。
6. **本地开发边界**：macOS 可先完成 macOS Agent 和 Host/Client 主体，Windows 产物由 Windows 机器调试生成；任一单平台本地 `npm pack` 都不作为正式跨平台发布源。

---

## 8. 实施与 PoC 推进路线

1. **PoC 1：左右 Ctrl 同时按下状态机与鼠标瞬间目标锁定**
   - 验证 `WH_KEYBOARD_LL` 左右 Ctrl 组合判定（零 I/O，工作线程写 NDJSON）；
   - 验证触发瞬间同步隐藏通知、抓取鼠标坐标、DWM 有效外框计算及单显示器跨屏判定。
2. **PoC 2：两阶段置前与可见内容降级截图**
   - 验证普通置前（`SetWindowPos`）及 Topmost 遮挡检测；
   - 验证置前失败时可见内容降级位图的生成与 WIC PNG 编码；
   - 验证最大分辨率（8K）与文件尺寸（20MB）防护。
3. **PoC 3：DSH Client Draft API 真实性验证（实施 Gate）**
   - 在 Windows DSH Desktop 验证 `http://dsh.internal` 自建 POST/长轮询路由；
   - 验证 `createDraftImages` + `addImages` 的挂载、`snapshot.imageIds` + `draftImages` 活性检查，以及 `removeImage` + `releaseDraftImage` 取消清理。
4. **PoC 4：No-Activate 原生通知与交付恢复闭环**
   - 验证通知条不夺焦点、不拦截鼠标，且触发前同步隐藏；
   - 验证 `capture/request`、Client/Session 锁定、无 Session/删除 Session 后明确认领、持续重试与 `delivery-result` 闭环；
   - 验证 BUSY、超时 cancel、迟到帧、Native 二次快捷键取消、Agent 在 `PENDING_ACK` 期间退出和 `sessionStorage` 跨刷新活性验证。

---

## 9. 实施 Gate、难度与完成定义

本文的“Closed Specification”只表示产品行为、Owner、时序、失败恢复与发布边界已有唯一方案，
不表示 Windows 功能已实现或真机验收通过。

| Gate | 必须解决的技术问题 | 难度 | 验证证据 | 失败时处理 |
| --- | --- | --- | --- | --- |
| G0 DSH 接口 | `dsh.internal` POST/长轮询、Session binding、Draft 创建/挂载/移除/释放 | 高 | Windows Desktop 2.0.0 真机 smoke 和请求头记录 | 阻断交付层实施，更新 `api-grounded-review.md` 并重新设计；不用类型断言绕过 |
| G1 全局快捷键 | 左/右 Ctrl 区分、重复键、注入事件、消息泵与二次取消 | 中 | Windows 10/11 实机状态机测试 | 保留双 Ctrl 合同，修正 Hook/状态机；不吞键 |
| G2 窗口与 DPI | 触发坐标、`GA_ROOT`、DWM 边界、Per-Monitor V2、`rcMonitor` 单屏判定 | 中 | 100%/150%/200% 混合 DPI 多屏用例 | 若无法在统一物理像素系工作，阻断截图，不静默裁切 |
| G3 置前与降级 | 普通置前可能被系统拒绝，Topmost 遮挡无法移除 | 高 | 置前成功/拒绝/Topmost 遮挡的图像与通知对照 | 始终使用触发时 visible backup 降级，禁止 `HWND_TOPMOST` 规避 |
| G4 截图与资源 | GDI `BitBlt` 屏幕可见矩形、WIC PNG、8K/20MB 上限、句柄/位图释放 | 中 | 连续 50 次、8K、编码失败和内存基线 | 返回明确错误，不产生 Pending，清理所有中间资源 |
| G5 交付状态机 | BUSY、NO_CLIENT、无 Session、Composer busy、断线、迟到帧、重复 ACK、Agent 退出 | 高 | 状态转换表的单测+双 Client 集成测试 | 任一错投、丢图、假 ACK 或无法取消都阻断发布 |
| G6 Draft 生命周期 | runtime-only Draft、插件/Renderer reload、活性验证、取消与 ACK 竞态 | 高 | reload 前后 Composer + registry 双验证，取消清理测试 | 验证不通过就重放 Node Pending，禁止仅凭 `sessionStorage` 补 ACK |
| G7 通知 | No-Activate、鼠标不拦截、防自截、截图前隐藏 | 中 | 前台应用输入/点击不受影响，截图不含通知 | 根据行为测试调整样式/消息处理，不把单一样式位当作证明 |
| G8 发布 | macOS/Windows 分别构建、产物装配、平台选择、签名和包内容 | 中高 | 双 runner artifact + `npm pack` 解包报告+双平台安装 smoke | 任一端产物缺失或不可运行都不发布 |

### 9.1 Windows Basic 完成定义

只有同时满足以下条件，才可将 Windows Basic 标记为实现完成：

1. G0–G8 全部有可复现证据且无阻断项；
2. 核心路径“左右 Ctrl → 鼠标下单屏窗口 → 普通置前/可见降级 → 锁定 Session Draft → `MOUNTED`”在 Windows 10/11 x64 真机通过；
3. 无 Session、Composer busy、断线、Client/Renderer reload、Agent 退出和用户取消均能进入明确终态，不错投、不假 ACK；可验证的已挂载 Draft 不重复，但 [`requirements-windows.md` §8.1](requirements-windows.md#81-exactly-once-的不可消除竞态窗口) 的不可判定窗口按 at-least-once 优先不丢图处理；
4. 截图落盘前不显示 UI，全程不强制激活 DSH，通知不夺焦点且不拦截鼠标；
5. 临时文件、Pending 字节、Draft 资源、长轮询、定时器与 Native 进程在成功、失败、取消和 dispose 分支全部有唯一 Owner 且可释放。
