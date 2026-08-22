using Xunit;
using AppshotWin.Capture;

namespace AppshotWin.Tests;

public class TargetFilterTests
{
    private const int DshPid = 1234;

    private static WindowInfo Win(
        int pid = 5678, string className = "Chrome_WidgetWin_1",
        bool cloaked = false, bool iconic = false, bool visible = true, bool popup = false) =>
        new(pid, className, cloaked, iconic, visible, popup);

    [Fact]
    public void ValidWindowIsCapturable()
    {
        Assert.Equal(FilterReason.Capturable, TargetFilter.Evaluate(Win(), DshPid));
    }

    [Fact]
    public void DshWindowIsExcluded()
    {
        Assert.Equal(FilterReason.DshWindow, TargetFilter.Evaluate(Win(pid: DshPid), DshPid));
    }

    [Fact]
    public void DesktopIsExcluded()
    {
        Assert.Equal(FilterReason.Desktop, TargetFilter.Evaluate(Win(className: "Progman"), DshPid));
        Assert.Equal(FilterReason.Desktop, TargetFilter.Evaluate(Win(className: "WorkerW"), DshPid));
    }

    [Fact]
    public void TaskbarIsExcluded()
    {
        Assert.Equal(FilterReason.Taskbar, TargetFilter.Evaluate(Win(className: "Shell_TrayWnd"), DshPid));
        Assert.Equal(FilterReason.Taskbar, TargetFilter.Evaluate(Win(className: "Shell_SecondaryTrayWnd"), DshPid));
    }

    [Fact]
    public void CloakedWindowIsExcluded()
    {
        Assert.Equal(FilterReason.Cloaked, TargetFilter.Evaluate(Win(cloaked: true), DshPid));
    }

    [Fact]
    public void MinimizedWindowIsExcluded()
    {
        Assert.Equal(FilterReason.Minimized, TargetFilter.Evaluate(Win(iconic: true), DshPid));
    }

    [Fact]
    public void PopupIndependentTargetIsCapturable()
    {
        // Tooltip/菜单/浮动工具窗作为独立顶层目标（Windows Basic 不做 GA_ROOTOWNER 归并）
        Assert.Equal(FilterReason.Capturable, TargetFilter.Evaluate(Win(popup: true), DshPid));
    }

    [Fact]
    public void DshProcessNameIsExcluded()
    {
        Assert.Equal(FilterReason.DshWindow, TargetFilter.Evaluate(new WindowInfo(9999, "Chrome_WidgetWin_1", false, false, true, false, "DSH Desktop"), DshPid));
        Assert.Equal(FilterReason.DshWindow, TargetFilter.Evaluate(new WindowInfo(9999, "Chrome_WidgetWin_1", false, false, true, false, "dsh.exe"), DshPid));
    }

    [Fact]
    public void InvisibleWindowIsExcluded()
    {
        Assert.Equal(FilterReason.NotVisible, TargetFilter.Evaluate(Win(visible: false), DshPid));
    }
}

public class SingleMonitorCheckTests
{
    private static readonly Rect Monitor = new() { Left = 0, Top = 0, Right = 1920, Bottom = 1080 };

    [Fact]
    public void FullyInsideIsWithinMonitor()
    {
        var win = new Rect { Left = 100, Top = 100, Right = 1200, Bottom = 900 };
        Assert.True(SingleMonitorCheck.IsWithinMonitor(win, Monitor));
    }

    [Fact]
    public void MaximizedWindowWithNegativeOffsetIsAllowedAndClamped()
    {
        // Windows 10/11 最大化窗口典型的 -8px 负外框
        var maximizedWin = new Rect { Left = -8, Top = -8, Right = 1928, Bottom = 1088 };
        Assert.True(SingleMonitorCheck.IsWithinMonitor(maximizedWin, Monitor));

        var clamped = SingleMonitorCheck.ClampToMonitor(maximizedWin, Monitor);
        Assert.Equal(0, clamped.Left);
        Assert.Equal(0, clamped.Top);
        Assert.Equal(1920, clamped.Right);
        Assert.Equal(1080, clamped.Bottom);
    }

    [Fact]
    public void CrossingRightMonitorRejected()
    {
        var win = new Rect { Left = 1000, Top = 100, Right = 2100, Bottom = 900 };
        Assert.False(SingleMonitorCheck.IsWithinMonitor(win, Monitor));
    }

    [Fact]
    public void CrossingLeftMonitorRejected()
    {
        var win = new Rect { Left = -100, Top = 100, Right = 800, Bottom = 900 };
        Assert.False(SingleMonitorCheck.IsWithinMonitor(win, Monitor));
    }

    [Fact]
    public void ExceedingBottomRejected()
    {
        var win = new Rect { Left = 100, Top = 100, Right = 1200, Bottom = 1200 };
        Assert.False(SingleMonitorCheck.IsWithinMonitor(win, Monitor));
    }
}
