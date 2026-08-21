using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace AppshotWin.Capture;

/// <summary>截图结果：最终位图与是否降级。</summary>
public sealed class CaptureResult
{
    public required byte[] PngBytes { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public bool IsFallback { get; init; }
    public string? FallbackReason { get; init; }
}

/// <summary>
/// 两阶段截图执行器（technical-windows.md §3.4）：
/// 阶段 1：捕获目标矩形当前可见屏幕内容作为降级备份（BitBlt SRCCOPY|CAPTUREBLT）；
/// 阶段 2：普通置前（SetWindowPos HWND_TOP，严禁 HWND_TOPMOST）+ BringWindowToTop；
///         检测同屏 Topmost 遮挡；置前成功且无遮挡时 DwmFlush + 有界延时后重截；
///         失败/遮挡用 backup 降级（isFallback: true）。
/// 尺寸防护：max 7680x4320，编码后 PNG 上限 20MB。
/// </summary>
public static class ScreenCapturer
{
    public const int MaxWidth = 7680;
    public const int MaxHeight = 4320;
    public const long MaxPngBytes = 20L * 1024 * 1024;

    private const uint SRCCOPY = 0x00CC0020;
    private const uint CAPTUREBLT = 0x40000000;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const long WS_EX_TOPMOST = 0x00000008;
    private const uint GW_HWNDPREV = 3;

    /// <summary>
    /// 执行两阶段截图。backup 位图先捕获；若 bringToFront 且无 Topmost 遮挡则重截。
    /// cancellation 协作取消：各阶段间检查，返回 null 表示已取消。
    /// </summary>
    public static async Task<CaptureResult?> CaptureAsync(
        IntPtr targetHwnd,
        Rect bounds,
        CancellationToken cancellation,
        bool attemptBringToFront = true,
        Action<IntPtr>? bringToFrontHook = null)
    {
        cancellation.ThrowIfCancellationRequested();

        // 尺寸与上限防护（checked 算术防溢出）
        int width = bounds.Width;
        int height = bounds.Height;
        if (width <= 0 || height <= 0) return null;
        if (width > MaxWidth || height > MaxHeight)
            throw new InvalidOperationException("IMAGE_TOO_LARGE: dimensions exceed 7680x4320");
        long pixelCount = (long)width * height;
        if (pixelCount > (long)MaxWidth * MaxHeight)
            throw new InvalidOperationException("IMAGE_TOO_LARGE: pixel count exceeds 7680x4320");

        // 阶段 1：可见屏幕备份
        IntPtr backupBmp = CaptureScreenRegion(bounds);
        if (backupBmp == IntPtr.Zero)
            throw new InvalidOperationException("CAPTURE_FAILED: BitBlt stage-1 backup failed");
        try
        {
            cancellation.ThrowIfCancellationRequested();

            bool useBackup = true;
            string? fallbackReason = null;

            if (attemptBringToFront)
            {
                // 阶段 2：普通置前（严禁 HWND_TOPMOST）
                bool brought = BringToFrontNormal(targetHwnd);
                bringToFrontHook?.Invoke(targetHwnd);

                // Topmost 遮挡检测
                bool occluded = HasIntersectingTopmost(targetHwnd, bounds);

                if (brought && !occluded)
                {
                    // DWM 同步等待
                    NativeMethods.DwmFlush();
                    await Task.Delay(Random.Shared.Next(30, 81), cancellation).ConfigureAwait(false);

                    // 二次校验边界与跨屏（由调用方基于 cursor 点执行）
                    var fresh = CaptureScreenRegion(bounds);
                    if (fresh != IntPtr.Zero)
                    {
                        // 释放备份，使用新位图
                        NativeMethods.DeleteObject(backupBmp);
                        backupBmp = fresh;
                        useBackup = false;
                    }
                    else
                    {
                        fallbackReason = "REFRESH_CAPTURE_FAILED";
                    }
                }
                else
                {
                    fallbackReason = !brought ? "BRING_TO_FRONT_FAILED" : "TOPMOST_OCCLUSION";
                }
            }

            cancellation.ThrowIfCancellationRequested();

            // WIC 编码 PNG（显式释放备份位图由调用方 finally 兜底）
            var png = WicEncoder.EncodePng(backupBmp);
            if (png == null || png.LongLength > MaxPngBytes)
                throw new InvalidOperationException("IMAGE_TOO_LARGE: PNG exceeds 20MB");

            return new CaptureResult
            {
                PngBytes = png,
                Width = width,
                Height = height,
                IsFallback = useBackup,
                FallbackReason = fallbackReason,
            };
        }
        finally
        {
            NativeMethods.DeleteObject(backupBmp);
        }
    }

    /// <summary>捕获屏幕指定物理矩形（DWM 边界对应的组合后像素）。</summary>
    internal static IntPtr CaptureScreenRegion(Rect bounds)
    {
        IntPtr screenDc = NativeMethods.GetDC(IntPtr.Zero);
        if (screenDc == IntPtr.Zero) return IntPtr.Zero;
        IntPtr memDc = IntPtr.Zero;
        IntPtr bmp = IntPtr.Zero;
        try
        {
            memDc = NativeMethods.CreateCompatibleDC(screenDc);
            if (memDc == IntPtr.Zero) return IntPtr.Zero;
            bmp = NativeMethods.CreateCompatibleBitmap(screenDc, bounds.Width, bounds.Height);
            if (bmp == IntPtr.Zero) return IntPtr.Zero;

            var old = NativeMethods.SelectObject(memDc, bmp);
            bool ok = NativeMethods.BitBlt(memDc, 0, 0, bounds.Width, bounds.Height,
                screenDc, bounds.Left, bounds.Top, SRCCOPY | CAPTUREBLT);
            NativeMethods.SelectObject(memDc, old);
            return ok ? bmp : IntPtr.Zero;
        }
        finally
        {
            if (memDc != IntPtr.Zero) NativeMethods.DeleteDC(memDc);
            if (screenDc != IntPtr.Zero) NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
            if (bmp == IntPtr.Zero) { /* 失败时位图由调用方不处理 */ }
        }
    }

    /// <summary>普通置前：SetWindowPos(HWND_TOP) + BringWindowToTop；严禁 HWND_TOPMOST。</summary>
    private static bool BringToFrontNormal(IntPtr hwnd)
    {
        bool ok1 = NativeMethods.SetWindowPos(hwnd, new IntPtr(0), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
        bool ok2 = NativeMethods.BringWindowToTop(hwnd);
        return ok1 && ok2;
    }

    /// <summary>向上检查同屏是否存在可见、未最小化且与目标外框相交的 WS_EX_TOPMOST 窗口。</summary>
    private static bool HasIntersectingTopmost(IntPtr targetHwnd, Rect bounds)
    {
        IntPtr current = NativeMethods.GetWindow(targetHwnd, GW_HWNDPREV);
        while (current != IntPtr.Zero)
        {
            var exStyle = (long)NativeMethods.GetWindowLongPtr(current, -20 /* GWL_EXSTYLE */);
            bool isTopmost = (exStyle & WS_EX_TOPMOST) != 0;
            if (isTopmost && NativeMethods.IsWindowVisible(current) && !NativeMethods.IsIconic(current))
            {
                var r = default(Rect);
                if (NativeMethods.GetWindowRect(current, ref r))
                {
                    if (RectsIntersect(r, bounds))
                        return true;
                }
            }
            current = NativeMethods.GetWindow(current, GW_HWNDPREV);
        }
        return false;
    }

    private static bool RectsIntersect(Rect a, Rect b) =>
        a.Left < b.Right && a.Right > b.Left &&
        a.Top < b.Bottom && a.Bottom > b.Top;
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
    internal static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int cx, int cy);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool BitBlt(IntPtr hdc, int x, int y, int cx, int cy,
        IntPtr hdcSrc, int x1, int y1, uint rop);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteDC(IntPtr hdc);

    [DllImport("dwmapi.dll")]
    internal static extern int DwmFlush();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    internal static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr hWnd, ref Rect lpRect);
}
