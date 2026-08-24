using System;
using System.Runtime.InteropServices;
using System.Threading;
using Rect = AppshotWin.Capture.Rect;

namespace AppshotWin.UI;

/// <summary>
/// 定位 DSH 在任务栏上的按钮矩形（飞入动画终点）。
///
/// Windows 没有获取任务栏按钮位置的公开 API：通过 UI Automation 在
/// Shell_TrayWnd 子树按 Name 查找（Win10 标准按钮 / Win11 XAML 树均可达）。
/// 直接走 UIA COM 接口（见 UiaInterop.cs），不引入托管 System.Windows.Automation
/// （WindowsDesktop 框架引用会把 WPF 运行时打进自包含发布，体积 +50MB）。
/// FindAll 无超时参数，外层用后台线程 + Join 超时保护；失败/超时返回 null，
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
            // UIA COM 要求 STA 线程（CoInitialize 由 STA 线程自动完成）
            var automation = (IUIAutomation)new CUIAutomation();
            automation.ElementFromHandle(taskbar, out IUIAutomationElement root);
            automation.CreateTrueCondition(out IUIAutomationCondition trueCondition);

            // 任务栏按钮的 UIA Name 带状态后缀（如 "DSH Desktop - 1 个运行窗口 已固定"），
            // 精确匹配命不中，必须前缀匹配遍历
            root.FindAll(UiaInterop.TreeScopeDescendants, trueCondition, out var all);
            if (all is null) return null;

            all.Length(out int count);
            for (int i = 0; i < count; i++)
            {
                all.GetElement(i, out IUIAutomationElement el);
                string name;
                try
                {
                    el.CurrentName(out name);
                }
                catch
                {
                    continue;
                }
                if (string.IsNullOrWhiteSpace(name)) continue;
                foreach (var candidate in NameCandidates)
                {
                    if (name.StartsWith(candidate, StringComparison.OrdinalIgnoreCase))
                    {
                        el.CurrentBoundingRectangle(out var r);
                        // 等价旧判空逻辑：Width<=0 || Height<=0（UiaRect 布局为 left/top/width/height）
                        if (r.Width <= 0 || r.Height <= 0) break;
                        return new Rect
                        {
                            Left = (int)r.Left,
                            Top = (int)r.Top,
                            Right = (int)(r.Left + r.Width),
                            Bottom = (int)(r.Top + r.Height),
                        };
                    }
                }
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    // Electron 任务栏按钮 Name 前缀 = 应用显示名（后缀为运行状态）
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
