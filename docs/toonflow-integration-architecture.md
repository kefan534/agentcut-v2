# Toonflow × AgentCut v2 结合架构文档

> 版本：v1.3 ｜ 日期：2026-08-13 ｜ 作者：AgentCut 工程 ｜ 修订：v1.2 审查修订；v1.3 确认 5 项待确认问题，更新阶段计划与依赖
> 范围：将开源项目 Toonflow（AI 短剧创作工具）以「React 重写 + 后端移植」方式融入 AgentCut v2，复用 AgentCut 的模型路由与统一设计系统。
> 说明：本文档基于 Toonflow 仓库源码（HBAI-Ltd/Toonflow-app，`master` @ bc61ec7）与 AgentCut v2 当前代码的事实梳理，不是臆测。

---

## 0. 结论速览

1. **Toonflow 不是网页应用**：它是 Electron + Express 5 + better-sqlite3 + socket.io + vm2 的**桌面应用**。前端源码后续已取得（独立仓库 `Toonflow-web`，Vue 3 工程），但**前端整合选定 Route B：按 AgentCut 风格 React 重写**（否决 Route A 部署 Vue 原版）。因此"融合"= 用 React 在 AgentCut 内重写其界面，并把后端逻辑移植进 AgentCut 的 FastAPI/PostgreSQL。
2. **最值钱、最难搬的是"供应商系统 + AI 编排"**：它用 `vm2` 沙箱运行 TS 供应商脚本，再用 Vercel AI SDK 调用模型，重度依赖 tool calling / reasoning / fullStream。这部分**不应原样移植**（Python 无 vm2、Vercel SDK 是 TS 生态），而应**复用 AgentCut 已有的 `ApiSource` + `call_upstream` 模型路由层**替代它。
3. **数据层 26 张表，关系清晰**：以 `o_project` 为根，向下挂 novel/script/assets/tasks/video/storyboard。迁移到 PostgreSQL 主要是类型/保留字/JSON 处理，无大坑。
4. **合规可用**：Apache-2.0 + 作者补充协议，公开部署到 agentcut.cn 需走"扶持期书面授权"（早期零成本）。署名义务永久保留。

---

## 1. 背景与目标

| 项 | 内容 |
|---|---|
| 目标 | 在 AgentCut v2 通栏导航新增「短剧工坊」入口，点进去是"通栏保留 + 左栏模块导航 + 右栏工作区"，把 Toonflow 的短剧创作能力网页化并入 AgentCut |
| 非目标 | 不维护独立 Toonflow 桌面端；不保留 Electron/Express 双服务并存（采用"React 重写 + 后端移植"而非 iframe/API 代理） |
| 价值 | 统一用户体系、统一模型路由（API Key/积分/计费）、统一设计语言、统一部署 |

已完成的地基：前端「短剧工坊」外壳（通栏入口 + 左栏 12 模块导航 + 右栏 `Outlet`）已搭好并部署，当前为占位页。

---

## 2. Toonflow 现状架构（基于源码）

### 2.1 技术栈

- **运行形态**：Electron 桌面应用（主进程 `scripts/main.ts` 起 Express 服务 + 加载 SPA）。编译产物 `data/web/index.html` 由 Vue 3 源码构建（见 §2.6）。
- **后端**：Express 5 + `better-sqlite3`（经 knex 查询构建器）+ socket.io + `express-ws`（预留）。
- **AI 调用**：Vercel AI SDK（`ai`）+ `@ai-sdk/openai` 等，供应商通过 `vm2` 沙箱以 TS 代码动态加载。
- **前端（编译产物）**：Electron 加载 `data/web/index.html`（minified 单文件 SPA，由独立仓库 `Toonflow-web` 的 Vue 3 源码构建，经 `viteSingleFile` 打成单文件嵌入）。**前端真正源码在 `Toonflow-web`（Vue 3.5 + Vite + Pinia + Vue Router + vue-i18n + TDesign Vue Next + @vue-flow/core 节点编辑器 + Monaco + socket.io-client + @webav）**，已克隆到本地 `Toonflow-web-master`，详见 §2.6。

### 2.2 数据层（26 张表，knex `createTable` 构建）

- 初始化：`src/utils/db.ts` → knex(client: better-sqlite3)；建表 `src/lib/initDB.ts`（26 表的 `TableSchema[]`），迁移 `src/lib/fixDB.ts`（addColumn 等幂等助手，事实上的 migration）。
- 主键均为 `integer`，**值由应用层赋值**（如 `Date.now()`），**无自增**。
- 复杂对象以 `JSON.stringify` 存 `TEXT`（如 `o_vendorConfig.inputValues`、`o_agentWorkData.data`、`o_imageFlow.flowData`、`o_skillList.embedding`）。
- 仅 3 处声明了数据库级外键（`o_eventChapter`、`o_assets.imageId`、`o_skillAttribution.skillId`）；其余关联靠应用层 `where` 维护。

**核心实体关系（以 `o_project` 为根）**：

```
o_user ──< o_project
o_project ──< o_novel ──< o_eventChapter >── o_event
o_project ──< o_script ──< (o_scriptAssets) >── o_assets
o_project ──< o_storyboard ──< (o_assets2Storyboard) >── o_assets
o_assets ──< o_image (声明FK) ｜ o_assets.assetsId 自引用(衍生资产)
o_assets ──< (o_assetsRole2Audio) >── o_assets(audio)
o_project ──< o_tasks (状态聚合视图, 由生成流水线写入)
o_project ──< o_agentWorkData (key='scriptAgent'/'productionAgent', 存大JSON流程)
o_video ── o_videoTrack (互指) ｜ o_storyboard ──< o_video
支撑表: o_artStyle, o_prompt, o_agentDeploy, o_vendorConfig, o_modelPrompt,
        o_imageFlow, o_skillList+attribution, memories, o_setting
```

### 2.3 AI 编排与供应商系统（核心、最难搬）

**供应商 = 一段 TS 代码**（如 `data/vendor/openai.ts`、`toonflow.ts`），在 `vm2` 沙箱运行，暴露 4 个适配器：
- `textRequest(model, think, thinkLevel)` → 返回 Vercel AI SDK 的 `LanguageModel`
- `imageRequest(config, model)` → `Promise<string>`（图片 URL/base64）
- `videoRequest(config, model)` → `Promise<string>`
- `ttsRequest(config, model)` → `Promise<string>`（**当前多为空 stub**）

沙箱内注入了 `createOpenAI / createDeepSeek / createOpenAICompatible / createMinimax / createAnthropic …` 等工厂。凭据来自 DB 表 `o_vendorConfig.inputValues`（baseUrl/apiKey），模型清单 `o_vendorConfig.models`。

**调用链路（一次"生成内容"）**：
1. 业务/对话入口 → `u.Ai.Text/Image/Video("vendorId:modelName")`
2. `resolveModelName` 解析 `vendorId:modelName` → 查 `o_vendorConfig` + `o_agentDeploy` → 加载沙箱 → 用 DB 的 `inputValues` 覆盖默认值
3. 文本：`textRequest` 返回 `LanguageModel` → Vercel `streamText({model, tools, stopWhen})` 发真实 `/chat/completions`（HTTP）
4. 图像/视频：`fetch/axios` 直连供应商自有端点（`/image/generateImage`、`/video/generateVideo`）+ **轮询**异步任务状态
5. 流式结果经 socket.io `content:add/content:update` 推送前端

**重度依赖 Vercel AI SDK 特性**：tool calling 多步循环（`stopWhen: stepCountIs(tools*50)`）、`extractReasoningMiddleware`（思考标签）、`fullStream` 区分 `reasoning-delta`/`text-delta`/`error`、memory 作为 tool 注入、子 Agent 以 tool 形式递归编排（`scriptAgent`→storySkeleton/adaptationStrategy/script/supervision；`productionAgent`→deriveAssets/generateAssets/directorPlan/storyboardGen/…）。

### 2.4 功能模块与 API（169 个路由模块，统一 `/api` 前缀）

| 模块 | 职责 | 关键端点 |
|---|---|---|
| project | 项目管理 + 视觉/导演手册(MD) | add/get/edit/del + visualManual*/directorManual* |
| task | 任务看板（只读聚合，状态来自各生成表） | getTaskApi/getTaskCategories/taskDetails |
| script | 剧本 CRUD + **AI 资产提取** + 导出 | addScript/extractAssets/pollScriptAssets/exportScript |
| scriptAgent | 剧本智能体对话数据 | getPlanData/setPlanData/updateData（对话走 socket） |
| novel | 小说导入/切分/事件抽取 | addNovel/generateEvents/getEvent |
| assets / assetsGenerate / artStyle / cornerScape | 资产库/资产图生成/画风/配音绑定 | generateAssets/batch/artStyle/polish/cornerScape.bindAudio |
| production（最大） | 分镜/图片工作流/视频合成台 | getFlowData/saveFlowData + storyboard/* + editImage/* + workbench/* |
| setting | 供应商与模型部署/用户/提示词/技能/记忆/DB | vendorConfig/*（含 vm2 加载校验）、agentDeploy、promptManage、skillManagement、dbConfig |
| modelSelect | 模型列表 | getModelList/getModelDetail |
| login | 登录 | login（JWT，明文密码，无角色） |
| agents / general / common / other / test | 记忆/统计/工具 | getMemory/generalStatistics/getBigImage/version |

### 2.5 认证与实时通信

- **认证**：`POST /api/login/login` → 校验 `o_user`（默认 `admin/admin123`，**明文密码**）→ `jsonwebtoken` 签 `Bearer` token（payload `{id,name}`，180 天，密钥 `tokenKey` 存 `o_setting`）。全局中间件校验，白名单仅 login。socket.io 侧独立 `jwt.verify(handshake.auth.token)`。
- **实时**：socket.io 两个命名空间 `/api/socket/scriptAgent`、`/api/socket/productionAgent`；4 类 emit：`message` / `message:update` / `content:add` / `content:update`。长任务（图/视频）用 REST `polling*` + DB `state` 字段，**不**靠 socket 推。
- **前端（运行态）**：纯 JSON API + 内置 SPA（由 Vue 3 构建，见 §2.6），**无 SSR、无模板引擎**。

### 2.6 前端源码与整合路线

**源码已取得**：原 `Toonflow-app` 仓库仅有构建产物 `data/web/`（约 25MB 单文件 SPA）；但前端**真正源码在独立仓库 `Toonflow-web`**（Vue 3.5 工程，86×`.vue` + 43×`.ts`）。已克隆到本地 `Toonflow-web-master`，技术栈见 §2.1。这意味着"前端融合"有两条候选路线，而非只能从 API 反推：

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A：Vue 原版独立部署（保真·最快）** | 把 Vue 应用原样构建（本就单文件 HTML），部署到 `agentcut.cn/drama` 子路径作独立 SPA，后端接 AgentCut 模型路由 | 100% 还原原 UI、工作量最小 | 站点并存 **两套框架**（Vue SPA + React 主站）；样式需额外对齐；TDesign 与 AgentCut 设计系统割裂；运维两套构建链 |
| **B：按 AgentCut 风格 React 重写（统一）** | 用 React + AgentCut 设计系统（purple-500 / shadcn token / `UserLayout`/`DramaLayout`/`PageContainer`）重写各功能页 | 技术栈统一、视觉一致、复用既有前端基础设施、单构建链 | 工作量更大：Vue Flow 节点编辑器、Monaco、TDesign 组件需用 React 生态等价实现（React Flow、Monaco Editor、shadcn 组件） |

**决策：选 B（按 AgentCut 风格 React 重写）。** 理由：
1. **技术栈统一**：React 已是 AgentCut 主力，避免主站 + 短剧工坊双框架并存带来的构建/部署/依赖/样式割裂。
2. **视觉与体验一致**：直接套用 AgentCut 设计 token，用户无需在两种 UI 语言间切换。
3. **基础设施复用**：`UserLayout`/`DramaLayout`/`PageContainer`/SSE 流式消费等已落地，重写是"填充功能页"而非"另起炉灶"。
4. **长期维护成本更低**：Route A 看似省力，实则把"双框架债"长期背在身上，且 Vue 原版的 TDesign 组件与 AgentCut 后续设计演进会持续分叉。

**关键约定**：`Toonflow-web-master`（Vue 源码）作为**权威参考**——其 API 契约、socket 事件名、数据模型、节点编辑器交互逻辑均可直接照抄到 React 实现中，但**不复制代码、不引入 Vue 构建链**。合规义务（LICENSE/NOTICES/补充协议署名）同样适用于该源码。

---

## 3. AgentCut v2 现状与对接点

### 3.1 前端
- React + TS + Vite + **Tailwind v4 + shadcn token**（品牌色 `purple-500`，中性 `stone`，侧栏 `bg-sidebar`/`border-sidebar-border`）。
- 路由：`createBrowserRouter` + `UserLayout`（渲染 `AppTopNav` + `Outlet`）。导航项在 `navigation-tools.ts`。
- 全站统一容器 `PageContainer`（`mx-auto max-w-7xl px-6`）。
- **已落地外壳**：通栏新增 `drama` 入口「短剧工坊」；`/drama/*` 路由挂 `DramaLayout`（左栏 `DramaSidebar` + 右 `Outlet`），12 个占位模块页（项目/任务看板/剧本编辑/剧本智能体/小说/资产库/资产生成/画风/配音配乐/分镜/合成工作台/模型与部署）。

### 3.2 后端模型路由（关键对接面）
- `ApiSource`：`base_url` / `endpoint_path`（默认 `/v1/chat/completions`）/ `api_key_encrypted` / `modal_category`（text|image|audio|video）。
- `VariableMapping`：把逻辑名 `TEXT_MODEL`/`IMAGE_MODEL`/`VIDEO_MODEL` 映射到具体 `ApiSource`。
- `call_upstream` / `stream_upstream`：OpenAI 兼容代理层，统一凭据解密 + 积分计费 + 调用日志。
- 文本另有 Makers Agent 通道（`@makers/*`，私有 SSE 协议，专供 AgentCut 自身 Agent 面板，**非 OpenAI 格式**）。⚠️ **方案 (b) 下该通道将随 Makers 退场而关闭**，通用 Agent 职责由 §6.6 新建的进程内 Agent 接管，统一走 `call_upstream`（OpenAI 兼容）。

### 3.3 认证
- FastAPI `get_current_user`（JWT）。与 Toonflow 的 JWT 机制可对齐（统一用 AgentCut 用户体系，短剧工坊不再自建 `o_user`）。

### 3.4 后端现状
- `app/api/drama/*` **尚未创建**，需从零搭建 FastAPI 路由 + PostgreSQL 表。

---

## 4. 结合总体方案

### 4.1 选型（已与用户确认）
**React 重写（前端，即 Route B）+ 后端移植（FastAPI/PostgreSQL）**，且**模型调用复用 AgentCut 已有的 `ApiSource` + `call_upstream`**，不移植 Toonflow 的 `vm2`/TS 供应商沙箱。

> **命名区隔**：Route B 专指"前端整合路线"（React 重写 vs Vue 原版独立部署）；方案 (b) 专指"Agent 体系统一方案"（Makers 退场，由自建通用 Agent + 短剧 Agent 替代）。两者独立，见 §4.4 与 §6.6。

### 4.2 总体架构（见配套架构图）

```
浏览器
 └─ AgentCut v2 通栏导航（含「短剧工坊」入口）
      └─ 短剧工坊布局：左栏模块导航 + 右栏工作区（React 重写各功能页）
           └─ 调 AgentCut FastAPI：/api/v1/drama/*（新建）
                ├─ PostgreSQL（迁移 26 表 → drama_* schema）
                └─ 模型调用 → 复用 ApiSource + call_upstream
                     ├─ 文本：OpenAI 兼容 /chat/completions（含 tool calling / reasoning 透传）
                     ├─ 图像/视频：扩展 ApiSource 支持 /image/*、/video/* + 轮询
                     └─ 统一凭据/积分/计费（不再散落 o_vendorConfig）
```

### 4.3 三大融合层
1. **前端融合**：复用 `UserLayout` + `DramaLayout`，每个 Toonflow 功能页用 React 重写，套 AgentCut 设计 token。
2. **后端融合**：新建 FastAPI `/api/v1/drama/*` 模块，业务逻辑用 SQLAlchemy + PostgreSQL 重写（替代 knex + better-sqlite3）。
3. **模型路由融合**：Toonflow 的"供应商/模型"概念**收敛为 AgentCut 的 `ApiSource` + `VariableMapping`**；Toonflow 的短剧 AI 编排 Agent（scriptAgent/productionAgent 的 tool calling 流水线）用 Python 手写 supervisor-worker（裸 `openai` SDK 接 `call_upstream`）重写，**不再引入 LangGraph/canvas-agent**；全站"通用 Agent"（替代 EdgeOne Makers 的通用对话角色）见 §6.6。

### 4.4 前端整合路线决策（Route B 已选定）

> **决策状态：前端整合选 Route B —— 按 AgentCut 风格 React 重写（否决 Route A 部署 Vue 原版）。**
> 背景：已取得 `Toonflow-web`（Vue 3 真源码，见 §2.6），故"从 API 反推"不再是唯一选项，需在 A/B 间决策。最终选 B，与 AgentCut 现有技术栈、设计系统、部署链保持一致。

- **Route A（否决）**：Vue 原版独立部署到 `/drama` 子路径。代价 = 站点并存两套框架（Vue SPA + React 主站）、TDesign 与 AgentCut 设计系统割裂、双构建链运维。
- **Route B（选定）**：React + AgentCut 设计系统重写各功能页。需以 React 生态等价实现 Toonflow 的核心交互组件：**React Flow**（替代 @vue-flow/core 节点编辑器）、**shadcn 组件**（替代 TDesign Vue Next）。Monaco Editor 在 Route B 中**角色变更**：由于移除 vm2/TS 供应商沙箱，不再用于编辑供应商脚本，而是用于编辑提示词模板、自定义工具脚本等仍可复用的文本/代码场景。
- **权威参考**：`Toonflow-web-master` 的 API 契约 / socket 事件 / 数据模型 / 节点编辑器交互**直接照抄**到 React 实现，但不复制代码、不引入 Vue 构建链（详见 §2.6）。

---

## 5. 前端融合方案

- **入口/布局**：沿用已部署的「短剧工坊」外壳（`DramaLayout` + `DramaSidebar`），按 AgentCut 设计系统重做（已完成视觉对齐 + 宽度统一）。
- **页面重写清单**（对应 Toonflow 模块，去重合并）：

| 左栏分组 | React 页面 | 对应 Toonflow 模块 |
|---|---|---|
| 工作台 | 项目列表/详情、任务看板 | project、task |
| 剧本创作 | 剧本编辑、剧本智能体、小说 | script、scriptAgent、novel |
| 资产管理 | 资产库、资产生成、画风、配音配乐 | assets、assetsGenerate、artStyle、cornerScape |
| 制作 | 分镜、合成工作台 | production(storyboard/workbench/editImage) |
| 设置 | 模型与部署 | setting(vendorConfig/agentDeploy/promptManage…) |

- **流式交互**：用 AgentCut 既有 SSE 模式（`/api/v1/agent/turn` 同款 `text/event-stream`）替代 socket.io，前端用 `fetch` + `ReadableStream` 消费 `content:add/content:update` 等价事件。
- **配置页不变更心智**：模型选择不再暴露"供应商 TS 编辑"，改为在 AgentCut 管理后台维护 `ApiSource`，短剧工坊设置页只做"选模型 + 填提示词"。

---

## 6. 后端移植方案

### 6.1 数据模型迁移（SQLite → PostgreSQL）

**原则**：表结构用 SQLAlchemy 重写；保持"主键由应用赋值"的语义（不要误加 SERIAL）；JSON 字段用 `JSONB`（若需查询）或 `Text`（仅整体存取，与现状一致）。

**主要注意点**：
- 主键：`o_*` 的 `id` 为 `integer` 且应用层赋值（`Date.now()`）。PG 用 `Integer`/`BigInteger` 主键、仍由应用赋值；`Date.now()` 毫秒级可能碰撞，建议改 `BigInteger` 或 UUID。
- 保留字/关键字：`index` 是 PG 保留字；`key` 虽非 PG 保留字但属于 SQL 关键字且易产生歧义。`o_storyboard.index`、`o_setting.key`、`o_agentWorkData.key` 等建议统一改名（如 `idx`、`config_key`、`data_key`），避免加引号维护负担。
- JSON：`o_vendorConfig.inputValues` / `o_agentWorkData.data` / `o_imageFlow.flowData` / `o_skillList.embedding` 当前存 `TEXT(JSON.stringify)`。PG 可保持 `Text`，要做向量检索再换 `pgvector`。
- `sqlite_master` / `PRAGMA` 硬编码：`setting/dbConfig/*`（dbInfo/exportData/clearData/importData）用到 SQLite 系统表与 `PRAGMA foreign_keys`，PG 需改为 `information_schema`/事务控制，**不能原样搬**。
- 复合主键表（`o_assets2Storyboard`、`o_scriptAssets`、`o_assetsRole2Audio`、`o_skillAttribution`）PG 原生支持。
- 仅 3 处声明 FK，移植时按业务补全依赖删除顺序（替代"先关外键再清表"）。

**表名映射建议**：为隔离，短剧工坊表统一加前缀 `drama_`（如 `drama_project`、`drama_script`、`drama_assets`…），与 AgentCut 既有表分开；用 Alembic 管理迁移。

**多租户隔离**：所有 `drama_*` 业务表必须带 `user_id` 字段并建索引；所有 CRUD 必须按 `user_id = current_user.id` 过滤。若后续需团队协作，再新增 `drama_project_member` 显式授权表，禁止用简单外键绕过用户隔离。

**代表性示例（节选）**：
```python
class DramaProject(Base):
    __tablename__ = "drama_project"
    id = Column(BigInteger, primary_key=True)            # 应用层赋值
    name = Column(Text, nullable=False)
    intro = Column(Text)
    project_type = Column(String(64))
    image_model = Column(String(255))                   # 形如 vendorId:modelName 或 ApiSource key
    video_model = Column(String(255))
    art_style = Column(Text)
    director_manual = Column(Text)
    video_ratio = Column(String(32))
    mode = Column(String(32))
    create_time = Column(BigInteger)
    user_id = Column(BigInteger)                         # → AgentCut users.id（逻辑关联）
```

### 6.2 API 设计

- 新建 `app/api/drama/` 蓝图，前缀 `/api/v1/drama`，与现有网关/鉴权重用 `get_current_user`。
- 端点粒度对齐 Toonflow（项目/剧本/小说/资产/分镜/视频/设置…），但**模型相关端点收敛**：移除 `vendorConfig` 的 vm2 加载，改为读取 AgentCut `ApiSource`/`VariableMapping`。
- 认证：直接复用 AgentCut JWT，**删除 Toonflow 的 `o_user` + 明文密码 + 独立 tokenKey**。

### 6.3 模型路由对接（重点）

**用 AgentCut `ApiSource`/`call_upstream` 替代 Toonflow `vm2` 供应商系统**，理由：
- Toonflow 文本调用本质是 OpenAI 兼容 `/chat/completions`（经 Vercel SDK）；图像/视频是供应商 `/image/*`、`/video/*` + 轮询。
- AgentCut `call_upstream` 已能代理 OpenAI 兼容 + 统一凭据 + 积分；只需**扩展支持"媒体类" `modal_category`**（image/video 端点 + 异步轮询返回 URL）。

**映射表**：

| Toonflow 概念 | AgentCut 等价 |
|---|---|
| `o_vendorConfig`（inputValues/models，TS 沙箱） | `ApiSource`（base_url/endpoint_path/api_key/modal_category）+ `VariableMapping` |
| `o_agentDeploy.modelName = "vendorId:modelName"` | `VariableMapping.TEXT_MODEL/IMAGE_MODEL/VIDEO_MODEL` → `ApiSource` |
| `textRequest` → `createOpenAI(...).chat(model)` | `call_upstream(modal_category=text)` 原样转发 body（含 `tools`/`tool_calls`/`reasoning_content`） |
| `imageRequest`/`videoRequest` → `fetch /image/*` + 轮询 | 扩展 `ApiSource(modal_category=image/video)` 指向供应商 `/image/*`、`/video/*`，`call_upstream` 支持提交+轮询 |
| 模型列表（`getModelList`） | `GET /api/v1/gateway/models` 或新增 `/api/v1/drama/models` 聚合 `ApiSource` |
| `ttsRequest`（空 stub） | 若需配音，新增 `modal_category=audio` 的 `ApiSource` |

**关键透传要求**：`call_upstream` 必须保留 `tools`/`tool_calls`/`reasoning_content`/`function_call` 等字段，否则 Toonflow 移植后的 AI 编排 Agent（tool calling 多步循环）无法工作。建议 `call_upstream` 对 `text` 类做成"透传代理"，不解析语义。

### 6.4 实时通信

- **SSE 替代 socket.io**：AgentCut 已有 `/api/v1/agent/turn` 的 SSE 实现，短剧工坊的流式生成（剧本/分镜智能体）复用同一模式。前端用 `EventSource`/fetch-stream 消费 `content`/`thinking`/`done` 事件，等价 Toonflow 的 `content:add/content:update`。
- 长任务（图/视频生成）：保留"提交→轮询 DB `state`"模式（REST `polling*`），与现状一致，无需 socket 推送。

### 6.5 AI 编排 Agent 移植（短剧领域）

- Toonflow 的 `scriptAgent`/`productionAgent`（子 Agent 递归、tool calling、memory 注入、reasoning 中间件）是**短剧领域**的核心创作逻辑，**硬编码**了短剧子任务（storySkeleton / adaptationStrategy / deriveAssets / directorPlan / storyboardGen …），**不具备承担全站通用对话 + skill 的能力**。
- Python 侧用**裸 `openai` SDK 手写 supervisor-worker**重写这些 Agent（Vercel AI SDK 的 `tool()` 同范式，不引入 LangChain/LangGraph/canvas-agent，理由见 §6.6），将"生成资产/分镜/视频"的 tool 实现为调用 `call_upstream`（经 `ApiSource`）。
- 把 Toonflow 的 skill/memory 提示词（`o_prompt`、`o_skillList`、`memories`）迁移为 AgentCut 侧的提示词模板与记忆表（可复用 AgentCut 既有 skill/记忆体系）。
- **全站通用对话 Agent（替代 EdgeOne Makers）是另一个独立新建项，不是 Toonflow 这套**，详见 §6.6。

### 6.6 通用 Agent 改造（替代 EdgeOne Makers，方案 b 必做）

> **决策状态：方案 (b) 已选定 —— Makers 退场。**
> Toonflow 的 supervisor-worker 仅覆盖短剧领域，无法承担全站"通用对话 + skill"角色，因此必须**新建一个通用 Agent** 替代 Makers 的通用对话职责。短剧 Agent（§6.5）与通用 Agent 并存，**共用 AgentCut 模型网关（`call_upstream`）与账号体系**。

**为什么不能把 Toonflow 的 Agent 直接当全站 Agent 用**
- Toonflow 的 `scriptAgent`/`productionAgent` 是硬编码短剧子任务，没有"接住任意用户对话 + 注入 skill"的能力。
- 因此通用 Agent 必须**独立新建**，沿用 AgentCut 现有 `turn` 路由 + skill 注入逻辑，底层走 `call_upstream`。

**最小实现清单（4 步）**

1. **路由改造（Route Refactor）**
   把 `app/api/agent/router.py` 透传给 Makers 的 `_stream_from_makers()` 替换为**进程内 agent 循环**。Python 后端新增 `openai` SDK（OpenAI 兼容客户端）指向 `call_upstream`；收到用户消息 → 调 LLM → 若返回 `tool_calls` 则执行工具 → 回填 → 再问，循环至无 tool_call 或达步数上限（`stepCountIs` 等价）。
   - 不新增独立服务（对比 canvas-agent 方案要再起常驻进程 + 网关联调），复用 AgentCut 账号/线程/素材/审计整套基础设施。

2. **工具注册（Tool Registry）**
   内置工具（`ima_search`、素材读取、资产查询等）直接挂为可调用 tool；工具实现统一走 `call_upstream`/`ApiSource`，**不直连外部供应商**。这是把"工具能力"从 Makers 侧收回 AgentCut 自有的关键一步。

3. **skill 动态工具（Skill as Real Tools）**
   将 skill 的 `tool_overrides` 字段**动态注册为真正的可调用 tool**（Python 侧用 `openai` SDK 的 function calling）。这把 skill 从"提示词挂件"（`prompt_fragment` 注入）升级成"可调用函数"，且**完全自主可控**，不依赖任何外部平台的工具白名单。
   - 注意：`prompt_fragment` 注入仍保留（见第 4 点），二者互补。

4. **流式返回 + skill 注入保护（Streaming & Injection Guard）**
   沿用既有 SSE（`text/event-stream`）流式输出；**必须保留 `turn` 路由中“查询 `UserSkillBinding` → 拼接 `prompt_fragment` → 注入上下文”的 skill 注入块**（当前在 `app/api/agent/router.py` 第 341–357 行附近，行号会随代码漂移，以功能描述为准）。该块是 skill 商店能生效的根，换运行时**不得误删**。
   - skill 商业层（解锁/积分/分成/审核，`AdminSkill` + `skill_service.unlock_skill` + `/api/skills/*`）100% 在 AgentCut，与 Makers 无关，退场不受影响。

**框架取舍（明确排除）**
- ❌ **LangChain / LangGraph**：过重，违背"去外部框架、统一走 AgentCut 网关"原则；后端现无任何 LLM SDK，引入债务大。
- ❌ **canvas-agent**：它是 `@openai/codex` + MCP 的**画布代码操作桥接**，用途不对，且为独立 Bun 服务、生产未部署。
- ⚠️ **可选（非必需）**：若后续多 Agent 协作复杂度上升，可引入轻量 `openai-agents`（Python 官方 SDK，原生 handoff/supervisor-worker + 工具调用，OpenAI 兼容），比 LangChain 轻得多。初始先用裸 `openai` SDK 手写循环，更可控、依赖更少。

### 6.7 资产存储与媒体处理（网页化必补）

桌面端 Electron 可直接读写本地文件系统并调用本地 `ffmpeg`/`sharp`；网页化后必须显式处理以下三点：

1. **对象存储替代本地文件**
   - 图片/视频/音频不再落本地磁盘，改为上传到对象存储（生产可用 S3 / 腾讯云 COS / 家庭 NAS 网关；开发可用 MinIO）。
   - DB 只保存 object key / 公开/预签名 URL；原 `o_image` 等表中的二进制或路径字段需改为 URL 或 object key。
   - 建议增加 `drama_file_record` 统一表（id / user_id / object_key / mime_type / size / created_at / expires_at），作为所有媒体资产的元数据索引。

2. **服务端媒体处理**
   - 视频合成、剪辑、转码、抽帧、音频提取等 `ffmpeg` 操作必须放到服务端执行。
   - 方案：FastAPI 后端异步任务队列（Celery/RQ/Arq）+ 临时下载源文件到 `/tmp` → `ffmpeg` 处理 → 上传结果 → 清理临时文件。
   - 若计算量大，可异构调度到家庭 CUDA 笔记本或 Mac Mini（见用户记忆：Cloudflare Tunnel + 家庭算力），但需健康检查与云端降级。

3. **浏览器端限制适配**
   - 文件导入：小说/剧本/资产批量上传改走 `<input type="file">` / 拖拽上传，不再读取用户任意本地路径。
   - 文件导出：剧本/视频/项目文件改由后端生成后返回下载链接或 `Content-Disposition` 下载。
   - 大文件上传注意浏览器单文件大小限制与网络超时，建议用分片上传或预签名 PUT。

---

## 7. 分阶段实施计划

| 阶段 | 内容 | 依赖 | 工作量 |
|---|---|---|---|
| ✅ 地基 | 外壳（通栏入口 + 左栏 + 占位页）+ 设计对齐 + 宽度统一 | 已完成 | 小 |
| **P0（媒体基础设施）** | **对象存储 + 异步任务队列 + `ffmpeg` 媒体处理**：开发 MinIO、生产 COS/S3；任务队列（Celery/RQ/Arq）；视频合成/转码/抽帧/上传下载链路 | 地基 | 中 |
| **P0.5（b 必做）** | **通用 Agent 替代 Makers**：`turn` 路由就地改造（手写 tool 循环）+ 工具注册 + skill 动态工具 + 保留 SSE 与 skill 注入块 | 现有 `turn` 路由（Makers 代理） | 中 |
| P1 | **数据模型**：`drama_*` 表 SQLAlchemy + Alembic 迁移；项目 CRUD API | 地基 | 中 |
| P2 | **项目/任务看板** 前端页（列表/新建/详情/编辑）+ 后端 API | P1 | 中 |
| P3 | **剧本编辑 + 剧本智能体**：script 表 + SSE 流式对话（Python Agent 重写 tool calling） | P1,P2 | 大 |
| P4 | **小说**：导入/切分/事件抽取 | P1 | 中 |
| P5 | **资产管理**：资产库/资产生成/画风/配音，接 `ApiSource`(image) + 对象存储（§6.7） | P1,模型路由扩展,§6.7 | 大 |
| P6 | **分镜 + 合成工作台 + 视频生成**：production 全套，接 `ApiSource`(video, 轮询) + 媒体处理队列（§6.7） | P1,P5,§6.7 | 大 |
| P7 | **设置（模型与部署）**：复用 AgentCut 管理后台 `ApiSource`/`VariableMapping` 管理，短剧设置页仅"选模型+提示词" | 模型路由扩展 | 中 |
| P8 | **合规收尾**：保留 LICENSE/NOTICES、署名、申请扶持期书面授权 | 全程 | 小 |

**建议起点与并行策略**：

- **P0.5（通用 Agent）与 P1（数据模型）并行开工**，互不阻塞。
  - P0.5 只改现有 `turn` 路由（AgentCut 全站通用 Agent），不动 `drama_*` 数据。
  - P1 从零建 `drama_*` 数据层与项目 CRUD，是短剧工坊主线的地基。
- **P2 项目页跑通后**，再横向铺开 P3（剧本）、P4（小说）、P5（资产）、P6（分镜/合成/视频）。
- **P0（基础设施）**：在 P5/P6 之前，需先完成 §6.7 的**对象存储接入 + 异步任务队列（含 `ffmpeg`）**。标记为 **P0**，与 P0.5/P1 并行或紧随其后，因为所有媒体生成功能（P5/P6）都依赖它。
- **合规授权**：在公开上线前 2-4 周启动 P8（HBAI-Ltd 扶持期书面授权），开发/内测阶段保留 LICENSE/NOTICES 即可。

> **即：P0（存储+媒体队列）∥ P0.5（通用 Agent）∥ P1（短剧数据模型）→ P2 → P3/P4 → P5/P6 → P7 → P8。**
>
> 因为 P0/P0.5/P1 互不阻塞，可安排同一次迭代/冲刺内并行启动。P2 开始单线推进，P5/P6 可并行（资产与分镜虽无强依赖，但都需要 P0 媒体基础设施）。

---

## 8. 风险、合规与待确认

### 风险与缓解

| # | 风险 | 影响 | 缓解措施 |
|---|---|---|---|
| R1 | **vm2 沙箱不移植**：TS 供应商系统用 Python 重写成本高；已用 `ApiSource` 替代，但 Toonflow 某些供应商的"专属端点分支逻辑"（如豆包/Seedance/Gemini 的 `/image/generateImage` + 轮询）需逐一在 `call_upstream` 的 image/video 模态里复刻 | image/video 模态首批只支持 1-2 家主流供应商，功能残缺 | 建立"供应商适配清单"，按优先级逐个接入；对未支持的供应商给出"请改用 AgentCut 已配置模型"的降级提示；新供应商接入走 `ApiSource` 配置化，不硬编码 |
| R2 | **Vercel SDK 高级特性透传**：`call_upstream` 必须支持 `tool_calls`/`reasoning_content` 透传，否则 Python 重写后的 Agent 行为会降级 | Agent 多步循环、思考标签失效 | 将 `call_upstream(text)` 改为**透明代理**：转发完整 body/response，不解析语义；新增网关级测试用例覆盖 tool calling / reasoning / function_call |
| R3 | **React 重写工作量大**：核心交互（节点编辑器、长表单、提示词/模板编辑器、任务看板）需在 React 生态中等价实现 | 进度/还原度不及预期 | 分阶段交付：先跑通项目/剧本/资产等"表单页"，节点编辑器（React Flow）放在 P5-P6；用 Toonflow-web Vue 源码逐页对照验收 |
| R4 | **Agent 进程内循环安全**：tool 调用在 FastAPI 进程内执行，恶意/错误工具可能导致死循环、长阻塞或资源耗尽 | 服务稳定性、用户体验 | 设置单轮最大步数（如 16-32）、单工具超时（如 30s）、全局并发限制；危险操作（文件/网络/执行代码）走独立 worker/队列 |
| R5 | **用户数据隔离**：`drama_*` 表按 user_id 过滤不严格会导致用户 A 看到用户 B 的项目/资产 | 数据泄露 | 所有 `drama_*` CRUD 强制加 `user_id = current_user.id` 过滤；必要时加行级安全策略（RLS）；团队协作通过显式 project_member 表授权 |
| R6 | **媒体处理与存储**：视频合成/转码/大文件上传在浏览器无法完成，服务端缺少对象存储与 ffmpeg 链路 | 视频功能瘫痪 | 接入对象存储 + 异步任务队列（§6.7）；视频/长任务提交后返回 task_id 轮询，不阻塞请求 |
| R7 | **SSE 稳定性**：Agent 流式输出对网络抖动敏感，断线后难以续传 | 用户看到"回答到一半断开" | 前端实现自动重连 + 最后事件 ID；后端支持按 conversation/message id 查询历史；关键生成任务改用"提交-轮询"而非纯 SSE |
| R8 | **TTS 为空**：Toonflow 配音生成未接通 | 配音/旁白功能缺失 | 若 P6 前不需要配音，可延后；若需要，新增 `modal_category=audio` 的 `ApiSource`（如 FishAudio / ElevenLabs / 阿里云） |
| R9 | **合规授权**：对外部署到 agentcut.cn 触发补充协议，未及时取得书面授权 | 法律风险 | 在公开上线前 2-4 周联系 HBAI-Ltd 申请扶持期书面授权；开发/内测阶段保留 LICENSE/NOTICES 即可 |


### 合规（Apache-2.0 + 作者补充协议）

- **授权范围**：允许修改/合并/商用/闭源；义务：保留 `LICENSE` + `NOTICES.txt`、改动文件注明、不删 Toonflow 标识/版权。
- **两个仓库均适用**：`Toonflow-app`（后端源码）与 `Toonflow-web`（前端源码）均使用同一套 **Apache-2.0 + 补充协议**。即使 Route B 不直接复制 Vue 代码，只要**参考/移植其业务逻辑与交互**，仍属"基于 Toonflow 修改"，署名与授权义务同样适用。
- **补充协议触发点**：公开部署到 agentcut.cn 属"对外分发"，需 **HBAI-Ltd 书面商业授权**；早期年销售额 < ¥10 万走"扶持期免费授权"（零成本，需书面）。
- **关于 README 的 AGPL 徽章**：`Toonflow-web` README 顶部误标 AGPL-3.0，但 LICENSE 正文及 README 解释条款已明确为 Apache-2.0 + 补充协议（v1.0.8 前才不追溯适用 AGPL）。我们以 LICENSE 正文 + 补充协议为准，不以徽章为准。
- **永久义务（无论是否公开）**：保留署名、不改版权标识、移植文件标注"基于 Toonflow 修改"。

**上线前合规检查清单（P8 之前完成）**：
1. 在 `agentcut-v2/` 保留 `Toonflow-app/LICENSE`、`Toonflow-app/NOTICES.txt`、`Toonflow-web/LICENSE`、`Toonflow-web/NOTICES.txt`。
2. 在短剧工坊 UI 的"关于/设置"页展示 "Powered by Toonflow" 或类似署名，并给出原项目 GitHub 链接。
3. 所有从 Toonflow 移植/参考的文件头部加注释：`# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.`。
4. 向 HBAI-Ltd 发送扶持期书面授权申请（邮件/工单），明确部署域名为 `agentcut.cn`、用途、预期销售额。
5. 保留授权回执，随部署文档存档。

### 已确认决策（用户已拍板）

| # | 决策项 | 结论 | 对架构/排期的影响 |
|---|---|---|---|
| 1 | 用户体系 | **完全复用 AgentCut 账号**，删除 `o_user`；`drama_*` 表用 AgentCut `users.id` 作为 `user_id` | 统一登录/权限/审计；短剧工坊不再自建用户体系 |
| 2 | 图像/视频调用路径 | **统一走 AgentCut `ApiSource`**，不保留供应商直连 | 统一密钥/积分/计费；`call_upstream` image/video 模态必须按期落地 |
| 3 | TTS 配音 | **P6 后再决定**；首版仅"字幕+背景音乐"，暂不引入 `audio` 模态 | P5/P6 暂不做配音；后续若需旁白，新增 `modal_category=audio` 的 `ApiSource` |
| 4 | 数据迁移策略 | **全新库起步**，不导入历史 sqlite；后续有真实本地项目再补一次性 SQLite→PG 导入工具 | 大幅降低初期复杂度；P1 数据模型无需兼容旧数据 |
| 5 | 对象存储与媒体处理 | 生产用 **腾讯云 COS / S3**；开发用 **MinIO**；`ffmpeg`/视频合成放后端异步任务队列，优先跑云后端，可溢出到家庭 CUDA 节点（需健康检查+降级） | §6.7 方案锁定；P5 资产生成、P6 视频合成都需该基础设施 |

### 待确认
> **当前无未确认问题**。所有架构决策已关闭。后续若出现新分歧，在此追加。



---

## 9. 附录：关键文件索引（Toonflow）

- 数据层：`src/utils/db.ts`、`src/lib/initDB.ts`、`src/lib/fixDB.ts`、`src/utils/getPath.ts`
- 供应商/AI 编排：`src/utils/vm.ts`、`src/utils/ai.ts`、`src/utils/vendor.ts`、`data/vendor/*.ts`、`src/agents/*/index.ts`、`src/agents/*/tools.ts`
- 路由/功能：`src/router.ts`、`src/app.ts`、`src/core.ts`、`src/routes/**`
- 认证/实时：`src/routes/login/login.ts`、`src/app.ts:152-170`、`src/socket/index.ts`、`src/socket/routes/*`、`src/socket/resTool.ts`
- AgentCut 对接点：`agentcut-v2/backend/app/services/gateway_service.py`（`call_upstream`）、`app/models/model.py`（`ApiSource`/`VariableMapping`）、`web/src/pages/drama/*`、`web/src/constant/navigation-tools.ts`

> 本文档为架构层面决策与映射，不含逐表 DDL/逐端点实现代码；具体实现按 P1–P8 阶段推进。
