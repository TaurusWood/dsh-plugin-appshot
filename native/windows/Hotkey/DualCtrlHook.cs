using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace AppshotWin.Hotkey;

/// <summary>
/// 左右 Ctrl 全局按键钩子（technical-windows.md §3.2）。
///
/// - WH_KEYBOARD_LL 低级键盘钩子；Hook 回调零 I/O（仅采样坐标与时间戳，投递工作线程队列）；
/// - 注入事件（LLKHF_INJECTED）在 Hook 层过滤；组合判定委托纯逻辑 DualCtrlStateMachine；
/// - 触发后回调 CaptureTrigger（含物理坐标 + 时间戳）。
/// </summary>
public sealed class DualCtrlHook : IDisposable
{
    public const int VK_LCONTROL = 0xA2;
    public const int VK_RCONTROL = 0xA3;
    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_SYSKEYUP = 0x0105;
    public const uint LLKHF_INJECTED = 0x00000010;

    private readonly IntPtr _hookHandle;
    private readonly NativeMethods.LowLevelKeyboardProc _proc;
    private readonly DualCtrlStateMachine _stateMachine;
    private readonly bool _allowInjected;

    public event Action<CaptureTrigger>? Triggered;
    /// <summary>测试诊断：收到任意有效按键事件（含注入，若放行）。</summary>
    public event Action<int, bool>? AnyKey;

    /// <param name="allowInjected">测试专用：放行 LLKHF_INJECTED 注入事件（生产默认 false）。</param>
    public DualCtrlHook(bool allowInjected = false)
    {
        _allowInjected = allowInjected;
        _stateMachine = new DualCtrlStateMachine();
        _proc = HookCallback;
        // WH_KEYBOARD_LL 是全局低级钩子：hMod 可传 NULL（MSDN 明确），
        // 避免 Self-Contained 单文件下 MainModule 句柄无效导致钩子不触发。
        _hookHandle = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
        if (_hookHandle == IntPtr.Zero)
            throw new InvalidOperationException(
                "SetWindowsHookEx(WH_KEYBOARD_LL) failed: " +
                Marshal.GetLastWin32Error());
    }

    /// <summary>当前组合状态（诊断用）。</summary>
    public (bool LeftDown, bool RightDown, bool InFlight) GetState() =>
        _stateMachine.GetState();

    /// <summary>键位热更新（config/update 帧驱动）；键位与组合判定统一由状态机维护。</summary>
    public void UpdateKeys(int leftVk, int rightVk) =>
        _stateMachine.UpdateKeys(leftVk, rightVk);

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var flags = (uint)Marshal.ReadInt32(lParam, 8);
            bool injected = (flags & LLKHF_INJECTED) != 0;
            // 诊断模式：无条件上报所有键（含注入），用于确认钩子链路
            AnyKey?.Invoke(Marshal.ReadInt32(lParam), injected);
            if (!injected || _allowInjected)
            {
                int vk = Marshal.ReadInt32(lParam);
                // 触发载荷用 epoch 毫秒（IPC 合同 technical-windows.md §5.2）：
                // Node 超时守卫用 Date.now() 比较 startedAt，混入 Stopwatch 单调时钟会被立即判超时。
                long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                bool keyDown = (int)wParam == WM_KEYDOWN || (int)wParam == WM_SYSKEYDOWN;
                bool keyUp = (int)wParam == WM_KEYUP || (int)wParam == WM_SYSKEYUP;

                if (keyDown && _stateMachine.OnKeyDown(vk))
                {
                    // Hook 回调唯一允许的额外动作：采样物理坐标（微秒级）
                    NativeMethods.GetCursorPos(out var pt);
                    Triggered?.Invoke(new CaptureTrigger(nowMs, pt.X, pt.Y));
                }
                else if (keyUp)
                {
                    _stateMachine.OnKeyUp(vk);
                }
            }
        }
        return NativeMethods.CallNextHookEx(_hookHandle, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_hookHandle != IntPtr.Zero)
            NativeMethods.UnhookWindowsHookEx(_hookHandle);
    }
}

/// <summary>触发事件载荷：触发瞬间时间戳（ms）与鼠标物理坐标。</summary>
public readonly record struct CaptureTrigger(long TimestampMs, int X, int Y)
{
    public string ToJson() =>
        System.Text.Json.JsonSerializer.Serialize(new { TimestampMs, X, Y });
}

internal static partial class NativeMethods
{
    internal const int WH_KEYBOARD_LL = 13;

    internal delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn,
        IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    internal static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    internal static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetCursorPos(out NativePoint lpPoint);
}
