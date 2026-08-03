# AgentCut 专业测试报告（QA / 软件测试工程师视角）

**测试时间：** 2026-07-26  
**测试角色：** 专业软件测试工程师（功能 + 接口 + 安全 + 体验走查）  
**测试范围：** 鉴权/注册、积分计费、图像/视频/文本生成、Agent 控制台、画布、历史记录、导航、管理后台、接口边界  
**测试方法：** 通读源码定位缺陷 + 对运行中的服务（http://localhost:3000）做接口实测与边界用例  
**结论前置：** 在既有《产品体验评估报告》的 7 个 P0 基础上，本次重新走查**新发现 14 项问题**，其中 3 项为 P0（计费逃逸、越权读他人对话、幽灵线程致白屏）。产品目前**不建议对外放量**。

---

## 一、本次新发现的问题（N 系列，按严重度排序）

### N1【P0·资损/滥用】Agent 控制台生成视频完全不扣积分
- **现象：** 主路径 `/api/agent/chat` 驱动 LangGraph 生成视频，但全目录 `lib/agent-video` 内 **没有任何 `credits` 扣减 / `prisma.user` 更新逻辑**（已 grep 确认）。只有孤儿端点 `/api/agent/generate` 才扣 15 积分。
- **复现：** 用任一账号从 `/agent` 页面发送需求 → 走完分镜确认 → 逐帧渲染成片，**账户积分不变**。
- **期望：** 每次 Agent 视频生成应按资源消耗扣积分（与图像/视频/文本一致）。
- **影响：** 用户可**无限制白嫖视频生成**；上游网关真实产生成本但用户侧 0 计费，是重大资损 + 滥用黑洞。
- **位置：** `app/api/agent/chat/route.ts`（无扣费）、`lib/agent-video/*`（无扣费）

### N2【P0·安全/越权】Agent 线程接口无归属校验（IDOR）
- **现象：** `GET /api/agent/thread/[id]`、`/api/agent/thread/[id]/events`(SSE)、`GET /api/agent/threads` 仅调用 `requireAuth`，**不校验该 thread 是否属于当前用户**，也不按 userId 过滤。
- **复现（代码级）：** `listThreadSummaries()` 直接返回内存 Map 全部线程（注释却写"当前用户"）；`thread/[id]` 仅判断 `isThreadDeleted`；SSE 仅判断 token 有效性。
- **期望：** 仅本人（或 admin）可读自己的线程；`/api/agent/threads` 仅返回本人线程。
- **影响：** 任意登录用户可凭 threadId **实时监听他人对话与成片**（SSE），或列举**所有用户**的对话标题/行业/状态（含 prompt 摘要）——严重隐私泄露。对比 `/api/task/[id]` 有 `gen.userId !== user.userId → 403` 校验，授权策略不一致。
- **位置：** `app/api/agent/threads/route.ts`、`app/api/agent/thread/[threadId]/route.ts`、`.../events/route.ts`

### N3【P0·崩溃】幽灵线程导致 Agent 页白屏（无 Error Boundary 放大）
- **现象：** `GET /api/agent/thread/<从未运行的线程>` 返回 `{"success":true,"data":{}}`（HTTP 200，空对象）。前端 `use-agent.fetchState` 将其 `setState({})`，Agent 页渲染 `agent.state?.messages.map(...)` 对 `undefined` 调 `.map` → **TypeError 白屏**。
- **复现（实测）：**
  ```
  GET /api/agent/thread/never-run-ghost-xyz  →  HTTP 200  {"success":true,"data":{}}
  ```
  点击 Agent 页"新建对话"（`newThread()` 生成随机 UUID 写入 localStorage `agent-current-thread`，但**不请求后端**）→ 刷新页面 → `switchThread(phantom)` → `fetchState(phantom)` → 白屏。
- **期望：** 未运行线程应返回 404，或前端对空 state 做兜底；且全局应有 Error Boundary 防白屏。
- **影响：** 用户在 Agent 页点"新建对话"后一旦刷新即整页崩溃，体验毁灭性。叠加报告 R7（无 Error Boundary）。
- **位置：** `lib/agent-ui/use-agent.ts`、`app/(dashboard)/agent/page.tsx`、`lib/agent-video/thread-store.ts:104`

### N4【P1·安全/可观测性】鉴权失败一律返回 HTTP 500
- **现象：** `requireAuth`/`requireAdmin` 抛错后，各路由 `catch` 统一 `apiError(err.message, 500)`。实测无 token 访问：
  ```
  GET /api/history           → HTTP 500 {"error":"Unauthorized"}
  GET /api/admin/stats       → HTTP 500 {"error":"Unauthorized"}
  GET /api/agent/thread/x/events (无token) → HTTP 500
  ```
- **期望：** 未认证应 401、无权限应 403；利于前端统一拦截（报告 R4）与监控告警。
- **影响：** 前端"假登录"问题（R4）更难处理（拿不到 401 语义）；错误码失真，监控无法区分"未登录"与"服务器错误"。
- **位置：** `lib/auth.ts` + 各 route 的 `catch`

### N5【P1·安全/数据】注册零校验，可产出"永不可登录"账户
- **现象（实测）：** 注册接口对手机号、密码**无任何服务端校验**：
  ```
  POST /api/auth/register {"phone":"abc","password":"test123456"} → 成功，返回 token
  POST /api/auth/register {"phone":"13900139000","password":"12"} → 成功（密码仅 2 位）
  ```
- **期望：** 手机号正则（1 开头 11 位）、密码强度/最小长度、防暴力。
- **影响：** 用 `abc` 这类非法手机号注册成功后，**登录依赖手机号，该账户永远无法再登录**（成"僵尸账户"）；弱密码易被爆破。
- **位置：** `app/api/auth/register/route.ts`

### N6【P1·功能误导】图像质量/尺寸/比例 在所有图像页均为"装饰控件"
- **现象：** `lib/models/gpt-image.ts` 中明确注释 `APIyi gpt-image-2-all rejects size/n/quality params`，且 body 根本不带这几个字段；比例仅被拼进 prompt 文本。前端 `create/image` 与 `workspace/image` 却有 质量(1K/2K/4K)、尺寸、比例 下拉框，并显示"输出尺寸 1920×1080 / 4096×4096"。
- **期望：** 选 4K 应真出 4K；或控件直接隐藏/标注"不支持"。
- **影响：** 用户以为选了 4K 高清、横版竖版，实际输出与选择无关，**严重误导 + 客诉风险**。
- **位置：** `lib/models/gpt-image.ts:42`、`app/(dashboard)/create/image/page.tsx:79-90`、`app/(dashboard)/workspace/image/page.tsx:67`

### N7【P1·功能缺失】负面提示词（negativePrompt）形同虚设
- **现象：** `create/image` 页面收集 `negativePrompt`（输入框+状态），但提交时 `formData` **从未 append `negativePrompt`**，后端也不接收。
- **影响：** 用户认真填写"变形,模糊"等负向约束，生成时完全被忽略，效果不可控。
- **位置：** `app/(dashboard)/create/image/page.tsx:41,189-191,83-90`

### N8【P1·死代码/计费混乱】孤儿端点 /api/agent/generate
- **现象：** 全仓检索 `"/api/agent/generate"` 仅在其自身 route 定义处出现，**前端从不调用**；但它会扣 15 积分并跑另一套 LangGraph 初始状态（brief/industry/durationSec），与 `/api/agent/chat` 形成双实现。
- **影响：** 维护负担 + 计费口径分裂（一个免费、一个扣 15）；若被误触发热路径，行为不可预期。
- **位置：** `app/api/agent/generate/route.ts`

### N9【P1·功能名不副实】视频 r2v（参考生视频）实际仍是图生视频
- **现象（复核确认）：** `workspace/video` 在 `r2v` 模式 `accept="video/*"`，但 `onChange` 把文件塞进 `imageFiles` 状态，提交时 `formData.append('images', f)`；后端 `/api/generate/video` 读的是 `formData.getAll('videos')`（为空）。
- **影响：** 用户以为上传参考视频生成，实际传的是图片字段、后端收不到视频，功能失效。
- **位置：** `app/(dashboard)/workspace/video/page.tsx:88,175`、`app/api/generate/video/route.ts:20`

### N10【P1·计费】图像按 n 计费但生成上限 min(n,4)
- **现象：** `app/api/generate/image/route.ts:33` `cost = 10 * n`，但 `:65` 生成循环 `calls = Math.min(n, 4)`。前端旧页 n 上限 4、新页固定 1，故 UI 不会超；**但 API 层无 n 校验**，构造 `n=8` 等请求会扣 80 积分只出 4 张。
- **期望：** 服务端校验 n 范围，或按实际生成数计费。
- **影响：** API 暴露的超扣 / 少出图风险（潜在资损 + 客诉）。
- **位置：** `app/api/generate/image/route.ts:33,65`

### N11【P2·一致性】两套图像入口功能重叠、计费文案不一
- **现象：** `/create/image`（旧，左参数面板，cost=10×count，含负向提示词/质量）与 `/workspace/image`（新，聊天式，cost 固定 10）并存；导航只连 `/workspace/image`，但 `/create/image` 仍可直链访问。
- **影响：** 入口分叉、风格割裂、计费口径不一，同报告 R11/R2 同源。
- **位置：** `app/(dashboard)/create/image/page.tsx`、`app/(dashboard)/workspace/image/page.tsx`、`app/(dashboard)/layout.tsx:23`

### N12【P2·安全】配置/密钥信息泄露 + fallback 密钥可伪造
- **现象：** `/api/agent/config` 向**任意登录用户**返回 `gatewayBaseUrl`、`gatewayHasKey`（是否配置）；`lib/jwt.ts` 中 `JWT_SECRET = process.env.JWT_SECRET || 'agentcut-dev-secret'`，若 .env 缺失则 token 可用已知密钥伪造。
- **位置：** `app/api/agent/config/route.ts`、`lib/jwt.ts`

### N13【P2·安全】上传无大小/类型硬校验、无速率限制
- **现象：** `handleMultipleUploads` 仅限制"最多 16 个"，未限制单文件大小/总大小，也未对 MIME 做强制校验；接口层无 rate limit。
- **影响：** 大文件可拖垮存储/带宽；接口可被刷。
- **位置：** `lib/upload.ts`、`app/api/generate/*`

### N14【P2·可维护性】画布仅存 localStorage，无服务端持久化
- **现象：** `canvas/page.tsx` 把画布状态只写 `localStorage`（`mxai-canvas-state-v1`），"保存画布"仅导出 JSON 文件；无任何服务端存储。
- **影响：** 清缓存/换设备/换浏览器即丢失；多人协作不可行；与"作品应可追溯"相悖。
- **位置：** `app/(dashboard)/canvas/page.tsx:83-105,359-378`

---

## 二、既有评估报告问题复核（R 系列，标注现状）

| 编号 | 原问题 | 本次复核结果 |
|---|---|---|
| R1 | 历史记录无分页 | **仍成立（降级为硬上限）**：现已 `take:200`，但无游标/分页，超 200 条不可达；前端仍全量拉取再过滤。 |
| R2 | 文本生成同步阻塞 | **仍成立**：`/api/generate/text` 同步 `await generateChat`，无超时/取消/流式。 |
| R3 | Canvas 自定义 shim + 闭包旧 state | **仍成立（更具体）**：`onNodeDragStop`/`onConnect`/`onMoveEnd` 用闭包旧 `nodes/edges`；`copyNodes` 只存 nodes、`CLIPBOARD_KEY+'-edges'` 从不写入 → 粘贴**永远丢失连线**。 |
| R4 | 登录态 401 无全局处理 | **仍成立（叠加 N4）**：后端返回 500 而非 401，前端更难拦截。 |
| R5 | Agent 状态纯内存 | **仍成立**：`thread-store.ts:26` `const threadStates = new Map(...)`，重启/多实例全丢。 |
| R6 | 积分退款不可靠 | **仍成立**：图像/视频退款在异步回调里，进程重启/回调异常即不退。 |
| R7 | 缺全局 Error Boundary | **仍成立（叠加 N3 白屏）**：全仓无 `error.tsx`/`global-error.tsx`/`not-found.tsx`。 |
| R8 | 移动端不可用 | **仍成立**：全部桌面固定布局。 |
| R9 | Agent 新建对话前端 ID 未同步后端 | **升级为 N3（崩溃）**：不仅是"显示不存在"，而是刷新即白屏。 |
| R10 | 新用户初始积分过低 | **仍成立且更严重**：注册送 10 积分，视频最低 4s=120 积分 → **新用户零生成可能**，首体验直接断。 |
| R11 | 主题不统一 | **仍成立**：首页/登录/注册浅色，工作区/Agent/Canvas/历史深色。 |
| R12 | emoji 图标 | **仍成立**：导航、工具栏、节点类型大量 emoji。 |
| R13 | Agent 附件按钮无功能 | **仍成立**：`bottom-input` 📎 无 `onUpload`。 |
| R14 | 输入框无字数提示 | **仍成立**。 |
| R15 | 构建 Dynamic Server Usage 警告 | **仍成立**：`/api/agent/threads` 用到 `request.headers`。 |
| R16 | API 错误提示不友好 | **仍成立**：多处 `apiError(err.message, 500)`，如 "No available image generation channel"。 |
| R17 | 后台权限客户端校验 | **降级为 P2**：`/api/admin/*` 均 `requireAdmin`（服务端已保护），仅 layouts 客户端 `useAuth().role` 有闪屏。 |
| R18 | 文本结果存 resultUrls[0] 语义错 | **仍成立**。 |

---

## 三、问题总表（按优先级）

### P0（阻塞上线）
1. **N1** Agent 控制台生成视频不扣积分（资损/滥用）
2. **N2** Agent 线程接口越权读他人对话（IDOR，隐私泄露）
3. **N3** 幽灵线程致 Agent 页白屏（无 Error Boundary）
4. **R5** Agent 状态纯内存，重启/多实例丢失
5. **R6** 积分退款不可靠（资损）
6. **R7** 无全局 Error Boundary
7. **R4** 登录态 401 无全局处理（叠加 N4）

### P1（显著体验/安全，近期必修）
8. **N4** 鉴权失败返回 500 而非 401/403
9. **N5** 注册零校验 + 可产生"永不可登录"账户
10. **N6** 图像质量/尺寸/比例 为装饰控件（误导）
11. **N7** 负面提示词无效
12. **N8** 孤儿端点 /api/agent/generate（双实现/计费分裂）
13. **N9** 视频 r2v 实际是图生视频（功能失效）
14. **N10** 图像按 n 计费但生成上限 min(n,4)（潜在超扣）
15. **R1** 历史记录无真分页（take:200 硬上限）
16. **R2** 文本生成同步阻塞无取消/超时
17. **R3** Canvas 闭包旧 state + 复制丢失连线
18. **R10** 新用户初始积分过低，零生成可能
19. **R8** 移动端不可用

### P2（打磨/一致性/安全加固）
20. **N11** 两套图像入口并存、计费文案不一
21. **N12** 配置/网关信息泄露 + fallback JWT 密钥可伪造
22. **N13** 上传无大小/类型硬校验、无速率限制
23. **N14** 画布仅 localStorage 无服务端持久化
24. **R11** 主题不统一
25. **R12** emoji 图标
26. **R13** Agent 附件按钮无功能
27. **R14** 输入框无字数提示
28. **R15** 构建 Dynamic Server Usage 警告
29. **R16** API 错误提示不友好
30. **R17** 后台布局客户端 role 闪屏
31. **R18** 文本结果存 resultUrls[0] 语义错

---

## 四、实测复现关键证据（节选）
```
# 注册零校验（手机号=abc / 密码=2位 均成功）
POST /api/auth/register {"phone":"abc","password":"test123456"}            → success
POST /api/auth/register {"phone":"13900139000","password":"12"}          → success

# 鉴权失败返回 500（应为 401/403）
GET /api/history                  → HTTP 500 {"error":"Unauthorized"}
GET /api/admin/stats              → HTTP 500 {"error":"Unauthorized"}

# 幽灵线程返回空对象 → 前端白屏
GET /api/agent/thread/never-run-ghost-xyz  → HTTP 200 {"success":true,"data":{}}

# Agent 用不存在的 threadId 不 404（后续前端 state 可能为空对象致崩）
POST /api/agent/chat {"threadId":"phantom-not-exist-123",...} → success
```

---

## 五、修复优先级建议

**第一周（止血）：**
1. N1：在 `/api/agent/chat` 流程内接入积分扣减 + 订单流水（与图像/视频一致）。
2. N2：Agent 线程接口统一加 `userId` 归属校验（`/api/agent/threads` 按当前用户过滤、`thread/[id]` 与 SSE 校验归属）。
3. N3+R7：加全局 `error.tsx`/`global-error.tsx`；`GET thread` 未运行返回 404；`newThread` 不预写 localStorage 幽灵 ID。
4. N4：鉴权失败统一返回 401/403。
5. N5：注册加手机号正则 + 密码强度校验。

**第二周（体验与安全）：**
6. N6/N7/N9/N10：修图像参数透传或隐藏无效控件；接通负面提示词；修 r2v 文件字段；API 校验 n 上限。
7. R1/R2/R3/R6：历史真分页；文本异步化/SSE；Canvas 用官方 API + 修复闭包与复制连线；积分退款幂等 + 对账。
8. N12/N13：收敛配置暴露；上传加大小/MIME/速率限制；为 JWT 设强密钥并禁止 fallback。

**第三周（打磨）：** R8/R10/N11/N14 等响应式、新用户额度、入口统一、画布服务端持久化。
