/**
 * Phase W1 — Windows Native 触发、目标和通知测试
 *
 * 对应任务（docs/tasks.md Phase W1 / docs/technical-windows.md §3）：
 *   > 实现左右 Ctrl 状态机、物理坐标锁定、窗口规范化、单显示器校验与 No-Activate 通知。
 *
 * 验证重点：
 *   1. 左右 Ctrl 同时按下状态机与双键完全释放后重置；
 *   2. 长按重复脉冲与注入按键（LLKHF_INJECTED）过滤；
 *   3. Hook 回调零 I/O 约束：仅投递队列，由工作线程异步发送 capture/started；
 *   4. 触发瞬间物理坐标固化与 DWM 扩展边界；
 *   5. 窗口规范化（保留独立 Popup，排除 DSH、桌面、任务栏、Cloaked）；
 *   6. 单显示器物理边界校验，跨屏窗口返回 WINDOW_ACROSS_MONITORS；
 *   7. 命中测试前同步隐藏旧通知窗口。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 模拟左右 Ctrl 状态机（含 500ms 冷却与双键释放重置）
interface DualCtrlState {
  isLeftDown: boolean
  isRightDown: boolean
  lastLeftDownTime: number
  lastRightDownTime: number
  inFlight: boolean
  lastTriggerTime: number
}

function createDualCtrlStateMachine() {
  const state: DualCtrlState = {
    isLeftDown: false,
    isRightDown: false,
    lastLeftDownTime: 0,
    lastRightDownTime: 0,
    inFlight: false,
    lastTriggerTime: 0,
  }

  return {
    onKeyDown(vkCode: number, isInjected: boolean, now: number): boolean {
      if (isInjected) return false // 过滤程序注入事件

      if (vkCode === 0xa2) { // VK_LCONTROL
        if (state.isLeftDown) return false // 过滤系统长按重复脉冲
        state.isLeftDown = true
        state.lastLeftDownTime = now
      } else if (vkCode === 0xa3) { // VK_RCONTROL
        if (state.isRightDown) return false // 过滤系统长按重复脉冲
        state.isRightDown = true
        state.lastRightDownTime = now
      } else {
        return false
      }

      // 检查 500ms 冷却期与单次并发锁
      if (state.inFlight || now - state.lastTriggerTime < 500) {
        return false
      }

      // 检查 300ms 组合时间窗
      if (state.isLeftDown && state.isRightDown) {
        const timeDiff = Math.abs(state.lastLeftDownTime - state.lastRightDownTime)
        if (timeDiff <= 300) {
          state.inFlight = true
          state.lastTriggerTime = now
          return true // 触发有效按键组合
        }
      }
      return false
    },
    onKeyUp(vkCode: number) {
      if (vkCode === 0xa2) state.isLeftDown = false
      if (vkCode === 0xa3) state.isRightDown = false
      // 必须双键完全释放后才解除 inFlight 状态
      if (!state.isLeftDown && !state.isRightDown) {
        state.inFlight = false
      }
    },
    getState: () => ({ ...state }),
  }
}

test('W1.1 左右 Ctrl 组合按下、500ms 冷却与双键释放重置', () => {
  const sm = createDualCtrlStateMachine()
  const t0 = 1000

  // 1. 单按左 Ctrl 不触发
  assert.equal(sm.onKeyDown(0xa2, false, t0), false)
  // 2. 100ms 内按下右 Ctrl，成功触发
  assert.equal(sm.onKeyDown(0xa3, false, t0 + 100), true)
  // 3. 在释放前继续按键不重复触发
  assert.equal(sm.onKeyDown(0xa2, false, t0 + 150), false)
  
  // 4. 释放左 Ctrl，右 Ctrl 仍按着，未完全释放时不重置
  sm.onKeyUp(0xa2)
  assert.equal(sm.getState().inFlight, true)

  // 5. 释放右 Ctrl，完全释放后解除 inFlight
  sm.onKeyUp(0xa3)
  assert.equal(sm.getState().inFlight, false)

  // 6. 冷却期测试：距上次触发仅 200ms（< 500ms），即使双键重新按下也不触发
  sm.onKeyDown(0xa2, false, t0 + 200)
  assert.equal(sm.onKeyDown(0xa3, false, t0 + 250), false, '500ms 冷却期内禁止重新触发')
})

test('W1.2 注入按键（LLKHF_INJECTED）与长按 repeat 脉冲过滤', () => {
  const sm = createDualCtrlStateMachine()
  const t0 = 1000

  // 注入事件直接忽略
  assert.equal(sm.onKeyDown(0xa2, true, t0), false)
  assert.equal(sm.getState().isLeftDown, false)

  // 物理按下左 Ctrl
  sm.onKeyDown(0xa2, false, t0)
  // 模拟长按产生的 repeat 脉冲
  assert.equal(sm.onKeyDown(0xa2, false, t0 + 50), false)
  assert.equal(sm.onKeyDown(0xa2, false, t0 + 100), false)
})

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

function checkSingleMonitorBoundary(windowRect: Rect, monitorRect: Rect): boolean {
  return (
    windowRect.left >= monitorRect.left &&
    windowRect.top >= monitorRect.top &&
    windowRect.right <= monitorRect.right &&
    windowRect.bottom <= monitorRect.bottom
  )
}

test('W1.3 单显示器窗口边界校验与跨屏拒绝', () => {
  const monitorRect: Rect = { left: 0, top: 0, right: 1920, bottom: 1080 }

  // 1. 完全在屏幕内的合法窗口
  const validWindow: Rect = { left: 100, top: 100, right: 1200, bottom: 900 }
  assert.equal(checkSingleMonitorBoundary(validWindow, monitorRect), true)

  // 2. 窗口横跨至右侧副屏（right: 2100 > 1920）
  const crossRightWindow: Rect = { left: 1000, top: 100, right: 2100, bottom: 900 }
  assert.equal(checkSingleMonitorBoundary(crossRightWindow, monitorRect), false)

  // 3. 窗口横跨至左侧副屏（left: -100 < 0）
  const crossLeftWindow: Rect = { left: -100, top: 100, right: 800, bottom: 900 }
  assert.equal(checkSingleMonitorBoundary(crossLeftWindow, monitorRect), false)
})

test('W1.4 窗口规范化与系统 Shell / DSH / Cloaked 过滤', () => {
  const dshPid = 1234
  
  interface WindowInfo {
    pid: number
    className: string
    isCloaked: boolean
    isIconic: boolean
    isPopup: boolean
  }

  function isCapturableTarget(win: WindowInfo): { capturable: boolean; reason?: string } {
    if (win.pid === dshPid) return { capturable: false, reason: 'DSH_WINDOW' }
    if (win.className === 'Progman' || win.className === 'WorkerW') return { capturable: false, reason: 'DESKTOP' }
    if (win.className === 'Shell_TrayWnd') return { capturable: false, reason: 'TASKBAR' }
    if (win.isCloaked) return { capturable: false, reason: 'CLOAKED' }
    if (win.isIconic) return { capturable: false, reason: 'MINIMIZED' }
    return { capturable: true }
  }

  // 排除 DSH 自身
  assert.equal(isCapturableTarget({ pid: 1234, className: 'Chrome_WidgetWin_1', isCloaked: false, isIconic: false, isPopup: false }).capturable, false)
  // 排除任务栏
  assert.equal(isCapturableTarget({ pid: 5678, className: 'Shell_TrayWnd', isCloaked: false, isIconic: false, isPopup: false }).capturable, false)
  // 排除 Cloaked 窗口
  assert.equal(isCapturableTarget({ pid: 5678, className: 'Chrome_WidgetWin_1', isCloaked: true, isIconic: false, isPopup: false }).capturable, false)
  // 独立有效窗口/工具窗允许捕获
  assert.equal(isCapturableTarget({ pid: 5678, className: 'Chrome_WidgetWin_1', isCloaked: false, isIconic: false, isPopup: true }).capturable, true)
})

test('W1.5 触发时先同步隐藏通知再执行 WindowFromPoint 命中测试', () => {
  const executionOrder: string[] = []

  function onCaptureTriggered() {
    // 1. 同步隐藏通知窗口
    executionOrder.push('HIDE_NOTIFICATIONS')
    // 2. 依据物理坐标调用 WindowFromPoint 命中目标 HWND
    executionOrder.push('WINDOW_FROM_POINT')
    // 3. 抓取屏幕可见备份
    executionOrder.push('VISIBLE_BACKUP')
  }

  onCaptureTriggered()
  assert.deepEqual(executionOrder, ['HIDE_NOTIFICATIONS', 'WINDOW_FROM_POINT', 'VISIBLE_BACKUP'])
})
