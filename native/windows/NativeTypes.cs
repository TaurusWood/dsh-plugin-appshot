using System.Runtime.InteropServices;

namespace AppshotWin;

[StructLayout(LayoutKind.Sequential)]
internal struct NativePoint
{
    public int X;
    public int Y;
}
