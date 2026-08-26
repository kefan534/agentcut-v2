# AgentCut v2 第三轮代码审查报告（R3）

> 审查范围：相对上一轮（R2）之后的全部改动 + 所有未提交新增模块。
> 口径：`git diff` 22 个已修改文件（后端 10 + 前端 12）+ 8 个未跟踪新增后端模块 + 多个未跟踪前端页面。
> 结论性质：~~只审查、不动手~~ → **已按用户确认（优先级 R3-1→R3-2→R3-3→R3-4/R3-5）全部修复，见文末《修复记录》**。

---

## ✅ 修复记录（2026-08-26，用户已确认执行）

| 编号 | 修复内容 | 改动文件 | 验证 |
|---|---|---|---|
| R3-1 | `create_job` 增加 `kind: str = "generation"` 形参并写入 `_jobs` 字典（含 `"kind": kind`），转写提交与任务重试不再 TypeError | `backend/app/services/async_job_service.py` | `py_compile` OK |
| R3-2 | `analyze_media` / `split_video_prompts` 接入统一计费：`compute_cost`（按文本变量名查定价规则，无规则走 COST_MAP）→ `freeze_credits`（余额不足 402）→ 上游成功 `settle_frozen_credits` / 失败或空结果 `release_frozen_credits`；`cost<=0` 免费档短路；新增 `_resolve_text_variable` 返回变量名、`_run_paid_analysis` 统一流程 | `backend/app/api/drama/creative_tools.py` | `py_compile` OK |
| R3-3 | `DramaLockCard.project_id` 去掉物理 `unique=True`，改 Postgres 部分唯一索引 `uq_drama_lock_card_active (project_id) WHERE is_deleted='N'`；`main.py` 启动幂等迁移：先 `DROP CONSTRAINT IF EXISTS drama_lock_card_project_id_key` 再建索引，兼容已有库 | `backend/app/models/drama.py`、`backend/main.py` | `py_compile` OK |
| R3-4 | `lock-card.tsx` 顶部新增「项目选择」下拉（`listDramaProjects()` 加载，选中自动带入 ID + 加载锁定卡 + 更新 URL），保留手工 ID 输入兜底 | `web/src/pages/drama/lock-card.tsx` | `tsc --noEmit` exit=0 |
| R3-5 | `buildSeedancePromptText` 图例由「分类型编号（图片1/视频1…）」改为「全局 @N 编号（@1（图片1）、@N（视频N）…）」，与前端插入的 `@N` token、`buildSeedanceContent` 的 content 数组顺序（图→视频→音频）三者统一 | `web/src/lib/seedance-video.ts` | `tsc --noEmit` exit=0 |

### 修复要点说明
- **R3-2 计费口径**：`compute_cost(db, variable_name, body, "text")` 与同步网关/异步任务/报价共用同一函数，避免「预览价 ≠ 实扣价」；`reference_id` 用请求级 `media-analyze-{uuid}` / `prompts-split-{uuid}`，若进程中途崩溃，孤儿冻结会被启动对账自动释放回可用余额。
- **R3-3 迁移幂等**：新装库由 `create_all` 直接建部分索引；已装库通过 ALTER 删除旧唯一约束后重建，两种情况均可重复执行。
- **R3-5 一致性链**：UI 按钮（`@N · 图片X`）→ 提示词 token（`@N`）→ 图例（`@N（图片X）`）→ content 数组顺序，全部按「图→视频→音频」全局编号，上游模型不会再混淆两套编号。

---

## 🔴 严重（会导致功能直接崩溃 / 资损）

### R3-1 `create_job` 缺 `kind` 形参，但调用处传了 `kind=` → 转写与重试必崩
- 位置：`backend/app/services/async_job_service.py` `create_job`（L55-59）签名只有 `(variable_name, request_body, user_id)`，但：
  - `backend/app/api/gateway/router.py:330` `create_job("TRANSCRIPTION", ..., kind="transcription")`
  - `backend/app/api/gateway/router.py` `retry_user_job` `create_job(..., kind=kind)`
- 影响：**每次提交转写任务、每次点「任务重试」都会抛 `TypeError: create_job() got an unexpected keyword argument 'kind'` → 500**。转写功能完全不可用，任务中心重试按钮不可用。
- 修复方案：
  ```python
  def create_job(variable_name, request_body, user_id, kind: str = "generation") -> str:
      ...
      _jobs[job_id] = {
          ...
          "kind": kind,           # 新增
          "cost_credits": 0,
          ...
      }
  ```
  并在 `submit_and_run` / `_run_transcription_job` 调用时正确传 `kind`。`retry_user_job` 已读 `job.get("kind")`，补上存储后逻辑自洽。

---

## 🟠 高危（业务逻辑漏洞 / 可被滥用）

### R3-2 制片工坊「创作工具」两个端点不扣积分 → 上游算力被白嫖
- 位置：`backend/app/api/drama/creative_tools.py`
  - `analyze_media`（L84）调用 `call_upstream`（真实上游视觉/文本模型，平台付费）
  - `split_video_prompts`（L185）同样调用 `call_upstream`
- 影响：两个端点**既没 `compute_cost` 计费、也没 `freeze_credits`/`deduct_credits`、也没余额校验**。任何登录用户可无限免费调用，直接消耗平台上游配额（成本泄漏 + 可被刷接口打爆上游）。
- 修复方案（与其余端点一致）：在分析/分段前 `compute_cost(...)` → `freeze_credits(...)`，成功后 `settle_frozen_credits`，失败 `release_frozen_credits`；`kind` 走 async 或同步扣费均可。至少应加 `check_budget` + 限流。TTS 端点现在返回 501/400（未接供应商），无成本，保持不变即可。

### R3-3 `DramaLockCard.project_id` 物理唯一约束 + 软删除设计冲突（潜在 IntegrityError）
- 位置：`backend/app/models/drama.py` `DramaLockCard.project_id = Column(..., unique=True)`，upsert 逻辑（`router.py` `upsert_lock_card`）靠 `is_deleted == "N"` 过滤判断「是否存在」。
- 影响：
  1. 一旦未来加软删除（把 `is_deleted` 置 `"Y"`），再 upsert 会新建一行 → 撞 `unique` 约束 → `IntegrityError`；
  2. 并发两次 upsert 都会看到「无活跃卡」→ 双插 → 撞唯一约束。
- 修复方案（二选一，推荐 A）：
  - **A（推荐）**：去掉 `unique=True`，改用 Postgres 部分唯一索引 `CREATE UNIQUE INDEX uq_lock_card_active ON drama_lock_card (project_id) WHERE is_deleted = 'N'`；upsert 仍按 `is_deleted=='N'` 查找。
  - **B**：保留 `unique=True`，删除走「硬删 + 重建」，并在 upsert 前加 `SELECT ... FOR UPDATE` 行锁防并发。

---

## 🟡 中危（一致性 / 健壮性问题）

### R3-4 `/lock-card` 导航入口无项目上下文，需手工粘贴项目 ID
- 位置：前端 `navigation-tools.ts` 新增 `lock-card` 入口 → 路由 `/lock-card`；但后端端点为 `/drama/{project_id}/lock-card`，页面 `lock-card.tsx` 靠 `?projectId=` 手工输入。
- 影响：用户从左侧栏点「全局锁定卡」进入后是一张空白表单，必须知道自己项目 ID 才能用，体验割裂、易用性差；且无法从项目内一键跳转。
- 修复方案：把「全局锁定卡」作为**项目内的子页/抽屉**（从项目详情页或制片工坊侧栏带入 `project_id`），而非顶层独立导航；或在导航点击时引导先选项目。

### R3-5 视频页 `@N` 引用序号与后端映射顺序需对齐（正确性待验证）
- 位置：前端 `video/index.tsx` `combinedRefs` = 图→视频→音频 全局 1-based 编号；提示词内插入 `@N`。
- 影响：服务端若按不同顺序（或分别）解析 `@N`，会指向错误素材。当前快照把 `references / videoReferences / audioReferences` 分开传，@N 仅为客户端展示，服务端是否/如何消费 `@N` 未在本轮改动中可见，**存在映射错位风险**。
- 修复方案：明确约定服务端 `@N` 解析顺序必须与前端 `combinedRefs` 完全一致（图→视频→音频），或在请求里单独附带「@N → 素材 URL」映射表，避免依赖隐式顺序。

### R3-6 `analyze_media` 未校验上传文件真实类型（kind=image 时可传非图片）
- 位置：`creative_tools.py:109` 仅按 `kind` 分支，未验证 `file.content_type`/magic 是否匹配；`kind=image` 用户可传任意文件（content_type 伪造为 image/*）。
- 影响：低危（视觉模型会拒识），但抽首帧的 `ffmpeg` 对 `kind=video` 未校验视频合法性，异常文件可能触发 ffmpeg 报错（已 `try/except` 兜底为 422，无 RCE 风险）。
- 修复方案：按 `kind` 用 `file.content_type` / 文件头（magic number）做强校验后再处理。

### R3-7 `/diagnostics/network` 对全部登录用户开放（建议仅管理员）
- 位置：`backend/app/api/diagnostics/router.py`，仅 `get_current_user`，无 `adminOnly`。
- 影响：仅探测「已知白名单 URL」（settings + `api_sources.base_url`），不回显密钥，风险低；但属于运维能力，暴露给普通用户意义不大。
- 修复方案：加管理员依赖（与 admin 路由一致）；或保持现状并在文档注明。

---

## 🟢 低危 / 设计说明（非缺陷，记录备查）

- **R3-8 任务中心为内存态（`_jobs` 字典）**：进程重启即丢失全部任务历史；重试仅在进程存活且未被 prune（TTL 7 天 / 上限 5000）时可用。生产环境应落库（已注释说明）。本轮确认重启对账逻辑正确：`main.py` 先 `credits += frozen_balance; frozen_balance=0` 释放孤儿冻结，再 `_recover_pending_video_jobs()` 重跑「生成中」视频并**重新冻结**，无重复扣费。
- **R3-9 导出 `export_import.py` 含用户全部画风库**（非项目级），导入按 name 去重。属过度导出但不涉密，可接受。导入已做数量上限（每类 ≤500）与字符串长度截断，防 DoS，做得对。
- **R3-10 TTS 供应商未接通**为需求明确约定（「留调用模型接口（变量）」），非缺陷；`generate_tts` 返回 `audio_provider_not_implemented` 符合预期。
- **R3-11 SSRF 改造确认无回归**：`_is_private_url` 逻辑下沉到 `url_safety.py`，hostname 黑名单（localhost/.local）、整数/十六进制 IP、169.254 元数据地址均保留；`_persist_external_url` 改为手动逐跳（≤3 跳）且每跳重检，正确。
- **R3-12 `compose_drama_videos` 固定 10 积分 + 失败 `add_credits` 退款**：逻辑正确；退款与扣减共用 `reference_id=project_id`，可对账。

---

## 缺失项清单（"确实的项目"）

| 项 | 状态 | 说明 |
|---|---|---|
| 创作工具端点计费/限流 | **缺失** | R3-2，需补 `compute_cost`+冻结/结算或至少 `deduct`+限流 |
| `create_job` 的 `kind` 参数 | **缺失（导致崩溃）** | R3-1 |
| 锁定卡部分唯一索引 | **缺失（设计脆弱）** | R3-3 |
| 锁定卡项目上下文跳转 | **缺失（体验）** | R3-4 |
| 任务中心持久化 | 设计性缺失 | R3-8，生产前需落库 |
| TTS 真实供应商 | 按需求刻意留空 | R3-10，非缺失 |

---

## 建议修复优先级
1. **R3-1**（必崩，10 分钟改完）
2. **R3-2**（资损/滥用，需计费接入）
3. **R3-3**（数据完整性，部分索引）
4. **R3-4 / R3-5**（体验与正确性）
5. 其余低危按排期处理
