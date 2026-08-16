import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

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

    // 先截后唤硬约束：落盘后激活目标 DSH App（置顶聚焦）
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

// MARK: - 双 Command 状态机 (DoubleCommandMonitor)

final class DoubleCommandMonitor {
    enum State {
        case idle
        case leftDown
        case rightDown
        case triggered
    }

    private var state: State = .idle
    private var isCapturing = false
    private var lastTriggerTime: TimeInterval = 0
    private let cooldownDuration: TimeInterval = 1.0 // 1 秒触发冷却防抖
    private let onTrigger: () -> Void

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
        // macOS device-dependent modifier masks:
        // NX_DEVICELCMDKEYMASK = 0x00000008 (bit 3: Left Command)
        // NX_DEVICERCMDKEYMASK = 0x00000010 (bit 4: Right Command)
        let raw = event.modifierFlags.rawValue
        let isLeftDown = (raw & 0x08) != 0
        let isRightDown = (raw & 0x10) != 0

        switch state {
        case .idle:
            if isLeftDown && isRightDown {
                state = .triggered
                tryTrigger()
            } else if isLeftDown {
                state = .leftDown
            } else if isRightDown {
                state = .rightDown
            }
        case .leftDown:
            if isLeftDown && isRightDown {
                state = .triggered
                tryTrigger()
            } else if !isLeftDown {
                state = isRightDown ? .rightDown : .idle
            }
        case .rightDown:
            if isLeftDown && isRightDown {
                state = .triggered
                tryTrigger()
            } else if !isRightDown {
                state = isLeftDown ? .leftDown : .idle
            }
        case .triggered:
            // 脱离双按状态后，才能重新装填 (re-arm) 状态机
            if !isLeftDown && !isRightDown {
                state = .idle
            } else if isLeftDown && !isRightDown {
                state = .leftDown
            } else if !isLeftDown && isRightDown {
                state = .rightDown
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
              --daemon               Run as persistent background agent with double-Command monitor
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

            let monitor = DoubleCommandMonitor {
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
