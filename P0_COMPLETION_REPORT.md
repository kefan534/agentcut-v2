# AgentCut v2 — P0 三项改进 完成与验证报告

> 对照本地「乐凡 AI Film OS v6.8.4」(`127.0.0.1:7860`) 功能差距，落地 3 项 P0 改进。
> 验证时间：2026-08-23

## 一、三项 P0 落地情况

### P0-1 生成前费用预估 + 确认弹窗 ✅
- 文件：`web/src/pages/image/index.tsx`、`web/src/pages/video/index.tsx`
- 行为：`generate()` 在真正调用上游前，先取 `useUserStore.credits` 余额；若 `creditCost` 为空则调用 `quoteCredits(...)` 估价；余额不足直接拦截报错；否则弹 `Modal.confirm`（「本次约消耗 X credits，当前余额 Y。确认生成？」）。
- **修复 bug**：video 页 `onCancel: () => (false)` → `() => resolve(false)`（原写法 Promise 永不 resolve，取消后 `generate()` 永久挂起）。image 页此前已正确。

### P0-2 统一任务中心（列表 + 重试）✅
- 后端：`app/services/async_job_service.py` 的 `create_job` 增加 `request_body` 字段并记录，`list_jobs_for_user()` 按用户聚合。
- 后端：`app/api/gateway/router.py` 新增
  - `GET /api/v1/gateway/jobs` — 当前用户全部任务
  - `POST /api/v1/gateway/jobs/{job_id}/retry` — 用原 `request_body` 重新提交（后台 `submit_and_run`）
  - 同步生成接口在扣费成功后登记 job、running/succeeded/failed 全程更新状态。
- 前端：`constant/navigation-tools.ts` 导航加「任务中心」；新增 `web/src/pages/tasks/index.tsx`（antd Table：类型/状态/消耗/时间/结果链接/重试按钮，3s 轮询）；`services/api/backend.ts` 加 `listJobs/retryJob`；`router.tsx` 加 `/tasks` 路由。

### P0-3 模型控制台一键测通 ✅（已存在，仅验证）
- 逐文件核实：`app/api/admin/router.py` 的 `POST /admin/models/{source_id}/test`（仅 GET base_url 连通性校验，10s 超时，不扣费、不发真实请求）+ 前端 `admin-models.tsx` 每行「测试」按钮 + 成功率/耗时/上游余额统计列。
- 结论：**功能已端到端实现**，本次不改动代码，仅做确认。

## 二、验证结果

| 验证项 | 命令/方式 | 结果 |
|---|---|---|
| 前端类型检查 | `npm run typecheck` | ✅ 0 error |
| 前端生产构建 | `npm run build` | ✅ 成功（警告为既有 dynamic-import/chunk 体积，与本次无关） |
| 后端路由导入 | `from app.api.gateway.router import router` | ✅ 18 路由 |
| 后端端点冒烟（TestClient，绕过 DB） | list / 404 / retry→新 job_id | ✅ 全部通过 |
| **后端实时鉴权冒烟（8082 新实例）** | 真实 access token 调 `GET /jobs` / `POST /jobs/{id}/retry` / 无 token | ✅ `[]`(200) / `404 Job not found` / `401` |

## 三、重要：8081 僵死进程（需你手动重启）

运行中的 `:8081` 后端是**改 P0-2 之前的旧代码**（OpenAPI 中无 `/jobs` 路由），且：

- 该监听属 **PID 32692**，但本工具进程视图下 `Get-Process` / `taskkill` 均报「找不到进程」——它是**在你自己会话/提权上下文**里启动的，本沙箱只共享网卡（`netstat` 可见）但看不到其进程树，**我无法从当前环境杀掉它**。
- `DEBUG=False` 无热重载，所以**必须重启**才能加载新接口。

**请在你自己的终端执行（可能需要以管理员身份运行 PowerShell）：**
```powershell
taskkill /PID 32692 /F
# 然后回到后端目录重启
cd D:\testapp\agentcut-v2\backend
.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8081
```
> 文件已在磁盘更新，重启即生效；前端（`VITE_BACKEND_URL=http://localhost:8081`）无需改动。

## 四、当前服务状态
- **新后端验证实例**：`:8082` 已启动并通过实时鉴权冒烟（保留以备你检查；不影响前端，前端仍指向 8081）。
- PG：`:5432`（库 `infinite_canvas`，postgres/postgres）。
- 前端 dev：`:3000`（如未运行，`cd web && npm run dev`）。

## 五、已知限制
- 任务中心目前基于**内存字典**（`async_job_service._jobs`），进程重启后历史清空；如需持久化可后续落到 `drama_video`/新建 `generation_jobs` 表（Alembic 迁移）。
- 重试复用原 `request_body`，不重新估价（余额已在首次扣减；重试若需重新计费需额外处理，当前按"已扣费重试"语义）。
