using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Rect = AppshotWin.Capture.Rect;

namespace AppshotWin.UI;

/// <summary>
/// 截图缩略图"飞入任务栏 DSH 图标"动画（防自截合同：仅在 PNG 已落盘后显示）。
///
/// 时序：先等待 CaptureFlash 边框闪烁结束（~340ms），再播放飞入；
/// 终点优先 UIA 查找 DSH 任务栏按钮（TaskbarLocator），失败退化为任务栏中心。
/// 实现：WS_EX_LAYERED 分层窗口 + 每帧 UpdateLayeredWindow（GDI+ 高质量缩放
/// 生成帧位图，SourceConstantAlpha 控制尾段淡出），独立短命线程自带消息泵。
/// </summary>
public static class CaptureFlyin
{
    private const string ClassName = "AppshotFlyinWnd";
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_LAYERED = 0x00080000;
    private const uint WS_POPUP = 0x80000000;

    private const int FlashWaitMs = 340;   // 等边框闪烁结束（CaptureFlash 总时长 350ms）
    private const int FlyinDurationMs = 420;
    private const int FrameIntervalMs = 33; // ~30fps
    private const int StartMaxWidth = 380;  // 缩略图初始最大宽（物理像素）
    private const int EndWidth = 36;        // 缩略图终末宽

    private static readonly NativeMethods.WndProc WndProc = (hwnd, msg, wParam, lParam) =>
        NativeMethods.DefWindowProc(hwnd, msg, wParam, lParam);
    private static bool _classRegistered;
    private static int _busy;

    /// <summary>播放飞入动画（png 为已落盘截图字节；targetBounds 为目标窗口物理矩形）。</summary>
    public static void Show(byte[] png, Rect targetBounds)
    {
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
        var t = new Thread(() => Run(png, targetBounds)) { IsBackground = true };
        t.Start();
    }

    private static void Run(byte[] png, Rect targetBounds)
    {
        Thread.Sleep(FlashWaitMs);
        IntPtr hwnd = IntPtr.Zero;
        try
        {
            using var source = Decode(png);
            if (source == null) return;

            var (endCenter, fallback) = ResolveEndpoint(targetBounds);

            RegisterClassOnce();
            hwnd = NativeMethods.CreateWindowEx(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                ClassName, "", WS_POPUP,
                0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (hwnd == IntPtr.Zero) return;
            NativeMethods.ShowWindow(hwnd, 4 /* SW_SHOWNOACTIVATE */);

            // 初始尺寸：目标窗口 30%，宽限制在 StartMaxWidth 内，保持宽高比
            double scale = Math.Min(0.3, (double)StartMaxWidth / Math.Max(1, targetBounds.Width));
            int startW = Math.Max(EndWidth, (int)(targetBounds.Width * scale));
            int startH = Math.Max(8, (int)(targetBounds.Height * scale));

            var startCenter = new PointF(
                targetBounds.Left + targetBounds.Width / 2f,
                targetBounds.Top + targetBounds.Height / 2f);

            long startTick = Environment.TickCount64;
            while (true)
            {
                int t = (int)(Environment.TickCount64 - startTick);
                if (t > FlyinDurationMs) break;
                double p = Math.Min(1.0, (double)t / FlyinDurationMs);

                if (!RenderFrame(hwnd, source, startCenter, endCenter, startW, startH, p))
                    break;

                PumpMessages();
                Thread.Sleep(FrameIntervalMs);
            }
        }
        catch
        {
            // 动画失败静默忽略
        }
        finally
        {
            if (hwnd != IntPtr.Zero) NativeMethods.DestroyWindow(hwnd);
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>渲染一帧：ease-in 位移 + 线性缩小 + 尾段淡出。</summary>
    private static bool RenderFrame(
        IntPtr hwnd, Image source,
        PointF startCenter, PointF endCenter,
        int startW, int startH, double p)
    {
        double ease = p * p; // ease-in：先慢后快，"吸入"感
        double cx = startCenter.X + (endCenter.X - startCenter.X) * ease;
        double cy = startCenter.Y + (endCenter.Y - startCenter.Y) * ease;
        int w = Math.Max(1, (int)(startW + (EndWidth - startW) * ease));
        int h = Math.Max(1, (int)(startH + (EndWidth * (double)startH / Math.Max(1, startW) - startH) * ease));
        byte alpha = p < 0.75 ? (byte)255 : (byte)(255 * (1 - (p - 0.75) / 0.25));

        using var frame = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(frame))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(source, 0, 0, w, h);
        }

        IntPtr hbmp = frame.GetHbitmap();
        if (hbmp == IntPtr.Zero) return false;
        try
        {
            IntPtr screenDc = NativeMethods.GetDC(IntPtr.Zero);
            IntPtr memDc = NativeMethods.CreateCompatibleDC(screenDc);
            IntPtr old = NativeMethods.SelectObject(memDc, hbmp);
            try
            {
                var pos = new Point((int)(cx - w / 2.0), (int)(cy - h / 2.0));
                var size = new Size(w, h);
                var src = new Point(0, 0);
                var blend = new NativeMethods.BlendFunction
                {
                    BlendOp = 0, // AC_SRC_OVER
                    SourceConstantAlpha = alpha,
                    AlphaFormat = 0,
                };
                return NativeMethods.UpdateLayeredWindow(
                    hwnd, IntPtr.Zero, ref pos, ref size, memDc, ref src, 0, ref blend, 2 /* ULW_ALPHA */);
            }
            finally
            {
                NativeMethods.SelectObject(memDc, old);
                NativeMethods.DeleteDC(memDc);
                NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
            }
        }
        finally
        {
            NativeMethods.DeleteObject(hbmp);
        }
    }

    /// <summary>终点：优先 UIA 精确 DSH 按钮；退化任务栏中心。</summary>
    private static (PointF Center, bool Fallback) ResolveEndpoint(Rect targetBounds)
    {
        var button = TaskbarLocator.LocateDshButton();
        if (button != null)
        {
            var b = button.Value;
            return (new PointF(b.Left + b.Width / 2f, b.Top + b.Height / 2f), false);
        }
        var bar = TaskbarLocator.GetPrimaryTaskbarRect();
        return (new PointF(bar.Left + bar.Width / 2f, bar.Top + bar.Height / 2f), true);
    }

    private static Image? Decode(byte[] png)
    {
        try
        {
            using var ms = new MemoryStream(png);
            return Image.FromStream(ms);
        }
        catch
        {
            return null;
        }
    }

    private static void RegisterClassOnce()
    {
        if (_classRegistered) return;
        var wc = new NativeMethods.WndClass
        {
            lpfnWndProc = WndProc,
            hInstance = NativeMethods.GetModuleHandle(null),
            lpszClassName = ClassName,
            style = 0,
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

internal static partial class NativeMethods
{
    [DllImport("user32.dll")]
    internal static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteDC(IntPtr hdc);

    [StructLayout(LayoutKind.Sequential)]
    internal struct BlendFunction
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UpdateLayeredWindow(IntPtr hWnd, IntPtr hdcDst,
        ref Point pptDst, ref Size psize, IntPtr hdcSrc, ref Point pprSrc,
        uint crKey, ref BlendFunction pblend, uint dwFlags);
}
