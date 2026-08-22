using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;

namespace AppshotWin.UI;

/// <summary>
/// 快门音效（落盘后反馈，受 soundEnabled 配置控制）。
///
/// 资源为代码合成的 CC0 双脉冲快门声（Resources/shutter.wav，嵌入程序集），
/// 经 winmm PlaySound 以 SND_MEMORY | SND_ASYNC 异步播放，不阻塞截图管线。
/// 音频字节加载后常驻：SND_ASYNC 要求缓冲区在播放期间保持有效。
/// </summary>
public static class ShutterSound
{
    private const uint SND_ASYNC = 0x0001;
    private const uint SND_MEMORY = 0x0004;

    private static byte[]? _wavBytes;
    private static readonly object _loadGate = new();

    public static void Play()
    {
        try
        {
            byte[]? wav = GetBytes();
            if (wav != null)
            {
                NativeMethods.PlaySound(wav, IntPtr.Zero, SND_ASYNC | SND_MEMORY);
            }
        }
        catch
        {
            // 音效失败静默忽略，不影响交付
        }
    }

    private static byte[]? GetBytes()
    {
        lock (_loadGate)
        {
            if (_wavBytes != null) return _wavBytes;
            var asm = Assembly.GetExecutingAssembly();
            var name = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("shutter.wav"));
            if (name == null) return null;
            using var stream = asm.GetManifestResourceStream(name);
            if (stream == null) return null;
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            _wavBytes = ms.ToArray();
            return _wavBytes;
        }
    }
}

internal static partial class NativeMethods
{
    [DllImport("winmm.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PlaySound(byte[] pszSound, IntPtr hmod, uint fdwSound);
}
