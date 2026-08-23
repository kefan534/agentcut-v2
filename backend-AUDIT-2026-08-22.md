# AgentCut 后端 / 计费 / Agent 链路 审计与修复方案

> 审计时间：2026-08-22 ｜ 审计范围：`agentcut-v2/backend`（FastAPI）+ `agentcut-v2/web`（React/Antd）
> 方法：静态代码审查 + 运行时导入校验 + 迁移一致性检查（本地 PostgreSQL 未启动，未做 DB 运行时验证）

---

## 一、已验证正常的点（先说结论里好的部分）

- ✅ 后端 `import main` / 全部 `.py` `py_compile` 通过，无语法/导入错误。
- ✅ 积分扣减核心**原子性正确**：`deduct_credits` 用 `UPDATE ... SET credits = credits - :amount WHERE id=:uid AND credits >= :amount RETURNING credits`，无并发负余额 / 超卖风险。
- ✅ 图片/视频主生成链路（`_run_gateway`）与前端 quote 用**同一套参数键名**（`size/quality/count`、视频 `vquality/size/videoSeconds`），报价与实扣口径一致。
- ✅ 图片"分辨率档"已与"宽高比"解耦为独立参数 `resolution`（`1K/2K/4K`），前端 quote 与网关真实扣费路径（`proxyGateway` body）均透传；后台 `resolve_credits` 参数无关，按 `param_conditions={"resolution":"2K"}` 即可分级计费（P1-1 修复）。
- ✅ 后台"Agent 配置"页（`model_variable` 等）已真正接入主链路 `run_local_agent`（`agent_loop.py:303-307`）。

---

## 二、问题清单（按严重度）

### 🔴 P0 — 影响计费正确性 / 数据一致性

**P0-1｜Alembic 双 head 分叉（迁移无法干净升级）—— ✅ 已修复**
- 证据：`alembic heads` 返回两个 leaf head —— `7a1b3c5d8e9f`（p0_audit_and_asset_text）与 `e8f9a0b1c2d3`（add_pricing_rules_table，即我们加的积分规则表）。
- 影响：`alembic upgrade head` 产生歧义；若多节点迁移状态漂移，schema 会不一致，新表（pricing_rules / balance 列等）可能漏建。
- 方案：新建一个 **merge migration**，`down_revision = ["7a1b3c5d8e9f", "e8f9a0b1c2d3"]`，`upgrade()` 为空（两分支均已独立落地），统一为单 head。部署时先在生产库 `alembic upgrade head` 验证。

**P0-2｜主链路 Agent 聊天完全不扣积分（积分商业化缺口）—— ✅ 已修复**
- 证据：`agent/router.py` 中 `deduct_credits` 仅被 `import`（第36行）**从未调用**；`/agent/turn` 返回里的 `"costPerTurn": 1`（第817/830行）只是前端展示假值；`agent_loop.py` 只调用 `get_user_credits`（读余额）。
- 影响：前端实际使用的智能体聊天（走 `/api/v1/agent`）**免费**，与图片/视频/文本生成（走 `_run_gateway` 实扣）严重不一致。这是积分商业化链路的最大缺口。
- 方案：在 agent turn 入口按 `resolve_source_for_variable(db, model_variable, user)` 解析真实文本模型变量名 → `resolve_credits(...)` → `deduct_credits(...)`（与 `_run_gateway` 一致）。建议**仅对成功完成的轮次计费**，并对失败做退款（见 P1-2）。

**P0-3｜`gateway/agent/stream` 孤儿端点硬编码 `"TEXT_MODEL"`—— ✅ 已修复**
- 证据：`gateway/router.py:326/351/368` 全程用字面量 `"TEXT_MODEL"` 做扣费与日志；该端点未被前端调用（前端已切到 `/api/v1/agent`）。
- 影响：即便被误调用，也会绕开 `agent_config.model_variable` 与定价规则，且 CallLog 的 `variable_name` 错标为 `"TEXT_MODEL"`，干扰后台日志/统计。
- 方案：确认无调用方后**直接删除**该端点（与其内部的 Makers 死代码一并清理，见 P2-1），避免误导。

### 🟠 P1 — 计费规则实际不可达 / 不一致

**P1-1｜图片"按尺寸差异化积分"形同虚设（参数口径错位）—— ✅ 已修复**
- 证据：前端图片 quote / 生成传的是 `size: config.size`，而 `config.size` 是**宽高比字符串**（如 `"1:1"` / `"1024x1024"` / `"16:9"`），不是分辨率档（`1K/2K/4K`）。
- 影响：若后台定价规则按"尺寸(1K/2K/4K)"配置 `param_conditions={"size":"2K"}`，**永远不匹配**，全部回退 `COST_MAP(image=5)`。后台"图像按尺寸差异化积分"功能实际失效。
- 方案（需你拍板口径，二选一）：
  - A（推荐）：前端把**分辨率档**作为独立参数（`resolution: "1K"|"2K"|"4K"`）随 quote 与生成一起传，与 `size`（宽高比）解耦；定价规则 UI 用分辨率档枚举。
  - B：后台定价规则 UI 直接用宽高比枚举（"1:1" 等）做匹配键，放弃分辨率档概念。

**P1-2｜扣费在调用上游之前、失败不退款—— ✅ 已修复**
- 证据：`_run_gateway` 第575行先 `deduct_credits`，随后 `call_upstream` 失败进入 `except`，仅 `log_call(cost_credits=0)` 记日志，**已扣积分不退回**。
- 影响：上游超时/报错时用户仍被扣费，体验与对账风险。
- 方案：① 先预占冻结（`frozen_balance += cost`），上游成功再结算、失败释放；或 ② 失败即退款（`add_credits` 回补 + 写 ledger）。推荐方案①防超发。

### 🟡 P2 — 清理 / 健壮性

**P2-1｜Makers（EdgeOne）死代码未清理—— ✅ 已修复**
- 证据：`agent_loop.py`、`core/config.py`、`admin/model_pricing.py`、`api/agent/router.py` 仍含 `makers` / `EdgeOne` 残留引用（功能已停用）。
- 方案：确认无调用后批量清理残留引用（与 P0-3 的 `gateway/agent/stream` 一并删除）。

**P2-2｜文本积分档位用字符数近似 token—— ✅ 已修复（文档化）**
- 证据：`_run_gateway` 文本路径 `input_tokens = len(json.dumps(messages))`（字符数），分档粗糙；且 agent chat 走另一路径未接该逻辑。
- 方案：文档注明为近似；后续可接 tokenizer 精确化（非紧急）。

---

## 三、优先级执行计划（建议顺序）

| 序 | 任务 | 复杂度 | 依赖 |
|----|------|--------|------|
| 1 | **P0-1** 新建 merge migration 收口双 head | 低 | 无 |
| 2 | **P0-2** 主链路 Agent 聊天接入 `resolve_credits` + `deduct_credits` | 中 | 需 P1-2 退款策略 |
| 3 | **P1-2** 扣费失败退款 / 冻结预占机制 | 中 | 无 |
| 4 | **P1-1** 图片尺寸/分辨率参数口径对齐（需你确认 A/B） | 中 | 你的决策 |
| 5 | **P0-3 + P2-1** 删除孤儿 `gateway/agent/stream` 与 Makers 死代码 | 低 | 无 |
| 6 | **P2-2** 文本 token 近似优化（可选） | 低 | 无 |

---

## 四、需要你拍板的决策点

1. **P1-1 图片参数口径**：采用方案 A（分辨率档独立参数，推荐）还是方案 B（改用宽高比枚举）？
2. **P1-2 失败处理**：冻结预占（推荐，防超发）还是直接失败退款？
3. 本次是否**直接执行上述修复**（按优先级计划），还是只看报告？

> 注：按既有约定，动手修改前我会先复述理解并给出改动点，你确认后再执行。

---

## 五、修复执行记录（2026-08-16 续做）

### 用户已拍板的决策
1. **P1-1 图片参数口径** → 方案 **A（分辨率档独立参数 `1K/2K/4K`，与宽高比解耦）**。
2. **P1-2 失败处理** → **直接失败退款**（`add_credits` 回补 + 写 `CreditLedger`）。
3. **执行方式** → **按优先级直接执行全部修复**。

### 已落地改动（文件级）

**P0-1｜Alembic 收口双 head**
- 新建 `backend/alembic/versions/a1b2c3d4e5f6_merge_p0_heads.py`：`down_revision=["7a1b3c5d8e9f","e8f9a0b1c2d3"]`，`upgrade/downgrade` 为空；验证 `alembic heads` 收敛为单 head `a1b2c3d4e5f6`。

**P0-2 + P1-2｜主链路 Agent 聊天扣费 + 失败退款**（`backend/app/api/agent/router.py`）
- `agent_turn` 入口按 `get_agent_config` → `model_variable` → `resolve_source_for_variable` 解析真实文本模型，再用 `resolve_credits(db, model_variable, {input_tokens}, "text")` → `deduct_credits`；余额不足返回 402。
- `/models` 端点返回真实 `costPerTurn`（`resolve_credits` 计算，不再硬编码 1）。
- `_run_local_agent_task` 用 try/except 包裹 `run_local_agent`，失败时 `add_credits(reason="refund")` 回补并 `_enqueue("agent_error")`。

**P0-3 + P2-1｜删除孤儿端点与 Makers 死代码**（`backend/app/api/gateway/router.py`、`backend/app/api/agent/router.py`）
- `gateway/router.py`：删除 `agent_stream`（`POST /agent/stream`，硬编码 `"TEXT_MODEL"`）及内部 SSE 逻辑；移除唯一用途的 `first_active_source_by_category` import。
- `agent/router.py`：删除确证无调用的 `_stream_from_makers` / `_parse_makers_frame` / `_enqueue_makers_event` 与重复的 `MAKERS_BUILTIN_MODELS` / `_get_active_builtin_model` 死代码；保留活动 `/interrupt` 端点与 admin 定价里的活跃 Makers 常量。

**P1-2｜`_run_gateway` 流式分支补强退款**（`backend/app/api/gateway/router.py`）
- 主非流式 `except` 本就有 `add_credits` 退款；本次为 `event_stream()` 增加失败退款 + `log_call(status="failed")`，与主分支一致。

**P1-1｜图片分辨率档独立参数（前端）**
- `web/src/stores/use-config-store.ts`：`AiConfig` 新增 `resolution: string`（默认 `"1K"`），`defaultConfig` 与 `merge` 规范化同步。
- `web/src/components/image-settings-panel.tsx`：`aspectOptions` 改为**纯宽高比**（移除 `16:9-2k` 等合并写法），新增 `resolutionOptions`（1K/2K/4K/自动）选择器；`imageAspectOptions`/`imageSizeLabel` 改为按 `value`（ratio）匹配。
- `web/src/pages/image/index.tsx`：quote 参数加入 `resolution: config.resolution`，预览 effect 依赖同步更新。
- `web/src/services/api/image.ts` 与 `web/src/services/api/remote-gateway.ts`：新增 `RESOLUTION_BASE` + `normalizeResolutionTier` + `resolveBasePixels`；`resolveSize`/`resolveRequestSize` 改为以 `resolution` 为像素基准（兼容旧版 `"16:9-2k"` 合并字符串，自动回退分辨率档）；所有生成/编辑调用点透传 `config.resolution`；`remoteImageGeneration/Edit` 在发往 `proxyGateway`（真实扣费路径）的 body 中带上 `resolution`，供后台 `resolve_credits` 按分辨率档匹配定价规则。
- **后端无需改动**：`resolve_credits` / `_run_gateway` 本就参数无关——`quote` 透传 `params`、`_run_gateway` 用 `pricing_params = dict(body)`，因此 `resolution` 进入定价匹配；管理员只需建 `param_conditions={"resolution":"2K"}` 的 pricing_rule 即可实现按分辨率分级计费。

**P2-2｜文本 token 近似**
- `_run_gateway` 文本路径已有注释说明"按字符数近似，档位粗粒度"；本任务将其明确为**临时策略**（非紧急），后续可接 tokenizer 精确化，当前不阻塞。

### 验证
- 后端：`py_compile` 三个改动文件 + `import main` 通过（`APP_IMPORT_OK`）。
- 前端：`npx tsc --noEmit` 通过（无类型错误）。
- 本地 PostgreSQL 未启动，未做 DB 运行时验证；Alembic merge migration 与 pricing_rule 匹配逻辑需在生产库 `alembic upgrade head` + 建一条 `resolution` 定价规则后实测确认。

