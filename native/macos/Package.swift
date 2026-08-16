// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AppshotNative",
    platforms: [
        // SCScreenshotManager（含 captureImage）在 CommandLineTools SDK 中标注
        // API_AVAILABLE(macos(14.0))，最低版本必须为 14，否则编译失败。
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "appshot-macos",
            path: "Sources"
        )
    ]
)
