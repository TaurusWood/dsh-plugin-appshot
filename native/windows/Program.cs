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
    private static readonly CancellationTokenSource _appCts = new();
    private static CancellationTokenSource? _activeCaptureCts;
    private static int _dshPid;
    private static string _stagingDir = "";
    private static string _instanceId = "";
    private static bool _allowInjected;
    private static bool _diagTarget;
    private static volatile bool _soundEnabled = true;
    private static volatile bool _animationEnabled = true;
    private static uint _mainThreadId;

    [STAThread]
    private static int Main(string[] args)
    {
        _mainThreadId = NativeMethods.GetCurrentThreadId();

        // 1. 全局未捕获异常兜底（防止子线程异常导致 CLR 无声闪退）
        AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
        {
            var exStr = e.ExceptionObject?.ToString() ?? "Unknown unhandled exception";
            LogFatal("UNHANDLED_EXCEPTION", exStr);
        };
        TaskScheduler.UnobservedTaskException += (sender, e) =>
        {
            var exStr = e.Exception?.ToString() ?? "Unknown unobserved task exception";
            LogFatal("UNOBSERVED_TASK_EXCEPTION", exStr);
            e.SetObserved();
        };

        try
        {
            WriteDiagLog($"main-entry args=[{string.Join(" ", args)}]");

            // 2. Per-Monitor V2 DPI 感知（manifest 声明 + 运行时兜底）
            try
            {
                NativeMethods.SetProcessDpiAwarenessContext(
                    new IntPtr(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2));
            }
            catch (Exception dpiEx)
            {
                WriteDiagLog($"SetProcessDpiAwarenessContext non-fatal: {dpiEx.Message}");
            }

            // 3. 解析启动参数
            ParseArgs(args);
            WriteDiagLog($"after-parse stagingDir='{_stagingDir}' dshPid={_dshPid}");

            // 4. 注册通知窗口类
            NoActivateToast.RegisterClass();

            // 5. 启动输出线程（stdout NDJSON）
            var outThread = new Thread(OutputLoop) { IsBackground = true };
            outThread.Start();

            // 6. 启动输入线程（stdin NDJSON 指令：status/cancel/shutdown）
            var inThread = new Thread(InputLoop) { IsBackground = true };
            inThread.Start();

            // 7. 安装左右 Ctrl 钩子
            _hook = new DualCtrlHook(allowInjected: _allowInjected);
            _hook.Triggered += OnTriggered;
            if (_diagTarget)
            {
                _hook.AnyKey += (vk, injected) =>
                    SendFrame(new { type = "diag/key", vk, injected });
            }

            // 8. ready 握手
            SendFrame(new { type = "ready", version = 1, platform = "win32", pid = Environment.ProcessId });
            WriteDiagLog("ready-sent");

            // 9. 工作线程：消费触发队列，执行目标锁定 → capture/request → 截图 → appshot 帧
            var worker = new Thread(WorkerLoop) { IsBackground = true };
            worker.Start();

            // 10. 标准消息泵（钩子回调依赖消息循环）：GetMessage 阻塞取消息
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
            LogFatal("AGENT_INIT_FAILED", ex.ToString());
            return 1;
        }
        finally
        {
            _hook?.Dispose();
            _appCts.Cancel();
            WriteDiagLog("main-exit");
        }
        return 0;
    }

    private static void WriteDiagLog(string msg)
    {
        try
        {
            var line = $"[{DateTime.UtcNow:O}][pid:{Environment.ProcessId}] {msg}\n";
            var globalLog = Path.Combine(Path.GetTempPath(), "dsh-appshot-native.log");
            File.AppendAllText(globalLog, line);
            if (!string.IsNullOrEmpty(_stagingDir))
            {
                Directory.CreateDirectory(_stagingDir);
                File.AppendAllText(Path.Combine(_stagingDir, "started.txt"), line);
            }
        }
        catch { }
    }

    private static void LogFatal(string code, string message)
    {
        try
        {
            var line = $"[{DateTime.UtcNow:O}][pid:{Environment.ProcessId}] FATAL [{code}]: {message}\n";
            var globalLog = Path.Combine(Path.GetTempPath(), "dsh-appshot-native.log");
            File.AppendAllText(globalLog, line);
            var crashLog = Path.Combine(Path.GetTempPath(), "dsh-appshot-native-crash.log");
            File.AppendAllText(crashLog, line);
            if (!string.IsNullOrEmpty(_stagingDir))
            {
                Directory.CreateDirectory(_stagingDir);
                File.WriteAllText(Path.Combine(_stagingDir, "crash.txt"), line);
            }
        }
        catch { }

        // 同步直接写输出，不依赖可能已终止的后台线程
        try
        {
            var frame = JsonSerializer.Serialize(new { type = "fatal", code, message });
            var bytes = Encoding.UTF8.GetBytes(frame + "\n");
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
        catch { }

        try
        {
            Console.Error.WriteLine($"appshot-win-x64 fatal: {code}: {message}");
            Console.Error.Flush();
        }
        catch { }
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
        try
        {
            foreach (var item in _inbox.ReadAll(_appCts.Token))
            {
                try
                {
                    var trigger = JsonSerializer.Deserialize<CaptureTriggerJson>(item)!;
                    HandleTrigger(trigger);
                }
                catch (Exception ex)
                {
                    WriteDiagLog($"worker handle error: {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // 正常取消退出，不作为未捕获异常崩溃
        }
        catch (Exception ex)
        {
            LogFatal("WORKER_FATAL", ex.ToString());
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
        using var captureCts = CancellationTokenSource.CreateLinkedTokenSource(_appCts.Token);
        _activeCaptureCts = captureCts;
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
                target.Hwnd, target.Bounds, captureCts.Token,
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

            // 落盘后用户反馈：快门音（防自截合同：仅在 PNG 已原子落盘后播放）
            if (_soundEnabled) UI.ShutterSound.Play();
            // 目标窗口边框闪烁 → 截图缩略图飞入任务栏 DSH 图标（内部先等闪烁结束）
            if (_animationEnabled)
            {
                UI.CaptureFlash.Show(target.Bounds);
                UI.CaptureFlyin.Show(result.PngBytes, target.Bounds);
            }
        }
        finally
        {
            _activeCaptureCts = null;
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
            int w = Math.Min(450, Math.Max(320, wa.Right - wa.Left - 40));
            int h = 48;
            int x = wa.Right - w - 24;
            int y = wa.Bottom - h - 24;
            toast.Show(x, y, w, h);
            WriteDiagLog($"toast-shown text='{text}' bounds=[{x},{y},{w},{h}]");
        }
        catch (Exception ex)
        {
            WriteDiagLog($"ShowToast error: {ex.Message}");
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
        try
        {
            using var stdout = Console.OpenStandardOutput();
            foreach (var line in _outbox.ReadAll(_appCts.Token))
            {
                var bytes = Encoding.UTF8.GetBytes(line + System.Environment.NewLine);
                stdout.Write(bytes, 0, bytes.Length);
                stdout.Flush();
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            WriteDiagLog($"OutputLoop error: {ex.Message}");
        }
    }

    private static void InputLoop()
    {
        try
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
                            case "config/update":
                                HandleConfigFrame(root);
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
        catch (Exception ex)
        {
            WriteDiagLog($"InputLoop error: {ex.Message}");
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
        try
        {
            _activeCaptureCts?.Cancel();
        }
        catch { }
    }

    private static void HandleConfigFrame(JsonElement root)
    {
        try
        {
            if (root.TryGetProperty("hotkeys", out var hk))
            {
                string left = hk.TryGetProperty("left", out var l) ? l.GetString() ?? "lctrl" : "lctrl";
                string right = hk.TryGetProperty("right", out var r) ? r.GetString() ?? "rctrl" : "rctrl";
                int lvk = ModifierToVk(left);
                int rvk = ModifierToVk(right);
                if (lvk != 0 && rvk != 0 && lvk != rvk)
                {
                    _hook?.UpdateKeys(lvk, rvk);
                    WriteDiagLog($"config hotkeys updated: {left}+{right}");
                }
                else
                {
                    WriteDiagLog($"config hotkeys rejected: left={left} right={right}");
                }
            }
            if (root.TryGetProperty("soundEnabled", out var s) &&
                (s.ValueKind == JsonValueKind.True || s.ValueKind == JsonValueKind.False))
            {
                _soundEnabled = s.GetBoolean();
            }
            if (root.TryGetProperty("animationEnabled", out var a) &&
                (a.ValueKind == JsonValueKind.True || a.ValueKind == JsonValueKind.False))
            {
                _animationEnabled = a.GetBoolean();
            }
        }
        catch (Exception ex)
        {
            WriteDiagLog($"config frame error: {ex.Message}");
        }
    }

    /// <summary>修饰键名 → 虚拟键码；池子限定 lctrl/rctrl/lalt/ralt（Shift/Win 系统副作用排除）。</summary>
    private static int ModifierToVk(string name) => name switch
    {
        "lctrl" => Hotkey.DualCtrlStateMachine.VK_LCONTROL,
        "rctrl" => Hotkey.DualCtrlStateMachine.VK_RCONTROL,
        "lalt" => Hotkey.DualCtrlStateMachine.VK_LALT,
        "ralt" => Hotkey.DualCtrlStateMachine.VK_RALT,
        _ => 0,
    };
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
