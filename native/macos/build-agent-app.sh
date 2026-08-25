#!/usr/bin/env bash
# build-agent-app.sh — Agent.app 打包与签名（docs/tasks.md T2.1）
#
# 产物：native/macos/.build/Appshot Agent.app
#   - Info.plist 取自 Resources/Info.plist（版本控制）
#   - 可执行文件为 swift build 产物（--show-bin-path 自动适配 arch 目录）
#   - ad-hoc 签名（本地开发；发布时替换为稳定签名身份）
#
# 用法（在 native/macos 目录内执行）：./build-agent-app.sh
set -euo pipefail
cd "$(dirname "$0")"

APP=".build/Appshot Agent.app"

echo "==> swift build (debug)"
swift build

BIN="$(swift build --show-bin-path)/appshot-macos"
echo "==> binary: $BIN"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/shutter.wav "$APP/Contents/Resources/shutter.wav" 2>/dev/null || true
cp "$BIN" "$APP/Contents/MacOS/appshot-macos"

echo "==> codesign (ad-hoc)"
codesign --force --sign - "$APP"

echo "==> verify"
codesign --verify --strict "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E 'Identifier=|Signature=' || true
echo "OK: $APP"
