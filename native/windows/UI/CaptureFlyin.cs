using System;
using System.Collections.Generic;
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
/// 与快门音、边框闪烁同时开始；终点优先 UIA 查找 DSH 任务栏按钮，失败退化为
/// 任务栏中心。流畅度策略：全部帧一次性预生成（源图先缩到起始尺寸再逐帧缩放），
/// 播放期零 GDI+ 分配，仅 UpdateLayeredWindow 上传；timeBeginPeriod(1) 提高
/// 定时精度，DwmFlush 对齐垂直同步，消除掉帧。
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

    private const int FlyinDurationMs = 420;
    private const int FrameIntervalMs = 16; // ~60fps：帧距减半是消除整数像素跳感的第一要素
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
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
    }

    private sealed record FlyFrame(IntPtr HBitmap, Point Pos, int W, int H, byte Alpha);

    private static void Run(byte[] png, Rect targetBounds)
    {
        IntPtr hwnd = IntPtr.Zero;
        var frames = new List<FlyFrame>();
        try
        {
            using var source = Decode(png);
            if (source == null)
            {
                Program.WriteDiagLog("flyin: decode failed");
                return;
            }

            var (endCenter, fallback) = ResolveEndpoint(targetBounds);
            Program.WriteDiagLog($"flyin: endpoint=({(int)endCenter.X},{(int)endCenter.Y}) fallback={fallback}");

            // 初始尺寸：目标窗口 30%，宽限制在 StartMaxWidth 内，保持宽高比
            double scale = Math.Min(0.3, (double)StartMaxWidth / Math.Max(1, targetBounds.Width));
            int startW = Math.Max(EndWidth, (int)(targetBounds.Width * scale));
            int startH = Math.Max(8, (int)(targetBounds.Height * scale));
            var startCenter = new PointF(
                targetBounds.Left + targetBounds.Width / 2f,
                targetBounds.Top + targetBounds.Height / 2f);

            RegisterClassOnce();
            hwnd = NativeMethods.CreateWindowEx(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                ClassName, "", WS_POPUP,
                0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (hwnd == IntPtr.Zero)
            {
                Program.WriteDiagLog("flyin: CreateWindowEx failed: " + Marshal.GetLastWin32Error());
                return;
            }
            NativeMethods.ShowWindow(hwnd, 4 /* SW_SHOWNOACTIVATE */);

            // 预生成全部帧：先把源图缩到起始尺寸（避免每帧从数千像素宽的原图重采样）
            using var mid = RenderScaled(source, startW, startH);
            if (mid == null)
            {
                Program.WriteDiagLog("flyin: prerender start-size failed");
                return;
            }
            int frameCount = FlyinDurationMs / FrameIntervalMs;
            for (int i = 0; i < frameCount; i++)
            {
                double p = (i + 1) / (double)frameCount;
                var f = BuildFrame(mid, startCenter, endCenter, startW, startH, p);
                if (f == null) break;
                frames.Add(f);
            }
            Program.WriteDiagLog($"flyin: frames={frames.Count} startW={startW} startH={startH}");
            if (frames.Count == 0) return;

            Play(hwnd, frames);
        }
        catch (Exception ex)
        {
            Program.WriteDiagLog($"flyin: aborted: {ex.Message}");
        }
        finally
        {
            foreach (var f in frames) NativeMethods.DeleteObject(f.HBitmap);
            if (hwnd != IntPtr.Zero) NativeMethods.DestroyWindow(hwnd);
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>逐帧上传：高精度可等待定时器对齐帧距 + DwmFlush 等合成，播放期零分配。</summary>
    private static void Play(IntPtr hwnd, List<FlyFrame> frames)
    {
        NativeMethods.TimeBeginPeriod(1);
        IntPtr timer = CreateHighResTimer();
        IntPtr thread = NativeMethods.GetCurrentThread();
        NativeMethods.SetThreadPriority(thread, 1 /* THREAD_PRIORITY_ABOVE_NORMAL */);
        IntPtr screenDc = IntPtr.Zero;
        IntPtr memDc = IntPtr.Zero;
        try
        {
            screenDc = NativeMethods.GetDC(IntPtr.Zero);
            memDc = NativeMethods.CreateCompatibleDC(screenDc);
            var blend = new NativeMethods.BlendFunction { BlendOp = 0 /* AC_SRC_OVER */ };
            long startTick = Environment.TickCount64;
            for (int i = 0; i < frames.Count; i++)
            {
                long due = startTick + (long)(i + 1) * FrameIntervalMs;
                long wait = due - Environment.TickCount64;
                if (wait > 0) WaitPrecise(timer, (int)wait);

                var f = frames[i];
                IntPtr old = NativeMethods.SelectObject(memDc, f.HBitmap);
                var pos = f.Pos;
                var size = new Size(f.W, f.H);
                var src = new Point(0, 0);
                blend.SourceConstantAlpha = f.Alpha;
                bool ok = NativeMethods.UpdateLayeredWindow(
                    hwnd, IntPtr.Zero, ref pos, ref size, memDc, ref src, 0, ref blend, 2 /* ULW_ALPHA */);
                NativeMethods.SelectObject(memDc, old);
                if (i == 0)
                {
                    Program.WriteDiagLog($"flyin: first-frame ULW ok={ok} err={Marshal.GetLastWin32Error()} pos=({pos.X},{pos.Y}) size=({size.Width}x{size.Height}) frames={frames.Count} hrTimer={timer != IntPtr.Zero}");
                }
                if (!ok) continue;

                PumpMessages();
                NativeMethods.DwmFlush();
            }
        }
        finally
        {
            NativeMethods.SetThreadPriority(thread, 0 /* THREAD_PRIORITY_NORMAL */);
            if (timer != IntPtr.Zero) NativeMethods.CloseHandle(timer);
            if (memDc != IntPtr.Zero) NativeMethods.DeleteDC(memDc);
            if (screenDc != IntPtr.Zero) NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
            NativeMethods.TimeEndPeriod(1);
        }
    }

    /// <summary>高精度可等待定时器（Win10 1803+ 1ms 精度）；不支持时退化普通定时器。</summary>
    private static IntPtr CreateHighResTimer()
    {
        IntPtr t = NativeMethods.CreateWaitableTimerExW(IntPtr.Zero, null, 0x2 /* CREATE_WAITABLE_TIMER_HIGH_RESOLUTION */, 0x1F0003 /* TIMER_ALL_ACCESS */);
        if (t == IntPtr.Zero)
        {
            t = NativeMethods.CreateWaitableTimerExW(IntPtr.Zero, null, 0, 0x1F0003);
        }
        return t;
    }

    private static void WaitPrecise(IntPtr timer, int ms)
    {
        if (timer != IntPtr.Zero)
        {
            long due = -(long)ms * 10000; // 100ns 单位，负值 = 相对时间
            if (NativeMethods.SetWaitableTimer(timer, ref due, 0, IntPtr.Zero, IntPtr.Zero, false))
            {
                NativeMethods.WaitForSingleObject(timer, uint.MaxValue);
                return;
            }
        }
        Thread.Sleep(ms);
    }

    /// <summary>easeInOutCubic 位移与缩放：两端速度收敛，消除最快段的大跳步。</summary>
    private static FlyFrame? BuildFrame(
        Image mid, PointF startCenter, PointF endCenter, int startW, int startH, double p)
    {
        double ease = p < 0.5
            ? 4 * p * p * p
            : 1 - Math.Pow(-2 * p + 2, 3) / 2;
        double cx = startCenter.X + (endCenter.X - startCenter.X) * ease;
        double cy = startCenter.Y + (endCenter.Y - startCenter.Y) * ease;
        int w = Math.Max(1, (int)(startW + (EndWidth - startW) * ease));
        int endH = Math.Max(8, (int)(EndWidth * (double)startH / Math.Max(1, startW)));
        int h = Math.Max(1, (int)(startH + (endH - startH) * ease));
        byte alpha = p < 0.75 ? (byte)255 : (byte)(255 * (1 - (p - 0.75) / 0.25));

        using var frame = RenderScaled(mid, w, h);
        if (frame == null) return null;
        IntPtr hbmp = frame.GetHbitmap();
        if (hbmp == IntPtr.Zero) return null;
        return new FlyFrame(hbmp, new Point((int)(cx - w / 2.0), (int)(cy - h / 2.0)), w, h, alpha);
    }

    private static Bitmap? RenderScaled(Image source, int w, int h)
    {
        try
        {
            var dst = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using var g = Graphics.FromImage(dst);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(source, 0, 0, w, h);
            return dst;
        }
        catch
        {
            return null;
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
            // GDI+ 要求流在 Image 存活期间保持打开；复制为独立位图后即可安全释放流
            using var ms = new MemoryStream(png);
            using var img = Image.FromStream(ms);
            return new Bitmap(img);
        }
        catch (Exception ex)
        {
            Program.WriteDiagLog($"flyin: decode exception: {ex.Message}");
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

    [DllImport("dwmapi.dll")]
    internal static extern int DwmFlush();

    // winmm 导出名是小写开头：必须显式指定 EntryPoint，否则按方法名查找抛 EntryPointNotFoundException
    [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod")]
    internal static extern uint TimeBeginPeriod(uint period);

    [DllImport("winmm.dll", EntryPoint = "timeEndPeriod")]
    internal static extern uint TimeEndPeriod(uint period);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern IntPtr GetCurrentThread();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetThreadPriority(IntPtr hThread, int nPriority);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern IntPtr CreateWaitableTimerExW(IntPtr lpTimerAttributes, string? lpTimerName, uint dwFlags, uint dwDesiredAccess);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWaitableTimer(IntPtr hTimer, ref long lpDueTime, int lPeriod, IntPtr pfnCompletionRoutine, IntPtr lpArgToCompletionRoutine, bool fResume);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr hObject);

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
