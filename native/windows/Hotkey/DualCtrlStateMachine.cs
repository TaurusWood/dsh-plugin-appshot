using System;
using System.Diagnostics;

namespace AppshotWin.Hotkey;

/// <summary>
/// 双修饰键组合判定纯逻辑（technical-windows.md §3.2 状态判定）。
///
/// 与 Win32 钩子解耦：时间用单调时钟（ms），按键用虚拟键码。
/// 键位可配置（config/update 帧驱动，默认双 Ctrl）；
/// 池子限定修饰键 lctrl/rctrl/lalt/ralt（Shift/Win 因系统副作用排除）。
///
/// 可单测的判定面：
/// - 单按不触发；组合窗内双键触发一次；
/// - 长按重复脉冲过滤；双键完全释放后才允许再次触发；
/// - 触发后冷却；键位热更新后状态复位。
/// </summary>
public sealed class DualCtrlStateMachine
{
    public const int VK_LCONTROL = 0xA2;
    public const int VK_RCONTROL = 0xA3;
    public const int VK_LALT = 0xA4;
    public const int VK_RALT = 0xA5;

    private readonly long _combinationWindowMs;
    private readonly long _cooldownMs;
    private readonly Func<long> _clockMs;
    private readonly object _gate = new();

    private int _leftVk = VK_LCONTROL;
    private int _rightVk = VK_RCONTROL;
    private bool _isLeftDown;
    private bool _isRightDown;
    private long _lastLeftDownMs = long.MinValue;
    private long _lastRightDownMs = long.MinValue;
    private long _lastTriggerMs = long.MinValue;
    private bool _inFlight;

    /// <param name="clockMs">单调毫秒时钟（默认 Stopwatch）。</param>
    public DualCtrlStateMachine(long combinationWindowMs = 300, long cooldownMs = 500,
        Func<long>? clockMs = null, int leftVk = VK_LCONTROL, int rightVk = VK_RCONTROL)
    {
        _combinationWindowMs = combinationWindowMs;
        _cooldownMs = cooldownMs;
        _clockMs = clockMs ?? (() => Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency);
        _leftVk = leftVk;
        _rightVk = rightVk;
    }

    public bool IsLeftDown { get { lock (_gate) return _isLeftDown; } }
    public bool IsRightDown { get { lock (_gate) return _isRightDown; } }
    public bool InFlight { get { lock (_gate) return _inFlight; } }

    /// <summary>键位热更新（config/update）；旧键残留按下状态一并复位。</summary>
    public void UpdateKeys(int leftVk, int rightVk)
    {
        lock (_gate)
        {
            _leftVk = leftVk;
            _rightVk = rightVk;
            _isLeftDown = false;
            _isRightDown = false;
            _lastLeftDownMs = long.MinValue;
            _lastRightDownMs = long.MinValue;
            _lastTriggerMs = long.MinValue;
            _inFlight = false;
        }
    }

    /// <summary>
    /// 处理 KeyDown。返回 true 表示本次按键触发了捕获组合。
    /// 非当前配置键位的按键直接返回 false（钩子层据此过滤）。
    /// </summary>
    public bool OnKeyDown(int vkCode)
    {
        long nowMs = _clockMs();
        lock (_gate)
        {
            if (vkCode == _leftVk)
            {
                if (_isLeftDown) return false; // 长按重复脉冲过滤
                _isLeftDown = true;
                _lastLeftDownMs = nowMs;
            }
            else if (vkCode == _rightVk)
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
    }

    /// <summary>处理 KeyUp。双键完全释放后才解除 inFlight。</summary>
    public void OnKeyUp(int vkCode)
    {
        lock (_gate)
        {
            if (vkCode == _leftVk) _isLeftDown = false;
            else if (vkCode == _rightVk) _isRightDown = false;
            if (!_isLeftDown && !_isRightDown) _inFlight = false;
        }
    }

    public (bool LeftDown, bool RightDown, bool InFlight) GetState()
    {
        lock (_gate) return (_isLeftDown, _isRightDown, _inFlight);
    }
}
