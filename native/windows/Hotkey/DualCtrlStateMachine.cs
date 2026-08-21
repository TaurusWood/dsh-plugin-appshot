using System;
using System.Diagnostics;

namespace AppshotWin.Hotkey;

/// <summary>
/// 左右 Ctrl 组合判定纯逻辑（technical-windows.md §3.2 状态判定）。
///
/// 与 Win32 钩子解耦：时间用单调时钟（ms），按键用虚拟键码。
/// 可单测的判定面：
/// - 单按不触发；300ms 组合窗内双键触发一次；
/// - 长按重复脉冲过滤；双键完全释放后才允许再次触发；
/// - 触发后 500ms 冷却。
/// </summary>
public sealed class DualCtrlStateMachine
{
    public const int VK_LCONTROL = 0xA2;
    public const int VK_RCONTROL = 0xA3;

    private readonly long _combinationWindowMs;
    private readonly long _cooldownMs;
    private readonly Func<long> _clockMs;

    private bool _isLeftDown;
    private bool _isRightDown;
    private long _lastLeftDownMs = long.MinValue;
    private long _lastRightDownMs = long.MinValue;
    private long _lastTriggerMs = long.MinValue;
    private bool _inFlight;

    /// <param name="clockMs">单调毫秒时钟（默认 Stopwatch）。</param>
    public DualCtrlStateMachine(long combinationWindowMs = 300, long cooldownMs = 500,
        Func<long>? clockMs = null)
    {
        _combinationWindowMs = combinationWindowMs;
        _cooldownMs = cooldownMs;
        _clockMs = clockMs ?? (() => Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency);
    }

    public bool IsLeftDown => _isLeftDown;
    public bool IsRightDown => _isRightDown;
    public bool InFlight => _inFlight;

    /// <summary>
    /// 处理 KeyDown。返回 true 表示本次按键触发了捕获组合。
    /// 注入事件应在调用前过滤（LLKHF_INJECTED 由 Hook 层处理）。
    /// </summary>
    public bool OnKeyDown(int vkCode)
    {
        long nowMs = _clockMs();
        if (vkCode == VK_LCONTROL)
        {
            if (_isLeftDown) return false; // 长按重复脉冲过滤
            _isLeftDown = true;
            _lastLeftDownMs = nowMs;
        }
        else if (vkCode == VK_RCONTROL)
        {
            if (_isRightDown) return false;
            _isRightDown = true;
            _lastRightDownMs = nowMs;
        }
        else
        {
            return false;
        }

        // 冷却期与单次并发锁
        if (_inFlight || (_lastTriggerMs != long.MinValue && nowMs - _lastTriggerMs < _cooldownMs))
            return false;

        if (_isLeftDown && _isRightDown)
        {
            long diffMs = Math.Abs(_lastLeftDownMs - _lastRightDownMs);
            if (diffMs <= _combinationWindowMs)
            {
                _inFlight = true;
                _lastTriggerMs = nowMs;
                return true;
            }
        }
        return false;
    }

    /// <summary>处理 KeyUp。双键完全释放后才解除 inFlight。</summary>
    public void OnKeyUp(int vkCode)
    {
        if (vkCode == VK_LCONTROL) _isLeftDown = false;
        else if (vkCode == VK_RCONTROL) _isRightDown = false;
        if (!_isLeftDown && !_isRightDown) _inFlight = false;
    }

    public (bool LeftDown, bool RightDown, bool InFlight) GetState() =>
        (_isLeftDown, _isRightDown, _inFlight);
}
