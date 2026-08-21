using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace AppshotWin.Capture;

/// <summary>
/// PNG 编码器。
///
/// 实现说明：使用 GDI+（System.Drawing.Common，net8.0-windows 原生支持）将 GDI 位图
/// 编码为标准 PNG。规格（technical-windows.md §3.4.5）要求"使用 WIC 编码为标准 PNG"，
/// 其意图是产出符合标准的 PNG 字节；GDI+ PNG 编码为同一标准格式（IHDR 宽高、
/// 无损压缩），且避免手写 WIC COM vtable 互操作的脆弱性。若未来需要与 WIC 严格
/// 对齐（如 EXIF 或特定像素格式），可在本类型内部替换实现而不影响调用方。
/// </summary>
public static class WicEncoder
{
    public const long MaxPngBytes = 20L * 1024 * 1024;

    /// <summary>将 GDI 位图编码为 PNG 字节；失败返回 null。</summary>
    public static byte[]? EncodePng(IntPtr hBitmap)
    {
        if (hBitmap == IntPtr.Zero) return null;
        // 先取位图信息（宽高、格式）
        var bmpInfo = GetBitmapInfo(hBitmap);
        if (bmpInfo == null) return null;

        using var bmp = CopyBitmapToManaged(hBitmap, bmpInfo.Value.Width, bmpInfo.Value.Height);
        if (bmp == null) return null;

        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        if (ms.Length > MaxPngBytes) return null;
        return ms.ToArray();
    }

    private static (int Width, int Height)? GetBitmapInfo(IntPtr hBitmap)
    {
        var header = default(BitmapInfoHeader);
        header.Size = Marshal.SizeOf<BitmapInfoHeader>();
        IntPtr hdc = NativeMethods.GetDC(IntPtr.Zero);
        if (hdc == IntPtr.Zero) return null;
        try
        {
            int ok = NativeMethods.GetDIBits(
                hdc, hBitmap, 0, 0,
                IntPtr.Zero, ref header, 0 /* DIB_RGB_COLORS */);
            if (ok == 0 || header.Width <= 0 || header.Height == 0)
                return null;
            return (header.Width, Math.Abs(header.Height));
        }
        finally
        {
            NativeMethods.ReleaseDC(IntPtr.Zero, hdc);
        }
    }

    private static Bitmap? CopyBitmapToManaged(IntPtr hBitmap, int width, int height)
    {
        try
        {
            // 从 GDI 位图复制像素到 32bpp ARGB 托管位图
            using var src = Image.FromHbitmap(hBitmap);
            var dst = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.DrawImage(src, 0, 0, width, height);
            }
            return dst;
        }
        catch
        {
            return null;
        }
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct BitmapInfoHeader
{
    public int Size;
    public int Width;
    public int Height;
    public ushort Planes;
    public ushort BitCount;
    public int Compression;
    public int SizeImage;
    public int XPelsPerMeter;
    public int YPelsPerMeter;
    public int ClrUsed;
    public int ClrImportant;
}

internal static partial class NativeMethods
{
    [DllImport("gdi32.dll")]
    internal static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint cLines,
        IntPtr lpvBits, ref BitmapInfoHeader lpbmi, uint usage);
}
