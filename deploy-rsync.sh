#!/usr/bin/env bash
set -euo pipefail

# AgentCut v2 一键同步脚本（SSH key 免密，不依赖 GitHub，直接用 rsync 走 SSH）
#
# 用法：
#   ./deploy-rsync.sh
#
# 认证：使用本机专用部署密钥 ~/.ssh/agentcut_deploy（已配置服务器 authorized_keys）。
# 服务器 root 密码仅作应急备份，存放于 ~/.ssh/agentcut-server-credentials.txt（0600），
# 不要写进任何脚本或仓库（2026-09-30 曾因密码入库被迫轮换一次）。

SERVER_IP="${SERVER_IP:-159.75.164.31}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_KEY="${SERVER_KEY:-$HOME/.ssh/agentcut_deploy}"
LOCAL_DIR="/Users/macminim4/WorkBuddy/2026-07-24-10-48-29/agentcut-v2"
REMOTE_DIR="/opt/agentcut-v2"
SSH_OPTS="-i ${SERVER_KEY} -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

if ! command -v rsync >/dev/null 2>&1; then
    echo "错误：需要先安装 rsync"
    exit 1
fi

if [ ! -f "$SERVER_KEY" ]; then
    echo "错误：找不到部署密钥 $SERVER_KEY"
    exit 1
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
rsync -avz --delete -e "ssh $SSH_OPTS" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='web/dist' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.env' \
    --exclude='uploads' \
    --exclude='backups/' \
    --exclude='CODEX_REVIEW_*.md' \
    "$LOCAL_DIR/" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"

# 3. 服务器端构建并重启
echo "=== 服务器端构建并重启服务 ==="
ssh $SSH_OPTS "${SERVER_USER}@${SERVER_IP}" "
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
