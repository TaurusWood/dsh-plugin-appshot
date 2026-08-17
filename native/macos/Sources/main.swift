import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import AudioToolbox

// MARK: - NDJSON 契约模型

struct AppshotReadyFrame: Encodable {
    let type: String = "ready"
    let version: Int = 1
    let pid: pid_t
    let bundleId: String
}

struct AppshotSuccessResult: Encodable {
    let type: String = "appshot"
    let ok: Bool = true
    let platform: String = "darwin"
    let appName: String
    let windowTitle: String?
    let windowId: CGWindowID
    let width: Int
    let height: Int
    let mimeType: String = "image/png"
    let imagePath: String
    let timestamp: Int64
}

struct AppshotErrorResult: Encodable {
    let type: String = "error"
    let ok: Bool = false
    let platform: String = "darwin"
    let code: String
    let message: String
}

struct WindowInfo: Encodable {
    let windowId: CGWindowID
    let appName: String
    let pid: pid_t
    let title: String?
    let frame: [String: Double]
    let isOnScreen: Bool
    let layer: Int

    enum CodingKeys: String, CodingKey {
        case windowId, appName, pid, title, frame, isOnScreen, layer
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(windowId, forKey: .windowId)
        try container.encode(appName, forKey: .appName)
        try container.encode(pid, forKey: .pid)
        if let title = title {
            try container.encode(title, forKey: .title)
        } else {
            try container.encodeNil(forKey: .title)
        }
        try container.encode(frame, forKey: .frame)
        try container.encode(isOnScreen, forKey: .isOnScreen)
        try container.encode(layer, forKey: .layer)
    }
}

// MARK: - 动态配置模型 (Inbound JSON)

struct ConfigPayload: Decodable {
    let shortcutMode: String?
    let soundEnabled: Bool?
    let animationEnabled: Bool?
}

struct InboundCommand: Decodable {
    let type: String
    let payload: ConfigPayload?
}

final class AppConfig {
    static let shared = AppConfig()

    var soundEnabled: Bool = true
    var animationEnabled: Bool = true
    var shortcutMode: String = "double-cmd" // "double-cmd", "double-option", "double-control", "cmd-option"

    private init() {}

    func update(with payload: ConfigPayload) {
        if let sound = payload.soundEnabled {
            self.soundEnabled = sound
        }
        if let anim = payload.animationEnabled {
            self.animationEnabled = anim
        }
        if let shortcut = payload.shortcutMode {
            self.shortcutMode = shortcut
        }
    }
}

func outputJSON<T: Encodable>(_ object: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(object),
       let jsonString = String(data: data, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

func outputError(code: String, message: String, exitCode: Int32 = 1) -> Never {
    outputJSON(AppshotErrorResult(code: code, message: message))
    exit(exitCode)
}

func checkScreenCapturePermission() -> Bool {
    if #available(macOS 10.15, *) {
        if CGPreflightScreenCaptureAccess() {
            return true
        }
        _ = CGRequestScreenCaptureAccess()
        return CGPreflightScreenCaptureAccess()
    }
    return true
}

func saveCGImageAsPNG(image: CGImage, destinationURL: URL) -> (Bool, String) {
    let parentDir = destinationURL.deletingLastPathComponent()
    do {
        try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true)
    } catch {
        return (false, "createDirectory failed: \(error.localizedDescription)")
    }

    let typeIdentifier = UTType.png.identifier as CFString
    if let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, typeIdentifier, 1, nil) {
        CGImageDestinationAddImage(destination, image, nil)
        if CGImageDestinationFinalize(destination) {
            return (true, "")
        }
    }

    let rep = NSBitmapImageRep(cgImage: image)
    rep.size = NSSize(width: image.width, height: image.height)
    if let pngData = rep.representation(using: .png, properties: [:]) {
        do {
            try pngData.write(to: destinationURL, options: .atomic)
            return (true, "")
        } catch {
            return (false, "pngData write failed: \(error.localizedDescription)")
        }
    }

    return (false, "Both CGImageDestination and NSBitmapImageRep failed for image \(image.width)x\(image.height)")
}

func fetchShareableContent() throws -> SCShareableContent {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<SCShareableContent, Error>?

    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
        if let error = error {
            result = .failure(error)
        } else if let content = content {
            result = .success(content)
        } else {
            result = .failure(NSError(domain: "Appshot", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown error fetching shareable content"]))
        }
        semaphore.signal()
    }

    _ = semaphore.wait(timeout: .distantFuture)
    return try result!.get()
}

func captureWindow(filter: SCContentFilter, config: SCStreamConfiguration) throws -> CGImage {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<CGImage, Error>?

    SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
        if let error = error {
            result = .failure(error)
        } else if let image = image {
            result = .success(image)
        } else {
            result = .failure(NSError(domain: "Appshot", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown error capturing screenshot"]))
        }
        semaphore.signal()
    }

    _ = semaphore.wait(timeout: .distantFuture)
    return try result!.get()
}

// MARK: - 音效与动画辅助

/// 持有正在播放的 NSSound 实例，防止 ARC 在播放完成前释放
private var _activeSoundRef: NSSound?

func playCaptureSound() {
    guard AppConfig.shared.soundEnabled else { return }
    DispatchQueue.main.async {
        // 1. 优先加载系统音效文件（Tink = 清脆短促，适合截图反馈）
        let systemSoundPath = "/System/Library/Sounds/Tink.aiff"
        if FileManager.default.fileExists(atPath: systemSoundPath),
           let sound = NSSound(contentsOfFile: systemSoundPath, byReference: true) {
            _activeSoundRef = sound
            sound.play()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                _activeSoundRef = nil
            }
            return
        }
        // 2. 回退到 NSSound named（Pop 在多数 macOS 版本存在）
        if let sound = NSSound(named: NSSound.Name("Pop")) {
            _activeSoundRef = sound
            sound.play()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                _activeSoundRef = nil
            }
            return
        }
        // 3. 最低限度兜底
        NSSound.beep()
    }
}

final class CaptureOverlayWindow: NSWindow {
    init(targetRect: CGRect) {
        super.init(
            contentRect: targetRect,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        self.level = .floating
        self.isOpaque = false
        self.hasShadow = false
        self.backgroundColor = NSColor.white.withAlphaComponent(0.4)
        self.ignoresMouseEvents = true
        self.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    }
}

/// 强引用正在执行动画的 overlay window，防止 ARC 在动画回调前释放导致 SIGSEGV
final class OverlayManager {
    static let shared = OverlayManager()
    private var activeOverlays: [CaptureOverlayWindow] = []
    private init() {}

    func track(_ overlay: CaptureOverlayWindow) {
        activeOverlays.append(overlay)
    }

    func release(_ overlay: CaptureOverlayWindow) {
        overlay.orderOut(nil)
        activeOverlays.removeAll { $0 === overlay }
    }
}

func showCaptureAnimation(for scFrame: CGRect) {
    guard AppConfig.shared.animationEnabled else { return }
    DispatchQueue.main.async {
        guard let mainScreen = NSScreen.main else { return }
        let primaryHeight = mainScreen.frame.height
        // ScreenCaptureKit (左上原点) -> Cocoa (左下原点)
        let cocoaY = primaryHeight - scFrame.origin.y - scFrame.size.height
        let targetRect = CGRect(x: scFrame.origin.x, y: cocoaY, width: scFrame.size.width, height: scFrame.size.height)

        let overlay = CaptureOverlayWindow(targetRect: targetRect)
        OverlayManager.shared.track(overlay)
        overlay.alphaValue = 0.0
        overlay.orderFrontRegardless()

        // Phase 1: 快速亮起白色闪光（60ms）
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.06
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            overlay.animator().alphaValue = 0.85
        }, completionHandler: {
            // Phase 2: 缓慢淡出（300ms）
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.3
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                overlay.animator().alphaValue = 0.0
            }, completionHandler: {
                OverlayManager.shared.release(overlay)
            })
        })
    }
}

@discardableResult
private func bringAppToFront(_ app: NSRunningApplication) -> Bool {
    if #available(macOS 14.0, *) {
        return app.activate()
    } else {
        return app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
    }
}

func activateApplication(bundleIdentifier: String? = nil, pid: pid_t? = nil) -> Bool {
    // 1. 优先根据 PID 激活 (直接激活拉起 Agent 的宿主进程)
    if let targetPid = pid, targetPid > 0 {
        if let app = NSRunningApplication(processIdentifier: targetPid) {
            if bringAppToFront(app) {
                return true
            }
        }
    }

    // 2. 根据候选 Bundle ID 激活
    let candidateBundleIds = [
        bundleIdentifier,
        "com.deepseek-harness.desktop",
        "com.deepseek.harness",
        "com.electron.deepseek-harness"
    ].compactMap { $0 }

    for bundleId in candidateBundleIds {
        let runningApps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        if let targetApp = runningApps.first {
            if bringAppToFront(targetApp) {
                return true
            }
        }
    }

    // 3. 按进程名称匹配 DeepSeek 相关应用
    for app in NSWorkspace.shared.runningApplications {
        if let name = app.localizedName, (name.localizedCaseInsensitiveContains("deepseek") || name.localizedCaseInsensitiveContains("dsh")) {
            if bringAppToFront(app) {
                return true
            }
        }
    }

    // 4. AppleScript 强力唤起置顶兜底
    if let bid = bundleIdentifier ?? candidateBundleIds.first {
        let scriptSource = "tell application id \"\(bid)\" to activate"
        if let script = NSAppleScript(source: scriptSource) {
            var errorDict: NSDictionary?
            script.executeAndReturnError(&errorDict)
            if errorDict == nil {
                return true
            }
        }
    }

    return false
}

// MARK: - 核心截图执行器

func performCapture(targetWindowId: UInt32? = nil, outputPath: String? = nil, activateAppId: String? = nil, activatePid: pid_t? = nil) -> AppshotSuccessResult? {
    guard checkScreenCapturePermission() else {
        outputJSON(AppshotErrorResult(code: "SCREEN_PERMISSION_DENIED", message: "Screen capture permission is required."))
        return nil
    }

    let content: SCShareableContent
    do {
        content = try fetchShareableContent()
    } catch {
        outputJSON(AppshotErrorResult(code: "SCREEN_CONTENT_FETCH_FAILED", message: "Failed to fetch shareable content: \(error.localizedDescription)"))
        return nil
    }

    var targetWindow: SCWindow? = nil
    var targetAppName = "Unknown"

    if let requestedId = targetWindowId {
        targetWindow = content.windows.first { $0.windowID == requestedId }
        if let window = targetWindow {
            targetAppName = window.owningApplication?.applicationName ?? "Unknown"
        } else {
            outputJSON(AppshotErrorResult(code: "WINDOW_NOT_FOUND", message: "Window with ID \(requestedId) not found."))
            return nil
        }
    } else {
        var targetAppPID: pid_t? = nil
        if let frontApp = NSWorkspace.shared.frontmostApplication {
            targetAppName = frontApp.localizedName ?? "Unknown"
            targetAppPID = frontApp.processIdentifier
        }

        var appWindows: [SCWindow] = []
        if let targetPID = targetAppPID {
            appWindows = content.windows.filter { win in
                guard let owner = win.owningApplication else { return false }
                return owner.processID == targetPID &&
                       win.isOnScreen &&
                       win.frame.width > 50 &&
                       win.frame.height > 50
            }
        }

        if appWindows.isEmpty {
            let topWindows = content.windows.filter { win in
                guard let owner = win.owningApplication else { return false }
                return owner.processID != ProcessInfo.processInfo.processIdentifier &&
                       win.isOnScreen &&
                       win.frame.width > 50 &&
                       win.frame.height > 50 &&
                       win.windowLayer == 0
            }
            if let firstTop = topWindows.first {
                targetWindow = firstTop
                targetAppName = firstTop.owningApplication?.applicationName ?? "Unknown"
            } else {
                outputJSON(AppshotErrorResult(code: "NO_FOREGROUND_WINDOW", message: "No capturable on-screen window found."))
                return nil
            }
        } else {
            let layerZeroWindows = appWindows.filter { $0.windowLayer == 0 }
            if let firstLayerZero = layerZeroWindows.first {
                targetWindow = firstLayerZero
            } else {
                targetWindow = appWindows.max { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) }
            }
        }
    }

    guard let window = targetWindow else {
        outputJSON(AppshotErrorResult(code: "NO_FOREGROUND_WINDOW", message: "Could not resolve a valid target window."))
        return nil
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.showsCursor = false
    config.scalesToFit = false
    config.width = Int(window.frame.width * 2)
    config.height = Int(window.frame.height * 2)

    let capturedImage: CGImage
    do {
        capturedImage = try captureWindow(filter: filter, config: config)
    } catch {
        outputJSON(AppshotErrorResult(code: "CAPTURE_FAILED", message: "ScreenCaptureKit captureImage failed: \(error.localizedDescription)"))
        return nil
    }

    let resolvedPath = outputPath ?? "/tmp/dsh-appshot-\(UUID().uuidString.prefix(8)).png"
    let destinationURL = URL(fileURLWithPath: resolvedPath)
    let (saved, saveErr) = saveCGImageAsPNG(image: capturedImage, destinationURL: destinationURL)
    guard saved else {
        outputJSON(AppshotErrorResult(code: "FILE_SAVE_FAILED", message: "Failed to write PNG image to \(resolvedPath): \(saveErr)"))
        return nil
    }

    // 先截后唤与视觉/音效反馈（严格在落盘后触发，保障防自截）
    playCaptureSound()
    showCaptureAnimation(for: window.frame)
    _ = activateApplication(bundleIdentifier: activateAppId, pid: activatePid)

    let result = AppshotSuccessResult(
        appName: targetAppName,
        windowTitle: window.title,
        windowId: window.windowID,
        width: capturedImage.width,
        height: capturedImage.height,
        imagePath: resolvedPath,
        timestamp: Int64(Date().timeIntervalSince1970 * 1000)
    )

    return result
}

// MARK: - 可配置快捷键状态机 (ConfigurableShortcutMonitor)

final class ConfigurableShortcutMonitor {
    private var isCapturing = false
    private var lastTriggerTime: TimeInterval = 0
    private let cooldownDuration: TimeInterval = 1.0 // 1 秒触发冷却防抖
    private let onTrigger: () -> Void

    // 双击连击检测
    private var lastModifierPressTime: TimeInterval = 0
    private var lastModifierType: String = ""
    private var previousFlags: NSEvent.ModifierFlags = []

    init(onTrigger: @escaping () -> Void) {
        self.onTrigger = onTrigger
    }

    private func tryTrigger() {
        let now = Date().timeIntervalSince1970
        guard !isCapturing && (now - lastTriggerTime >= cooldownDuration) else {
            return
        }
        lastTriggerTime = now
        isCapturing = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer { self?.isCapturing = false }
            self?.onTrigger()
        }
    }

    func handleFlagsChanged(event: NSEvent) {
        let flags = event.modifierFlags
        let raw = flags.rawValue
        let now = Date().timeIntervalSince1970
        let mode = AppConfig.shared.shortcutMode

        // 提取左右具体键位（利用 macOS raw 掩码）
        // NX_DEVICELCMDKEYMASK = 0x08, NX_DEVICERCMDKEYMASK = 0x10
        // NX_DEVICELALTKEYMASK = 0x20, NX_DEVICERALTKEYMASK = 0x40
        let isLeftCmd = (raw & 0x08) != 0
        let isRightCmd = (raw & 0x10) != 0
        let isLeftOpt = (raw & 0x20) != 0
        let isRightOpt = (raw & 0x40) != 0
        let isCmd = flags.contains(.command)
        let isOpt = flags.contains(.option)
        let isCtrl = flags.contains(.control)

        switch mode {
        case "double-cmd":
            // 左右 Cmd 同时按
            if isLeftCmd && isRightCmd {
                tryTrigger()
                previousFlags = flags
                return
            }
            // 或单 Cmd 快速双击 (Double Tap within 350ms)
            if isCmd && !previousFlags.contains(.command) {
                if lastModifierType == "cmd" && (now - lastModifierPressTime < 0.35) {
                    tryTrigger()
                    lastModifierPressTime = 0
                } else {
                    lastModifierPressTime = now
                    lastModifierType = "cmd"
                }
            }

        case "double-option":
            if isLeftOpt && isRightOpt {
                tryTrigger()
                previousFlags = flags
                return
            }
            if isOpt && !previousFlags.contains(.option) {
                if lastModifierType == "opt" && (now - lastModifierPressTime < 0.35) {
                    tryTrigger()
                    lastModifierPressTime = 0
                } else {
                    lastModifierPressTime = now
                    lastModifierType = "opt"
                }
            }

        case "double-control":
            if isCtrl && !previousFlags.contains(.control) {
                if lastModifierType == "ctrl" && (now - lastModifierPressTime < 0.35) {
                    tryTrigger()
                    lastModifierPressTime = 0
                } else {
                    lastModifierPressTime = now
                    lastModifierType = "ctrl"
                }
            }

        case "cmd-option":
            if isCmd && isOpt {
                tryTrigger()
                previousFlags = flags
                return
            }

        default:
            if (isLeftCmd && isRightCmd) || (isCmd && !previousFlags.contains(.command) && lastModifierType == "cmd" && (now - lastModifierPressTime < 0.35)) {
                tryTrigger()
            }
        }

        previousFlags = flags
    }
}

// MARK: - Stdin 监听器

func startStdinListener() {
    DispatchQueue.global(qos: .utility).async {
        let input = FileHandle.standardInput
        while true {
            let data = input.availableData
            guard !data.isEmpty else { break }
            guard let text = String(data: data, encoding: .utf8) else { continue }
            let lines = text.split(separator: "\n")
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }
                if let lineData = trimmed.data(using: .utf8),
                   let cmd = try? JSONDecoder().decode(InboundCommand.self, from: lineData) {
                    if cmd.type == "config/update", let payload = cmd.payload {
                        // 派发到主线程更新配置，避免与 NSEvent monitor 回调的并发竞态
                        DispatchQueue.main.async {
                            AppConfig.shared.update(with: payload)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Main 入口

@main
struct AppshotCLI {
    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        let args = CommandLine.arguments

        if args.contains("--help") || args.contains("-h") {
            print("""
            Usage: appshot-macos [options]
            Options:
              --cli-capture          Capture the current frontmost window (default)
              --daemon               Run as persistent background agent with configurable shortcut monitor
              --window-id <id>       Capture specific window by ID
              --list-windows         List all on-screen capturable windows
              --output <path>        Custom output PNG file path
              --activate-app <id>    Activate target application bundle ID after capture
              --help                 Show this help message
            """)
            exit(0)
        }

        // 诊断模式：列出窗口
        if args.contains("--list-windows") {
            guard checkScreenCapturePermission() else {
                outputError(code: "SCREEN_PERMISSION_DENIED", message: "Screen capture permission is required.")
            }
            do {
                let content = try fetchShareableContent()
                let windowsInfo = content.windows.map { win in
                    WindowInfo(
                        windowId: win.windowID,
                        appName: win.owningApplication?.applicationName ?? "Unknown",
                        pid: win.owningApplication?.processID ?? 0,
                        title: win.title,
                        frame: ["x": win.frame.origin.x, "y": win.frame.origin.y, "width": win.frame.size.width, "height": win.frame.size.height],
                        isOnScreen: win.isOnScreen,
                        layer: win.windowLayer
                    )
                }
                outputJSON(windowsInfo)
                exit(0)
            } catch {
                outputError(code: "SCREEN_CONTENT_FETCH_FAILED", message: "Failed to fetch shareable content: \(error.localizedDescription)")
            }
        }

        // DAEMON 模式（Phase 3 / 生产常驻模式）
        if args.contains("--daemon") {
            let pid = ProcessInfo.processInfo.processIdentifier
            let bundleId = Bundle.main.bundleIdentifier ?? "com.deepseek-harness.appshot-agent"
            outputJSON(AppshotReadyFrame(pid: pid, bundleId: bundleId))

            var targetActivateApp: String? = "com.deepseek-harness.desktop"
            if let actIndex = args.firstIndex(of: "--activate-app"), actIndex + 1 < args.count {
                targetActivateApp = args[actIndex + 1]
            }

            var targetActivatePid: pid_t? = nil
            if let pidIndex = args.firstIndex(of: "--activate-pid"), pidIndex + 1 < args.count {
                targetActivatePid = pid_t(args[pidIndex + 1])
            }

            let monitor = ConfigurableShortcutMonitor {
                if let result = performCapture(activateAppId: targetActivateApp, activatePid: targetActivatePid) {
                    outputJSON(result)
                }
            }

            NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
                monitor.handleFlagsChanged(event: event)
            }

            NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
                monitor.handleFlagsChanged(event: event)
                return event
            }

            // 启动 stdin NDJSON 指令监听
            startStdinListener()

            NSApp.run()
            exit(0)
        }

        // CLI 单次模式（Phase 1~2 / 诊断测试）
        var targetWindowId: UInt32? = nil
        if let idIndex = args.firstIndex(of: "--window-id"), idIndex + 1 < args.count {
            targetWindowId = UInt32(args[idIndex + 1])
        }

        var outputPath: String? = nil
        if let outIndex = args.firstIndex(of: "--output"), outIndex + 1 < args.count {
            outputPath = args[outIndex + 1]
        }

        var activateAppId: String? = nil
        if let actIndex = args.firstIndex(of: "--activate-app"), actIndex + 1 < args.count {
            activateAppId = args[actIndex + 1]
        }

        var activatePid: pid_t? = nil
        if let pidIndex = args.firstIndex(of: "--activate-pid"), pidIndex + 1 < args.count {
            activatePid = pid_t(args[pidIndex + 1])
        }

        if let result = performCapture(targetWindowId: targetWindowId, outputPath: outputPath, activateAppId: activateAppId, activatePid: activatePid) {
            outputJSON(result)
            exit(0)
        } else {
            exit(1)
        }
    }
}
