# AgentCut v2 × EdgeOne Makers 接入说明

## 架构

- **自站后端**（`agentcut-v2/backend`）：保留用户鉴权、积分、素材、上传、模型网关。
- **Makers 托管 Agent**（`agentcut-v2/agents/agentcut`）：Agent 大脑运行在 EdgeOne Makers，通过 OpenAI Agents SDK 调用 Makers 模型网关。
- **后端转发层**（`backend/app/api/agent/router.py`）：前端只和后端通信，后端再调用 Makers Agent；画布/站点工具通过后端桥接到浏览器执行。

```
┌─────────────┐      SSE/WebSocket      ┌──────────────────┐
│  Web 前端   │ ◄────────────────────► │  AgentCut 后端   │
└─────────────┘                         └────────┬─────────┘
                                                 │ HTTP SSE
                                                 ▼
                                        ┌──────────────────┐
                                        │ EdgeOne Makers   │
                                        │ agents/agentcut  │
                                        └──────────────────┘
```

## 新增文件

| 文件 | 说明 |
|------|------|
| `edgeone.json` | Makers 项目配置（framework=openai-agents-sdk） |
| `requirements.txt` | Makers 运行依赖 |
| `agents/agentcut/index.py` | Agent handler（POST /agentcut） |
| `agents/agentcut/stop.py` | 中断当前 turn（POST /agentcut/stop） |
| `backend/app/api/agent/router.py` | 后端代理路由 |
| `web/src/components/canvas/canvas-edgeone-agent-panel.tsx` | 连接后端的 Agent 面板 |

## 关键后端接口

- `GET /api/v1/agent/events?clientId=xxx` — SSE 事件流
- `POST /api/v1/agent/turn` — 发送用户消息
- `POST /api/v1/agent/tool-bridge` — Makers Agent 调用浏览器工具（需 `X-Agent-Tool-Secret`）
- `POST /api/v1/agent/canvas/result` — 前端回传工具执行结果
- `POST /api/v1/agent/interrupt` — 中断当前 Makers turn

## 环境变量（后端 `.env`）

```bash
# Makers 部署后获得的 Agent 入口
EDGEONE_MAKERS_AGENT_URL=https://<your-project>.edgeone.link/agentcut
# 若 Makers 端点加了鉴权则填写
EDGEONE_MAKERS_API_KEY=
# 与 Makers 项目环境变量 AGENT_TOOL_SECRET 保持一致
AGENT_TOOL_SECRET=change-me-in-production
```

## Makers 项目环境变量

在 EdgeOne Makers 控制台的项目设置里配置：

```bash
AI_GATEWAY_API_KEY=<Makers Models API Key>
AI_GATEWAY_BASE_URL=https://ai-gateway.edgeone.link/v1
AI_GATEWAY_MODEL=@makers/deepseek-v4-flash
AGENT_BACKEND_URL=https://<your-backend>/api/v1/agent
AGENT_TOOL_SECRET=change-me-in-production
```

## 本地开发

1. 填好 `backend/.env` 里的 Makers 相关变量（没有则连接后会提示 503）。
2. `cd agentcut-v2 && ./start.sh`
3. 打开 `http://localhost:3000`，登录后打开右侧 Agent 面板，点击「连接」。

## 部署

1. 把 `agentcut-v2` 推送到 Git 仓库。
2. 在 Makers 控制台「导入 Git 仓库」，选择 `edgeone.json` 所在目录。
3. 配置上述 Makers 环境变量后部署。
4. 把生成的 Agent URL 填回自站后端的 `EDGEONE_MAKERS_AGENT_URL`。
