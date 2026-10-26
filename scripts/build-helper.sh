#!/usr/bin/env bash
# 编译 universal(arm64 + x86_64) 键位 helper,供 macOS 通用包使用
# 打包后 helper 由 extraResources 放进 Contents/Resources/native/
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="native/keytap.swift"
OUT="native/keytap"
SRC2="native/winlist.swift"
OUT2="native/winlist"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

swiftc -O -target arm64-apple-macos11 "$SRC" -o "$TMP/keytap-arm64"
swiftc -O -target x86_64-apple-macos11 "$SRC" -o "$TMP/keytap-x64"
lipo -create "$TMP/keytap-arm64" "$TMP/keytap-x64" -output "$OUT"
chmod +x "$OUT"
echo "helper → $OUT"
lipo -info "$OUT"

swiftc -O -target arm64-apple-macos11 "$SRC2" -o "$TMP/winlist-arm64"
swiftc -O -target x86_64-apple-macos11 "$SRC2" -o "$TMP/winlist-x64"
lipo -create "$TMP/winlist-arm64" "$TMP/winlist-x64" -output "$OUT2"
chmod +x "$OUT2"
echo "winlist → $OUT2"
lipo -info "$OUT2"
