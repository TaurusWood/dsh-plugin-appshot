using System;
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
    /// 在触发瞬间的物理坐标上解析可捕获目标。
    /// dshPid 为注入的 DSH 主进程 PID（排除 DSH 自身窗口）。
    /// </summary>
    public static TargetWindowResolveResult Resolve(
        int cursorX, int cursorY, int dshPid, Func<IntPtr, bool>? isVisibleOverride = null)
    {
        // 1. WindowFromPoint：鼠标物理坐标命中
        var leaf = NativeMethods.WindowFromPoint(new NativePoint { X = cursorX, Y = cursorY });
        if (leaf == IntPtr.Zero)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        // 2. GA_ROOT 规范化到顶层窗口
        var top = NativeMethods.GetAncestor(leaf, GA_ROOT);
        if (top == IntPtr.Zero) top = leaf;

        // 3. 可见性与最小化
        bool visible = isVisibleOverride?.Invoke(top) ?? NativeMethods.IsWindowVisible(top);
        if (!visible)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);
        if (NativeMethods.IsIconic(top))
            return new TargetWindowResolveResult(null, TargetError.Minimized);

        // 4. 类名与进程
        var className = GetClassName(top);
        var pid = GetWindowProcessId(top);
        var processName = GetProcessName(pid);

        // 5. 排除 DSH 自身（PID 或 进程名）
        if (TargetFilter.IsDshProcess(pid, processName, dshPid))
            return new TargetWindowResolveResult(null, TargetError.DshWindow);

        // 6. 排除桌面与任务栏
        if (className is ClassProgman or ClassWorkerW)
            return new TargetWindowResolveResult(null, TargetError.Desktop);
        if (className is ClassShellTray or ClassShellSecondaryTray)
            return new TargetWindowResolveResult(null, TargetError.Taskbar);

        // 7. 排除 Cloaked（DWM）
        if (IsCloaked(top))
            return new TargetWindowResolveResult(null, TargetError.Cloaked);

        // 8. DWM 有效外框（排除阴影的真实可视物理边界，DWM 失败时用 GetWindowRect 兜底）
        var bounds = GetExtendedFrameBounds(top);
        if (bounds.IsEmpty)
        {
            var wr = default(Rect);
            if (NativeMethods.GetWindowRect(top, ref wr)) bounds = wr;
        }
        if (bounds.IsEmpty)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        // 9. 单显示器校验：鼠标所在显示器的 rcMonitor 必须包含外框（允许最大化负边框容差）
        var monitorRect = GetMonitorRectFromPoint(cursorX, cursorY);
        if (!SingleMonitorCheck.IsWithinMonitor(bounds, monitorRect))
            return new TargetWindowResolveResult(null, TargetError.AcrossMonitors);

        // 10. 裁剪至物理屏幕范围（去除最大化窗口在屏幕外的负边框）
        bounds = SingleMonitorCheck.ClampToMonitor(bounds, monitorRect);
        if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0)
            return new TargetWindowResolveResult(null, TargetError.NoTargetWindow);

        var title = GetWindowTitle(top);
        return new TargetWindowResolveResult(
            new TargetWindow(top, pid, className, bounds, title), TargetError.None);
    }

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
