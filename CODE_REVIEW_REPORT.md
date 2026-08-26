# AgentCut v2 — P0/P1/P2 新增代码审查与修复报告

> 审查范围：P0（费用确认、任务中心、模型测通）+ P1（成本中心、@N 引用、全局锁定卡）+ P2（导入导出、QA、网络诊断、多供应商适配器）相关新增/改动代码。
> 审查与修复时间：2026-08-24

## 一、发现的问题与修复（按严重程度）

### 🔴 高危
| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 1 | **网络诊断 SSRF**：`_probe` 对任意配置 URL 直接 `HEAD`，无内网拦截；`verify=False` 关 TLS 校验；`follow_redirects=True` 可经 302 跳内网；任何登录用户可触发 | `app/api/diagnostics/router.py` | 新增独立 leaf 模块 `app/services/url_safety.py`（`is_private_url`，拦截回环/私网/链路本地/元数据 169.254.169.254/整数·十六进制 IP）；`follow_redirects=False`、移除 `verify=False`；并发限流 `Semaphore(10)` |
| 2 | **任务重试重复扣费/重复执行**：`/jobs/{id}/retry` 对任意状态任务都 `submit_and_run`（内部再 `deduct_credits`） | `app/api/gateway/router.py` | 重试仅允许 `failed` 任务（否则 400）；同时剥离请求体里的 `stream` 标记 |

### 🟠 中危
| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 3 | **项目导入无限制**：无子表数量/字段长度校验，缺 `name` 或未知字段 → 500；`art_styles` 每次导入复制整套画风库 | `app/api/drama/export_import.py` | 校验项目名必填 + 每类子表 ≤500；只复制真实列；字符串按列长度截断；画风库按 `name` 去重 |
| 4 | **任务内存字典泄漏 + 列表无上限**：`_jobs` 永不清理、`list_jobs_for_user` 返回全部 | `app/services/async_job_service.py` | 加 TTL(7天)/总量(5000) 清理 + 列表上限 200 |
| 5 | **路由前缀不一致**：billing/diagnostics/qa 把 `/api/v1` 写死在自身前缀 | 三个 router + `main.py` | 统一为 `/billing` `/diagnostics` `/qa`，由 `main.py` 统一叠加 `API_V1_PREFIX` |

### 🟡 低危（参数校验）
| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 6 | QA `target_id`/`comment` 无长度上限；`budget_cap` 无上限 | `app/api/qa/router.py`、`app/api/billing/router.py` | `target_id≤128`、`comment≤2000`；`budget_cap ge=0, le=10_000_000` |
| 7 | 任务中心对所有状态都显示「重试」按钮 | `web/src/pages/tasks/index.tsx` | 仅 `failed` 显示重试按钮 |

### 🟢 附带修复（审查中发现）
| 问题 | 修复 |
|---|---|
| `diagnostics` 顶层 import `gateway_service` 触发 `gateway_service ↔ model_service` **既有循环导入** | SSRF 逻辑下沉至 leaf 模块 `url_safety`，`gateway_service._is_private_url` 改为委托，`diagnostics` 直连 `url_safety`（单一来源，无循环） |

## 二、验证结果
- 后端 `import main` → **164 路由**，`url_safety` + `gateway_service` 委托正常。
- 前端 `npm run typecheck` → **0 error**。
- 功能级验证（in-process）：
  - SSRF：`127.0.0.1 / 169.254.169.254 / 10.x / localhost / 2130706433(整数形式)` 全部判定私网，`_probe` 拒绝并返回「内网/私网地址，禁止探测」。
  - 重试：`succeeded` 任务 → 400「仅失败的任务可重试」；`failed` 任务 → 200 且生成新 job。

## 三、服务重启（已解决）
- ✅ `:8081` 旧进程已不在（你已按步骤结束），已用 `uvicorn main:app --host 0.0.0.0 --port 8081` 重新启动，**加载全部新代码**，`/health` 200，billing/jobs/adapters/qa/diagnostics 全部 200。

## 四、后续修复记录（08-24，已全部落地）
- ✅ **消除 `gateway_service ↔ model_service` 循环导入**：`COST_MAP` 下沉至 leaf 模块 `app/services/cost_map.py`，`gateway_service` / `model_service` / `async_job_service` 均改由该模块导入。`model_service` 与 `gateway_service` 现已可独立 import。
- ✅ **@N 插入后光标还原**：视频页 `insertReferenceToken` 用 `requestAnimationFrame` 恢复焦点与光标位置。
- ✅ **成本中心预算输入上限**：`InputNumber` 加 `max={10000000}` 对齐后端（`min={0}` 原已存在）。
- ✅ **网络诊断限流**：新增内存滑动窗口限流（每用户 60s 内最多 10 次），超限返回 429。
- ✅ **`frozen_balance` 落地**：`users` 表加 `frozen_balance` 列（幂等 `ALTER ... IF NOT EXISTS`）；`credit_service` 新增 `freeze_credits`/`settle_frozen_credits`/`release_frozen_credits`（冻结/结算不污染流水，仅结算记 `generation` 流水）；异步任务 `submit_and_run` 由「先扣后退」改为「冻结→成功结算/失败释放」；账单 `frozen_balance` 读真实值。已通过状态机测试（freeze→settle 净 -amount、freeze→release 净 0、余额不足拦截）。
