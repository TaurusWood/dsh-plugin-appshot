using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AppshotWin.Capture;
using AppshotWin.Hotkey;
using AppshotWin.UI;

namespace AppshotWin;

internal static class Program
{
    private const int DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;

    private static volatile bool _shutdown;
    private static readonly Channel<string> _outbox = new();
    private static readonly Channel<string> _inbox = new();
    private static DualCtrlHook? _hook;
    private static CancellationTokenSource _cts = new();
    private static int _dshPid;
    private static string _stagingDir = "";
    private static string _instanceId = "";
    private static bool _allowInjected;
    private static bool _diagTarget;
    private static uint _mainThreadId;

    [STAThread]
    private static int Main(string[] args)
    {
        _mainThreadId = NativeMethods.GetCurrentThreadId();
        try
        {
            // 1. Per-Monitor V2 DPI 感知（manifest 声明 + 运行时兜底）
            NativeMethods.SetProcessDpiAwarenessContext(
                new IntPtr(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2));

            // 2. 解析启动参数
            ParseArgs(args);

            // 3. 注册通知窗口类
            NoActivateToast.RegisterClass();

            // 4. 启动输出线程（stdout NDJSON）
            var outThread = new Thread(OutputLoop) { IsBackground = true };
            outThread.Start();

            // 5. 启动输入线程（stdin NDJSON 指令：status/cancel/shutdown）
            var inThread = new Thread(InputLoop) { IsBackground = true };
            inThread.Start();

            // 6. 安装左右 Ctrl 钩子
            _hook = new DualCtrlHook(allowInjected: _allowInjected);
            _hook.Triggered += OnTriggered;
            if (_diagTarget)
            {
                _hook.AnyKey += (vk, injected) =>
                    SendFrame(new { type = "diag/key", vk, injected });
            }

            // 7. ready 握手
            SendFrame(new { type = "ready", version = 1, platform = "win32", pid = Environment.ProcessId });

            // 8. 工作线程：消费触发队列，执行目标锁定 → capture/request → 截图 → appshot 帧
            var worker = new Thread(WorkerLoop) { IsBackground = true };
            worker.Start();

            // 9. 标准消息泵（钩子回调依赖消息循环）：GetMessage 阻塞取消息
            //    （WH_KEYBOARD_LL 消息投递到安装线程队列，必须用 GetMessage 泵出）
            long lastBeat = 0;
            while (!_shutdown)
            {
                int gm = NativeMethods.GetMessage(out var msg, IntPtr.Zero, 0, 0);
                if (gm <= 0) break; // WM_QUIT (0) 或错误 (-1)
                NativeMethods.TranslateMessage(ref msg);
                NativeMethods.DispatchMessage(ref msg);
                if (_diagTarget)
                {
                    long now = Environment.TickCount64;
                    if (now - lastBeat >= 2000)
                    {
                        lastBeat = now;
                        SendFrame(new { type = "diag/heartbeat", tick = now });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            SendFrame(new { type = "fatal", code = "AGENT_INIT_FAILED", message = ex.Message });
            Console.Error.WriteLine("appshot-win-x64 fatal: " + ex);
            return 1;
        }
        finally
        {
            _hook?.Dispose();
            _cts.Cancel();
        }
        return 0;
    }

    private static void ParseArgs(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--mode":
                    // daemon（当前仅支持 daemon）
                    break;
                case "--staging-dir":
                    if (i + 1 < args.Length) _stagingDir = args[++i];
                    break;
                case "--dsh-pid":
                    if (i + 1 < args.Length && int.TryParse(args[++i], out var pid)) _dshPid = pid;
                    break;
                case "--instance-id":
                    if (i + 1 < args.Length) _instanceId = args[++i];
                    break;
                case "--allow-injected":
                    _allowInjected = true;
                    break;
                case "--diag-target":
                    _diagTarget = true;
                    break;
            }
        }
        if (string.IsNullOrEmpty(_instanceId))
            _instanceId = Guid.NewGuid().ToString("N");
    }

    // ── 触发调度 ─────────────────────────────────────────────────────────

    private static void OnTriggered(CaptureTrigger trigger)
    {
        // Hook 回调只投递队列；工作线程异步处理（零 I/O 约束）
        _inbox.TryWrite(trigger.ToJson());
    }

    private static void WorkerLoop()
    {
        foreach (var item in _inbox.ReadAll(_cts.Token))
        {
            try
            {
                var trigger = JsonSerializer.Deserialize<CaptureTriggerJson>(item)!;
                HandleTrigger(trigger);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("worker error: " + ex);
            }
        }
    }

    private static void HandleTrigger(CaptureTriggerJson trigger)
    {
        // 1. 先同步隐藏所有活动通知
        NoActivateToast.HideAll();

        // 2. 目标锁定（触发瞬间坐标）
        var resolve = TargetWindowFinder.Resolve(trigger.X, trigger.Y, _dshPid);
        if (resolve.Window is null)
        {
            // 测试模式：resolve 失败仍输出 capture/request 诊断帧（仅 --diag-target）
            if (_diagTarget)
            {
                SendFrame(new { type = "capture/request", captureId = Guid.NewGuid().ToString("D"), timestamp = trigger.TimestampMs });
                return;
            }
            ShowLocalFailure(resolve.Error);
            return;
        }
        var target = resolve.Window;

        // 3. 阶段 1：保存 visible backup（在 capture/request 前完成）
        IntPtr backupBmp = ScreenCapturer.CaptureScreenRegion(target.Bounds);
        if (backupBmp == IntPtr.Zero)
        {
            ShowLocalFailure(TargetError.NoTargetWindow);
            return;
        }

        var captureId = Guid.NewGuid().ToString("D");
        try
        {
            // 4. 发送 capture/request，等待接受（1000ms）
            SendFrame(new
            {
                type = "capture/request",
                captureId,
                timestamp = trigger.TimestampMs,
            });

            // 5. 等待接受：读取 stdin 中的 status 帧（简化：同步等待 1s）
            //    实际接受确认由 Node 侧 status IN_FLIGHT 帧驱动；
            //    这里先按 1s 窗口接收，超时释放 backup。
            bool accepted = WaitForAcceptance(captureId, 1000);
            if (!accepted)
            {
                // BUSY / NO_CLIENT / 超时：释放 backup，不置前不编码
                NativeMethods.DeleteObject(backupBmp);
                ShowLocalFailure(TargetError.NoTargetWindow);
                return;
            }

            // 6. 两阶段截图（backup 已在阶段 1；置前成功后重截）
            var result = ScreenCapturer.CaptureAsync(
                target.Hwnd, target.Bounds, _cts.Token,
                attemptBringToFront: true,
                bringToFrontHook: (_) => { }).GetAwaiter().GetResult();

            if (result == null)
            {
                NativeMethods.DeleteObject(backupBmp);
                return; // 已取消
            }

            // 7. PNG 原子落盘：<uuid>.partial → <uuid>.png
            string finalPath = Path.Combine(_stagingDir, captureId + ".png");
            WritePngAtomically(finalPath, result.PngBytes);

            // 8. 发送 appshot 帧
            SendFrame(new
            {
                type = "appshot",
                captureId,
                platform = "win32",
                appName = GetProcessName(target.ProcessId),
                windowTitle = target.WindowTitle,
                width = result.Width,
                height = result.Height,
                mimeType = "image/png",
                imagePath = finalPath,
                isFallback = result.IsFallback,
                fallbackReason = result.FallbackReason,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }
        finally
        {
            NativeMethods.DeleteObject(backupBmp);
        }
    }

    private static bool WaitForAcceptance(string captureId, int timeoutMs)
    {
        // 简化实现：等待 stdin 中的 status IN_FLIGHT 帧（由 InputLoop 投递）
        // 使用 ManualResetEvent 由 InputLoop 触发。
        return AcceptanceGate.Wait(captureId, timeoutMs);
    }

    private static void ShowLocalFailure(TargetError error)
    {
        string text = error switch
        {
            TargetError.NoTargetWindow => "截图失败：未识别到目标窗口",
            TargetError.DshWindow => "截图失败：目标为 DSH 自身窗口",
            TargetError.Desktop => "截图失败：目标为桌面",
            TargetError.Taskbar => "截图失败：目标为任务栏",
            TargetError.Cloaked => "截图失败：目标窗口不可见",
            TargetError.Minimized => "截图失败：目标窗口已最小化",
            TargetError.AcrossMonitors => "截图失败：目标窗口跨越多个显示器，请移至单屏后重试",
            _ => "截图失败",
        };
        ShowToast(text, isError: true);
    }

    private static void ShowToast(string text, bool isError)
    {
        try
        {
            var toast = new NoActivateToast(text);
            // 定位到主显示器工作区右下角
            var wa = GetWorkArea();
            int w = Math.Min(420, wa.Right - wa.Left - 40);
            int h = 48;
            int x = wa.Right - w - 20;
            int y = wa.Bottom - h - 20;
            toast.Show(x, y, w, h);
        }
        catch
        {
            // 通知失败不影响主流程
        }
    }

    private static (int Left, int Top, int Right, int Bottom) GetWorkArea()
    {
        // 通过 Capture.TargetWindowFinder 暴露的工作区查询（避免跨命名空间 Native 方法）
        var work = AppshotWin.Capture.TargetWindowFinder.GetPrimaryWorkArea();
        return (work.Left, work.Top, work.Right, work.Bottom);
    }

    private static string GetProcessName(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.ProcessName + ".exe";
        }
        catch
        {
            return "unknown.exe";
        }
    }

    private static void WritePngAtomically(string finalPath, byte[] bytes)
    {
        Directory.CreateDirectory(_stagingDir);
        string partial = finalPath + ".partial";
        File.WriteAllBytes(partial, bytes);
        // MoveFileEx 原子重命名（覆盖已存在）
        if (!NativeMethods.MoveFileEx(partial, finalPath,
                NativeMethods.MOVEFILE_REPLACE_EXISTING | NativeMethods.MOVEFILE_WRITE_THROUGH))
        {
            File.Delete(partial);
            throw new InvalidOperationException("atomic rename failed: " + Marshal.GetLastWin32Error());
        }
    }

    // ── IPC 输出 / 输入 ──────────────────────────────────────────────────

    private static void SendFrame(object frame)
    {
        _outbox.TryWrite(JsonSerializer.Serialize(frame));
    }

    private static void OutputLoop()
    {
        using var stdout = Console.OpenStandardOutput();
        foreach (var line in _outbox.ReadAll())
        {
            var bytes = Encoding.UTF8.GetBytes(line + System.Environment.NewLine);
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
    }

    private static void InputLoop()
    {
        using var stdin = Console.OpenStandardInput();
        var buffer = new byte[4096];
        var pending = new StringBuilder();
        int read;
        while (!_shutdown && (read = stdin.Read(buffer, 0, buffer.Length)) > 0)
        {
            pending.Append(Encoding.UTF8.GetString(buffer, 0, read));
            while (true)
            {
                int nl = pending.ToString().IndexOf('\n');
                if (nl < 0) break;
                string line = pending.ToString(0, nl).Trim();
                pending.Remove(0, nl + 1);
                if (line.Length == 0) continue;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    string type = root.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
                    switch (type)
                    {
                        case "status":
                            HandleStatusFrame(root);
                            break;
                        case "cancel":
                            HandleCancelFrame(root);
                            break;
                        case "shutdown":
                            _shutdown = true;
                            RequestExit();
                            break;
                    }
                }
                catch
                {
                    // 忽略坏帧
                }
            }
        }
    }

    private static void RequestExit()
    {
        // 投递 WM_QUIT 唤醒主线程 GetMessage 泵
        NativeMethods.PostThreadMessage(
            _mainThreadId, 0x0012 /* WM_QUIT */, IntPtr.Zero, IntPtr.Zero);
    }

    private static void HandleStatusFrame(JsonElement root)
    {
        if (!root.TryGetProperty("captureId", out var idEl)) return;
        string captureId = idEl.GetString() ?? "";
        string state = root.TryGetProperty("state", out var s) ? s.GetString() ?? "" : "";
        if (state == "IN_FLIGHT") AcceptanceGate.Accept(captureId);
        else if (state is "BUSY" or "NO_CLIENT") AcceptanceGate.Reject(captureId);
    }

    private static void HandleCancelFrame(JsonElement root)
    {
        _cts.Cancel();
    }
}

/// <summary>工作线程通道（简化阻塞集合）。</summary>
internal sealed class Channel<T>
{
    private readonly System.Collections.Concurrent.ConcurrentQueue<T> _queue = new();
    private readonly SemaphoreSlim _sem = new(0);

    public bool TryWrite(T item)
    {
        _queue.Enqueue(item);
        _sem.Release();
        return true;
    }

    public IEnumerable<T> ReadAll(CancellationToken token = default)
    {
        while (true)
        {
            _sem.Wait(token);
            if (_queue.TryDequeue(out var item)) yield return item;
        }
    }
}

/// <summary>capture/request 接受门（由 status 帧驱动）。</summary>
internal static class AcceptanceGate
{
    private static readonly Dictionary<string, TaskCompletionSource<bool>> _pending = new();
    private static readonly object _lock = new();

    public static bool Wait(string captureId, int timeoutMs)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_lock)
        {
            _pending[captureId] = tcs;
        }
        bool result = Task.WhenAny(tcs.Task, Task.Delay(timeoutMs)).GetAwaiter().GetResult() == tcs.Task
            ? tcs.Task.Result
            : false;
        lock (_lock) _pending.Remove(captureId);
        return result;
    }

    public static void Accept(string captureId)
    {
        lock (_lock)
        {
            if (_pending.TryGetValue(captureId, out var tcs)) tcs.TrySetResult(true);
        }
    }

    public static void Reject(string captureId)
    {
        lock (_lock)
        {
            if (_pending.TryGetValue(captureId, out var tcs)) tcs.TrySetResult(false);
        }
    }
}

internal sealed class CaptureTriggerJson
{
    public long TimestampMs { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
}

internal static partial class NativeMethods
{
    internal const int MONITOR_DEFAULTTOPRIMARY = 1;
    internal const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
    internal const uint MOVEFILE_WRITE_THROUGH = 0x00000008;

    [DllImport("user32.dll")]
    internal static extern int SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    internal static extern uint MsgWaitForMultipleObjectsEx(uint nCount, IntPtr pHandles,
        uint dwMilliseconds, uint dwWakeMask, uint dwFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PeekMessage(out NativeMsg lpMsg, IntPtr hWnd,
        uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    internal static extern int GetMessage(out NativeMsg lpMsg, IntPtr hWnd,
        uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PostThreadMessage(uint idThread, uint msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TranslateMessage(ref NativeMsg lpMsg);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage(ref NativeMsg lpMsg);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, uint dwFlags);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteObject(IntPtr hObject);

    internal static void PumpMessages()
    {
        NativeMsg msg;
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 0x0001 /* PM_REMOVE */))
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct NativeMsg
{
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public NativePoint pt;
}

[StructLayout(LayoutKind.Sequential)]
internal struct NativeMonitorInfo
{
    public int cbSize;
    public NativeRect rcMonitor;
    public NativeRect rcWork;
    public uint dwFlags;
}

[StructLayout(LayoutKind.Sequential)]
internal struct NativeRect
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
