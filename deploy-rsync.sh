#!/usr/bin/env bash
set -euo pipefail

# AgentCut v2 一键同步脚本（不依赖 GitHub，直接用 rsync 走 SSH）
# 用法：
#   SERVER_PASS='a65107107Q@' ./deploy-rsync.sh
# 或交互输入密码。

SERVER_IP="${SERVER_IP:-159.75.164.31}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PASS="${SERVER_PASS:-}"
LOCAL_DIR="/Users/macminim4/WorkBuddy/2026-07-24-10-48-29/agentcut-v2"
REMOTE_DIR="/opt/agentcut-v2"

if ! command -v rsync >/dev/null 2>&1; then
    echo "错误：需要先安装 rsync"
    exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
    echo "错误：需要先安装 sshpass（macOS: brew install sshpass）"
    exit 1
fi

if [ -z "$SERVER_PASS" ]; then
    printf "请输入服务器 root 密码："
    read -rs SERVER_PASS
    echo
fi

# 1. 本地提交并推送（保留 git 历史）
echo "=== 本地提交并推送到 GitHub ==="
cd "$LOCAL_DIR"
if [ -n "$(git status --short)" ]; then
    git add -A
    git commit -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')" || true
    git push origin main || echo "警告：推送到 GitHub 失败，继续用 rsync 同步"
fi

# 2. 用 rsync 同步代码到服务器（排除不需要覆盖的目录）
echo "=== 用 rsync 同步本地代码到服务器 ==="
sshpass -p "$SERVER_PASS" rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='web/dist' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.env' \
    --exclude='uploads' \
    --exclude='backups/' \
    "$LOCAL_DIR/" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"

# 3. 服务器端构建并重启
echo "=== 服务器端构建并重启服务 ==="
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" "
set -e
cd ${REMOTE_DIR}/web
rm -rf node_modules package-lock.json dist
npm install --legacy-peer-deps
VITE_BACKEND_URL= npm run build

echo '=== 重载 nginx ==='
nginx -t && systemctl reload nginx

echo '=== 重启后端 ==='
systemctl restart agentcut-backend
sleep 2
systemctl status agentcut-backend --no-pager -n 3

echo '=== 部署完成 ==='
echo '访问地址：http://${SERVER_IP}'
"
