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

echo "[build-app] 1. Preparing build directories..."
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"

echo "[build-app] 2. Building SwiftPM release product..."
# Package.swift 是 macOS deployment target 的唯一编译配置来源。
# 不直接调用 swiftc，避免发布二进制继承打包机器的默认 deployment target。
swift build --package-path "${ROOT_DIR}" --configuration release --product appshot-macos
BIN_DIR="$(swift build --package-path "${ROOT_DIR}" --configuration release --show-bin-path)"
cp "${BIN_DIR}/appshot-macos" "${MACOS_DIR}/appshot-macos"
chmod 755 "${MACOS_DIR}/appshot-macos"

echo "[build-app] 3. Copying Resources..."
cp "${ROOT_DIR}/Resources/Info.plist" "${CONTENTS_DIR}/Info.plist"
cp "${ROOT_DIR}/Resources/shutter.wav" "${RESOURCES_DIR}/shutter.wav" 2>/dev/null || true

echo "[build-app] 4. Verifying binary deployment target..."
BUNDLE_MINIMUM_OS_VERSION="$(plutil -extract LSMinimumSystemVersion raw -o - "${CONTENTS_DIR}/Info.plist")"
BINARY_MINIMUM_OS_VERSION="$(otool -l "${MACOS_DIR}/appshot-macos" | awk '
  $1 == "cmd" && $2 == "LC_BUILD_VERSION" { in_build_version = 1; next }
  in_build_version && $1 == "minos" { print $2; exit }
')"
if [[ -z "${BINARY_MINIMUM_OS_VERSION}" ]]; then
    echo "[build-app] error: appshot-macos has no LC_BUILD_VERSION minos value" >&2
    exit 1
fi
if [[ "${BINARY_MINIMUM_OS_VERSION}" != "${BUNDLE_MINIMUM_OS_VERSION}" ]]; then
    echo "[build-app] error: binary minos ${BINARY_MINIMUM_OS_VERSION} does not match Info.plist LSMinimumSystemVersion ${BUNDLE_MINIMUM_OS_VERSION}" >&2
    exit 1
fi
echo "[build-app] verified minimum macOS version: ${BINARY_MINIMUM_OS_VERSION}"

echo "[build-app] 5. Code signing App Bundle..."
codesign --force --deep --sign - "${APP_BUNDLE}"

# 同时同步根目录可执行文件以便 CLI 调试
cp "${MACOS_DIR}/appshot-macos" "${ROOT_DIR}/appshot-macos"

echo "[build-app] 6. Verifying Code Signature..."
codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}"

echo "[build-app] Successfully built: ${APP_BUNDLE}"
