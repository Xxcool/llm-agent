#!/usr/bin/env bash
# 安全同步：仅打包应用代码、前端产物和公开示例，不删除目标运行数据。
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$REPO/output/workbuddy}"
(cd "$REPO/frontend" && npm run build)
python3 "$REPO/scripts/prepare_deploy.py" "$DEST" --target workbuddy
