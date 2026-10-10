#!/usr/bin/env sh
# 兼容旧入口：必须指定已发布标签；仅检出源码，不安装依赖或重启服务。
# 用法：bash scripts/cloud-pull.sh v1.6.1
set -eu
cd "$(dirname "$0")/.."
exec node scripts/checkout-release.mjs "$@"
