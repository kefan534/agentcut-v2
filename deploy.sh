#!/usr/bin/env bash
set -euo pipefail

# AgentCut v2 一键部署脚本
# 用法：
#   SERVER_PASS='a65107107Q@' ./deploy.sh
# 或：
#   ./deploy.sh       # 会提示输入服务器 root 密码
#
# 功能：
# 1. 将本地修改 commit + push 到 GitHub main
# 2. SSH 到服务器 pull 最新代码
# 3. 重新安装前端依赖并构建
# 4. 重载 nginx、重启后端

SERVER_IP="${SERVER_IP:-159.75.164.31}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PASS="${SERVER_PASS:-}"
REPO_DIR="/opt/agentcut-v2"

if ! command -v sshpass >/dev/null 2>&1; then
    echo "错误：需要先安装 sshpass（macOS: brew install sshpass）"
    exit 1
fi

if [ -z "$SERVER_PASS" ]; then
    printf "请输入服务器 root 密码："
    read -rs SERVER_PASS
    echo
fi

# 1. 本地提交并推送
echo "=== 本地提交并推送到 GitHub ==="
cd "$(dirname "$0")"
if [ -n "$(git status --short)" ]; then
    git add -A
    git commit -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')" || true
fi
git push origin main

# 2. 服务器端拉取、构建、重启
echo "=== 服务器拉取最新代码 ==="
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" "
set -e
cd ${REPO_DIR}
git pull origin main

echo '=== 构建前端 ==='
cd ${REPO_DIR}/web
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
VITE_BACKEND_URL=http://${SERVER_IP} npm run build

echo '=== 重载 nginx ==='
nginx -t && systemctl reload nginx

echo '=== 重启后端 ==='
systemctl restart agentcut-backend
sleep 2
systemctl status agentcut-backend --no-pager -n 3

echo '=== 部署完成 ==='
echo '访问地址：http://${SERVER_IP}'
"
