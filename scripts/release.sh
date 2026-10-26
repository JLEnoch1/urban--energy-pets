#!/usr/bin/env bash
# 一键出两个安装包并同步到官网目录
# 用法: bash scripts/release.sh [mac|win|all]
set -euo pipefail
cd "$(dirname "$0")/.."

WHAT="${1:-all}"
export CSC_IDENTITY_AUTO_DISCOVERY=false   # 未配置证书时不尝试签名

npm run icon
if [ "$WHAT" = "mac" ] || [ "$WHAT" = "all" ]; then
  npm run build:mac
fi
if [ "$WHAT" = "win" ] || [ "$WHAT" = "all" ]; then
  npm run build:win
fi
npm run site:sync
echo "✅ 完成,官网目录: site/"
