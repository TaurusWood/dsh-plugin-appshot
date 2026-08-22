using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace AppshotWin.UI;

/// <summary>
/// 截屏完成后的目标窗口边框闪烁反馈（防自截合同：仅在 PNG 落盘后显示）。
///
/// - WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST；
/// - 窗口区域挖空为边框环（外矩形-内矩形），SetLayeredWindowAttributes 驱动两次 alpha 脉冲；
/// - 动画在独立短命线程 + 自带消息泵运行（~350ms 后销毁），不依赖 worker/主线程泵；
/// - 同一时间只允许一个实例（新截图落盘前旧的已结束，重入直接忽略）。
/// </summary>
public static class CaptureFlash
{
    private const string ClassName = "AppshotFlashWnd";
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_LAYERED = 0x00080000;
    private const uint WS_POPUP = 0x80000000;
    private const int BorderPad = 6; // 物理像素；高 DPI 屏上过细不可见
    private const int TotalDurationMs = 250;
    // 窗口过程必须原样转发 hwnd：DefWindowProc 依据 hwnd 查找类背景刷，
    // 丢失句柄会导致 WM_ERASEBKGND 不绘制、layered 窗口表面全透明（不可见）。
    private static readonly NativeMethods.WndProc WndProc = (hwnd, msg, wParam, lParam) =>
        NativeMethods.DefWindowProc(hwnd, msg, wParam, lParam);

    private static bool _classRegistered;
    private static int _busy;

    /// <summary>在目标窗口矩形上闪两圈亮蓝边框（调用方保证截图已落盘）。</summary>
    public static void Show(Capture.Rect bounds)
    {
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
        var t = new Thread(() => Run(bounds)) { IsBackground = true };
        t.Start();
    }

    private static void Run(Capture.Rect bounds)
    {
        IntPtr hwnd = IntPtr.Zero;
        try
        {
            RegisterClassOnce();
            int w = bounds.Width + BorderPad * 2;
            int h = bounds.Height + BorderPad * 2;
            hwnd = NativeMethods.CreateWindowEx(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                ClassName, "", WS_POPUP,
                bounds.Left - BorderPad, bounds.Top - BorderPad, w, h,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (hwnd == IntPtr.Zero) return;

            // 挖空为边框环：外矩形 - 内矩形
            IntPtr outer = NativeMethods.CreateRectRgn(0, 0, w, h);
            IntPtr inner = NativeMethods.CreateRectRgn(BorderPad, BorderPad, w - BorderPad, h - BorderPad);
            NativeMethods.CombineRgn(outer, outer, inner, 4 /* RGN_DIFF */);
            NativeMethods.SetWindowRgn(hwnd, outer, false);
            NativeMethods.DeleteObject(inner);

            NativeMethods.SetWindowPos(hwnd, new IntPtr(-1) /* HWND_TOPMOST */,
                0, 0, 0, 0, 0x0010 /* SWP_NOACTIVATE */ | 0x0040 /* SWP_SHOWWINDOW */ | 0x0001 /* SWP_NOSIZE */ | 0x0002 /* SWP_NOMOVE */);

            long start = Environment.TickCount64;
            while (true)
            {
                int t = (int)(Environment.TickCount64 - start);
                if (t > TotalDurationMs) break;
                byte alpha = ComputeAlpha(t, TotalDurationMs);
                NativeMethods.SetLayeredWindowAttributes(hwnd, 0, alpha, 0x0002 /* LWA_ALPHA */);
                PumpMessages();
                Thread.Sleep(16); // ~60fps
            }
        }
        catch
        {
            // 反馈失败静默忽略
        }
        finally
        {
            if (hwnd != IntPtr.Zero) NativeMethods.DestroyWindow(hwnd);
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>单次脉冲曲线：255 → 0 一次衰减（一下即收）。</summary>
    internal static byte ComputeAlpha(int tMs, int totalMs)
    {
        double p = Math.Min(1.0, (double)tMs / totalMs);
        return (byte)Math.Max(0, 255 * (1 - p));
    }

    private static void RegisterClassOnce()
    {
        if (_classRegistered) return;
        // 亮蓝边框（#5B9DFF，COLORREF BGR）
        var wc = new NativeMethods.WndClass
        {
            lpfnWndProc = WndProc,
            hInstance = NativeMethods.GetModuleHandle(null),
            lpszClassName = ClassName,
            style = 0,
            hbrBackground = NativeMethods.CreateSolidBrush(0x00FF9D5B),
        };
        NativeMethods.RegisterClass(ref wc);
        _classRegistered = true;
    }

    private static void PumpMessages()
    {
        while (NativeMethods.PeekMessage(out var msg, IntPtr.Zero, 0, 0, 0x0001 /* PM_REMOVE */))
        {
            NativeMethods.TranslateMessage(ref msg);
            NativeMethods.DispatchMessage(ref msg);
        }
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct FlashMsg
{
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public NativePoint pt;
}

internal static partial class NativeMethods
{
    [DllImport("gdi32.dll")]
    internal static extern IntPtr CreateRectRgn(int x1, int y1, int x2, int y2);

    [DllImport("gdi32.dll")]
    internal static extern int CombineRgn(IntPtr hrgnDest, IntPtr hrgnSrc1, IntPtr hrgnSrc2, int combineMode);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PeekMessage(out FlashMsg lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TranslateMessage(ref FlashMsg lpMsg);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage(ref FlashMsg lpMsg);
}
