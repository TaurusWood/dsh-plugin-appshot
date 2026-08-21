using System;

namespace AppshotWin.Capture;

/// <summary>窗口元数据（过滤判定输入）。</summary>
public readonly record struct WindowInfo(
    int ProcessId,
    string ClassName,
    bool IsCloaked,
    bool IsIconic,
    bool IsVisible,
    bool IsPopup);

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
/// - 排除 DSH 自身（--dsh-pid）、桌面（Progman/WorkerW）、任务栏（Shell_TrayWnd / Shell_SecondaryTrayWnd）；
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
        if (dshPid > 0 && win.ProcessId == dshPid) return FilterReason.DshWindow;
        if (win.ClassName is ClassProgman or ClassWorkerW) return FilterReason.Desktop;
        if (win.ClassName is ClassShellTray or ClassShellSecondaryTray) return FilterReason.Taskbar;
        if (win.IsCloaked) return FilterReason.Cloaked;
        return FilterReason.Capturable;
    }
}

/// <summary>单显示器边界校验纯逻辑（technical-windows.md §3.3.4）。</summary>
public static class SingleMonitorCheck
{
    /// <summary>目标窗口有效边界必须完整位于 rcMonitor 内；跨屏返回 false。</summary>
    public static bool IsWithinMonitor(Rect windowRect, Rect monitorRect) =>
        windowRect.Left >= monitorRect.Left &&
        windowRect.Top >= monitorRect.Top &&
        windowRect.Right <= monitorRect.Right &&
        windowRect.Bottom <= monitorRect.Bottom;
}
