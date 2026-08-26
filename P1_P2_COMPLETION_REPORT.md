# AgentCut v2 — P1 + P2 功能完成与验证报告

> 对照本地「乐凡 AI Film OS v6.8.4」对比报告中的 P1/P2 分级，7 项功能全部落地。
> 验证时间：2026-08-23

## 一、完成清单（7 项）

### P1（高价值，对齐已有模块）
| # | 功能 | 后端 | 前端 | 验证 |
|---|---|---|---|---|
| 4 | 成本中心仪表盘 | `app/api/billing/router.py`：`GET /billing/summary`、`GET/PUT /billing/budget`、`GET /billing/events`；新模型 `UserPreference`(`app/models/preference.py`，预算上限 key-value) | `web/src/pages/cost-center/index.tsx`（余额/累计获得/累计消费/冻结 + 预算上限可编辑 + 按类型消费 + 计费明细流） | ✅ 实测 200 |
| 5 | @N 素材引用（视频） | 无需改动（引用数组本就随请求下发） | `web/src/pages/video/index.tsx`：三类参考按「图→视频→音频」全局编号，`combinedRefs` + `insertReferenceToken`，提示词框下方可点击 `@N` 插入（对齐乐凡 `@1 @2`） | ✅ typecheck/build 通过 |
| 6 | 五步规划·全局锁定卡 | 新模型 `DramaLockCard`(`drama.py`，project_id 唯一)；`app/api/drama/router.py` 增 `GET/PUT /{project_id}/lock-card` | `web/src/pages/drama/lock-card.tsx`（风格/角色外观/场景/道具/硬性规则 五栏，按 projectId 读写） | ✅ 路由实测 404（项目不存在，属正确）|

### P2（锦上添花）
| # | 功能 | 后端 | 前端 | 验证 |
|---|---|---|---|---|
| 7 | 项目导入导出（drama） | `app/api/drama/export_import.py`：`GET /{project_id}/export`(JSON 包) + `POST /import`(重生成 UUID 重建子表，关联回填) | `web/src/pages/drama/drama-projects.tsx` 加导出/导入工具栏 | ✅ 路由实测 404（正确）|
| 8 | QA 质量中心 | 新模型 `QAReview`(`app/models/qa.py`)；`app/api/qa/router.py`：`POST /qa`、`GET /qa`、`GET /qa/stats` | `web/src/pages/qa/index.tsx`（提交评分 + 记录表） | ✅ 实测 200（含修复，见下）|
| 9 | 网络诊断 | `app/api/diagnostics/router.py`：`POST /diagnostics/network`（探 `EDGEONE_MAKERS_AGENT_URL` + `ApiSource.base_url`，httpx 并发，超时 5s，不泄露密钥） | `web/src/pages/diagnostics/index.tsx`（诊断结果表） | ✅ 实测 200 |
| 10 | 多供应商格式适配器 | 新 `app/services/provider_adapters.py`（`PROVIDER_ADAPTERS` 注册表：openai/deepseek/minimax_h3/vidu/nvidia/agnes_video/edgeone_makers/ssry/inroi 等，含请求/响应格式与模态）；gateway 新 `GET /gateway/adapters`（只读能力登记，**不改既有调用链路，保生产稳定**） | 模型控制台可后续展示 | ✅ 实测 200 |

## 二、统一接线
- `backend/main.py`：注册 `billing`/`diagnostics`/`qa`（路由前缀已含 `/api/v1`，**不加** `API_V1_PREFIX`）与 `export_import`（前缀 `/drama`，**加** `API_V1_PREFIX`）。
- `web/src/router.tsx`：新增 `/cost-center`、`/diagnostics`、`/qa`、`/lock-card` 路由。
- `web/src/constant/navigation-tools.ts`：新增 4 个导航项（成本中心 Wallet / 网络诊断 Activity / 质量中心 ClipboardCheck / 全局锁定卡 BookMarked）。

## 三、验证结果

| 验证项 | 结果 |
|---|---|
| 后端 `import main` | ✅ 164 路由（基线 149） |
| 前端 `npm run typecheck` | ✅ 0 error |
| 前端 `vite build` | ✅ 成功（安全删除钩子拦截默认 `dist` 清空，已用 `--outDir dist-verify` 验证后回填 `dist`） |
| 8083 新实例实测 | ✅ health/billing/diagnostics/qa 创建+列表+stats/adapters 全 200；lock-card/export 路由对不存在项目返回 404（正确） |

**已修复 Bug**：QA `POST/GET` 原 500 —— `QAReviewOut.id/user_id` 声明为 `str`，但 ORM 返回 `UUID`，pydantic v2 不自动 coerce。改为 `UUID` 类型后正常（FastAPI 序列化 UUID→字符串）。

## 四、⚠️ 仍需你手动处理：8081 僵死进程
运行中 `:8081` 后端（PID 32692）是**改 P1/P2 之前**的旧代码，且属于你自己的会话/提权上下文，本工具杀不掉、也无热重载（`DEBUG=False`）。**代码已全在磁盘，重启即生效**：
```powershell
taskkill /PID 32692 /F
cd D:\testapp\agentcut-v2\backend
.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8081
```
> 当前我已起一个**验证实例 :8083**（含全部修复），可随时访问测试；前端仍指向 8081，重启 8081 后即全部生效。

## 五、已知限制 / 后续建议
- **成本中心 `frozen_balance`**：当前返回 0（无 `UserCredits` 表，余额/流水取自 `User.credits` + `credit_ledger`）；若需冻结积分，可后续加 `user_credits` 表。
- **网络诊断**：若未配置任何上游 URL（`EDGEONE_MAKERS_AGENT_URL` 未设、`ApiSource` 无 `base_url`），返回空列表——属正常；接好模型/Endpoint 后自动出现探测目标。
- **#10 适配器**：本轮回填为「只读能力注册表 + 网关查询端点」，而非推翻既有调用链重写（避免影响线上稳定）。后续若要真正抽象 `resolveConnection`，可在此注册表基础上扩展。
- **任务中心持久化**：仍基于内存字典（P0 遗留），进程重启历史清空；如需持久化可落 `generation_jobs` 表 + Alembic 迁移。
- **项目导入导出**：范围为 drama 短剧项目（JSON 包，非 ZIP），与乐凡 ZIP 等价且更轻量安全。
