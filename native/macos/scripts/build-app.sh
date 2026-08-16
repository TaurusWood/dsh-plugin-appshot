#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/.build"
APP_NAME="Appshot Agent.app"
APP_BUNDLE="${BUILD_DIR}/${APP_NAME}"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
CACHE_DIR="${BUILD_DIR}/cache"

echo "[build-app] 1. Preparing build directories..."
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}" "${CACHE_DIR}"

echo "[build-app] 2. Compiling Swift binary with swiftc..."
swiftc -O -parse-as-library \
    "${ROOT_DIR}/Sources/main.swift" \
    -o "${MACOS_DIR}/appshot-macos" \
    -framework ScreenCaptureKit \
    -framework AppKit \
    -framework CoreGraphics \
    -framework ImageIO \
    -framework UniformTypeIdentifiers \
    -module-cache-path "${CACHE_DIR}"

echo "[build-app] 3. Copying Info.plist..."
cp "${ROOT_DIR}/Resources/Info.plist" "${CONTENTS_DIR}/Info.plist"

echo "[build-app] 4. Code signing App Bundle..."
codesign --force --deep --sign - "${APP_BUNDLE}"

# 同时同步根目录可执行文件以便 CLI 调试
cp "${MACOS_DIR}/appshot-macos" "${ROOT_DIR}/appshot-macos"

echo "[build-app] 5. Verifying Code Signature..."
codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}"

echo "[build-app] Successfully built: ${APP_BUNDLE}"
