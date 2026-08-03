#!/bin/bash
set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="/Users/macminim4/.workbuddy/binaries/python/envs/infinite-canvas/bin/python"

echo "=== 启动 AgentCut v2 ==="
echo "→ 后端 FastAPI :8081"
cd "$PROJECT_DIR/backend" && "$VENV" main.py &
BACKEND_PID=$!

echo "→ 前端 Vite :3000"
cd "$PROJECT_DIR/web" && npm run dev &
FRONTEND_PID=$!

sleep 3
echo ""
echo "后端: http://localhost:8081 (PID=$BACKEND_PID)"
echo "前端: http://localhost:3000 (PID=$FRONTEND_PID)"
echo "按 Ctrl+C 停止两个服务"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
