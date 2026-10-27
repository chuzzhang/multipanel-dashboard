#!/usr/bin/env bash
# MultiPanel 启动脚本（Linux / macOS）
# 用法：./start.sh   或   HOST=0.0.0.0 PORT=8787 ADMIN_PASSWORD=xxx ./start.sh
set -e
cd "$(dirname "$0")"

# 默认只监听本机，推荐前面挂 Nginx/Caddy 反代；要直接公网访问就改成 0.0.0.0
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"

# 首次启动如需预置管理员密码，取消下面注释并改成你的密码
# export ADMIN_PASSWORD="change-me-please"

echo "MultiPanel 已启动：http://${HOST}:${PORT}"
exec node server.js
