using System;

namespace AppshotWin.Capture;

/// <summary>窗口元数据（过滤判定输入）。</summary>
public readonly record struct WindowInfo(
    int ProcessId,
    string ClassName,
    bool IsCloaked,
    bool IsIconic,
    bool IsVisible,
    bool IsPopup,
    string ProcessName = "");

public enum FilterReason
{
    Capturable,
    DshWindow,
    Desktop,
    Taskbar,
    Cloaked,
    Minimized,
    NotVisible,
}

/// <summary>
/// 目标窗口过滤纯逻辑（technical-windows.md §3.3.3）：
/// - 排除 DSH 自身（--dsh-pid 与 进程名）、桌面（Progman/WorkerW）、任务栏（Shell_TrayWnd / Shell_SecondaryTrayWnd）；
/// - 排除 Cloaked、最小化、不可见；
/// - 保留独立 Popup（Tooltip/菜单/浮动工具窗作为独立顶层目标）。
/// </summary>
public static class TargetFilter
{
    private const string ClassProgman = "Progman";
    private const string ClassWorkerW = "WorkerW";
    private const string ClassShellTray = "Shell_TrayWnd";
    private const string ClassShellSecondaryTray = "Shell_SecondaryTrayWnd";

    public static FilterReason Evaluate(WindowInfo win, int dshPid)
    {
        if (!win.IsVisible) return FilterReason.NotVisible;
        if (win.IsIconic) return FilterReason.Minimized;
        if (IsDshProcess(win.ProcessId, win.ProcessName, dshPid)) return FilterReason.DshWindow;
        if (win.ClassName is ClassProgman or ClassWorkerW) return FilterReason.Desktop;
        if (win.ClassName is ClassShellTray or ClassShellSecondaryTray) return FilterReason.Taskbar;
        if (win.IsCloaked) return FilterReason.Cloaked;
        return FilterReason.Capturable;
    }

    public static bool IsDshProcess(int pid, string processName, int dshPid)
    {
        if (dshPid > 0 && pid == dshPid) return true;
        if (string.IsNullOrEmpty(processName)) return false;
        var name = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? processName[..^4]
            : processName;
        return name.Equals("DSH Desktop", StringComparison.OrdinalIgnoreCase) ||
               name.Equals("DeepSeek Harness", StringComparison.OrdinalIgnoreCase) ||
               name.Equals("dsh", StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>单显示器边界校验纯逻辑（technical-windows.md §3.3.4）。</summary>
public static class SingleMonitorCheck
{
    // Windows 最大化窗口常有 8~11px 负边框，给予 16px 容差
    public const int MaximizeTolerance = 16;

    /// <summary>目标窗口有效边界必须完整位于 rcMonitor 内（允许最大化负边框容差）；跨屏返回 false。</summary>
    public static bool IsWithinMonitor(Rect windowRect, Rect monitorRect, int tolerance = MaximizeTolerance) =>
        windowRect.Left >= monitorRect.Left - tolerance &&
        windowRect.Top >= monitorRect.Top - tolerance &&
        windowRect.Right <= monitorRect.Right + tolerance &&
        windowRect.Bottom <= monitorRect.Bottom + tolerance;

    /// <summary>将窗口边界裁剪至显示器边界内（消除最大化窗口溢出屏幕的负像素）。</summary>
    public static Rect ClampToMonitor(Rect windowRect, Rect monitorRect) =>
        new()
        {
            Left = Math.Max(windowRect.Left, monitorRect.Left),
            Top = Math.Max(windowRect.Top, monitorRect.Top),
            Right = Math.Min(windowRect.Right, monitorRect.Right),
            Bottom = Math.Min(windowRect.Bottom, monitorRect.Bottom),
        };
}
