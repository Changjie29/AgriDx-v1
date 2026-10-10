#!/usr/bin/env sh
# 兼容旧入口；提交需由开发者先完成，再推送当前工作分支。
set -eu
cd "$(dirname "$0")/.."
exec node scripts/sync.mjs "$@"
