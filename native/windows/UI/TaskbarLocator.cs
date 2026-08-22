using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using Rect = AppshotWin.Capture.Rect;

namespace AppshotWin.UI;

/// <summary>
/// 定位 DSH 在任务栏上的按钮矩形（飞入动画终点）。
///
/// Windows 没有获取任务栏按钮位置的公开 API：通过 UI Automation 在
/// Shell_TrayWnd 子树按 Name 查找（Win10 标准按钮 / Win11 XAML 树均可达）。
/// FindFirst 无超时参数，外层用后台线程 + Join 超时保护；失败/超时返回 null，
/// 由调用方退化为任务栏中心。名称候选包含进程名与产品名两种可能。
/// </summary>
public static class TaskbarLocator
{
    /// <summary>按候选名称查找 DSH 任务栏按钮；找不到或超时返回 null。</summary>
    public static Rect? LocateDshButton(int timeoutMs = 200)
    {
        Rect? result = null;
        var worker = new Thread(() => result = FindCore())
        {
            IsBackground = true,
            Name = "appshot-taskbar-locate",
        };
        // System.Windows.Automation（UIA COM）要求 STA 线程，MTA 下查找会失败
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
        worker.Join(timeoutMs);
        return worker.IsAlive ? null : result;
    }

    /// <summary>主任务栏矩形（退化终点 / 展示层定位用）。</summary>
    public static Rect GetPrimaryTaskbarRect()
    {
        IntPtr taskbar = NativeMethods.FindWindow("Shell_TrayWnd", null);
        var r = default(Rect);
        if (taskbar != IntPtr.Zero && NativeMethods.GetWindowRect(taskbar, ref r) && !r.IsEmpty)
        {
            return r;
        }
        // 兜底：主显示器底部 48px 条带
        var wa = Capture.TargetWindowFinder.GetPrimaryWorkArea();
        return new Rect { Left = wa.Left, Top = wa.Bottom - 8, Right = wa.Right, Bottom = wa.Bottom + 40 };
    }

    private static Rect? FindCore()
    {
        try
        {
            IntPtr taskbar = NativeMethods.FindWindow("Shell_TrayWnd", null);
            if (taskbar == IntPtr.Zero) return null;
            var root = AutomationElement.FromHandle(taskbar);
            if (root == null) return null;

            foreach (var name in NameCandidates)
            {
                var el = root.FindFirst(
                    TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.NameProperty, name));
                if (el == null) continue;
                var r = el.Current.BoundingRectangle;
                if (r.IsEmpty || r.Width <= 0 || r.Height <= 0) continue;
                return new Rect
                {
                    Left = (int)r.Left,
                    Top = (int)r.Top,
                    Right = (int)r.Right,
                    Bottom = (int)r.Bottom,
                };
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    // Electron 任务栏按钮 Name 来自 AppUserModelID DisplayName / 进程名
    private static readonly string[] NameCandidates = ["DSH Desktop", "DeepSeek Harness"];
}

internal static partial class NativeMethods
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr hWnd, ref Capture.Rect lpRect);
}
