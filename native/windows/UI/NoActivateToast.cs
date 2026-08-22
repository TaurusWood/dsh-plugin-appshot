using System;
using System.Runtime.InteropServices;
using System.Text;

namespace AppshotWin.UI;

/// <summary>
/// 不抢焦点、不拦截鼠标的轻量浮动通知（technical-windows.md §3.5）。
///
/// - WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST；
/// - 显示使用 SW_SHOWNOACTIVATE / SWP_NOACTIVATE；
/// - WS_EX_TRANSPARENT + WM_NCHITTEST 返回 HTTRANSPARENT 实现鼠标穿透；
/// - 触发新截图瞬间先隐藏（HideAll）。
/// 注意：样式位本身不构成行为保证，真机输入测试由验收阶段覆盖。
/// </summary>
public sealed class NoActivateToast : IDisposable
{
    private const string ClassName = "AppshotToastWnd";
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const uint WS_POPUP = 0x80000000;
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_PAINT = 0x000F;
    private const int WM_TIMER = 0x0113;
    private const int WM_ERASEBKGND = 0x0014;
    private const IntPtr HTTRANSPARENT = -1;
    private const uint TIMER_ID = 1001;

    private readonly IntPtr _hwnd;
    private static NoActivateToast? s_visible;
    private static readonly NativeMethods.WndProc s_wndProc = WndProcStatic;
    private string _text;

    public IntPtr Handle => _hwnd;

    public NoActivateToast(string text)
    {
        _text = text;
        _hwnd = NativeMethods.CreateWindowEx(
            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_TRANSPARENT,
            ClassName, text, WS_POPUP,
            0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (_hwnd == IntPtr.Zero)
            throw new InvalidOperationException("CreateWindowEx failed: " + Marshal.GetLastWin32Error());
    }

    public static void RegisterClass()
    {
        var wc = new NativeMethods.WndClass
        {
            lpfnWndProc = s_wndProc,
            hInstance = NativeMethods.GetModuleHandle(null),
            lpszClassName = ClassName,
            style = 0,
        };
        NativeMethods.RegisterClass(ref wc);
    }

    private static IntPtr WndProcStatic(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_NCHITTEST) return HTTRANSPARENT;
        if (msg == WM_ERASEBKGND) return new IntPtr(1);
        if (msg == WM_TIMER && (uint)wParam == TIMER_ID)
        {
            NativeMethods.KillTimer(hWnd, TIMER_ID);
            s_visible?.Hide();
            return IntPtr.Zero;
        }
        if (msg == WM_PAINT)
        {
            IntPtr hdc = NativeMethods.BeginPaint(hWnd, out var ps);
            if (hdc != IntPtr.Zero)
            {
                try
                {
                    NativeMethods.GetClientRect(hWnd, out var cr);

                    // 1. 深暗色圆角背景 (#242424) 与边框 (#484848)
                    IntPtr brush = NativeMethods.CreateSolidBrush(0x00242424);
                    IntPtr pen = NativeMethods.CreatePen(0 /* PS_SOLID */, 1, 0x00484848);
                    IntPtr oldBrush = NativeMethods.SelectObject(hdc, brush);
                    IntPtr oldPen = NativeMethods.SelectObject(hdc, pen);

                    NativeMethods.RoundRect(hdc, cr.Left, cr.Top, cr.Right, cr.Bottom, 12, 12);

                    NativeMethods.SelectObject(hdc, oldPen);
                    NativeMethods.SelectObject(hdc, oldBrush);
                    NativeMethods.DeleteObject(pen);
                    NativeMethods.DeleteObject(brush);

                    // 2. 居中绘制白色文本
                    NativeMethods.SetBkMode(hdc, 1 /* TRANSPARENT */);
                    NativeMethods.SetTextColor(hdc, 0x00F0F0F0); // 浅灰白色

                    string text = s_visible?._text ?? "Appshot";
                    var textRect = new NativeRect { Left = cr.Left + 16, Top = cr.Top, Right = cr.Right - 16, Bottom = cr.Bottom };
                    NativeMethods.DrawText(hdc, text, text.Length, ref textRect,
                        0x00000000 /* DT_LEFT */ | 0x00000020 /* DT_VCENTER */ | 0x00000004 /* DT_SINGLELINE */ | 0x00008000 /* DT_END_ELLIPSIS */);
                }
                finally
                {
                    NativeMethods.EndPaint(hWnd, ref ps);
                }
            }
            return IntPtr.Zero;
        }
        return NativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
    }

    /// <summary>在显示器工作区右下角显示（不激活）。</summary>
    public void Show(int x, int y, int width, int height)
    {
        // 隐藏前一个可见通知（触发新截图时先同步隐藏旧通知）
        HideAll();
        s_visible = this;
        // 移除 SWP_NOSIZE，保证 width 和 height 真实生效
        NativeMethods.SetWindowPos(_hwnd, new IntPtr(-1) /* HWND_TOPMOST */,
            x, y, width, height,
            0x0010 /* SWP_NOACTIVATE */ | 0x0040 /* SWP_SHOWWINDOW */);
        NativeMethods.InvalidateRect(_hwnd, IntPtr.Zero, true);

        // 3 秒后自动隐藏
        NativeMethods.SetTimer(_hwnd, TIMER_ID, 3000, IntPtr.Zero);
    }

    public void Hide()
    {
        if (_hwnd != IntPtr.Zero)
        {
            NativeMethods.KillTimer(_hwnd, TIMER_ID);
            NativeMethods.ShowWindow(_hwnd, 0 /* SW_HIDE */);
        }
        if (ReferenceEquals(s_visible, this)) s_visible = null;
    }

    public static void HideAll()
    {
        s_visible?.Hide();
    }

    public void Dispose()
    {
        Hide();
        if (_hwnd != IntPtr.Zero)
            NativeMethods.DestroyWindow(_hwnd);
    }
}

internal static partial class NativeMethods
{
    internal delegate IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WndClass
    {
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PaintStruct
    {
        public IntPtr hdc;
        public bool fErase;
        public NativeRect rcPaint;
        public bool fRestore;
        public bool fIncUpdate;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] rgbReserved;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern ushort RegisterClass(ref WndClass lpWndClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr CreateWindowEx(int dwExStyle, string lpClassName,
        string lpWindowName, uint dwStyle, int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    internal static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    internal static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    internal static extern IntPtr BeginPaint(IntPtr hWnd, out PaintStruct lpPaint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EndPaint(IntPtr hWnd, ref PaintStruct lpPaint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetClientRect(IntPtr hWnd, out NativeRect lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, bool bErase);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetTimer(IntPtr hWnd, uint nIDEvent, uint uElapse, IntPtr lpTimerFunc);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool KillTimer(IntPtr hWnd, uint uIDEvent);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr CreateSolidBrush(uint crColor);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr CreatePen(int fnPenStyle, int nWidth, uint crColor);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RoundRect(IntPtr hdc, int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    internal static extern int SetBkMode(IntPtr hdc, int iBkMode);

    [DllImport("gdi32.dll")]
    internal static extern uint SetTextColor(IntPtr hdc, uint crColor);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int DrawText(IntPtr hDC, string lpchText, int nCount, ref NativeRect lpRect, uint uFormat);
}
