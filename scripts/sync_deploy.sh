#!/usr/bin/env bash
# 把主仓库的代码与前端产物同步到部署目录，供 WorkBuddy「应用发布」使用。
#
# 用法：bash scripts/sync_deploy.sh [部署目录]
# 默认部署目录：与仓库同级的 llm-agent-live
#
# 只做本地同步，不触发生效。同步完成后到 WorkBuddy 会话里说「发布」，
# 由助理调用应用发布（固定参数见 docs/部署.md）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$(cd "$REPO/.." && pwd)/llm-agent-live}"

[ -d "$DEST" ] || { echo "✗ 部署目录不存在：$DEST" >&2; exit 1; }

echo "==> 1/4 构建前端"
(cd "$REPO/frontend" && npm run build)

echo "==> 2/4 同步后端代码（backend/app → app）"
rm -rf "$DEST/app"
cp -R "$REPO/backend/app" "$DEST/app"
find "$DEST/app" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

echo "==> 3/4 同步前端产物 / 依赖清单 / 示例知识库"
rm -rf "$DEST/static"
cp -R "$REPO/frontend/dist" "$DEST/static"
cp "$REPO/backend/requirements.txt" "$DEST/requirements.txt"
# 只同步示例文档：排除本地上传内容（可能含真实资料）与系统垃圾文件
rsync -a --delete --exclude '.DS_Store' --exclude 'uploads/' \
  "$REPO/backend/knowledge/" "$DEST/knowledge/"

echo "==> 4/4 自检"
bad="$(find "$DEST" -type f \( -name '*.pyc' -o -name '*.sqlite*' -o -name '.env*' \
  -o -name 'runtime_config.json' -o -name '*.map' \) -print)"
if [ -n "$bad" ]; then
  echo "✗ 含不该发布的内容：" >&2
  echo "$bad" >&2
  exit 1
fi

missing=""
for asset in $(grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' "$DEST/static/index.html" | sort -u); do
  [ -f "$DEST/static/$asset" ] || missing="$missing $asset"
done
if [ -n "$missing" ]; then
  echo "✗ index.html 引用了缺失资源：$missing" >&2
  exit 1
fi

diff -r -x '__pycache__' "$REPO/backend/app" "$DEST/app" >/dev/null \
  || { echo "✗ app 与主仓库不一致" >&2; exit 1; }
diff "$REPO/backend/requirements.txt" "$DEST/requirements.txt" >/dev/null \
  || { echo "✗ requirements.txt 不一致" >&2; exit 1; }

echo
echo "✓ 同步完成：$DEST"
echo "  文件数 $(find "$DEST" -type f | wc -l | tr -d ' ')"
echo "  下一步：在 WorkBuddy 会话里说「发布」"
