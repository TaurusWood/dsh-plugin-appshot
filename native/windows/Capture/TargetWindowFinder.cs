using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace AppshotWin.Capture;

/// <summary>窗口识别结果。</summary>
public sealed record TargetWindow(
    IntPtr Hwnd,
    int ProcessId,
    string ClassName,
    Rect Bounds,
    string? WindowTitle)
{
    public bool IsFallbackCandidate { get; init; }
}

public enum TargetError
{
    None,
    NoTargetWindow,
    DshWindow,
    Desktop,
    Taskbar,
    Cloaked,
    Minimized,
    AcrossMonitors,
}

/// <summary>
/// 目标窗口锁定与校验（technical-windows.md §3.3）：
/// - 以触发瞬间的物理坐标 WindowFromPoint → GA_ROOT 规范化；
/// - 排除不可见/最小化、桌面（Progman/WorkerW）、任务栏（Shell_TrayWnd / Shell_SecondaryTrayWnd）、DSH 自身、Cloaked；
/// - DWM 有效外框（DWMWA_EXTENDED_FRAME_BOUNDS）→ 单显示器 rcMonitor 完整包含校验；
/// - 跨屏直接失败（WINDOW_ACROSS_MONITORS），不拼接不裁剪。
/// </summary>
public static class TargetWindowFinder
{
    private const int GA_ROOT = 2;
    private const uint DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    private const uint DWMWA_CLOAKED = 14;

    private const string ClassProgman = "Progman";
    private const string ClassWorkerW = "WorkerW";
    private const string ClassShellTray = "Shell_TrayWnd";
    private const string ClassShellSecondaryTray = "Shell_SecondaryTrayWnd";

    /// <summary>
    /// 解析目标：鼠标所在显示器上 Z 序最靠前的可捕获顶层窗口（产品决策变更，2026-08-22）。
    /// 并列最前（互不遮挡、如分屏）时取鼠标下的窗口；全部被遮挡时退化 Z 序第一个。
    /// dshPid 为注入的 DSH 主进程 PID（DSH 窗口不作候选，但仍计为遮挡源）。
    /// </summary>
    public static TargetWindowResolveResult ResolveTopmost(int cursorX, int cursorY, int dshPid)
    {
        var monitorRect = GetMonitorRectFromPoint(cursorX, cursorY);
        if (monitorRect.IsEmpty)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        // 1. EnumWindows 天然按 Z 序（顶→底）枚举；一次遍历同时收集遮挡源与候选
        var occluders = new List<Rect>();               // 可见普通窗口边界（遮挡判定源）
        var candidates = new List<TopmostCandidate>();  // Z 序可捕获候选
        bool dshOnTop = false;
        NativeMethods.EnumWindows((hwnd, _) =>
        {
            if (!NativeMethods.IsWindowVisible(hwnd) || NativeMethods.IsIconic(hwnd)) return true;
            var className = GetClassName(hwnd);
            if (className is ClassProgman or ClassWorkerW or ClassShellTray or ClassShellSecondaryTray)
                return true; // 系统表面：既非候选也非遮挡源
            if (IsCloaked(hwnd)) return true;           // 不可见：非候选非遮挡
            var pid = GetWindowProcessId(hwnd);
            bool isDsh = TargetFilter.IsDshProcess(pid, GetProcessName(pid), dshPid);
            var bounds = GetExtendedFrameBounds(hwnd);
            if (bounds.IsEmpty)
            {
                var wr = default(Rect);
                if (NativeMethods.GetWindowRect(hwnd, ref wr)) bounds = wr;
            }
            if (bounds.IsEmpty || !RectsIntersect(bounds, monitorRect))
                return true; // 不在鼠标屏：与本屏裁决无关

            if (isDsh)
            {
                // 清晰边界：DSH 是该屏 Z 序最前的有效窗口 → 直接拒绝截图；
                // DSH 位于其他窗口之后时仅作为遮挡源参与裁决
                if (candidates.Count == 0)
                {
                    dshOnTop = true;
                    return false;
                }
                occluders.Add(bounds);
                return true;
            }

            bool occluded = occluders.Any(o => RectsIntersect(o, bounds));
            occluders.Add(bounds);
            candidates.Add(new TopmostCandidate(hwnd, bounds, occluded));
            return true;
        }, IntPtr.Zero);

        if (dshOnTop)
            return new TargetWindowResolveResult(null, TargetError.DshWindow);
        if (candidates.Count == 0)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        // 2. 鼠标下顶层窗口（并列裁决用）
        IntPtr hwndUnderCursor = IntPtr.Zero;
        var leaf = NativeMethods.WindowFromPoint(new NativePoint { X = cursorX, Y = cursorY });
        if (leaf != IntPtr.Zero)
        {
            hwndUnderCursor = NativeMethods.GetAncestor(leaf, GA_ROOT);
            if (hwndUnderCursor == IntPtr.Zero) hwndUnderCursor = leaf;
        }

        var chosen = PickTopmost(candidates, hwndUnderCursor);

        // 3. 单屏校验 + 物理边界裁剪（合同不变：跨屏报错、不裁剪）
        if (!SingleMonitorCheck.IsWithinMonitor(chosen.Bounds, monitorRect))
            return new TargetWindowResolveResult(null, TargetError.AcrossMonitors);
        var clamped = SingleMonitorCheck.ClampToMonitor(chosen.Bounds, monitorRect);
        if (clamped.IsEmpty || clamped.Width <= 0 || clamped.Height <= 0)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        return new TargetWindowResolveResult(
            new TargetWindow(
                chosen.Hwnd,
                GetWindowProcessId(chosen.Hwnd),
                GetClassName(chosen.Hwnd),
                clamped,
                GetWindowTitle(chosen.Hwnd)),
            TargetError.None);
    }

    /// <summary>Z 序候选（Occluded = 被更高层可见窗口遮挡）。</summary>
    public readonly record struct TopmostCandidate(IntPtr Hwnd, Rect Bounds, bool Occluded);

    /// <summary>
    /// 裁决纯逻辑（可单测）：唯一完全可见 → 它；多个并列完全可见 → 鼠标下的
    /// （鼠标下不在集合则取第一个）；全部被遮挡 → Z 序第一个。
    /// </summary>
    public static TopmostCandidate PickTopmost(IReadOnlyList<TopmostCandidate> zOrdered, IntPtr hwndUnderCursor)
    {
        var fullyVisible = zOrdered.Where(c => !c.Occluded).ToList();
        if (fullyVisible.Count > 1 && hwndUnderCursor != IntPtr.Zero)
        {
            var under = fullyVisible.FirstOrDefault(c => c.Hwnd == hwndUnderCursor);
            if (under.Hwnd != IntPtr.Zero) return under;
        }
        return fullyVisible.Count > 0 ? fullyVisible[0] : zOrdered[0];
    }

    private static bool RectsIntersect(Rect a, Rect b) =>
        a.Left < b.Right && a.Right > b.Left && a.Top < b.Bottom && a.Bottom > b.Top;

    /// <summary>重新校验窗口外框是否仍完整位于同一显示器（置前后二次校验）。</summary>
    public static bool IsStillSingleMonitor(IntPtr hwnd, int cursorX, int cursorY)
    {
        var bounds = GetExtendedFrameBounds(hwnd);
        if (bounds.IsEmpty)
        {
            var wr = default(Rect);
            if (NativeMethods.GetWindowRect(hwnd, ref wr)) bounds = wr;
        }
        if (bounds.IsEmpty) return false;
        var monitorRect = GetMonitorRectFromPoint(cursorX, cursorY);
        return SingleMonitorCheck.IsWithinMonitor(bounds, monitorRect);
    }

    public static Rect GetExtendedFrameBounds(IntPtr hwnd)
    {
        var rect = default(Rect);
        int hr = NativeMethods.DwmGetWindowAttribute(
            hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ref rect, Marshal.SizeOf<Rect>());
        return hr == 0 ? rect : default;
    }

    private static string GetProcessName(int pid)
    {
        try
        {
            using var p = System.Diagnostics.Process.GetProcessById(pid);
            return p.ProcessName;
        }
        catch
        {
            return "";
        }
    }

    private static bool IsCloaked(IntPtr hwnd)
    {
        uint cloaked = 0;
        int hr = NativeMethods.DwmGetWindowAttribute(
            hwnd, DWMWA_CLOAKED, ref cloaked, sizeof(uint));
        return hr == 0 && cloaked != 0;
    }

    private static string GetClassName(IntPtr hwnd)
    {
        var sb = new System.Text.StringBuilder(256);
        NativeMethods.GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var sb = new System.Text.StringBuilder(512);
        NativeMethods.GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static int GetWindowProcessId(IntPtr hwnd)
    {
        NativeMethods.GetWindowThreadProcessId(hwnd, out var pid);
        return pid;
    }

    /// <summary>主显示器工作区（rcWork），供通知定位。</summary>
    public static Rect GetPrimaryWorkArea()
    {
        var monitor = NativeMethods.MonitorFromPoint(
            new NativePoint { X = 0, Y = 0 },
            NativeMethods.MONITOR_DEFAULTTOPRIMARY);
        var info = default(NativeMonitorInfo);
        info.cbSize = Marshal.SizeOf<NativeMonitorInfo>();
        if (NativeMethods.GetMonitorInfo(monitor, ref info))
            return info.rcWork;
        return default;
    }

    private static Rect GetMonitorRectFromPoint(int x, int y)
    {
        var monitor = NativeMethods.MonitorFromPoint(
            new NativePoint { X = x, Y = y },
            NativeMethods.MONITOR_DEFAULTTONEAREST);
        var info = default(NativeMonitorInfo);
        info.cbSize = Marshal.SizeOf<NativeMonitorInfo>();
        if (NativeMethods.GetMonitorInfo(monitor, ref info))
            return info.rcMonitor;
        return default;
    }
}

public sealed record TargetWindowResolveResult(TargetWindow? Window, TargetError Error);

[StructLayout(LayoutKind.Sequential)]
public struct Rect
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;

    public bool IsEmpty => Left == 0 && Top == 0 && Right == 0 && Bottom == 0;
    public int Width => Right - Left;
    public int Height => Bottom - Top;

    public bool Contains(Rect other) =>
        other.Left >= Left && other.Top >= Top &&
        other.Right <= Right && other.Bottom <= Bottom;
}

[StructLayout(LayoutKind.Sequential)]
internal struct NativeMonitorInfo
{
    public int cbSize;
    public NativeRect rcMonitor;
    public NativeRect rcWork;
    public uint dwFlags;
}

[StructLayout(LayoutKind.Sequential)]
internal struct NativeRect
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;

    public static implicit operator Rect(NativeRect r) =>
        new() { Left = r.Left, Top = r.Top, Right = r.Right, Bottom = r.Bottom };
}

internal static partial class NativeMethods
{
    internal const int MONITOR_DEFAULTTONEAREST = 2;
    internal const int MONITOR_DEFAULTTOPRIMARY = 1;

    internal delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern IntPtr WindowFromPoint(NativePoint p);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr hwnd, uint dwAttribute, ref Rect pvAttribute, int cbAttribute);

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr hwnd, uint dwAttribute, ref uint pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    internal static extern IntPtr MonitorFromPoint(NativePoint pt, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetMonitorInfo(IntPtr hMonitor, ref NativeMonitorInfo lpmi);
}
