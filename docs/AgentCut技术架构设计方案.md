# AgentCut 技术架构设计方案

> 版本：v1.7
> 角色：资深全栈架构师（云原生 / AI 平台 / 高并发）
> 适用范围：AgentCut 智能体成片平台 — 从整体架构到部署运维的全技术栈设计
> 前置文档：AgentCut产品文档.md、QA测试报告.md、AgentCut存储系统技术方案.md、api_gateway/ 代码框架

---

## 模块一：整体架构概览

### 1.1 架构分层图（Mermaid）

```mermaid
graph TB
    subgraph Frontend["🖥️ 前端层"]
        WEB["Next.js 14<br/>App Router + React 18<br/>Tailwind CSS"]
        CANVAS["React Flow 画布<br/>节点编辑器"]
        AGENT_UI["Agent 对话<br/>实时 SSE 进度"]
        WORKFLOW["工作流页面<br/>一键同款/画布/Agent 三Tab"]
    end

    subgraph Gateway["🔀 网关层"]
        API_GW["AgentCut API Gateway<br/>FastAPI<br/>变量映射 · 自动切换 · 熔断"]
        CDN_GW["CDN 加速网关<br/>同区域内网回源"]
    end

    subgraph Business["⚙️ 业务服务层"]
        AUTH["认证服务<br/>JWT + OAuth2"]
        ASSET["资产服务<br/>上传签名 · 元数据 · 分层"]
        BILLING["积分/计费服务<br/>充值 · 消耗 · 退款"]
        AGENT_SVC["Agent 编排引擎<br/>LangGraph + SSE"]
        CANVAS_SVC["画布服务<br/>工程保存 · 协作"]
        TOOLS_SVC["工具服务<br/>ffmpeg · 轻量编排"]
        WORKFLOW_SVC["工作流服务<br/>克隆 · 收藏 · 分成"]
        NOTIFY["通知服务<br/>站内信 · 克隆提醒"]
    end

    subgraph Model["🤖 模型服务层"]
        GATEWAY_MODEL["外部模型网关<br/>OpenAI · 混元 · 火山 · Stability"]
        TOOLS_API["工具外部 API<br/>去字幕 · OCR · 抠图 ..."]
    end

    subgraph Storage["💾 存储层"]
        OBJ["云对象存储<br/>标准 → 低频 → 归档"]
        PG[("PostgreSQL<br/>用户 · 积分 · 元数据")]
        REDIS[("Redis<br/>缓存 · 队列 · 会话")]
    end

    subgraph Infra["🏗️ 基础设施层"]
        NAS["自建 NAS/MinIO<br/>rclone 异地备份"]
        MONITOR["Prometheus + Grafana<br/>监控告警"]
        CI["GitHub Actions<br/>CI/CD 流水线"]
    end

    Frontend --> Gateway
    Frontend --> CDN_GW
    Gateway --> Business
    Business --> Model
    Business --> Storage
    Model --> GATEWAY_MODEL
    Model --> TOOLS_API
    Storage --> NAS
    Infra -.-> Frontend
    Infra -.-> Gateway
    Infra -.-> Business
    Infra -.-> Model
    Infra -.-> Storage
```

### 1.2 各层职责说明

| 层 | 职责 | 说明 |
|---|---|---|
| 前端层 | 页面渲染、用户交互、状态管理 | Next.js 14 App Router，六页独立路由，Zustand 跨页状态 |
| 网关层 | 统一入口、路由转发、协议转换 | FastAPI Gateway（模型调用）+ CDN（静态资产） |
| 业务服务层 | 核心业务逻辑 | 认证、资产、积分、Agent 编排、画布、工具、工作流、通知八域，按垂直切片拆分 |
| 模型服务层 | AI 能力供给 | 外部 API（经网关变量映射）；工具类 AI（去字幕/OCR/抠图等）暂走第三方 API，v2.0 按调用量评估自部署 |
| 存储层 | 持久化与缓存 | PostgreSQL（ACID）、Redis（高频缓存+队列）、对象存储（资产三冷热） |
| 基础设施层 | 部署、监控、灾备 | Docker Compose 编排、Prometheus 监控、rclone 异地备份 |

### 1.3 关键技术选型清单

| 分类 | 技术 | 选择理由 | 备选方案 |
|---|---|---|---|
| 前端框架 | Next.js 14 App Router | 已有代码基础；SSR/SSG 混合；React Server Components 降低首屏 JS 载荷 | Remix、Nuxt — 迁移成本高 |
| 状态管理 | Zustand | 轻量（<2KB）、无 Provider 嵌套、天然支持订阅切片刷新、与 React Flow 外置状态兼容 | Jotai（原子粒度过细，画布场景不如 Zustand 的 slice 模式直观）；Redux（过重） |
| 服务端数据 | TanStack Query (React Query) | 声明式缓存+失效、乐观更新、SSE 集成 | SWR（功能近似，Query 社区更活跃） |
| 后端 API | FastAPI | 高性能异步 Python（Starlette）、Pydantic v2 数据校验、OpenAPI 自动生成、与 LangGraph 同语言栈 | Express/Fastify — Node 生态但 LangGraph 在 Python；Golang — 团队 Python 更熟 |
| 关系数据库 | PostgreSQL 16 | ACID 事务、JSONB 支持 condition_rules、百分位聚合函数、pgvector 扩展预留 | MySQL — JSONB 和窗口函数不如 PG |
| 缓存 | Redis 7 | 变量映射缓存、Session 存储、分布式锁、任务队列（Redis Streams）均可复用 | Memcached（无 Streams/持久化） |
| ORM | SQLAlchemy 2.0 async | 异步原生支持、类型安全、Prisma 在 Next.js 侧已有，FastAPI 侧需同栈 | Tortoise-ORM（社区弱） |
| 任务队列 | ARQ (Async Redis Queue) | 纯 Python + Redis（已有 Redis 无额外组件）、支持 cron 定时、失败重试 | Celery（功能强但运维重，需额外 broker）；Redis Streams（手写消费组逻辑多） |
| 对象存储 | 腾讯云 COS（主） + 适配器模式 | 成本可控、内网 CDN 回源免流、S3 兼容 API 可替换厂商 | 阿里云 OSS/七牛/R2 — 适配器模式保证切换仅改配置 |
| 容器化 | Docker Compose | 小团队运维友好、8-12 个服务编排足够、无需 Kubernetes 复杂度 | K8s — v2.0 可上（当下过度设计） |
| 监控 | Prometheus + Grafana | 云原生标配、指标拉取式架构，FastAPI + Redis + PG 均有 exporter | Datadog（SaaS 成本高，自建够用） |

---

## 模块二：前端架构

### 2.1 技术栈

```
框架:    Next.js 14 (App Router)
语言:    TypeScript (strict mode)
样式:    Tailwind CSS 3.4
状态:    Zustand + React Query (TanStack Query v5)
画布:    @xyflow/react (React Flow v12)
视频:    hls.js (m3u8 直播/点播) + video.js (播放器)
实时:    EventSource (SSE) + 降级 polling
渲染:    SSR（工作流展示/落地页 SEO）+ ISR（资产/工具页）+ CSR（工作台/画布/Agent）
适配:    Tailwind responsive + 移动端 PWA（v1.0）；React Flow 触控需评估
```

### 2.2 页面路由设计

```
app/
├── layout.tsx                    # 根布局：主题、AuthProvider、QueryClientProvider
├── page.tsx                      # 首页/落地页（未登录）
├── login/page.tsx                # /login
├── register/page.tsx             # /register
│
├── (dashboard)/                  # 登录后的工作区布局
│   ├── layout.tsx                # 顶部导航 + Zustand auth store
│   │
│   ├── workspace/                # 单模型页（含旧路由迁移）
│   │   ├── layout.tsx            # 左侧模型选择栏
│   │   ├── text/page.tsx         # /workspace/text → TEXT_MODEL
│   │   ├── image/page.tsx        # /workspace/image → IMAGE_MODEL
│   │   ├── video/page.tsx        # /workspace/video → VIDEO_MODEL
│   │   └── music/page.tsx        # /workspace/music → MUSIC_MODEL  [Beta]
│   │
│   ├── canvas/page.tsx           # /canvas 画布+Agent 页
│   ├── agent/page.tsx            # /agent  Agent 全功能页
│   ├── tools/page.tsx            # /tools  工具集合页      [Beta]
│   ├── workflow/page.tsx         # /workflow 工作流三Tab+收藏 [Beta]
│   ├── clip/page.tsx             # /clip   智能剪辑页      [MVP 简化版]
│   ├── assets/page.tsx           # /assets 资产/个人中心
│   ├── history/page.tsx          # /history 历史记录
│   ├── settings/page.tsx         # /settings 设置
│   └── admin/                    # /admin 管理后台（role=admin）
│       ├── layout.tsx
│       └── page.tsx
│
├── api/                          # Next.js API Routes（逐步迁移到 FastAPI Gateway）
│   ├── auth/
│   ├── generate/                 # 单模型调用 — 最终应变为 proxy → /gateway/{variable_name}
│   ├── agent/                    # Agent 线程接口
│   └── history/
│
├── error.tsx                     # 全局 Error Boundary [P0 待实现]
└── global-error.tsx              # 根 Error Boundary
```

**废弃计划**：`(dashboard)/create/*` 双入口在 v1.0 统一迁移到 `/workspace/*`，旧路由保留 301 重定向。

### 2.3 状态管理方案

**Zustand（跨页面 + 画布全局状态）** vs Jotai

- 选择 Zustand 的理由：画布页的 `nodes`/`edges` 是一个大数组，频繁更新（拖拽/连线/复制粘贴）。Zustand 的 `subscribeWithSelector` 允许只订阅 slice 变化，避免大面积重渲染。Jotai 原子粒度对画布来说拆得太碎（每节点一个 atom），维护成本爆炸。另外 Zustand 不与 React 树耦合，可在 `useAgent` hook 外部直接读写 — 解决当前代码"闭包旧 state"的根本方案。
- 不使用 Redux：项目体量无需 middleware 链，且 Zustand 的 TypeScript 推导更简洁。

```typescript
// stores/index.ts — Zustand 模块化切片
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// 用户 slice
interface AuthSlice { user: User | null; setUser: (u: User) => void; }
// 画布 slice（取代当前 useNodesState/useEdgesState）
interface CanvasSlice { nodes: Node[]; edges: Edge[]; /* ... */ }
// Agent slice
interface AgentSlice { currentThreadId: string | null; messages: Message[]; /* ... */ }

export const useStore = create<AuthSlice & CanvasSlice & AgentSlice>()(
  subscribeWithSelector((set, get) => ({
    /* slices */
  }))
);
```

**React Query 负责服务端数据**：所有 API 调用（生成结果轮询、历史列表、Agent 线程）通过 `useQuery`/`useMutation` 统一缓存、失效和乐观更新，避免重复的 `useEffect + fetch` 模式。

### 2.4 与后端通信方案

| 场景 | 方案 | 理由 |
|---|---|---|
| REST 查询/命令 | React Query (`useQuery` / `useMutation`) | 声明式，自动缓存/stale/refetch |
| Agent SSE 实时推送 | `EventSource`（原生）→ React Query `queryClient.setQueryData` 更新 | 复用 Query 缓存层，SSE 断开自动重连 |
| 画布实时协作 | WebSocket（Socket.IO）| 多人画布需要双向低延迟；Beta 阶段可降级为 polling |
| 大文件上传 | XHR `upload.onprogress` 直传 COS/OSS | 不经过 Next.js Server，避免占用 Node 线程 |

### 2.5 画布页节点编辑器技术选型

选择 **React Flow (@xyflow/react v12)**，无需备选。

| 理由 | 说明 |
|---|---|
| 已在项目中使用 | `app/(dashboard)/canvas/page.tsx` 已基于 React Flow，仅需修复闭包旧 state（改用 Zustand 外置状态） |
| 原生节点拖拽/连线/缩放 | 不需要手写 Canvas 绑定 |
| 可自定义节点 | 文本/图片/视频/音频/模型调用/工具处理 六类节点组件已实现 |
| MIT 协议 | 无商业授权顾虑 |

### 2.6 视频播放/剪辑预览方案

```
视频播放器:    video.js (UI 控件丰富)
HLS 支持:      hls.js（CDN 可输出 m3u8 流，支持自适应码率）
预览合成:      Canvas API + WebCodecs（帧级精确操作）
降级方案:      <video> + range 请求
```

---

## 模块三：后端 API 架构

### 3.1 技术栈

```
API 框架:   FastAPI 0.115+
ORM:        SQLAlchemy 2.0 async
数据库:     PostgreSQL 16
缓存/队列:  Redis 7（缓存 + ARQ 任务队列 + Session）
进程管理:   Gunicorn + Uvicorn workers
```

### 3.2 API 路由分层设计

```
/api
├── auth/                        # 认证鉴权（保留在 Next.js 侧，需用户状态紧密耦合）
│   ├── register
│   ├── login
│   ├── me
│   └── oauth/github|wechat     # [v1.0 扩展]
│
├── gateway/{variable_name}      # ← 网关统一入口（FastAPI Gateway）
│                                 #   Next.js → proxy → FastAPI :8080
│
├── assets/                      # 资产服务
│   ├── upload-sign              # 上传签名（Next.js → proxy COS）
│   ├── callback                 # 云存储回调
│   ├── list?page=&type=&sort=   # 资产列表（需服务端分页）
│   └── restore                  # 归档取回
│
├── agent/                       # Agent 编排（Next.js，需和 LangGraph JS 同栈）
│   ├── chat                     # 创建/续接对话
│   ├── threads                  # 线程列表 ← 需加 userId 过滤
│   ├── thread/[id]              # 线程状态 ← 需归属校验
│   ├── thread/[id]/confirm      # 确认分镜
│   ├── thread/[id]/events       # SSE 进度
│   └── thread/[id]/retry/[shot] # 重试单镜
│
├── canvas/                      # 画布服务
│   ├── project/save             # 保存工程 → PostgreSQL
│   └── project/load             # 读取工程
│
├── tools/                       # 工具服务 [Beta]
│   ├── strip-subtitle
│   ├── separate-vocal
│   ├── upscale
│   └── ...
│
├── workflow/                    # 工作流服务 [Beta]
│   ├── list?tab=one_click|canvas|agent&page=&q=&sort=hot|new  # 工作流列表（分Tab+搜索+排序）
│   ├── [id]                     # 工作流详情
│   ├── [id]/clone               # 克隆工作流（触发积分扣减+分成）
│   ├── [id]/favorite            # 收藏/取消收藏
│   ├── [id]/publish             # 发布到市场（/admin 需审核通过后上线）
│   └── favorites                # 我的收藏列表
│
├── notifications/               # 通知服务 [Beta]
│   ├── list?unread_only=true&page=  # 我的通知列表（站内铃铛）
│   ├── [id]/read                # 标记已读
│   └── unread-count             # 未读数量
│
├── billing/                     # 积分计费服务
│   ├── balance                  # 余额查询
│   ├── recharge                 # 充值（回调）
│   ├── consume                  # 消耗（网关调用后触发）
│   ├── sign-in                  # 签到
│   └── ledger?page=             # 积分流水
│
├── admin/                       # 后台管理（增加 FastAPI Gateway 管理面板的 Next.js 代理）
│   ├── users
│   ├── orders
│   ├── stats
│   └── gateway-proxy/*          # 代理到 FastAPI :8080/admin/*
│
└── ws/                          # WebSocket
    └── canvas/{projectId}       # 画布协作 Beta
```

### 3.3 认证鉴权方案

**JWT（Access + Refresh Token）+ 可选 OAuth2**

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as Next.js
    participant D as PostgreSQL

    U->>F: POST /api/auth/login {phone,password}
    F->>D: SELECT user WHERE phone
    D-->>F: user + hashed_pw
    F->>F: bcrypt.compare
    F->>F: 生成 access_token(15min)+refresh_token(7d)
    F-->>U: {access_token,refresh_token}

    U->>F: API 请求 + Authorization: Bearer access_token
    F->>F: requireAuth 校验 JWT
    alt access_token 过期
        F-->>U: 401
        U->>F: POST /api/auth/refresh {refresh_token}
        F->>F: 校验 refresh_token 非黑名单
        F-->>U: 新 access_token
    end
```

**设计决策**：

| 决策 | 方案 | 理由 |
|---|---|---|
| JWT 签发方 | Next.js（非 FastAPI） | 用户表在 Next.js 侧 Prisma 管理，FastAPI Gateway 只做无状态路由转发 |
| Refresh Token 存储 | Redis + 数据库双写 | Redis 快速校验黑名单；PG 持久化防 Redis 重启流失 |
| OAuth2 接入 | NextAuth.js v5 | 社区标准，支持 GitHub/微信/Google 多 Provider |
| 网关鉴权 | Gateway **旁路自校验 JWT** | Gateway 持与 Next.js 相同的 JWT_SECRET，从请求头 `Authorization: Bearer` 或 `x-token` 中提取并校验 JWT，**自身推导权威 user_id**，不再信任 Next.js proxy 转发的 body/user_id 字段。内部服务间通信用 API Key 仅用于非用户态操作（健康检查/跨服务元数据同步） |

### 3.4 积分系统数据库设计和事务一致性

```sql
-- 积分系统核心表（扩展 Prisma schema，逐步迁移到 PG 建表）

CREATE TABLE user_credits (
    user_id         UUID PRIMARY KEY REFERENCES users(id),
    balance         INTEGER NOT NULL DEFAULT 0,           -- 当前余额
    total_earned    INTEGER NOT NULL DEFAULT 0,           -- 累计获取
    total_spent     INTEGER NOT NULL DEFAULT 0,           -- 累计消耗
    frozen_balance  INTEGER NOT NULL DEFAULT 0,           -- 冻结积分（进行中任务）
    version         INTEGER NOT NULL DEFAULT 0,           -- 乐观锁版本号
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id),             -- 操作人（平台流水为 NULL，仅 scope='clone' AND type='clone_platform' 时）
    amount          INTEGER NOT NULL,                     -- 正=获得，负=消耗
    type            VARCHAR(32) NOT NULL,                  -- charge/gift/sign_in/consume/refund/clone_expense/clone_income/clone_platform
    balance_after   INTEGER NOT NULL,
    reference_id    VARCHAR(128),                         -- 关联订单号/任务ID
    -- 克隆分成专用字段（仅 type LIKE 'clone_%' 时填充）
    share_record_id UUID,                                 -- 一次克隆的三条流水共用同一 ID，关联对账与退款回溯
    clone_type      VARCHAR(16),                           -- one_click / canvas / agent（克隆类型）
    split_ratio     SMALLINT,                              -- 分成百分比，如 50 表分享者/平台各 50%
    ref_workflow_id UUID,                                  -- 被克隆工作流 ID
    counterparty_user_id UUID REFERENCES users(id),       -- 交易对手用户 ID（克隆者 vs 分享者互填，平台流水为 NULL）
    scope           VARCHAR(16) DEFAULT 'general',        -- 流水业务域：general / clone / model_call / tool_use
    split_share     INTEGER,                              -- 冗余：分享者分成额
    split_platform  INTEGER,                              -- 冗余：平台分成额
    -- 定价引擎成本追踪字段（模块七 7.2）
    variable_name   VARCHAR(64),                          -- 关联网关变量名（TEXT_MODEL / IMAGE_MODEL 等）
    official_cost_cny NUMERIC(12,6),                      -- 官方保底价人民币（用于毛利核算）
    proxy_cost_cny    NUMERIC(12,6),                      -- 代理采购价人民币（仅成本看板，不暴露用户）
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
CREATE INDEX idx_credit_ledger_share ON credit_ledger(share_record_id) WHERE share_record_id IS NOT NULL;
CREATE INDEX idx_credit_ledger_scope ON credit_ledger(scope, created_at DESC);

CREATE TABLE credit_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    package_id      INTEGER NOT NULL,                     -- 套餐 ID
    amount_credits  INTEGER NOT NULL,
    amount_money    INTEGER NOT NULL,                     -- 金额（分）
    payment_method  VARCHAR(16) NOT NULL,                 -- alipay/wechat
    payment_trade_no VARCHAR(64) UNIQUE,                  -- 第三方交易号（UNIQUE 防重复回调）
    status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending/paid/failed/expired
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**事务一致性**（`user_credits` 的乐观锁模式）：

```sql
-- 消耗积分的安全操作（单条 UPDATE + 流水 INSERT 在同一事务）
BEGIN;
  -- 1. 带版本号比对更新
  UPDATE user_credits
  SET balance = balance - 100,
      total_spent = total_spent + 100,
      version = version + 1,
      updated_at = now()
  WHERE user_id = 'xxx' AND version = 7 AND balance >= 100
  RETURNING balance, version;

  -- 若 affected_rows = 0 → 并发冲突/余额不足 → ROLLBACK

  -- 2. 写入流水
  INSERT INTO credit_ledger (user_id, amount, type, balance_after, reference_id)
  VALUES ('xxx', -100, 'consume', <new_balance>, 'task_123');
COMMIT;
```

**为什么是乐观锁而非悲观锁**：积分扣减高并发（用户同时点视频+文本生成），悲观锁（`SELECT FOR UPDATE`）会排队阻塞前端体验；乐观锁只在冲突时重试一次（`RETRY 1 TIME`），开销极小。极端冲突才降级为排队。

### 3.5 任务队列方案

**ARQ (Async Redis Queue)** 用于异步长耗时任务：

```python
# worker.py — ARQ Worker 示例
from arq import create_pool
from arq.connections import RedisSettings

async def composite_video(ctx, shots: list[dict], output_key: str):
    """后台合成视频：逐帧 FFmpeg 拼接 + 音频混音."""
    await ctx['redis'].set(f'job:{ctx["job_id"]}:status', 'processing')
    # ... 调用 FFmpeg
    await ctx['redis'].set(f'job:{ctx["job_id"]}:status', 'done')

class WorkerSettings:
    redis_settings = RedisSettings(host='localhost', port=6379)
    functions = [composite_video]
    max_jobs = 4  # 单 Worker 并发数
```

**任务类型分配**：

| 任务 | 队列 | 超时 | 说明 |
|---|---|---|---|
| 视频合成 (composite) | `video_queue` | 5 min | GPU/CPU 混合 |
| 模型 API 调用 | `model_queue` | 60 s | 整体调用上限（NF-06）；单源连接/首字节超时 5s（AC-101），长任务/流式模型豁免 5s 切换阈值 |
| 对象存储分层回调 | `storage_queue` | 30 s | 异步更新 storage_class |
| 每日签到结算 | `cron_queue` | 10 s | ARQ cron 支持 |
| 工作流画布克隆 | `clone_queue` | 5 min | 异步复制画布工程+资产到克隆者空间；一键同款/Agent Skill 无需此队列（同步返回） |

### 3.6 WebSocket 方案

用于画布实时协作（Beta/v1.0）：

| 组件 | 方案 | 说明 |
|---|---|---|
| WebSocket 服务器 | Socket.IO (Node.js) | 部署在 Next.js custom server 侧或独立 Socket.IO 服务 |
| 消息协议 | JSON-RPC 风格 | `{ type, payload, sender }`，节点增删改/锁定/光标位置 |
| 状态同步 | OT/CRDT | 初期用简易锁（同一节点同时只能一人编辑），后期升级 Yjs CRDT |
| 房间 | `canvas:{projectId}` | 同工程用户加入同一房间 |
| 离线消息 | Redis 暂存 | 用户离线期间消息入 Redis Streams，上线后回放 |

**为什么不在 FastAPI 侧做 WebSocket**：画布协作本质是前端+前端的状态同步，Socket.IO（Node.js）生态比 FastAPI WebSocket 更成熟（心跳、重连、房间、命名空间开箱即用）；且画布工程数据走 Next.js Prisma 持久化，和 FastAPI 无关。

### 3.7 数据迁移策略

项目存在两套持久化引擎（Next.js 侧 Prisma + FastAPI 侧裸 PG／Alembic），需明确分工与回滚路径以避免上线踩坑：

- **Next.js 侧（Prisma）**：管理用户、会话、画布工程等 schema。使用 `npx prisma migrate dev` 生成迁移文件，提交 Git；CI/CD 中 `npx prisma migrate deploy` 自动执行。
- **FastAPI Gateway 侧（Alembic）**：管理 `credit_ledger`、`workflows`、`notifications`、`platform_config` 等业务核心表。使用 `alembic revision --autogenerate` 生成迁移，`alembic upgrade head` 部署。
- **回滚路径**：Prisma → `npx prisma migrate resolve --rolled-back <migration_name>`；Alembic → `alembic downgrade -1`。生产环境回滚前**必须**备份 PG。
- **禁止事项**：禁止直接手动修改 PG 表结构；禁止同一张表在两套迁移工具中各自建表（选一个 owner）。

---

### 3.8 安全、鉴权与事务处理补强

#### 3.8.1 API 版本化

所有 FastAPI 路由统一加 `/v1/` 前缀，避免接口变更时无兼容手段。Next.js API Route 同步加 `/v1/`——虽当前仅 Web 端，但预留移动端与第三方集成空间。

#### 3.8.2 Agent SSE / 画布 WebSocket 鉴权

**统一 ticket 模式**：EventSource 不支持自定义 Header，JWT 无法通过 Authorization 头传递。统一改用 **短期 ticket 模式**，覆盖 Agent SSE（`/api/agent/thread/[id]/events`）与画布 WebSocket（`ws/canvas/{projectId}`）两处：

```
1. 前端 POST /api/auth/ws-ticket { resourceType: "agent_thread"|"canvas_project", resourceId }  
   → 服务端校验 JWT + 用户对 resourceId 的所有权（agent thread 查 author_id；canvas project 查 owner_id）
2. 返回 { ticket: "<一次性token>", expires_in: 60 }
3. SSE/WS 连接时通过 query param ?ticket=xxx 携带
4. 服务端校验 ticket 有效性 + resourceId 归属，通过后方可连接
```

- **Agent SSE**（`/api/agent/thread/[id]/events`）连入时校验 `ticket` + `threadId` 归属 → 解决 QA 报告 N2（IDOR）。
- **Agent threads 列表**（`/api/agent/threads`）强制 `WHERE user_id=...` 过滤；单 thread 查询（`/api/agent/thread/[id]`）校验 `thread.author_id == current_user`。
- **画布 WebSocket** 连入时强制校验 `ticket` + `projectId` 所有权。
- 画布协作冲突感知：节点上显示当前编辑者头像/光标；锁定节点时提示"XX 正在编辑"；客户端心跳断开 15s 后自动释放锁，防死锁。

#### 3.8.3 双框架数据访问层收敛路线

| 阶段 | 策略 | 说明 |
|---|---|---|
| Beta | **FastAPI 侧建 `users_sync` 镜像表**（`user_id UUID PK`），用户注册/登录时 Next.js 回调同步关键字段；Prisma 继续管 users/sessions/canvas | FastAPI 金融表（`credit_ledger`/`workflows`/`assets`）的 FK 指向 `users_sync` 而非 Prisma `users`，避免关键金融表 FK 挂在对家管理的表上 |
| v1.0 | users 表迁移到 Alembic 管理；Prisma 退化，仅读不写 | 单一 schema 所有权 |
| v2.0 | Next.js 退为纯 BFF，不再直接操作业务表 | 全部数据经 FastAPI Gateway 访问 |

```sql
-- users_sync 镜像表（FastAPI 侧，Beta 新建；finanical FK 指向此表而非 Prisma users）
CREATE TABLE users_sync (
    user_id         UUID PRIMARY KEY,
    username        VARCHAR(128),
    role            VARCHAR(16) DEFAULT 'free',  -- free / paid / vip / admin
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Next.js 注册/登录时回调 POST /v1/internal/sync-user { user_id, username, role }
```

#### 3.8.4 跨框架事务的补偿模式

画布克隆涉及"复制工程（Prisma）+ 扣积分分成（SQLAlchemy）"，两套 ORM 分属 Next.js 与 FastAPI 容器，无法同一事务。采用 **HTTP 回调补偿模式**，克隆主流程由 FastAPI 编排：

```
1. FastAPI 先扣积分+写三流水（同一 PG 事务）→ 成功，返回 { share_record_id, clone_url }
2. FastAPI 内网 HTTP POST Next.js /api/canvas/project/clone { source_project_id, target_user_id } → 异步复制工程到克隆者空间
3. Next.js 复制完成后回调 FastAPI POST /api/workflow/clone/complete { share_record_id, success, new_project_id }
    → 成功：更新 clone_records + 追加通知
    → 失败：补偿退款 — 退积分 + 写退款流水（type=clone_refund），关联回 share_record_id 的三流水
```

此设计不要求 FastAPI 安装 Prisma 或 Next.js 安装 SQLAlchemy，各自通过内网 HTTP 协作，解耦且可独立扩缩。

**补偿可靠性保障**：回调失败时 `share_record_id` 入 ARQ `compensation_queue`，指数退避重试（间隔 1min/5min/15min/30min）。累计失败 5 次入死信队列 → 触发告警 + 人工介入。补偿写入同样走乐观锁版本比对。

#### 3.8.5 积分扣减模式决策

| 操作 | 模式 | 理由 |
|---|---|---|
| 克隆 / 工具使用 | **直接扣**（即时完成，同步返回） | 操作本身是瞬时完成的，无需冻结 |
| 模型调用（生成） | **冻结→结算**（异步长任务） | 先冻结、完成后结算；失败/超时解冻退款 |
| Agent 成片 | **冻结→结算** | 多步编排，每步分阶段冻结 |

#### 3.8.6 生成进度与失败重试

- **单模型页生成进度**：不再纯 spinner。前端通过 SSE/w polling 获取阶段（排队→生成中→后处理）+ 基于历史 P50 的预估耗时。
- **失败保留部分结果**：Agent 多步执行时，已完成步骤的产物保留在资产空间；用户可选择「仅重试失败步骤」（`retry/[shot]`）或「从头重试」。
- **友好错误**：网关熔断/模型失败/超时时，前端展示中文友好文案 + 「重试」按钮 + 「切换模型源重试」选项，而非裸技术错误码。

---

## 模块四：API 网关路由系统

### 4.1 架构位置

```
                        ┌─────────────────────────┐
                        │    FastAPI Gateway       │
   Next.js ── proxy ──→ │    :8080                 │
                        │                          │
                        │  变量名映射 (/gateway/{}) │
                        │  ├─ 四级分类查数据库      │
                        │  ├─ Redis 缓存映射表      │
                        │  ├─ 选择器 (selector)     │
                        │  ├─ 熔断器 (circuit)      │
                        │  ├─ 健康检查 (health)     │
                        │  └─ 调用日志 (call_log)   │
                        │                          │
                        └─────┬───────────────────┘
                              │ 实际 API 请求
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
               OpenAI     混元 API   火山引擎
```

### 4.2 四级分类数据库表结构（SQL DDL）

```sql
-- 第四级：具体 API 源
CREATE TABLE api_sources (
    id              SERIAL PRIMARY KEY,
    modal_category  VARCHAR(32)  NOT NULL,   -- text | image | audio | video | model_3d
    vendor          VARCHAR(64)  NOT NULL,   -- openai | tencent_hunyuan | volcengine | ...
    model_version   VARCHAR(64)  NOT NULL,   -- gpt-4o | hunyuan-turbo | sd-xl | ...
    source_name     VARCHAR(64)  NOT NULL,   -- official | proxy_1 | self_hosted

    priority        INTEGER NOT NULL DEFAULT 100,
    base_url        VARCHAR(512) NOT NULL,
    api_key_encrypted TEXT NOT NULL,          -- Fernet 加密

    timeout_ms      INTEGER NOT NULL DEFAULT 5000,
    retry_count     INTEGER NOT NULL DEFAULT 2,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    cost_level      VARCHAR(16) DEFAULT 'medium',   -- low | medium | high
    quality_level   VARCHAR(16) DEFAULT 'medium',
    allowed_user_levels VARCHAR(128) DEFAULT 'free,paid,vip',  -- CSV

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_sources_modal_vendor ON api_sources(modal_category, vendor);

-- 变量名映射
CREATE TABLE variable_mappings (
    id              SERIAL PRIMARY KEY,
    variable_name   VARCHAR(64) UNIQUE NOT NULL,  -- TEXT_MODEL, IMAGE_MODEL, ...
    modal_category  VARCHAR(32) NOT NULL,
    default_source_id INTEGER REFERENCES api_sources(id),
    fallback_source_ids INTEGER[] DEFAULT '{}',   -- PG array
    condition_rules JSONB DEFAULT '{}',           -- 条件优先规则

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 调用日志
CREATE TABLE call_logs (
    id              BIGSERIAL PRIMARY KEY,
    request_id      VARCHAR(64) NOT NULL,
    variable_name   VARCHAR(64) NOT NULL,
    source_id       INTEGER REFERENCES api_sources(id),
    vendor          VARCHAR(64) NOT NULL,
    model_version   VARCHAR(64) NOT NULL,
    source_name     VARCHAR(64) NOT NULL,

    status_code     INTEGER,
    latency_ms      FLOAT DEFAULT 0,
    error_message   TEXT,
    cost            FLOAT DEFAULT 0,
    request_path    VARCHAR(512),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_logs_var_time ON call_logs(variable_name, created_at DESC);
CREATE INDEX idx_call_logs_source ON call_logs(source_id);
```

### 4.3 变量名映射的缓存策略

```
请求到达 /gateway/TEXT_MODEL
    │
    ├─ 1. Redis GET "var:TEXT_MODEL"
    │      ├─ hit → 获得 { default_source_id, fallback_ids, rules }
    │      └─ miss → PostgreSQL 查询 → Redis SET "var:TEXT_MODEL" EX 300
    │
    ├─ 2. Redis GET "src:{source_id}" → ApiSource 详情
    │      └─ miss → PG 查询 → Redis SET "src:{id}" EX 600
    │
    └─ 3. 选择器评估条件规则 → 确定最终源 → 解密 api_key → 发送请求
```

**缓存失效策略**：

- 管理员修改 `api_sources` 或 `variable_mappings` 时，Admin API 主动 `DEL var:{name}` 和 `DEL src:{id}`。
- 兜底 TTL 60s 防漏删，对齐 SPEC AC-103（配置文件变更 60s 内全局生效）。
- 开发模式下可设 `TTL=0`（每次查库）。

### 4.4 自动切换与熔断的实现路径

核心逻辑：**主源超时 >5s 或返回 5xx → 自动按 priority 切换到备用源 → 每个源重试 retry_count 次（默认 2）**。连续失败 ≥5 次触发熔断器（circuit breaker），open 状态持续 30s 后进入 half-open 试探。

```python
# core/router.py — 熔断器增强版
from pybreaker import CircuitBreaker

class GatewayRouter:
    def __init__(self, session: AsyncSession):
        # 每个 API 源一个独立熔断器实例
        self.breakers: dict[int, CircuitBreaker] = {}

    def _get_breaker(self, source: ApiSource) -> CircuitBreaker:
        if source.id not in self.breakers:
            self.breakers[source.id] = CircuitBreaker(
                fail_max=5,          # 连续 5 次失败 → open
                timeout_duration=30, # open 30s → half-open
                name=f"src:{source.id}"
            )
        return self.breakers[source.id]

    async def _try_with_breaker(self, source, method, path, body):
        breaker = self._get_breaker(source)
        try:
            return await breaker.call(
                self._try_source, source, method, path, body
            )
        except CircuitBreakerError:
            return SourceResult(success=False, error='circuit_open')

    async def resolve(
        self, variable_name: str, method: str, path: str,
        body: dict, user_level: str, strategy: str = "default",
    ) -> dict:
        mapping = await self._get_mapping(variable_name)
        source, fallbacks = await self.selector.select(mapping, user_level, strategy)

        # 尝试主源（含熔断器）
        result = await self._try_with_breaker(source, method, path, body)
        if result.success:
            return result

        # 主源失败 → 依次尝试 fallback（每个源独立熔断）
        for fb_id in fallbacks:
            fb_source = await self._get_source(fb_id)
            result = await self._try_with_breaker(fb_source, method, path, body)
            if result.success:
                return result

        raise AllSourcesFailedError(variable_name)
```

**超时与重试规格**（对齐 SPEC AC-101）：
- `_try_source` 内部使用 `httpx.AsyncClient(timeout=source.timeout_ms/1000)`，**默认 timeout_ms=5000（5s）**。
- 超时或 5xx → 视为失败，触发 fallback 链。
- 每个源重试 `retry_count` 次（默认 2），重试间退避 200ms。
- 所有源均失败 → 返回 `5001: AllSourcesFailed`。

1. Next.js API Route → `fetch("http://localhost:8080/gateway/TEXT_MODEL", ...)` 纯 HTTP proxy。
2. 或者在 `agentcut/.env` 设 `GATEWAY_BASE_URL=http://localhost:8080`，`lib/agent-video/config/models.ts` 中已有的 `getLLM`/`getVideoModel` 等函数改为调用 Gateway。
3. docker-compose 中 Gateway 作为独立 service。

### 4.5 条件优先规则的运行时评估

```python
# core/selector.py — 条件优先
async def select(
    self,
    mapping: VariableMapping,
    user_level: str,
    strategy: str = "default",
    current_hour: int | None = None,
) -> tuple[ApiSource, list[int]]:
    # 获取所有候选源（含默认 + fallback）
    candidates = await self._get_candidates(mapping)

    # 阶段 1：过滤
    filtered = []
    for src in candidates:
        if not src.is_active: continue
        if user_level not in src.allowed_user_levels: continue  # 免费用户不可用 VIP 专属源
        filtered.append(src)

    # 阶段 2：排序（策略驱动的多键排序）
    rules = mapping.condition_rules or {}
    peak_hours = rules.get("peak_hours", [19, 20, 21, 22])
    now_hour = current_hour or datetime.now().hour
    force_quality = rules.get("vip_force_high_quality") and user_level == "vip"

    def sort_key(src):
        score = 0
        # 成本最优策略（default）
        if strategy == "cheapest":
            score -= {"low": 3, "medium": 1, "high": 0}.get(src.cost_level, 0)
        # VIP 高质量优先
        if force_quality:
            score += {"low": 0, "medium": 1, "high": 3}.get(src.quality_level, 0)
        # 高峰时段排除低价慢源
        if now_hour in peak_hours and src.cost_level == "low" and src.quality_level == "low":
            score -= 100
        # 优先级（数字越小越优先）
        score -= src.priority * 0.01
        return -score  # 降序

    sorted_srcs = sorted(filtered, key=sort_key, reverse=True)

    if not sorted_srcs:
        raise NoAvailableSourceError(mapping.variable_name)

    primary = sorted_srcs[0]
    fallback_ids = [s.id for s in sorted_srcs[1:]]
    return primary, fallback_ids
```

---

## 模块五：多用户资产存储系统

### 5.1 上传链路架构图

```mermaid
sequenceDiagram
    participant U as 用户浏览器
    participant N as Next.js
    participant P as PostgreSQL
    participant C as COS/OSS
    participant CDN as CDN 节点

    U->>N: POST /api/assets/upload-sign {fileName,fileSize,contentType}
    N->>N: requireAuth + MIME白名单 + 大小校验
    N->>P: INSERT asset (status=pending)
    P-->>N: asset_id
    N-->>U: { uploadUrl, Authorization, cdnUrl, assetId }

    U->>C: PUT uploadUrl + Authorization (直传，不经过N)
    C-->>U: 200 OK

    C->>N: POST /api/assets/callback {key,size,etag} + x-cos-signature
    N->>N: 校验回调签名
    N->>P: UPDATE asset SET status=confirmed
    N-->>C: 200

    U->>CDN: GET cdnUrl
    CDN-->>U: 文件 (首次回源C，后续缓存命中)
```

### 5.2 资产元数据数据库表

```sql
CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    file_name       VARCHAR(512) NOT NULL,
    file_size       BIGINT NOT NULL,                  -- 字节
    content_type    VARCHAR(128) NOT NULL,             -- MIME
    object_key      VARCHAR(1024) NOT NULL UNIQUE,     -- 格式: {user_id}/{uuid}/{sanitized_name}，杜绝用户间碰撞与遍历
    cdn_url         VARCHAR(1024),                     -- CDN 加速域名（仅 visibility='public' 时落库；private 请求时现签）
    visibility      VARCHAR(16) NOT NULL DEFAULT 'private',  -- private=用户私有（走签名 URL）/ public=工作流公开物料（走无签名 CDN）

    storage_class   VARCHAR(32) NOT NULL DEFAULT 'STANDARD', -- STANDARD/STANDARD_IA/ARCHIVE/DEEP_ARCHIVE
    status          VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending/confirmed/deleted
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,    -- 置顶/收藏 → 不降级

    etag            VARCHAR(64),
    thumbnail_url   VARCHAR(1024),                     -- 缩略图 CDN URL

    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,                           -- 音视频时长

    restore_status  VARCHAR(32),                       -- NULL | in_progress | restored
    restore_requested_at TIMESTAMPTZ,

    last_accessed_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_user ON assets(user_id, created_at DESC);
CREATE INDEX idx_assets_storage_class ON assets(storage_class);
CREATE INDEX idx_assets_pinned ON assets(pinned) WHERE pinned = TRUE;
```

### 5.3 生命周期规则的云厂商配置对照

| 规则 | COS | OSS | 七牛 | R2 |
|---|---|---|---|---|
| 30天 → 低频 | `STANDARD → STANDARD_IA` (Transition Days=30) | `Standard → IA` (Days=30) | `line` 策略 | R2 无原生分层，需 lifecycle rule 转 R2 Infrequent Access |
| 120天 → 归档 | `STANDARD_IA → ARCHIVE` (Days=120) | `IA → ColdArchive` (Days=120) | 归档类型 | — |
| 不删除 | `Expiration Days=9999` | 同上 | 同上 | 同 |
| 置顶跳过 | `pinned/` prefix 排除 | 同 | 同 | 同 |

> 统一通过云厂商 SDK 或 Terraform 声明式配置。详细 Lifecycle XML 见 `AgentCut存储系统技术方案.md` 模块二。

### 5.4 CDN 回源架构的网络拓扑

```
┌──────────────────────────────────────────────────────┐
│                     公网 (Internet)                    │
│  用户 ──→ CDN 边缘节点 (全球)                          │
│              │                                        │
│              │ (cache MISS) ──→ CDN 回源层             │
│              │                    │                    │
│    ┌─────────┴────────────────────┴───────────────┐   │
│    │              云厂商 同地域 (ap-guangzhou)      │   │
│    │                                              │   │
│    │  CDN 回源层 ── 内网 ──→ COS Bucket           │   │
│    │  (10.x.x.x)      免流量   (cos.ap-guangzhou)  │   │
│    │                                              │   │
│    │  Next.js 业务服务器                           │   │
│    │  (云服务器 CVM, 同地域 VPC)                     │   │
│    └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 5.5 rclone 增量同步部署架构

```
  COS (ap-guangzhou)                    自建 MinIO (机房/家中)
  ┌──────────────┐                      ┌──────────────────┐
  │ agentcut-bucket │ ── rclone copy ──→ │ nas-minio:backup  │
  │ 标准+低频层     │    (VPN/IPSec)      │ (内网, 不对外)     │
  └──────────────┘  每周日凌晨 2:00      └──────────────────┘
```

网络方案：云服务器与自建 NAS 之间通过 **WireGuard VPN** 或 **IPSec 隧道** 打通，NAS 部署 MinIO（S3 兼容）+ rclone 定时任务。详细脚本见 `AgentCut存储系统技术方案.md` 模块四。

### 5.6 用户访问时的冷热切换逻辑

```mermaid
flowchart TD
    A[用户 GET CDN URL] --> B[CDN 有缓存?]
    B -->|Y| C[直接返回]
    B -->|N| D[CDN 回源 COS]
    D --> E{对象在标准/低频层?}
    E -->|Y| F[正常返回]
    E -->|N → 归档层| G[COS 返回 403]
    G --> H[前端收到 403 → 触发 restore]
    H --> I[POST /api/assets/restore]
    I --> J[业务服务器调用 COS RestoreObject]
    J --> K[异步轮询 restore 状态]
    K --> L{取回完成?}
    L -->|Y| M[更新 asset.storage_class=STANDARD]
    M --> N[通知用户可访问]
    L -->|N| K
```

### 5.7 资产引用计数与克隆共享（新增）

画布工作流克隆时，工程包含大量中间资产（视频片段、合成产物等），**禁止整文件拷贝**，改为元数据浅拷贝 + 底层 COS 对象共享，通过引用计数管理生命周期：

```sql
-- 资产引用计数表（每个 asset 被多少工作流引用）
CREATE TABLE asset_references (
    id              BIGSERIAL PRIMARY KEY,
    asset_id        UUID NOT NULL REFERENCES assets(id),
    workflow_id     UUID,                                -- 关联工作流（NULL=用户私有资产）
    user_id         UUID NOT NULL REFERENCES users(id),  -- 资产所属用户
    ref_count       INTEGER NOT NULL DEFAULT 1,          -- 当前引用计数
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_asset_ref_user ON asset_references(asset_id, user_id);
```

**规则**（所有增减操作必须在 PG 事务内 + `SELECT FOR UPDATE` 行锁执行，防并发计数不准）：
- 用户上传/生成新资产时，`ref_count` 初始为 1。
- 克隆工作流时，克隆者获得**新的元数据行**，但底层 COS key 不变（共享存储），克隆者引用计数 +1，原作者引用计数不受影响。
- 用户删除资产时，若 `ref_count > 1` → 仅减引用计数、不删除 COS 对象；若 `ref_count = 1` → 删除 COS 对象 + 删除引用记录。
- 与模块五 5.3 生命周期联动：引用计数 > 0 的资产不会被生命周期规则迁移到归档层（避免误归档被引用的活跃对象）。

### 5.8 存储安全与体验补强

#### 5.8.1 文件上传安全

签名直传链路缺失校验，需在签名前 + 回调时补全：

| 阶段 | 校验项 | 实现 |
|---|---|---|
| 签名前（Next.js） | 类型白名单、大小上限、MIME 与扩展名一致性 | `content_type` 仅允许 image/png、video/mp4 等白名单内类型；大小 ≤ 配置上限 |
| 回调时（Next.js） | Magic Number 探测 | 读取 COS 对象头 4 字节，验证与实际 MIME 类型匹配（防 .exe 伪装 image/png） |
| 回调后（可选） | 内容安全扫描 | v1.0 接腾讯云内容安全 API（涉政/涉黄/暴恐），异步回调标记风险资产 |

#### 5.8.2 CDN 私有资产鉴权

5.2 `assets` 表已含 `visibility` 字段（`private` / `public`），根据可见性区分 CDN 策略：

- **`visibility='public'`**（工作流封面/展示物料）：落库静态 `cdn_url`，走无签名 CDN，享受 CDN 缓存。
- **`visibility='private'`**（用户上传/生成产物）：**不落库** `cdn_url`。前端请求 `GET /api/assets/[id]/url` 时，服务端现场生成 ≤5min 签名 URL 返回，签名含 `user_id` 信息。签名过期后需重新请求。
- 此设计承接 QA 报告 N2（IDOR）——确保遍历 object_key 亦无法访问他人私有资产，同时避免签名 URL 存库后被长期转发。

#### 5.8.3 归档资产取回体验

- 资产列表对归档/低频项加视觉标记（灰色背景 + 冰冻图标）。
- 取回时前端展示进度 + 预估剩余时间（5.6 Mermaid 已有 restore 流程）。
- 高频资产预测性预热：从 `access_log` 学习访问模式，v1.0 自动在访问低谷期提前取回。
- 取回完成后站内通知推送（复用 9.3 通知通道）。

```sql
-- 资产访问日志（供 5.8.3 归档预热算法使用）
CREATE TABLE access_log (
    id              BIGSERIAL PRIMARY KEY,
    asset_id        UUID NOT NULL REFERENCES assets(id),
    user_id         UUID NOT NULL,
    accessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_log_asset ON access_log(asset_id, accessed_at DESC);
```

---

## 模块六：工具服务层（仅 ffmpeg 自部署）

### 6.1 设计决策

**v1.0 阶段全部 AI 模型走外部 API（经 API 网关路由），不自部署 GPU 模型服务。**
仅 ffmpeg 作为自部署工具，用 CPU 执行音视频处理。原因：

| 风险 | 决策 |
|---|---|
| GPU 成本 | 自部署 GPU 服务器月费 ¥800–2000；外部 API 按量计费，初期用户量低成本更低 |
| 运维负担 | GPU 驱动/CUDA/显存 OOM 需要专人运维；ffmpeg 纯 CPU 零运维 |
| 模型升级 | 外部 API 由厂商维护升级；自部署需手动跟进 |
| 实际需求 | 人声分离/超分/OCR/抠图有成熟的 SaaS API 可对接；初期通过第三方 API 先满足 |

**v2.0 评估触发条件**：某工具月度调用量 > 10 万次且 API 成本 > GPU 租赁成本时，评估自部署 ROI。

### 6.2 ffmpeg 自部署工具矩阵

所有工具通过 FastAPI wrapper 暴露为 HTTP 接口，统一经网关路由，按 `TOOL_XXX` 变量名接入。

| 工具 | 对应变量名 | 核心 ffmpeg 滤镜 | 实现方式 |
|---|---|---|---|
| 去字幕 | `TOOL_DELOGO` | `delogo=x:y:w:h:show=0` | HTTP POST video + rect → processed |
| 视频压缩 | `TOOL_COMPRESS` | `libx264 -crf 28` | POST video + bitrate → compressed |
| 视频转 GIF | `TOOL_VIDEO2GIF` | `fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse` | POST video → gif |
| 音频降噪 | `TOOL_DENOISE` | `afftdn=nr=10:nf=-30` | POST audio → cleaned |
| PDF 合并/拆分 | `TOOL_PDF` | (libreoffice + ghostscript) | POST files → merged/split |
| 音频格式转换 | `TOOL_AUDIO_CONVERT` | `-acodec libmp3lame -b:a 192k` | POST audio → mp3/wav/etc |
| 视频裁剪 | `TOOL_TRIM` | `-ss start -t duration -c copy` | POST video + start/end → clip |
| 水印叠加 | `TOOL_WATERMARK` | `overlay=x:y` | POST video + image/pos → watermarked |

> 去字幕、人声分离、超分、OCR、抠图等复杂 AI 工具在 v1.0 通过第三方 API 实现（接入网关 `TOOL_XXX` 变量），v2.0 按调用量评估自部署。

### 6.3 ffmpeg 服务 Docker Compose

```yaml
# tools/docker-compose.yml
services:
  ffmpeg-worker:
    build: ./ffmpeg
    image: jrottenberg/ffmpeg:7-ubuntu  # 官方维护 ffmpeg 7
    volumes:
      - /data/tools/tmp:/tmp            # 临时文件目录
    environment:
      MAX_CONCURRENT: 4                  # 单实例最大并发处理
      MAX_FILE_SIZE_MB: 500
    ports: ["8100:8100"]
    restart: unless-stopped
    deploy:
      replicas: 2                        # 可线性扩
```

### 6.4 请求处理流程

```mermaid
sequenceDiagram
    participant F as 前端 /tools
    participant N as Next.js
    participant G as API Gateway
    participant W as ffmpeg Worker
    participant S as COS

    F->>N: POST /api/tools/compress {assetId}
    N->>N: requireAuth + 获取 cdn_url
    N->>S: 下载源文件到临时目录
    N->>G: POST /gateway/TOOL_COMPRESS {input_path, params}
    G->>W: HTTP POST {task}
    W->>W: ffmpeg -i input -crf 28 output.mp4
    W-->>G: {output_path, duration_ms}
    G-->>N: 处理结果
    N->>S: 上传结果 → 新 asset
    N-->>F: {newAssetId, cdnUrl}
```

### 6.5 并发控制与限流

- 单 ffmpeg Worker 最大并发 = CPU 核心数 × 1.5（I/O 密集，非 CPU 密集）
- Redis 计数器 `tools:active:{userId}` 限制单用户同时最多 2 个工具任务
- 长时间任务（>30s）写入 ARQ 队列异步处理，返回 `taskId` 供前端轮询

---

## 模块七：积分与计费系统

### 7.1 积分数据库表设计

已包含在模块三 3.4 节。`credit_ledger` 表新增 `official_cost_cny` / `proxy_cost_cny` / `variable_name` 三个定价引擎字段（v1.6 更新），用于毛利核算与网关变量溯源。

### 7.2 定价引擎（Pricing Engine）

定价引擎是积分计费系统的核心，采用三层价格模型确保平台在任何输入组合下都不亏损。

#### 7.2.1 三层定价模型

三层价格互不混淆，各司其职：

| 层 | 说明 | 存储位置 | 用途 |
|---|---|---|---|
| **官方保底价** | OpenAI/Anthropic/火山等官方公布的 Token/按次价 | `model_version_price` 表 | 成本上限 + 售价锚点 |
| **代理采购价** | 实际从 api.apiyi.com 等聚合平台采购的价格 | `proxy_purchase_price` 表 | 内部毛利核算与成本监控 |
| **积分售价** | 用户实际支付的积分 | 运行时 `deduct()` 函数计算 | 用户端可见的唯一价格 |

**定价公式（运行时计算）**：

```
单次调用成本(元) = f(modal, usage)        // 按模态分支计算（见 7.2.3）
单次售价(积分) = ceil(单次调用成本(元) × SELL_MULTIPLIER × INTEGRAL_PER_YUAN + FLAT_SERVICE_FEE)
```

#### 7.2.2 全局变量表

所有变量存 Redis + DB，管理员可在后台实时调整，变更全站即时生效：

| 变量名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `USD_CNY` | float | 6.79 | 美元兑人民币汇率，每日凌晨从央行中间价自动刷新 |
| `INTEGRAL_PER_YUAN` | int | 10 | 1 元人民币兑换积分数量 |
| `SELL_MULTIPLIER` | float | 1.5 | 官方价上浮倍率，覆盖平台成本与利润 |
| `FLAT_SERVICE_FEE` | int | 1 | 每次调用固定附加积分（带宽/CDN/存储摊薄） |
| `PROXY_COST_DISCOUNT` | float | 0.6 | 代理价相对于官方价的估算比例（仅成本看板用，不参与售价） |

全局变量存入 `platform_config` 表（7.6.1），与 `workflow_clone_cost` / `clone_share_ratio` 共用同一张配置表：

```sql
INSERT INTO platform_config VALUES
    ('USD_CNY',           '6.79','float','美元兑人民币汇率，每日凌晨自动刷新', NULL, now()),
    ('INTEGRAL_PER_YUAN', '10',  'int',  '1 元人民币兑换积分数量', NULL, now()),
    ('SELL_MULTIPLIER',   '1.5', 'float','官方价上浮倍率', NULL, now()),
    ('FLAT_SERVICE_FEE',  '1',   'int',  '每次调用固定附加积分', NULL, now());
```

#### 7.2.3 模态分支计算逻辑

```python
def calculate_cost_cny(modal: str, usage: Usage, official_price: ModelVersionPrice) -> float:
    """
    modal: text / image / video / audio / tool
    usage: 包含 input_tokens / output_tokens / cache_tokens / image_count / duration_seconds
    official_price: 从 model_version_price 表查出的官方价记录
    """
    if modal == 'text':
        input_cost = usage.input_tokens / 1_000_000 * official_price.input_cny_per_1m
        output_cost = usage.output_tokens / 1_000_000 * official_price.output_cny_per_1m
        cache_cost = usage.cache_tokens / 1_000_000 * official_price.cache_cny_per_1m
        return input_cost + output_cost + cache_cost

    elif modal == 'image':
        return usage.image_count * official_price.per_call_cny

    elif modal == 'video':
        return usage.duration_seconds * official_price.per_second_cny

    elif modal in ('audio', 'tool'):
        return official_price.per_call_cny

    else:
        raise ValueError(f'Unknown modal: {modal}')
```

与网关四级分类（模块四）的映射关系：`variable_name`（TEXT_MODEL / IMAGE_MODEL 等）→ 网关 `variable_mappings` 表查 → `modal_category` + `vendor` + `model_version` → `model_version_price` 表查官方价。

#### 7.2.4 官方价表（model_version_price）

```sql
CREATE TABLE model_version_price (
    id              SERIAL PRIMARY KEY,
    modal           VARCHAR(32) NOT NULL,              -- text / image / video / audio / tool / model_3d
    vendor          VARCHAR(64) NOT NULL,              -- openai / anthropic / tencent / volcengine / stability
    model_version   VARCHAR(128) NOT NULL,             -- gpt-4o / claude-opus-4.8 / sora-2 / gpt-image-2
    -- 文本模型专用（元/百万 token）
    input_cny_per_1m   NUMERIC(12,6),
    output_cny_per_1m  NUMERIC(12,6),
    cache_cny_per_1m   NUMERIC(12,6),
    -- 图像/音频/工具模型专用（元/次）
    per_call_cny       NUMERIC(12,6),
    -- 视频模型专用（元/秒）
    per_second_cny     NUMERIC(12,6),
    updated_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE(modal, vendor, model_version)
);

CREATE INDEX idx_mvp_modal_vendor ON model_version_price(modal, vendor);
```

**初始化数据示例**（以当前市场实际价为准，美元价 × `USD_CNY`）：

```sql
-- 文本类
INSERT INTO model_version_price (modal, vendor, model_version, input_cny_per_1m, output_cny_per_1m, cache_cny_per_1m) VALUES
('text', 'openai',    'gpt-4o',            28.38, 113.52, 7.10),
('text', 'openai',    'gpt-4o-mini',       2.38,  9.54,   0.60),
('text', 'anthropic', 'claude-opus-4.8',   56.76, 283.80, 7.10),
('text', 'anthropic', 'claude-sonnet-4.6', 5.67,  28.38,  0.71);

-- 图像类（按次）
INSERT INTO model_version_price (modal, vendor, model_version, per_call_cny) VALUES
('image', 'openai', 'gpt-image-2-low',    0.04),
('image', 'openai', 'gpt-image-2-medium', 0.36),
('image', 'openai', 'gpt-image-2-high',   1.43);

-- 视频类（按秒）
INSERT INTO model_version_price (modal, vendor, model_version, per_second_cny) VALUES
('video', 'openai', 'sora-2', 0.80);

-- 工具类（按次）
INSERT INTO model_version_price (modal, vendor, model_version, per_call_cny) VALUES
('audio', 'tencent', 'mps-audio',      0.10),
('tool',  'tencent', 'mps-video-sr',   0.20);
```

**设计要点**：
- **官方价是天花板**：代理涨价时毛利压缩但不亏损；代理跑路切官方时平台也不亏损。
- **新增模型**：只需插一行 `model_version_price` + 在网关四级分类挂上 `variable_name`，前端零改动，积分售价自动算。
- **汇率每日刷新**：`USD_CNY` 变量每天凌晨从央行中间价接口拉取更新。

#### 7.2.5 代理采购价表（proxy_purchase_price）

仅用于成本核算与毛利看板，不参与前端售价计算：

```sql
CREATE TABLE proxy_purchase_price (
    id                      SERIAL PRIMARY KEY,
    model_version           VARCHAR(128) NOT NULL,
    source_name             VARCHAR(64) NOT NULL,     -- apiyi / azure / 自签
    purchase_cny_per_call       NUMERIC(12,6),
    purchase_cny_per_1m_input   NUMERIC(12,6),
    purchase_cny_per_1m_output  NUMERIC(12,6),
    snapshot_date               DATE NOT NULL,
    UNIQUE(model_version, source_name, snapshot_date)
);
```

**设计要点**：
- **代理价是秘密**：只存在内部成本看板，**永远不暴露给用户**。
- 每日定时任务从 api.apiyi.com 等聚合平台抓取最新价格，写入快照行。用于生成毛利看板中"官方价 vs 代理价 vs 实收"三柱对比。

#### 7.2.6 特殊覆盖表（pricing_override）

允许对特定 `variable_name` 设置固定积分值，覆盖自动计算公式。用于 Beta 促销、活动定价、限时免费等场景：

```sql
CREATE TABLE pricing_override (
    variable_name   VARCHAR(64) PRIMARY KEY,
    fixed_integral  INT,
    reason          VARCHAR(256),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
-- 示例：
-- INSERT INTO pricing_override VALUES ('IMAGE_MODEL', 5, 'Beta 促销价');
-- INSERT INTO pricing_override VALUES ('WORKFLOW_CLONE', 0, 'Beta 免费期');
```

`deduct()` 函数优先查此表：命中则用 `fixed_integral`，跳过后面的官方价 → 公式链路。

#### 7.2.7 积分扣除流程（deduct 函数）

```python
async def deduct(user_id: int, variable_name: str, usage: Usage) -> DeductResult:
    """
    核心扣费函数，所有模型调用前必须调用。返回实际扣除的积分数量。
    """
    # 1. 查找变量映射（网关四级分类），获取 modal / vendor / model_version
    mapping = await get_variable_mapping(variable_name)

    # 2. 检查是否有固定覆盖（如 Beta 期间 IMAGE_MODEL 锁 5 积分）
    override = await get_pricing_override(variable_name)
    if override and override.fixed_integral is not None:
        integral_to_deduct = override.fixed_integral
        cost_cny = 0  # 覆盖模式下不查官方价
    else:
        # 3. 获取官方价
        official = await get_official_price(mapping.modal, mapping.vendor, mapping.model_version)

        # 4. 按模态计算人民币成本
        cost_cny = calculate_cost_cny(mapping.modal, usage, official)

        # 5. 套公式算积分售价
        integral_to_deduct = math.ceil(
            cost_cny * settings.SELL_MULTIPLIER
            * settings.INTEGRAL_PER_YUAN
            + settings.FLAT_SERVICE_FEE
        )

    # 6. 预扣积分（数据库事务内原子操作——余额读取与扣减必须在同一事务）
    async with db.transaction():
        # 事务内用 UPDATE ... RETURNING 获取原子余额快照（消除 TOCTOU）
        result = await db.execute(
            update(UserCredits).where(
                UserCredits.user_id == user_id,
                UserCredits.balance >= integral_to_deduct,
                UserCredits.version == current_version,    # 乐观锁
            ).values(
                balance=UserCredits.balance - integral_to_deduct,
                total_spent=UserCredits.total_spent + integral_to_deduct,
                version=UserCredits.version + 1,
            ).returning(UserCredits.balance)
        )
        if result.rowcount == 0:
            raise InsufficientBalanceError(code=3001, msg='积分余额不足或并发冲突')
        new_balance = result.scalar_one()

        await insert_ledger(
            user_id=user_id,
            amount=-integral_to_deduct,
            balance_after=new_balance,           # 数据库返回的真实余额，非事务外读取的旧值
            variable_name=variable_name,
            modal=mapping.modal,
            official_cost_cny=cost_cny,
            proxy_cost_cny=await estimate_proxy_cost(mapping, usage),
            reference_id=usage.request_id,
        )

    # 7. 异步记录代理成本（不阻塞主流程）
    asyncio.create_task(log_proxy_cost(mapping, usage))

    return DeductResult(integral_deducted=integral_to_deduct)
```

**设计要点**：
- `settings.SELL_MULTIPLIER` / `INTEGRAL_PER_YUAN` / `FLAT_SERVICE_FEE` 从 Redis `config:*` 热读（7.6.1 热更新机制），秒级生效。
- `pricing_override` 命中时跳过官方价查询与公式计算，直接返回固定值。Beta 期间开放少量变量覆盖，正式上线后回收为超级管理员工具。
- `proxy_cost_cny` 异步记录，不阻塞用户请求（代理 API 偶有网络延迟）。

#### 7.2.8 代理价抓取脚本（每日定时）

```python
async def fetch_proxy_prices():
    """
    每日凌晨 3:00 从 api.apiyi.com / ModelPricing.ai 抓取最新代理价。
    使用 ModelPricing.ai REST API（免费层 2000 次/天）。
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            'https://api.modelpricing.ai/v1/estimate',
            json={'models': ['gpt-4o', 'gpt-image-2', 'claude-sonnet-4.6',
                             'claude-opus-4.8', 'sora-2'],
                  'currency': 'CNY'}
        )
        data = resp.json()
        for item in data['models']:
            await upsert_proxy_price(
                model_version=item['model'],
                source_name='apiyi',
                purchase_cny_per_call=item.get('per_call_cny'),
                purchase_cny_per_1m_input=item.get('input_cny_per_1m'),
                purchase_cny_per_1m_output=item.get('output_cny_per_1m'),
                snapshot_date=date.today()
            )
        # 写入后触发毛利看板刷新
        await recalculate_margin_dashboard()
```

部署为 ARQ cron 任务（`cron_queue`，每日 03:00）。

#### 7.2.9 后台配置页面与毛利看板

| 页面模块 | 功能 | 权限 |
|---|---|---|
| 全局变量配置 | 修改 USD_CNY / INTEGRAL_PER_YUAN / SELL_MULTIPLIER / FLAT_SERVICE_FEE，实时生效 | 超级管理员 |
| 官方价表管理 | 按模态/厂商筛选，CSV/JSON 批量导入，单条编辑 | 超级管理员 |
| 代理价快照 | 只读展示最近抓取价格，与官方价对比显示"当前毛利估算" | 管理员 |
| 特殊覆盖管理 | 按 variable_name 设置固定积分值，填写原因 | 超级管理员 |
| 积分模拟器 | 选模型 + 填假 usage → 预览实际扣分（`/api/admin/pricing/simulate`） | 管理员 |
| **毛利看板** | 各模态：官方成本 vs 代理成本 vs 实收积分 × 汇率倒推人民币，算出毛利率；附趋势图（7/30 天） | 管理员 |

毛利看板 API：`GET /api/admin/economy/margin?modal=&days=30`，输出 `{ modal, official_total_cny, proxy_total_cny, integral_total, revenue_est_cny, margin_pct }`，与 7.8 积分经济仪表盘共用 Grafana 面板。

#### 7.2.10 实际算账示例

以 `gpt-image-2 medium` 为例，三层价格流转：

```
┌────────────────────────────────────┐
│ 官方保底价（model_version_price）   │
│   per_call_cny = $0.053 × 6.79    │
│                = 0.36 元/张        │
├────────────────────────────────────┤
│ 代理采购价（proxy_purchase_price） │
│   purchase_cny_per_call = $0.03   │
│                        × 6.79     │
│                       = 0.20 元/张│
├────────────────────────────────────┤
│ 积分售价（deduct() 自动算）        │
│   = ceil(0.36×1.5×10 + 1)        │
│   = ceil(5.4 + 1) = 6 积分/张     │
├────────────────────────────────────┤
│ 平台毛利（每张图）                  │
│   收入：6 积分 ≈ 0.6 元           │
│   成本：0.20 元（代理采购价）      │
│   毛利：0.40 元/张（毛利率 67%）   │
└────────────────────────────────────┘
```

### 7.3 充值流程（支付宝/微信支付回调）

```mermaid
sequenceDiagram
    participant U as 用户
    participant N as Next.js
    participant P as PG
    participant ALI as 支付宝
    participant WX as 微信支付

    U->>N: POST /api/billing/recharge {package_id,pay_method}
    N->>P: INSERT credit_orders (status=pending)
    N-->>U: { qr_code / redirect_url }

    U->>ALI: 扫码支付
    ALI->>N: POST /api/billing/callback/alipay {trade_no,total_amount,sign}
    N->>N: 验签
    N->>P: BEGIN TXN
    N->>P: UPDATE credit_orders SET status=paid,payment_trade_no=xxx
    N->>P: UPDATE user_credits SET balance=balance+amount,total_earned=total_earned+amount,version=version+1 WHERE user_id=xxx AND version=<current_version>
    N->>P: INSERT credit_ledger (type=charge,balance_after=<RETURNING balance>)
    N->>P: COMMIT
    N-->>ALI: "success"
```
**支付回调幂等设计**：支付宝/微信支付回调可能因网络波动重复投递。回调入口第一步 `SELECT payment_trade_no` + `UNIQUE` 约束保证 `INSERT` 冲突即跳过，已处理订单直接返回 `"success"`，通知支付平台不再重试。**重复回调不得重复加积分。**

### 7.4 签到/赠送/邀请奖励逻辑

```python
# billing/sign_in.py
SIGN_IN_BONUS = [5, 5, 5, 5, 5, 10, 15]  # 连续签到 7 天循环
INVITE_BONUS = 50   # 被邀请人完成首次成片，双方各得 50
NEW_USER_GIFT = 30  # 注册初始积分（从 10 提升到 30，修复 R10）

async def daily_sign_in(user_id: str, today: date) -> int:
    last = await get_last_sign_in(user_id)
    streak = (1 if last == today - timedelta(days=1) else 0) + last_streak
    bonus = SIGN_IN_BONUS[(streak - 1) % 7]
    await add_credits(user_id, bonus, 'sign_in')
    return bonus
```

### 7.5 防止积分刷取的防护措施

| 攻击面 | 防护 |
|---|---|
| 刷签到 | Redis key `sign_in:{user_id}:{date}` 幂等；同一 IP 每日注册上限 |
| 退款回滚漏洞 | 消费后立即冻结资金（`frozen_balance`），仅在任务完成/失败后才解冻或结算 |
| 虚假邀请 | 被邀请人需完成"首次成片"才发放奖励；检测批量同 IP 注册 |
| API 超扣 | 积分计算在 Gateway 侧（`calculate_cost`），与执行解耦，多扣不退款场景通过 `frozen_balance` 限制 |
| 频率限制 | Redis sliding window rate limiter：`FREE: 10 req/min`, `PAID: 30 req/min`, `VIP: 100 req/min` |

#### 7.5.1 积分扣减模式决策

| 操作类型 | 模式 | 理由 |
|---|---|---|
| 克隆 / 工具使用 | **直接扣费**（同步） | 扣分是同步瞬时完成的，无需冻结；**仅画布克隆的异步资产复制失败时才发生补偿退款**（积分已扣、复制失败后通过 3.8.4 回调退分成），此退款概率极低且走补偿模式而非冻结模式 |
| 模型调用（单模型页生成） | **冻结 → 结算**（异步） | 视频生成 1–2 min；先冻结、任务完成后结算；超时/失败则解冻退款 |
| Agent 成片 | **冻结 → 结算**（异步多步） | 分镜多步编排，每步阶段冻结、全部完成后结算 |

### 7.6 工作流克隆积分分成机制（新增）

#### 7.6.1 分成公式与后台配置

设管理员配置的每次克隆消耗积分 `workflow_clone_cost = X`（整数，Beta 期填 0），分享者分成比例 `clone_share_ratio = R`（整数 0–100，默认 50）：

```
克隆者消耗积分        = X
分享者获得积分        = X × R // 100
平台留存积分（收入）  = X - (X × R // 100)
```

`clone_share_ratio` 作为可配置项，支持未来分层运营（如头部创作者 R=60）。初始 Beta 值 R=50（50%/50% 平分）。

后台配置表：

```sql
CREATE TABLE platform_config (
    key             VARCHAR(64) PRIMARY KEY,
    value           TEXT NOT NULL,
    value_type      VARCHAR(16) NOT NULL DEFAULT 'string',  -- int/string/json/bool
    description     VARCHAR(512),
    updated_by      UUID,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_config VALUES
    ('workflow_clone_cost', '0', 'int', '每次克隆消耗积分，分享者获 clone_share_ratio%，平台留余', NULL, now()),
    ('clone_share_ratio',   '50','int', '分享者分成百分比（0-100），默认 50 即 50%/50%', NULL, now()),
    ('daily_clone_limit',  '50','int', '单用户每日克隆次数上限', NULL, now());
```

配置修改日志（审计）：

```sql
CREATE TABLE platform_config_log (
    id          BIGSERIAL PRIMARY KEY,
    key         VARCHAR(64) NOT NULL,
    old_value   TEXT,
    new_value   TEXT NOT NULL,
    changed_by  UUID,
    reason      VARCHAR(512),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**配置热更新机制**：`platform_config` 中 `workflow_clone_cost`、`daily_clone_limit` 等定价项的读取走 Redis 缓存（key `config:workflow_clone_cost`，TTL 5min）。后台管理员修改配置时，同步 `DELETE` Redis 缓存 key → 下次读取从 PG 加载新值 → 秒级生效，**无需重启**服务。

**Beta 期 `cost=0` 的全链路约定**：即使 `workflow_clone_cost=0`，克隆仍**完整执行**三流水写入（金额均为 0）、`clone_records` UNIQUE 记录、通知推送、统计字段更新；仅跳过余额校验与扣减。这是确保正式上线后平滑切换的关键——若 Beta 跳过流水/通知，收费时链路可能未验证。

#### 7.6.2 三流水原子事务（克隆分成核心链路）

一次有效的克隆行为（首次、跨用户、非自克隆）必须在单个数据库事务内**原子地**写入三条流水记录，共用同一 `share_record_id`：

```python
# billing/clone.py
async def execute_clone_charge(
    db: AsyncSession,
    cloner_id: UUID,
    author_id: UUID,
    workflow_id: UUID,
    workflow_title: str,
    clone_type: str,          # one_click / canvas / agent
    config_cost: int,         # workflow_clone_cost
    share_ratio: int = 50,    # clone_share_ratio，从 platform_config 读取
) -> str:                     # → share_record_id
    share_record_id = uuid4()
    share_amount = config_cost * share_ratio // 100
    platform_amount = config_cost - share_amount

    async with db.begin():
        # 1. 克隆者支出
        await db.execute(
            update(UserCredits).where(
                UserCredits.user_id == cloner_id,
                UserCredits.version == current_version,
                UserCredits.balance >= config_cost,
            ).values(
                balance=UserCredits.balance - config_cost,
                total_spent=UserCredits.total_spent + config_cost,
                version=UserCredits.version + 1,
            )
        )
        # 乐观锁冲突 → retry or raise

        db.add(CreditLedger(
            user_id=cloner_id, amount=-config_cost,
            type='clone_expense', balance_after=new_balance,
            share_record_id=share_record_id, clone_type=clone_type,
            split_ratio=share_ratio, ref_workflow_id=workflow_id,
            counterparty_user_id=author_id,
            scope='clone', split_share=share_amount, split_platform=platform_amount,
            remark=f'克隆「{workflow_title}」',
        ))

        # 2. 分享者收入
        db.add(CreditLedger(
            user_id=author_id, amount=share_amount,
            type='clone_income', balance_after=author_new_balance,
            share_record_id=share_record_id, clone_type=clone_type,
            split_ratio=share_ratio, ref_workflow_id=workflow_id,
            counterparty_user_id=cloner_id,
            scope='clone', split_share=share_amount, split_platform=platform_amount,
            remark=f'您的「{workflow_title}」被克隆',
        ))
        await db.execute(
            update(UserCredits).where(
                UserCredits.user_id == author_id,
                UserCredits.version == author_version,    # 分享者也需乐观锁防并发资损
            ).values(
                balance=UserCredits.balance + share_amount,
                total_earned=UserCredits.total_earned + share_amount,
                version=UserCredits.version + 1,
            )
        )

        # 3. 平台收入（归入公共积分池）
        await db.execute(
            update(PlatformCreditPool).values(
                total=PlatformCreditPool.total + platform_amount,
            )
        )
        db.add(CreditLedger(
            user_id=None,  # 平台流水无单用户
            amount=platform_amount,
            type='clone_platform',
            share_record_id=share_record_id,
            clone_type=clone_type, split_ratio=share_ratio,
            ref_workflow_id=workflow_id,
            counterparty_user_id=None,
            scope='clone', split_share=share_amount, split_platform=platform_amount,
            remark='克隆撮合服务费',
        ))

    return share_record_id
```

**设计要点**：
- 三条流水在同一事务内：任一条失败全部回滚，永不出现"扣了钱没分"或"分了钱没扣"。
- 乐观锁（version）防止并发扣超余额。
- `balance_after` 在克隆者/分享者流水写入时计算最新值，平台流水无 `user_id`（挂 `NULL`）。

### 7.7 平台公共积分池（新增）

平台公共积分池与用户钱包隔离，归入所有「平台留存」积分，用于冲抵算力成本与运营支出：

```sql
CREATE TABLE platform_credit_pool (
    id              SERIAL PRIMARY KEY,
    total           BIGINT NOT NULL DEFAULT 0,          -- 累计平台留存积分
    source          VARCHAR(32) NOT NULL,               -- clone_share / manual / adjustment
    note            VARCHAR(512),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 统计视图（平台收入来源分布）
CREATE VIEW platform_credit_summary AS
SELECT
    source,
    SUM(total) AS total_credits,
    COUNT(*)   AS txn_count
FROM platform_credit_pool
GROUP BY source;
```

**与用户池的隔离**：
- 用户充值/消耗走 `user_credits` 与 `credit_ledger`（`user_id` 有值）。
- 平台收入走 `platform_credit_pool` + `credit_ledger`（`user_id IS NULL`，`scope='clone'`）。
- 对账时按 `scope` 区分：`scope='clone'` 计入平台收入；`scope IN ('model_call','tool_use')` 计入用户算力消耗。
- API：`GET /api/admin/platform-credits` 返回平台积分总额与来源分布。

### 7.8 积分经济仪表盘（新增）

#### 7.8.1 数据口径

| 指标 | SQL 查询逻辑 | 用途 |
|---|---|---|
| 全站积分发行总量 | `SELECT SUM(amount) FROM credit_ledger WHERE type IN ('charge','gift','sign_in') AND amount > 0` | 流动性供给 |
| 全站积分消耗总量 | `SELECT SUM(ABS(amount)) FROM credit_ledger WHERE scope IN ('model_call','tool_use','clone') AND amount < 0` | 流动性回收 |
| 日均积分流通量 | 发行+消耗 按 7/30 日平均值 | 通胀/通缩判断 |
| `workflow_clone_cost` 建议值 | 每日 cron 计算：`IF (消耗增速 > 发行增速) → 建议上调；IF (余额中位数下降明显) → 建议下调` | 辅助运营 |
| 手动调整日志 | `SELECT * FROM platform_config_log WHERE key='workflow_clone_cost' ORDER BY created_at DESC` | 审计 |

#### 7.8.2 API 设计

```
GET /api/admin/economy/dashboard
  → {
      total_issued: 1500000,
      total_consumed: 980000,
      daily_circulation_7d: 45000,
      daily_circulation_30d: 38000,
      recommended_clone_cost: 10,        # 建议值
      trend: 'inflating' | 'deflating' | 'stable',
      top_sharers: [...],                # Top 分享者榜
      top_cloned_workflows: [...],       # Top 被克隆工作流
      config_log: [...]                  # workflow_clone_cost 调整日志
    }
```

实现方式：按需查 PG 聚合 + Redis 缓存近 24h 指标（key `econ:dashboard`，TTL 5min）。

#### 7.8.3 监控告警

新增告警规则（module 8.4 补充）：
- 克隆支出占比 > 30% 全站消耗 → 通知（可能定价过高/过低异常）。
- `platform_credit_pool` 增长趋势异常（日增 > 均值 3σ） → 排查是否存在刷克隆。

### 7.9 克隆防刷机制（新增）

与模块七 7.5（通用防刷）互补，新增克隆专项防护：

| 防护项 | 实现 | SQL / 代码路径 |
|---|---|---|
| 同一用户克隆同一工作流仅首次扣费 | `clone_records` 表 `UNIQUE(cloner_id, source_workflow_id)` 约束；克隆前 `SELECT EXISTS` | `billing/clone.py::check_first_clone()` |
| 禁止自克隆获利 | `IF cloner_id == author_id → 跳过计费，直接返回克隆结果` | 克隆入口 `require_auth != author` 分支 |
| 每日克隆次数上限 | Redis key `clone:cnt:{user_id}:{YYYY-MM-DD}` INCR + EXPIRE；超 `daily_clone_limit` → 429 | rate limiter middleware |
| 克隆记录幂等 | `clone_records` 表 + `share_record_id` UNIQUE 约束防重复扣费 | DB UNIQUE index |

```sql
-- 克隆记录表（防刷 + 审计）
CREATE TABLE clone_records (
    id                  BIGSERIAL PRIMARY KEY,
    share_record_id     UUID UNIQUE NOT NULL,            -- 关联 credit_ledger.share_record_id
    cloner_id           UUID NOT NULL REFERENCES users(id),
    source_workflow_id  UUID NOT NULL,
    clone_type          VARCHAR(16) NOT NULL,
    cost                INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(cloner_id, source_workflow_id)                -- 同一用户同一工作流只计费一次
);
```

| 攻击面 | 防护 |
|---|---|
| 刷克隆次数获利 | 每日上限 + `clone_records` UNIQUE 约束 + 同 IP 多账号检测（v2.0） |
| 自克隆套取分成 | 克隆入口硬编码 `if cloner == author → skip billing` |
| 并发重复克隆扣费两次 | `share_record_id` UNIQUE（DB 层） + Redis 分布式锁 `clone:lock:{workflow_id}:{user_id}`（应用层） |
| 克隆流水与账户余额不一致 | 三流水在同一 PG 事务内写入；每日凌晨对账脚本 `reconcile_clone_ledger()` |



### 8.1 生产环境架构图

```mermaid
graph TB
    subgraph Cloud["☁️ 腾讯云 / 阿里云"]
        CVM["云服务器 4C8G<br/>Docker 宿主机"]
        subgraph Docker["Docker Compose"]
            FE["Next.js<br/>:3000"]
            BE["FastAPI GW<br/>:8080"]
            WK["ARQ Worker<br/>(2 instances)"]
            TOOLS["ffmpeg Workers<br/>(2 replicas)"]
            PG["PostgreSQL"]
            REDIS["Redis"]
        end
        COS["COS 对象存储<br/>+CDN 加速"]
    end
    subgraph OnPrem["🏠 自建机房/家中"]
        NAS["NAS / MinIO<br/>rclone 周备份"]
    end

    Internet --> CDN
    CDN --> COS
    CDN --> CVM
    CVM --> NAS
    NAS -.-> |"VPN / WireGuard"| CVM
```

### 8.2 Docker Compose 生产编排方案

```yaml
# docker-compose.prod.yml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: agentcut
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: agentcut
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports: ["5432:5432"]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports: ["6379:6379"]
    restart: unless-stopped

  nextjs:
    build: ./agentcut
    environment:
      DATABASE_URL: postgresql://agentcut:${DB_PASSWORD}@postgres:5432/agentcut
      REDIS_URL: redis://redis:6379
      GATEWAY_BASE_URL: http://gateway:8080
      JWT_SECRET: ${JWT_SECRET}
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
    restart: unless-stopped

  gateway:
    build: ./api_gateway
    environment:
      DATABASE_URL: postgresql+asyncpg://agentcut:${DB_PASSWORD}@postgres:5432/agentcut
      REDIS_URL: redis://redis:6379
      FERNET_KEY: ${FERNET_KEY}
    expose: ["8080"]               # 仅内网可达，禁止对外暴露（3.3 仅 Next.js proxy 做鉴权）
    depends_on: [postgres, redis]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build: ./agentcut  # 复用 Next.js 镜像，运行 ARQ worker
    command: arq worker.WorkerSettings --burst  # 或 --keepalive
    environment:
      DATABASE_URL: postgresql://agentcut:${DB_PASSWORD}@postgres:5432/agentcut
      REDIS_URL: redis://redis:6379
    depends_on: [postgres, redis]
    restart: unless-stopped
    scale: 2

  # ffmpeg 工具服务（独立 compose：docker compose -f tools/docker-compose.yml up）
  # nginx 作为反向代理（可选）
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on: [nextjs, gateway]
    restart: unless-stopped

volumes:
  pg_data:
```

### 8.3 CI/CD 流水线

```yaml
# .github/workflows/deploy.yml
name: Deploy AgentCut
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint & Type Check (Next.js)
        run: cd agentcut && npm ci && npm run lint && npx tsc --noEmit
      - name: Test (FastAPI Gateway)
        run: cd api_gateway && pip install -r requirements.txt && pytest tests/ -v

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build & Push Docker images
        run: |
          docker build -t agentcut-nextjs ./agentcut
          docker build -t agentcut-gateway ./api_gateway
          # tag & push to registry (Docker Hub / TCR)

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_KEY }}
          script: |
            cd /opt/agentcut
            docker compose pull
            docker compose up -d --remove-orphans
```

### 8.4 监控与告警方案

| 组件 | 方案 | 采集内容 |
|---|---|---|
| 指标采集 | Prometheus | 自采集（FastAPI metrics、Next.js custom metrics、PostgreSQL exporter、Redis exporter） |
| 可视化 | Grafana | Dashboard：Gateway 成功率/延迟 P50/P95/P99、积分散费、资产分层占比、CDN 流量 |
| 日志收集 | Loki + Promtail | 所有容器 stdout/stderr → Loki → Grafana 关联查询 |
| 告警 | Alertmanager | 规则：Gateway 5xx>5% 持续 5min、调用延迟 P99>10s、连续 3 次熔断未恢复、积分扣减异常、NAS 备份超 8 天未跑、**克隆分成异常（platform_credit_pool 日增量 > 3σ）**、**克隆支出占比 > 30% 全站消耗** |
| 通知通道 | 企业微信/钉钉/飞书 Webhook | 按告警级别路由 |

### 8.5 成本估算（月度，小规模运营阶段）

| 项目 | 规格 | 月费估算 |
|---|---|---|
| 云服务器（Docker 宿主机） | 4C8G + 100G SSD | ¥300 |
| ffmpeg Worker 实例 | 2C4G ×2（CPU 处理） | ¥200 |
| 云数据库 PostgreSQL | 2C4G 50G | ¥200（若自部署则省，但推荐托管 PGAutoBackup） |
| 云存储 COS | 存储 500GB（标准+低频+归档混合） | ¥60 |
| CDN 流量 | 1000GB/月 | ¥200 |
| API 调用成本 | 第三方模型按量付费 | ¥500–2000（取决于用量） |
| 总计 | | **¥1260–2560/月** |

> v2.0 扩展预估：用户量×10 → 月费 ×3–5（因云资源可弹性扩；总成本非线性）。自建 NAS 去云存储 500GB 后存储费接近 0。

### 8.6 水平扩展方案

| 组件 | 扩展策略 | 触发条件 |
|---|---|---|
| Next.js 前端 | 无状态，扩容实例 + Nginx upstream | CPU>70% 持续 5min |
| FastAPI Gateway | 同 Next.js，纯无状态 | QPS>500 |
| ARQ Worker | 增加 consumer 实例数 | 队列积压>100 |
| ffmpeg Worker | 增加 replicas（线性扩展） | 排队时间 P95>30s，CPU>70% |
| PostgreSQL | 读写分离（Pgpool-II）+ 读副本扩容 | 写入 TPS>500 或读 QPS>2000 |
| Redis | Sentinel 主从 + 故障自动切换 | 内存>80% 告警 → 垂直扩容 |

### 8.7 运维补强

#### 8.7.1 Gateway 端口收敛

3.3 明确 Gateway 不独立鉴权（仅 token 透传），因此 Gateway **禁止映射宿主机端口**。将 compose 中 `gateway: ports: ["8080:8080"]` 改为仅内部暴露（`expose: ["8080"]` 或不加 ports），外部请求统一走 `Nginx → Next.js proxy → Gateway:8080`。

#### 8.7.2 Redis 高可用

Redis 当前单实例承载缓存 + Session + 队列 + 锁 + 限流，为全站单点。v1.0 前升级为 Sentinel 主从：

```yaml
# 补充到 docker-compose.prod.yml
redis-sentinel:
  image: redis:7-alpine
  command: redis-sentinel /etc/redis/sentinel.conf
  depends_on: [redis]
```

ARQ 任务队列开启 `appendonly yes` + AOF，关键任务（克隆积分）走 Redis Streams 消费确认，防重启丢任务。

#### 8.7.3 健康检查与优雅停机

```yaml
# 各服务加 healthcheck
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

Worker 收到 SIGTERM 时停止接新任务、等待进行中任务（≤5 min）完成或超时回退队列、再退出。`docker compose down --timeout 300` 给足缓冲。

#### 8.7.4 分布式链路追踪与错误聚合

- **链路追踪**：引入 OpenTelemetry SDK，`traceparent` header 贯穿 `Nginx → Next.js → Gateway → Worker → 模型 API`。Grafana 已有，可直接接 OTLP endpoint 展示 trace 瀑布图。
- **错误聚合**：前后端统一接 Sentry SDK。`global-error.tsx` 捕获 React 异常；FastAPI 用 `sentry-asgi` 中间件。

#### 8.7.5 密钥管理

`JWT_SECRET`/`FERNET_KEY`/`DB_PASSWORD` 当前明文 env。v1.0 改用云 KMS（腾讯云 KMS / HashiCorp Vault）外挂密钥。`FERNET_KEY` 加密所有 API 源密钥，需支持版本化轮换：

```sql
-- fernet_keys 表：支持双密钥期轮换（旧 key 解密存量，新 key 加密新增）
CREATE TABLE fernet_keys (
    key_id      INTEGER PRIMARY KEY,
    key_value   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at  TIMESTAMPTZ     -- 旧 key 标记退休时间，退休后仅用于解密
);
```

**轮换流程**（非全表一次性重加密）：
1. 生成新 key → INSERT `fernet_keys`（`retired_at=NULL`）
2. Gateway 用新 key 加密所有新数据；解密时先试新 key，失败则遍历 `retired_at IS NULL` 的旧 key
3. 后台 cron 逐步用新 key 重加密 `api_sources.api_key_encrypted` 存量数据
4. 存量全量迁移完成后，旧 key 设 `retired_at=now()`

---

## 模块九：工作流市场支撑能力（新增）

> 对应产品文档第 11 章。承接模块七的「交易清算」，本模块补齐「供给侧发布 + 发现分发 + 通知激励」，让克隆分成市场真正运转起来。

### 9.1 完整业务链路（一图说明）

```
创作者生成产物（单模型/画布/Skill）
        │
        ▼
   [分享到市场] POST /workflow/[id]/publish
        │  ┌─ 写 workflows 表 status='pending_review'
        │  ├─ 快照当前参数/节点/连线 JSON
        │  └─ 写 cover_asset_id（缩略图/预览）
        │
        ▼
   [管理员审核] 后台管理 → 工作流审核列表
        │  ┌─ GET /admin/workflow/review-queue
        │  ├─ 预览工作流内容与模型参数
        │  ├─ 操作：approve → status='published'
        │  ├─        recommend → is_recommended=true + priority 设值
        │  └─        reject → status='draft' + 附审核说明
        │
        ▼
   [展示在工作流页面] 三个 Tab 中可见
        │  ┌─ /workflow?tab=one_click → 单模型模板
        │  ├─ /workflow?tab=canvas → 画布工作流
        │  └─ /workflow?tab=agent → Agent Skill
        │
        ▼
   [克隆者浏览/搜索/排序/筛选]
        │  ┌─ 搜索：q=国风 → PG tsvector 全文检索
        │  ├─ 排序：sort=hot → 热度分（clone数×3 + 收藏数×1 + 时间衰减）
        │  ├─ 筛选：模态/标签/
        │  └─ 推荐位：管理员设 is_recommended=true 的内容优先展示
        │
        ▼
   [克隆者点击克隆] POST /workflow/[id]/clone
        │  → 模块七 7.6 三流水事务 → 扣积分 + 分积分
        │
        ▼
   [通知分享者] INSERT notifications (type=clone_income)
        │  ┌─ 站内铃铛："「您的 XX」被克隆，获得 Y 积分"
        │  └─ credits_ledger 已有 remark 记录（不再重复建通知流水）
        │
        ▼
   [克隆者资产到账] 一键同款→产物入资产空间 / 画布→工程复制 / Skill→Agent 页
```

### 9.2 工作流发布链路：数据库表设计

```sql
-- 工作流主表（草稿 ↔ 已发布共用，通过 status 控制）
CREATE TABLE workflows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id),
    tab             VARCHAR(16) NOT NULL,               -- one_click / canvas / agent

    title           VARCHAR(256) NOT NULL,
    description     TEXT,
    cover_asset_id  UUID,                               -- 缩略图/预览图
    tags            TEXT[] DEFAULT '{}',                 -- 标签（PG array），如 {"国风","卡点","竖屏"}
    modal_category  VARCHAR(32),                        -- text / image / audio / video / model_3d

    -- 工作流内容快照（发布时锁定）
    config_json     JSONB NOT NULL,                     -- 一键同款：{variable_name, prompt, params}；画布：{nodes,edges}；Skill：{shot_list,agent_config}
    source_asset_ids UUID[] DEFAULT '{}',               -- 关联资产（画布中间产物）

    -- 发布状态机
    status          VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft / pending_review / published / taken_down
    is_recommended  BOOLEAN NOT NULL DEFAULT FALSE,     -- 管理员推荐位
    priority        INTEGER NOT NULL DEFAULT 0,          -- 推荐排序优先级（越大越前）
    review_comment  VARCHAR(1024),                       -- 审核说明（驳回/下架原因）

    -- 统计字段（写入时 UPDATE 增量）
    clone_count     INTEGER NOT NULL DEFAULT 0,
    favorite_count  INTEGER NOT NULL DEFAULT 0,
    view_count      INTEGER NOT NULL DEFAULT 0,

    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 工作流 schema 版本管理
    config_version  INTEGER NOT NULL DEFAULT 1           -- config_json 的结构版本；升级时对旧版本做兼容迁移
);

CREATE INDEX idx_workflows_tab_status ON workflows(tab, status) WHERE status = 'published';
CREATE INDEX idx_workflows_tab_rec ON workflows(tab, is_recommended, priority DESC) WHERE is_recommended = TRUE;
CREATE INDEX idx_workflows_author ON workflows(author_id, created_at DESC);
CREATE INDEX idx_workflows_search ON workflows USING GIN(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE INDEX idx_workflows_tags ON workflows USING GIN(tags);
```

**状态机规则**：

```
draft ──→ pending_review    （创作者点"发布"）
pending_review ──→ published（管理员 approve）
pending_review ──→ draft     （管理员 reject，附 review_comment）
published ──→ taken_down     （管理员下架 / 创作者自行下架）
taken_down ──→ draft         （创作者修改后重新提交审核）
```

**审核 API**（后台管理，需 `requireAdmin`）：
```
GET    /admin/workflows/review-queue?status=pending_review&page=
POST   /admin/workflows/[id]/review  { action: "approve"|"reject", comment: "..." }
POST   /admin/workflows/[id]/recommend  { is_recommended: true, priority: 10 }
POST   /admin/workflows/[id]/takedown   { comment: "因侵权/违规而下架" }
```

**审核阶段规划**：

| 阶段 | 方案 | 说明 |
|---|---|---|
| Beta | **人工审核 + 举报入口** | 小规模邀请制，内容量可控；管理员在后台逐条 approve/reject |
| v1.0 | 机审前置 + 人审抽检 | 调腾讯云内容安全 API（涉政/涉黄/暴恐），机审通过的自动上架、机审拒绝的自动驳回，灰区人工复审 |

**克隆体生命周期规则**（避免用户预期混乱）：

- **克隆 = 发布时快照**：克隆者获得的内容是工作流发布时刻的固定副本。源作者更新工作流后，已克隆的旧副本**不随源更新**。
- **下架仅影响公域**：工作流被 `taken_down` 后，从展示页移除；已克隆到用户空间的副本**保留可用**，已产生的分成**不回退**。
- **源删除不硬删**：若作者删除工作流，已克隆副本不受影响（因为克隆是浅拷贝元数据，底层资产由模块五引用计数保护）。

### 9.3 通知服务

#### 9.3.1 数据库表

```sql
CREATE TABLE notifications (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(32) NOT NULL,               -- clone_income / workflow_reviewed / system_notice
    title           VARCHAR(256) NOT NULL,               -- 「您的「国风卡点」被克隆」
    body            TEXT,                                -- 详细说明
    ref_id          UUID,                                -- 关联工作流/流水等 ID
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE is_read = FALSE;
```

#### 9.3.2 触发逻辑

```python
# billing/clone.py 中，三流水事务 COMMIT 后追加：

async def send_clone_notification(
    db: AsyncSession,
    author_id: UUID,
    cloner_username: str,
    workflow_title: str,
    share_amount: int,
    workflow_id: UUID,
):
    db.add(Notification(
        user_id=author_id,
        type='clone_income',
        title=f'「{workflow_title}」被 {cloner_username} 克隆',
        body=f'您获得 {share_amount} 积分分成',
        ref_id=workflow_id,
    ))
    # 如果三流水中 credit_ledger 可查到作者流水，body 内可附带 share_record_id
```

**设计要点**：
- 通知写入在积分事务**之后**（非同一事务），避免通知写失败回滚积分（积分为主，通知可补）。
- 后续扩展渠道：企业微信/钉钉 Webhook、邮件（v1.0）。
- **审核结果通知**（AC-404）：管理员 approve/reject 时同步写 `Notifications(type='workflow_reviewed', title='您的「XX」已通过/被驳回', body=review_comment)`，触发创作者站内铃铛。

#### 9.3.3 前端交互

- 顶部导航栏铃铛图标 + 未读红点（`GET /notifications/unread-count`，3 秒轮询）。
- 点击铃铛 → 下拉列表（最近 20 条）+ 「查看全部」跳转通知页。
- 单条点击 → 标记已读 + 跳转到关联工作流详情。

#### 9.3.4 创作者收益看板（新增）

> 对应产品决策「积分是平台统一流通货币」。创作者需看到「克隆分成赚了多少、能抵多少成片成本」，激励闭环才闭合。

```
GET /api/me/creator-stats
  → {
      total_clone_income: 1250,          # 累计分成积分
      income_this_month: 320,            # 本月分成
      income_trend_6m: [200, 250, ..., 320],  # 近 6 月趋势
      top_cloned_workflows: [             # 被克隆最多的 Top 5
        { workflow_id, title, clone_count, total_earned }
      ],
      estimated_savings: {               # 这些积分能抵多少成片
        image_generations: 125,          # 约 125 张图
        video_minutes: 41,               # 约 41 分钟视频
      }
    }
```

前端入口：个人中心页新增「收益看板」卡片，直接取 `GET /me/creator-stats` 渲染。另在铃铛通知列表底部加「查看收益详情」入口。

### 9.4 搜索与排序

#### 9.4.1 API 设计

```
GET /api/workflows/list
  ?tab=canvas                          # Tab 过滤
  &q=国风卡点                           # 关键词（标题+描述全文检索）
  &tags=国风,竖屏                       # 标签筛选（AND/OR 后台可配）
  &modal=video                         # 模态过滤
  &sort=hot                            # 默认 hot(热门)；可选 new(最新) / recommended(推荐)
  &page=1&page_size=20
```

#### 9.4.2 热度排序算法

```python
# workflow/ranking.py
from datetime import datetime, timezone

def hot_score(clone_count: int, favorite_count: int, view_count: int, published_at: datetime) -> float:
    """
    参考 Hacker News 排名算法，带时间衰减。
    分数 = (clone×3 + favorite×1 + view×0.1) / (age_hours + 2)^1.2
    """
    now = datetime.now(timezone.utc)
    age_hours = (now - published_at).total_seconds() / 3600
    quality = clone_count * 3 + favorite_count * 1 + view_count * 0.1
    return quality / ((age_hours + 2) ** 1.2)
```

**SQL 实现**（`sort=hot` 时）：

```sql
SELECT *,
       (clone_count * 3 + favorite_count * 1 + view_count * 0.1)
       / POWER(EXTRACT(EPOCH FROM (now() - published_at))/3600 + 2, 1.2) AS score
FROM workflows
WHERE tab = 'canvas' AND status = 'published'
  AND (to_tsvector('simple', title || ' ' || coalesce(description,'')) @@ plainto_tsquery('simple', '国风'))
ORDER BY score DESC
LIMIT 20 OFFSET 0;
```

**排序优先级**：
1. `sort=recommended`：管理员推荐位优先（`is_recommended DESC, priority DESC`），无推荐则降级为 hot。
2. `sort=hot`：热度分降序。
3. `sort=new`：`published_at DESC`。

**PG 全文检索说明（Beta 降级方案）**：`tsvector` + `simple` 分词对中文匹配效果差（全串匹配而非分词匹配）。**Beta 阶段实际使用 `ILIKE '%关键词%'` + PG `pg_trgm` 三元组 GIN 索引**，在万级数据量下性能足够。v2.0 上升级 Elasticsearch + jieba 分词实现真正的中文全文检索。

### 9.5 正奇数积分的余数归属（P2 补明）

已有代码 `share_amount = config_cost // 2; platform_amount = config_cost - share_amount`，当 `config_cost` 为奇数时，余数 1 归平台公共积分池。公式不变，此处仅作显式声明防误读。

### 9.6 与已有模块的联动索引

| 新增能力 | 关联已有模块 |
|---|---|
| `workflows` 表 + 发布审核 | 模块三 3.2 API 路由（`/workflows/publish`、`/admin/*`） |
| 克隆后通知 | 模块七 7.6 三流水事务（`COMMIT` 后追加 notify） |
| 搜索/排序 | 模块三 3.2 API 路由（`/workflows/list` 参数补全） |
| 热度分统计更新 | 克隆/收藏/浏览时增量更新 `workflows.clone_count/favorite_count/view_count` |
| 克隆者资产落点 | 模块五 存储系统（一键同款→新 asset、画布→工程复制、Skill→agent thread） |
| 资产引用计数去重 | 模块五 5.7（`asset_references` 表 + 删除时引用归零判定，画布克隆共享 COS 对象） |
| 数据迁移与回滚 | 模块三 3.7（Next.js Prisma + FastAPI Alembic 双轨迁移策略） |
| 克隆体生命周期 | 模块九 9.2（克隆=快照不随源更新；taken_down 仅影响公域；已分成不回退） |

### 9.7 通知与协作体验补强

#### 9.7.1 通知改 SSE 推送

当前 3 秒轮询 `GET /notifications/unread-count`。复用已有 Agent SSE 基础设施，改为 SSE 推送：

```
客户端 SSE 连接 GET /notifications/stream?ticket=xxx
  → 服务端校验 ticket（9.7.1 模式）
  → 保持长连接
  → 有新通知时推送 event: notification
```

- 好处：克隆分成、审核结果即时感知，取消 3s 轮询的无效请求。
- 降级：SSE 断连时回退到 polling。

#### 9.7.2 画布协作冲突可视化

- 节点被锁定时：显示编辑者头像/光标 + 禁用输入 + tooltip "XX 正在编辑"。
- 心跳断开 15s 自动释放锁（防用户关页面导致死锁）。
- WebSocket 重连时自动重新获取锁状态。

#### 9.7.3 积分消耗前置透明

- 生成按钮点击前，内联展示 `calculate_cost` 结果："本次消耗 X 积分（你余额 Y）"。
- 余额不足时提前提示 + 「去充值」入口，而非生成时报错。
- 克隆按钮同理，展示 `workflow_clone_cost`。

---

### 5.9 存储配额、CDN 缓存与 Range 支持（SPEC 补全）

#### 5.9.1 用户存储配额

```sql
CREATE TABLE user_storage_quota (
    user_id     UUID PRIMARY KEY REFERENCES users(id),
    used_bytes  BIGINT NOT NULL DEFAULT 0,    -- 已用字节
    total_bytes BIGINT NOT NULL DEFAULT 21474836480  -- 默认 20GB
);
CREATE INDEX idx_usage_alert ON user_storage_quota(user_id) WHERE used_bytes > total_bytes * 0.8;
```

- AC-211：`GET /api/assets/storage-usage` 返回 `{ used_mb, total_mb }`，精确到 MB。
- AC-212：used_bytes ≥ total_bytes × 80% → Alertmanager 告警管理员。
- 资产上传/删除时异步增量更新 used_bytes（Redis counter + 批次落库）。

#### 5.9.2 CDN 差异化缓存策略

| 资源类型 | Content-Type | Cache-Control max-age | 说明 |
|---|---|---|---|
| 图片/音频 | image/*, audio/* | 604800（7 天） | 生成产物，变更频率低 |
| 视频 | video/* | 86400（1 天） | 可能被重新生成覆盖 |
| API / 动态 | application/json | no-cache | 禁止 CDN 缓存 API 响应 |

CDN 回源配置按上述规则设置 `Cache-Control` 头。对齐 SPEC AC-206。

#### 5.9.3 Range 分片支持

- CDN + COS 均启用 Range 请求透传，视频播放器通过 HTTP `Range: bytes=` 头分片加载，支持拖拽播放（AC-208）。
- 归档取回流程（5.6）中，RestoreObject 完成的文件同样走 CDN + Range。

---

### 6.6 工具定价覆盖（pricing_override）

ffmpeg 自部署工具（去字幕/压缩/转 GIF/降噪/格式转换等）不经过外部 API，定价引擎无官方价来源。统一走 `pricing_override` 固定积分：

```sql
INSERT INTO pricing_override (variable_name, fixed_integral, reason) VALUES
    ('TOOL_DELOGO',        1, '轻量工具'),
    ('TOOL_COMPRESS',      1, '轻量工具'),
    ('TOOL_VIDEO2GIF',     1, '轻量工具'),
    ('TOOL_DENOISE',       1, '轻量工具'),
    ('TOOL_AUDIO_CONVERT', 1, '轻量工具'),
    ('TOOL_WATERMARK',     1, '轻量工具'),
    ('TOOL_STRIP_SUBTITLE',5, '重量工具'),
    ('TOOL_SEPARATE_VOCAL',5, '重量工具'),
    ('TOOL_UPSCALE',       5, '重量工具');
```

轻量工具 ≤1 积分、重量工具 =5 积分。对齐 SPEC AC-603/604。

---

#### 7.2.9 后台配置页面与毛利看板（续：模拟器与导入）

**积分模拟器 API** (AC-316)：

```
POST /api/admin/pricing/simulate
  { variable_name: "IMAGE_MODEL", usage: { image_count: 10 } }
  → {
      cost_cny: 3.60,               // 官方成本分解
      sell_multiplier: 1.5,
      integral_per_yuan: 10,
      flat_fee: 1,
      integral_total: 55,           // ceil(3.6*1.5*10+1)
      override: null                // 若有覆盖，显示固定值
    }
```

**官方价批量导入** (AC-317)：

```
POST /api/admin/pricing/import
  Content-Type: multipart/form-data
  { file: <csv|json> }
  → { imported: 15, skipped: 2, errors: [{ row: 3, reason: "vendor 不存在" }] }
```
UNIQUE(modal,vendor,model_version) 冲突时执行 upsert（覆盖更新），校验失败行回执。

---

## 模块十：智能剪辑页

> 对应 SPEC 3.5。为独立于 ffmpeg 工具矩阵（模块六）的端到端剪辑流水线。

### 10.1 处理流程

```
用户上传素材(视频+图片+音频)
    → [预处理 10s] 抽缩略图、分析时长、生成分镜候选 (AC-501)
    → [Agent 30s] LangGraph Agent 分析素材 → 输出剪辑 JSON: clips[] + subtitles[] + bgm + transitions (AC-502)
    → [ffmpeg 合成 60s] ARQ clip_queue 执行合成 → 成片 MP4 (AC-503)
    → 成片自动写入用户资产空间 → CDN 分发 (AC-505)
```

### 10.2 数据库表

```sql
CREATE TABLE clip_projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    source_asset_ids UUID[] NOT NULL DEFAULT '{}',  -- 原始素材
    clip_json       JSONB,                           -- Agent 输出的剪辑方案
    output_asset_id UUID,                            -- 合成后成片
    status          VARCHAR(16) DEFAULT 'preprocessing',  -- preprocessing/agent_planning/compositing/done/failed
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 10.3 AC 对标

| AC | 目标 | 实现 |
|---|---|---|
| AC-501 | 预处理 10s | 素材上传后 ARQ `clip_queue` 异步抽帧+分析，10s 内返回进度 |
| AC-502 | Agent 30s 输出剪辑 JSON | LangGraph 分析→生成 clip_json，超时 30s |
| AC-503 | ffmpeg 合成 60s | `clip_queue` 执行 ffmpeg 合成，3min 内素材 ≤60s |
| AC-504 | 失败有明确错误提示+重试按钮 | 前端展示中文错误（如"音频格式不支持"）+ 重试入口 |
| AC-505 | 成片入资产空间+CDN | 合成产物自动写入 assets 表 + CDN 分发 |

---

## 模块十一：页面联动

> 对应 SPEC 3.7。统一跨六页的资产传递 API，保证接收方用户资产空间自动写入。

### 11.1 联动矩阵

| 发送方 | 接收方 | 传递内容 | AC |
|---|---|---|---|
| 单模型页 | 画布页 | 生成产物(asset) + prompt + 参数 | AC-701 |
| 单模型页 | 智能剪辑页 | 视频产物 → 作为剪辑素材 | AC-701 |
| 工具集合页 | 画布页 | 处理结果 → 作为画布节点输入 | AC-702 |
| Agent 全功能页 | 工具集合页 | 子步骤触发工具 | AC-703 |
| 智能剪辑页 | 画布页 | 中间产物可二次编辑 | AC-704 |

### 11.2 统一 API

```
POST /api/link/send
  { target_page: "canvas"|"clip"|"tools", asset_ids: [...], context: {...} }
  → { transfer_id }
```

**AC-705 保证**：接收方自动将 asset 写入自身资产空间（`assets.user_id = target_user_id` + 新 `object_key = target_user_id/uuid/...`）。

---

## 附录：关键风险与备选方案

| 模块 | 风险 | 备选方案 |
|---|---|---|
| 整体 | Docker Compose 管理 8+ 服务运维负担 | v2.0 上 Kubernetes（K3s 轻量版） |
| 前端 | Next.js 全栈边界模糊（API Route + Server Component 滥用） | 强制 API 层全部走 Gateway proxy，Server Component 仅做渲染 |
| 后端 | FastAPI 与 Next.js 双框架协调复杂度 | 若团队 Python 偏弱，Gateway 改用 Node.js（Express + TypeScript），LangGraph 独立进程 |
| 网关 | 单点故障（Gateway 挂则所有模型不可用） | Gateway 部署 ≥2 实例 + Nginx 负载均衡 |
| 存储 | 归档取回耗时 1-5 分钟影响体验 | 提供"紧急取回"模式（加速收费）+ 前端进度提示 |
| 积分 | 消耗与执行解耦的时序问题（先扣后做，失败退款） | 严格实行"冻结→结算"模式，`frozen_balance` 对账脚本每日运行 |
| 克隆分成 | 三流水事务失败（DB/Redis 异常） → 货币资损 | 统一 PG 事务 + 每日对账；`share_record_id` UNIQUE 防重复；告警监控 |
| 备份 | rclone 网络中断导致备份空洞 >7 天 | 监控脚本 + 告警，同时开启 COS 跨地域复制作为第二道备份 |

---

> **文档版本**：v1.7 / 2026-07-27
> **关联文档**：AgentCut产品文档.md、QA测试报告.md、AgentCut存储系统技术方案.md、api_gateway/ 代码框架
> **v1.2 更新摘要**：新增模块九「工作流市场支撑能力」——发布链路（draft→pending_review→published→taken_down 状态机 + workflows 表 DDL + 审核 API）、通知服务（notifications 表 + 克隆分成触发通知）、搜索/排序（PG tsvector 全文检索 + 热度分算法 + 推荐位）
> **v1.3 更新摘要**：HY3 PM 评价后补齐 11 项不明确点——克隆异步执行模型（3.5 clone_queue）、资产引用计数（5.7 asset_references 表）、审核分阶段方案（Beta 人审 / v1.0 机审）、cost=0 全链路跑通约定、clone_cost 热更新机制、中文搜索 Beta 降级方案（ILIKE+pg_trgm）、创作者收益看板 API、默认排序值与推荐兜底、克隆体生命周期规则（快照不随源、下架仅隐公域）、数据迁移双轨策略（3.7）、config_json schema 版本字段
> **v1.4 更新摘要**：DeepSeek-V4-Pro / GLM-5.2 双架构师评价后全部补入（20 项）——
工程缺漏 12 项：Gateway 端口收敛（8.7.1+8.2 compose）、SSE/WS 鉴权 ticket 模式（3.8.2）、CDN 私有资产签名鉴权+visibility 字段（5.8.2）、双框架数据层收敛路线（3.8.3）、跨框架事务 outbox 补偿（3.8.4）、冻结/直扣决策表（7.5.1）、文件上传安全校验（5.8.1）、Redis 高可用+Streams 持久化（8.7.2）、分布式 trace+Sentry 错误聚合（8.7.4）、健康检查+优雅停机（8.7.3）、密钥管理 KMS/FERNET 轮换（8.7.5）、API 版本化 /v1/ 前缀（3.8.1）；
UX 建议 8 项：生成进度+预估时间（3.8.6）、积分前置透明（9.7.3）、失败重试+部分保留（3.8.6）、归档取回预热+视觉标记（5.8.3）、画布协作冲突可视化+锁释放（9.7.2）、通知改 SSE 推送（9.7.1）、SSR/SSG 渲染策略+移动端 PWA（2.1）、资产页懒加载+虚拟滚动（5.8.3）
> **v1.5 更新摘要**：HY3 资深架构师复审后补入 10 条（P0×5 + P1×5）——文档内部矛盾与信任边界修复：
P0 硬伤 5 项：①Gateway 旁路自校验 JWT（3.3 设计决策表）②credit_ledger.user_id 改为 nullable（3.4 DDL）③支付回调 payment_trade_no UNIQUE + 幂等说明（7.3）④Agent SSE/threads 鉴权补齐（3.8.2 标题+内容覆盖两处）⑤克隆退款口径统一（7.5.1 决策表）；
P1 文档矛盾 5 项：⑥clone 跨框架事务改为 HTTP 回调补偿模式（3.8.4）⑦clone_share_ratio 可配置 + 7.6.2 代码公式从 //2 改为读配置（7.6.1/7.6.2）⑧assets.visibility 字段补入 DDL + access_log 表（5.2/5.8.3）⑨私有/公有 CDN URL 策略区分（5.8.2 重写）⑩Beta 建 users_sync 镜像表避免金融表 FK 挂 Prisma users（3.8.3）
> **v1.6 更新摘要**：集成 AgentCut 定价引擎（7.2 完全重写）——三层定价模型（官方保底价 / 代理采购价 / 积分售价）配公式 `ceil(成本×倍率×汇率+固定费)`；全局变量表（USD_CNY 每日自动刷新 / INTEGRAL_PER_YUAN / SELL_MULTIPLIER / FLAT_SERVICE_FEE）；模态分支计算逻辑 text/image/video/audio/tool 五类；新增 `model_version_price` 官方价表、`proxy_purchase_price` 代理价表（仅成本看板）、`pricing_override` 特殊覆盖表（Beta 促销）；`deduct()` 核心扣费函数（优先查覆盖 → 官方价 → 按模态算 CNY 成本 → 套公式算积分）；每日代理价抓取脚本（ModelPricing.ai API + ARQ cron）；后台配置页（全局变量/官方价管理/代理价快照/特殊覆盖/积分模拟器/毛利看板）+ 毛利看板 API；初始化 seed 数据 + gpt-image-2 medium 完整算账示例（毛利率 67%）。3.4 credit_ledger 新增 `official_cost_cny` / `proxy_cost_cny` / `variable_name` 字段。旧 `credit_pricing` 表被 `model_version_price` + 定价公式替换。
> **v1.7 更新摘要**：双审计报告（SPEC 合规 + 安全架构）22 项完全接受项全部落地——
- **4.4 熔断器**：从无熔断逻辑升级为 pybreaker 实例，per-source fail_max=5/open 30s/half-open，对齐 AC-108。
- **4.4/3.5 超时规格**：Gateway 主源超时 5s/重试 2 次（AC-101）+ 长任务/流式模型豁免 5s 切换（NF-06）。
- **7.2.7 TOCTOU**：deduct() 余额读取移入事务内，用 `UPDATE...RETURNING` 消除账本快照误差。
- **7.6.2 clone 版本锁**：分享者 UPDATE 补 `WHERE version=author_version`（同克隆者的乐观锁）。
- **7.3 充值乐观锁**：回调加积分 UPDATE 走 version 比对。
- **3.8.4 补偿重试**：HTTP 回调失败入 ARQ compensation_queue，指数退避×5 → 死信+告警。
- **8.7.5 fernet 完整 DDL**：ferent_keys→fernet_keys（拼写修复）+ 双密钥期轮换流程（非一次性全表重加密）。
- **5.2/5.7 object_key**：{user_id}/{uuid}/{sanitized_name} 命名空间 + asset_references 所有增减走 `SELECT FOR UPDATE`。
- **4.3 缓存 TTL**：兜底 TTL 从 5-10min 收敛到 60s（对齐 AC-103/307/313）。
- **5.9 存储补强**（新增小节）：`user_storage_quota` 表 + 80% 告警（AC-211/212）；CDN 差异化缓存（图片/音频 7d、视频 1d、API nocache）（AC-206）；Range 分片透传（AC-208）。
- **6.6 工具定价覆盖**（新增小节）：ffmpeg 轻量工具=1 积分、重量=5 积分，走 pricing_override（AC-603/604）。
- **7.2.9 续**：补积分模拟器 API 契约 + 官方价 CSV/JSON 批量导入接口（AC-316/317）。
- **9.3 审核通知**：approve/reject 触发 `type=workflow_reviewed` 通知创作者（AC-404）。
- **7.6.2 残余硬编码**：split_ratio=50 → share_ratio（对齐 v1.6 引入的 clone_share_ratio 配置）。
- **模块十（新增）**：智能剪辑页端到端链路（预处理→Agent→ffmpeg 合成）+ clip_projects 表 + AC-501~505 全部覆盖。
- **模块十一（新增）**：页面联动统一 `POST /api/link/send` + 跨页资产写入接收方空间（AC-701~705）。
