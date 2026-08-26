# AgentCut v2 — 第二轮代码审查报告（frozen_balance / 任务链路 / P0-P2 复查）

> 审查时间：2026-08-25
> 范围：冻结积分机制、异步任务/重试链路、诊断 SSRF 防护、导入导出、QA、成本中心、drama 视频生成恢复路径。
> 状态：**仅审查，未改任何代码**，等你确认后再动手。

## 一、问题总览

| # | 等级 | 问题 | 位置 |
|---|---|---|---|
| 1 | 🔴 高 | 异步任务计费用扁平 COST_MAP，与报价/同步路径不一致 → 用户确认的价 ≠ 实扣价 | `async_job_service.py` vs `gateway_service.resolve_credits` |
| 2 | 🔴 高 | 进程重启后孤儿冻结积分永久卡死，无对账回收 | `credit_service` + `main.py` 启动逻辑 |
| 3 | 🔴 高 | 失败的转写任务重试会走通用生成器，产生「成功但无结果」的任务 | `gateway/router.py retry_user_job` |
| 4 | 🟠 中 | `_persist_external_url` 预检私网但 `follow_redirects=True` → 302 跳内网绕过 SSRF 防护 | `gateway/router.py` |
| 5 | 🟠 中 | drama 全链路（资产图/分镜图/视频/合成）零计费，绕过商业化闭环 | `api/drama/router.py` 全文无 credit 调用 |
| 6 | 🟠 中 | 冻结/释放不写流水，账目出现无法追溯的余额跳变；settle 失败兜底 release 会把已产出结果变免费 | `credit_service.py` |
| 7 | 🟡 低 | 流式分支任务状态永不更新：stream=true 的 job 卡在 queued | `gateway/router.py _run_gateway` |
| 8 | 🟡 低 | TTL 清理会删掉 running/queued 任务 → 状态端点 404、任务成孤儿（叠加 #2 卡积分） | `async_job_service._prune_jobs` |
| 9 | 🟡 低 | 流式退款依赖请求级 Session 在 StreamingResponse 内存活，版本行为差异下静默失败（except pass） | `gateway/router.py event_stream` |
| 10 | 🟡 低 | 诊断限流字典 `_recent_calls` 每 user 一个 deque 永不清理，慢泄漏 | `diagnostics/router.py` |
| 11 | 🟡 低 | budget_cap 只是展示值，没有任何消费拦截（乐凡语义是硬上限） | 产品决策项 |
| 12 | ⚪ 记录 | DNS rebinding 残余风险：is_private_url 只判域名不 pin IP，诊断+外部 URL 下载均受影响 | `url_safety.py` |

---

## 二、详细分析与修复方案

### 🔴 #1 异步计费口径不一致（多扣/少扣）

**现状**：
- 同步路径 `_run_gateway` 与 `/gateway/quote`、前端确认弹窗都走 `resolve_credits()`（定价规则优先，COST_MAP 仅兜底）。
- 异步路径 `submit_and_run` 直接 `cost = COST_MAP.get(modal_category, 1)`，完全跳过定价规则。

**后果**：管理员配了定价规则的视频模型（如按分辨率/时长阶梯），用户在弹窗确认「约消耗 X credits」（报价走定价规则），后台实际按扁平 20 扣 → 多扣或少扣；任务中心显示的 cost 也可能与流水对不上。

**方案**：`submit_and_run` 在 freeze 前改为 `resolve_credits(db, variable_name, request_body, modal_category)`，与同步路径同源。改动约 3 行。

### 🔴 #2 孤儿冻结积分永久卡死

**现状**：freeze 成功后若进程崩溃/重启（或任务被 prune 清掉），没有任何机制释放 frozen_balance。jobs 在内存字典里，重启即丢；`main.py` 启动只恢复 drama_video「生成中」，不碰 gateway jobs 和冻结余额。

**后果**：用户可用积分被永久扣留，且无流水可查、无法对账。这是资金安全问题。

**方案（推荐 A+B）**：
- A（最小止血）：启动时执行一次对账 SQL——把 frozen_balance 重置为 0 并全额退回 credits？❌ 不行，会把正在运行的真任务也释放。正确做法：**给 freeze/release 写 ledger 流水（reason='freeze'/'release'，见 #6）**，启动时扫描「最近一条 freeze 流水之后没有对应 settle/release」的 reference_id（job_id），逐笔 release 回滚。
- B（短期简化版）：接受「重启 = 全部未完成任务作废」语义，启动时直接 `UPDATE users SET credits = credits + frozen_balance, frozen_balance = 0`（因为内存 jobs 全丢了，所有冻结必然是孤儿）。一行 SQL，幂等，语义清晰。**建议先落 B，A 作为后续持久化任务表的一部分。**

### 🔴 #3 转写任务重试走错执行器

**现状**：`retry_user_job` 对任何 failed job 统一调 `submit_and_run`（通用生成）。但 transcription job 的正确执行器是 `_run_transcription_job`（要写转录结果 JSON 文件、result_urls 指向 `/transcription/{id}/result`）。

**后果**：转写失败后点重试 → 走 call_upstream 当普通生成跑 → 即使上游返回成功，也没有转录文件，任务显示 succeeded 但点开 404；且计费口径也不对。

**方案**：job 增加 `kind` 字段（"generation"/"transcription"），retry 按 kind 分发到对应 runner；transcription 分支复用 `_run_transcription_job(job_id=new_id, ...)`。

### 🟠 #4 外部媒体下载的重定向 SSRF 绕过

**现状**：`_persist_external_url` 在请求前做了 `is_private_url` 预检，但 `follow_redirects=True`。上游模型返回的 URL 若 302 到 `http://169.254.169.254/...` 或内网地址，服务端会照常跟随并下载。诊断接口已修此问题（follow_redirects=False），媒体下载漏了。

**攻击面**：需要上游返回恶意 URL（模型输出不可信时成立，如 prompt 注入让视频服务回显任意 URL）。

**方案**：`follow_redirects=False`，收到 3xx 时取 Location 重新过 `is_private_url` 再手动跟随，最多限 3 跳；或简单版——3xx 直接放弃该 URL（记 warning）。推荐手动逐跳版。

### 🟠 #5 drama 链路零计费

**现状**：`api/drama/router.py` 全文没有任何 deduct/freeze 调用——剧作工坊的资产生图、分镜生图、视频生成、ffmpeg 合成全部免费，包括启动恢复自动续跑的视频。

**影响**：商业化闭环被整个 drama 模块绕过；用户可无限白嫖视频生成（这是最贵的模态）。

**需你先确认产品意图**：若 drama 是「内部创作工具不计费」则维持现状（建议在 admin 定价页注明）；若要计费，方案是 `_run_video_generation` / 图像生成入口接入同一套 freeze→settle/release（视频生成是异步后台任务，天然适合冻结模式），合成 ffmpeg 可按次固定价。**这是本次审查里唯一需要你拍板的产品决策。**

### 🟠 #6 冻结/释放无流水，账目不可追溯

**现状**：freeze/release 不写 CreditLedger（设计初衷是「不污染 earned/spent 聚合」）。副作用：ledger 的 balance_after 序列会出现无法解释的跳变（如 balance 100 → 冻结 20 → 消费记录显示 balance_after=80，但上一条流水还是 100）；出问题时无法审计每笔冻结的去向；也让 #2 的对账无法实现。

**方案**：freeze 写 `reason='freeze', delta=0`（或 -0/+0 占位）流水带 reference_id=job_id，settle 写负向流水（现有）、release 写 `reason='release', delta=0` 流水。聚合统计过滤 delta=0 即可不影响 earned/spent。这样 #2-A 的精确对账才有数据基础。

### 🟡 其余低危项（一并修）

- **#7**：流式分支在 return StreamingResponse 前补 `gen_job["status"]="running"`；终态可在 stream 结束（finally/StopAsyncIteration）时置 succeeded/failed。
- **#8**：`_prune_jobs` 的 TTL 清理跳过 `status in ("queued","running")` 的任务。
- **#9**：event_stream 里的退款改为独立 `SessionLocal()` 会话，不再依赖请求级 db。
- **#10**：`_recent_calls` 在清理窗口时顺带删除空 deque（`if not q: del _recent_calls[user_id]`）。

### ⚪ 记录项（暂不动）

- **#12 DNS rebinding**：is_private_url 判定通过后，实际请求时 DNS 可能解析到私网 IP。彻底修法是自定义 httpx transport 把 hostname 固定为首次解析的 IP。当前有「目标来自管理员配置的 base_url + 限流」两道缓冲，风险可控，建议挂账后续。
- **#11 budget_cap 无强制力**：如需硬预算，应在 freeze/deduct 前校验「当月累计消费 + 本次 ≤ cap」。属产品功能而非 bug。

---

## 三、验证基线（本轮审查时的健康状态）

- 后端 :8081 运行中含全部已落地修复；164 路由导入正常。
- 前端 typecheck 0 error；tasks 页仅 failed 显示重试 ✅；video 页 @N 编号「图→视频→音频」全局连续 ✅；确认弹窗 Promise resolve 正确 ✅。
- `url_safety` 对整数/十六进制/环回/元数据 IP 判定完整 ✅；诊断接口 follow_redirects=False + TLS 校验开启 ✅。
- 导入导出校验（名称必填、子表 ≤500、列截断、画风去重）✅；storyboard/video 跨表 FK 回填映射正确 ✅。
- QA score 1-5 与 target_type 白名单校验 ✅。

## 四、建议修复顺序

1. **第一批（资金安全，约半天）**：#1 计费口径统一、#2-B 重启对账、#8 prune 保护运行中任务。
2. **第二批（安全+正确性，约半天）**：#4 重定向防护、#3 重试分发 kind、#7/#9/#10 小修。
3. **第三批（待拍板）**：#5 drama 计费接入与否、#6 冻结流水化（可与任务持久化一起做）、#11 预算硬拦截。

---

## 五、修复记录（08-25，三批共 11 项已全部落地）

> 用户拍板：**#5 drama 全量接入冻结计费**（生图 image 价、视频 video 价、ffmpeg 合成按次固定价）。#12 DNS rebinding 挂账未动。

| # | 修复内容 | 落地位置 |
|---|---|---|
| #1 | 新增统一计费入口 `compute_cost()`（定价规则优先 + text input_tokens 估算）；同步 `_run_gateway` 与异步 `submit_and_run` 共用，报价/确认价/实扣价三者同源 | `gateway_service.py`、`gateway/router.py`、`async_job_service.py` |
| #2-B | 启动对账：`UPDATE users SET credits = credits + frozen_balance, frozen_balance = 0 WHERE frozen_balance <> 0`，幂等，先于任务恢复执行（恢复路径会重新冻结，不会重复扣费） | `main.py` startup |
| #3 | job 增加 `kind` 字段（generation/transcription），重试按 kind 分发到对应执行器；转写失败重试不再产生「成功但无结果」任务 | `async_job_service.py`、`gateway/router.py` |
| #4 | `_persist_external_url` 改手动逐跳跟随（≤3 跳、每跳过 `is_private_url`、支持相对 Location），302 跳内网被拦截 | `gateway/router.py` |
| #5 | drama 四处接入计费：资产生图/分镜生图（freeze→settle/release，402 拦截）、视频后台生成（含启动恢复复用同函数）、ffmpeg 合成（固定 10 积分 deduct→失败退款）；全部带 reference_id 可审计 | `api/drama/router.py` |
| #6 | freeze/release 写 `delta=0` 流水（reason='freeze'/'release' + reference_id），聚合统计不受影响，每笔冻结可审计可对账 | `credit_service.py` |
| #7 | 流式分支置 running，流正常结束置 succeeded、异常置 failed（此前永远卡 queued） | `gateway/router.py` |
| #8 | TTL 清理跳过 queued/running 任务 | `async_job_service.py` |
| #9 | 流式退款改独立 SessionLocal，不再依赖请求级 session 在 StreamingResponse 中存活 | `gateway/router.py` |
| #10 | 诊断限流清理空 deque，防慢泄漏 | `diagnostics/router.py` |
| #11 | 预算硬拦截：仅显式设置过 budget_cap 的用户生效，自然月累计消费 + 本次 ≤ cap；deduct 与 freeze 前校验，超限报「预算不足」（默认展示值不拦截） | `credit_service.py` |

### 验证结果（8081 实测）
- 后端 `import main` → **164 路由**，启动日志无错误。
- 状态机实测 **13/13 PASS**：freeze 写 delta=0 流水、settle 净 -5、release 回滚、超额冻结拒绝、earned/spent 聚合不受流水化影响、无显式预算不拦截、超预算拦截（含 deduct 路径）、对账 SQL 释放孤儿冻结（102/0）。
- OpenAPI 关键路由全在（billing/jobs/diagnostics/drama import/qa）；鉴权冒烟：billing summary 含 `frozen_balance`、jobs 列表 200、不存在任务重试 404、无 token 401。

### 残余风险（挂账）
- **DNS rebinding**（#12）：彻底修法需自定义 transport 固定 IP，当前有「目标来自管理员配置 + 限流」缓冲，暂不动。
- **任务中心仍为内存态**：重启丢历史（但对账保证不丢钱）；持久化到 `generation_jobs` 表仍是后续方向。
- **drama 计费为服务端强制**：前端尚未显示 drama 生成的预估弹窗（不影响扣费正确性，仅 UX），可后续补。
