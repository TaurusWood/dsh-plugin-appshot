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
    private const IntPtr HTTRANSPARENT = -1;

    private readonly IntPtr _hwnd;
    private static NoActivateToast? s_visible;
    private static readonly NativeMethods.WndProc s_wndProc = WndProcStatic;

    public IntPtr Handle => _hwnd;

    public NoActivateToast(string text)
    {
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
        return NativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
    }

    /// <summary>在显示器工作区右下角显示（不激活）。</summary>
    public void Show(int x, int y, int width, int height)
    {
        // 隐藏前一个可见通知（触发新截图时先同步隐藏旧通知）
        HideAll();
        NativeMethods.SetWindowPos(_hwnd, new IntPtr(-1) /* HWND_TOPMOST */,
            x, y, width, height,
            0x0001 /* SWP_NOSIZE */ | 0x0010 /* SWP_NOACTIVATE */ | 0x0040 /* SWP_SHOWWINDOW */);
        s_visible = this;
    }

    public void Hide()
    {
        if (_hwnd != IntPtr.Zero)
            NativeMethods.ShowWindow(_hwnd, 0 /* SW_HIDE */);
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
}
