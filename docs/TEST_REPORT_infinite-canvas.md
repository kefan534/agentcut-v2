# 测试报告：infinite-canvas-main（含新建 FastAPI 后端）

> 测试角色：测试工程师
> 测试对象：无限画布前端（`infinite-canvas-main/web/src`）+ 新建后端（`infinite-canvas-backend`）
> 测试方法：静态代码审查 + 接口逻辑推演（只读，未运行服务）
> 结论概览：**体验问题 9 项、安全隐患 13 项（含 1 严重）、重大 Bug 6 项**。

---

## 一、用户体验（UX）问题

| 级别 | 问题 | 位置 | 说明 |
|---|---|---|---|
| 🔴 高 | Token 过期后"假登录"，全功能静默失效 | `backend.ts:16`、`use-user-store.ts:66` | 401 拦截器派发 `ic:auth:required` 事件，但**全仓无任何监听器**；`refreshSession` 只调 `fetchMe()` 不调 `refreshToken()`（后者为死代码）。登录 15 分钟后用户仍显示"已登录"，但所有请求 401，只弹"生成失败/加载失败"。无静默续期、无跳登录。 |
| 🔴 高 | `/admin` 未登录可直接进入 | `pages/admin/index.tsx:42` | 守卫条件 `if (currentUser && role !== "admin")` 在 `currentUser===null` 时不成立，未登录用户能看到后台空壳 + 一堆 401。应补 `!currentUser → /login`。 |
| 🔴 高 | 积分不足（402）不引导充值 | `gateway/router.py:64`、`image.ts/video.ts/audio.ts` | 上游失败抛原始 axios 错误（如 "Request failed with status code 402"），前端直接展示技术文案，无"积分不足，去充值"入口。 |
| 🟠 中 | 路由级守卫缺失 | `router.tsx` | 无全局 `RequireAuth`，未登录用户可进入 `/canvas` 等页，触发生成后才暴露 401。 |
| 🟠 中 | 进入画布后顶部导航整体消失 | `app-top-nav.tsx:27` | 进入具体画布 `hideHeader` 正则隐藏整条顶栏（含用户菜单/退出登录），用户易"困"在当前页。 |
| 🟠 中 | admin 用原生 `window.prompt/confirm` | `admin/index.tsx:387,404` | 充值和禁用用原生弹窗，与 antd 风格不一致；删除模型/变量无 `Modal.confirm` 二次确认，易误删。 |
| 🟠 中 | 调用日志无分页 | `admin/index.tsx:452` | 固定 `limit:100` 一次性拉取，超 100 条旧日志不可见；模型/用户为全量前端分页，数据量大时慢且截断。 |
| 🟡 低 | 首页/导出反馈差 | `home/index.tsx:77`、`project.tsx:1000` | 首页 showcase 无 loading/empty 态；登录框无自动聚焦；密码强度提示登录侧（仅 required）与注册侧（min:6）不一致；导出失败仅 `console.error` + 笼统文案。 |

---

## 二、安全隐患

| 级别 | 问题 | 位置 | 攻击场景与影响 |
|---|---|---|---|
| 🔴 严重 | 生产密钥硬编码默认值 | `config.py:18,23`；`.env` 缺失时生效 | `JWT_SECRET="change-me"`、`KEY_ENCRYPTION_KEY="change-me-..."` 写在代码默认里。若生产漏配 `.env`：① 攻击者可自签任意 JWT（含 `role=admin`）绕过 `require_admin`；② 可解密后端存储的全部供应商 `api_key`。**必须：缺失则启动失败，禁止默认值可用**。 |
| 🟠 高 | `DEBUG=true` 泄露堆栈 | `.env:3`、`config.py:8`、`main.py:16` | 未捕获异常返回完整 traceback/绝对路径/SQL；前端 `video.ts:391` 等把 `detail` 直接展示给用户（配合后端缺陷升级为信息泄露）。 |
| 🟠 高 | 上传文件存储型 XSS + 静态挂载免鉴权 | `main.py:37`、`upload/router.py`、`StaticFiles` | ① `/uploads` 静态挂载**无鉴权**，任何知道 UUID 文件名者可直接下载（隐私）；② `StaticFiles` 按扩展名返回 Content-Type，上传 `evil.html/svg` 即被浏览器当活动内容渲染 → 站点域下执行任意 JS（盗 Cookie/localStorage、调带凭证接口）。**修复：上传目录不走公开静态；返回一律 `Content-Disposition: attachment` 或仅放行图片/视频 MIME，禁用 HTML/SVG 上传。** |
| 🟠 高 | 前端插件可从任意 URL 执行 | `lib/canvas/plugin-loader.ts:61-68` | `installPluginFromUrl` 对任意 URL `fetch` 后 `import()` 执行；`official` 仅是前端布尔、无后端签名校验。在已认证会话内运行任意 JS = 持久化 XSS / 凭据窃取。**注意：此前 remote 模式只禁用了 model-plugin 的 `new Function`，并未覆盖 canvas 插件系统，仍是敞口。** |
| 🟠 高 | Cookie `secure=False` | `auth/router.py:26,34` | HTTPS 部署下 Cookie 可被中间人截获导致会话被盗；应生产 `secure=True`。 |
| 🟠 中 | 网关 proxy 可覆盖 endpoint + 跟随重定向 | `gateway/router.py:171`、`gateway_service.py:47,82` | `/gateway/{var}/proxy` 用户指定 `endpoint` 拼到供应商 base_url（只能作路径追加，无法改 host，限制有限）；但 `follow_redirects=True`，若供应商返回 302 可经重定向打内网（SSRF via redirect）。建议收敛/禁用覆盖或校验重定向目标。 |
| 🟠 中 | 插件后台执行 = 服务端 RCE | `plugin_service.py:54` | `execute_plugin` 用 `subprocess` 跑管理员脚本，仅限制 builtins，无沙箱/网络隔离/资源限制（仅 10s 超时）。admin 账号被攻破即整服 RCE。建议最小权限容器 + 网络隔离。 |
| 🟠 中 | 刷新令牌不失效 / 不校验状态 | `auth/router.py:82-95` | 刷新时旧 refresh token 7 天内仍可用（无 jti/版本/黑名单）；被封禁用户 refresh 仍可用。建议 refresh 版本号或黑名单，并刷新时校验 `status`。 |
| 🟠 中 | CORS `methods/headers=["*"]` + `credentials=True` | `main.py:21-24` | 当前 origins 为 localhost 列表可控；一旦生产配宽，凭证 Cookie 可被任意前端跨域读取。建议生产严格白名单。 |
| 🟠 中 | 登录无速率限制 / 无注册校验 | `auth/router.py:40,69` | `/auth/login` 可被暴力破解；注册无验证码 → 批量垃圾号。建议加限流 + 注册校验。 |
| 🟠 中 | localStorage 明文凭据 | `use-config-store.ts:275`、`use-agent-store.ts` | `apiKey`、`webdav.password`、`canvas-agent-token` 持久化于 localStorage，任何 XSS 可窃取。建议 WebDAV 密码经口令派生密钥加密；agent token 短期不持久化。 |
| 🟡 低 | 上传大小校验可绕过 | `upload/router.py:36` | 仅读客户端 `content-length` 头，可谎报小值上传大文件（磁盘 DoS）。应读取流时累加校验。 |
| 🟡 低 | 调用日志存完整请求体 | `gateway_service.py:115` | `request_body`（含用户 prompt）全量入库，admin 可读全部用户提示词，隐私风险。建议脱敏。 |

---

## 三、重大 Bug

| 级别 | 问题 | 位置 | 说明 |
|---|---|---|---|
| 🔴 高 | 401 处理死链导致"卡死" | 同 UX-1 | `refreshToken()` 为死代码，登录态仅靠 15min Cookie；过期后无任何续期/重定向逻辑，全功能失效且无提示。本质是功能级 Bug。 |
| 🟠 中 | 网关退款竞态 / 丢分 | `gateway/router.py:55-151` | 先 `deduct_credits` 再调上游；若进程在扣费后、调用前崩溃，**无退款 → 用户丢分**；流式路径异常不退款。建议事务化，或失败统一退款覆盖 stream。 |
| 🟠 中 | 注册两次写库 / 无事务 | `auth/router.py:50-62` | `User(credits=0)` 提交后 `add_credits(100)` 再提交；若第二步失败，用户 0 分无法生成。建议单条 `UPDATE` 或事务包裹。 |
| 🟠 中 | `get_user_credits` 悬持行锁 | `credit_service.py:8` | 用 `FOR UPDATE` 但不在事务内提交，可能悬持行锁；且该函数未被关键路径使用，逻辑冗余。 |
| 🟡 低 | stream 错误无友好提示 | `backend.ts:81-92` | `proxyGatewayStream` 仅 `response.ok` 判断，错误抛原始 text（含后端 detail），前端未兜底。 |
| 🟡 低 | `update_source` 全字段 setattr | `admin/router.py:63` | 遍历 `data` 设置全部字段，虽 schema 已限字段，但后续若 schema 增字段需警惕越权赋值。 |

---

## 四、已确认安全 / 无问题（避免误报）

- ✅ 后端 `projects/assets` 路由均按 `current_user.id` 过滤，**无 IDOR 越权**。
- ✅ JWT access 用 **HttpOnly Cookie**，前端不持有 access token（仅 401 拦截），优于 localStorage 方案，设计良好。
- ✅ `ApiSourceOut` **不含** `api_key_plain/api_key_encrypted`，密钥不随列表接口泄露（前端 `AdminApiSource.api_key_plain` 仅为可选类型字段，后端从不返回）。
- ✅ 后端 `EmailStr` 校验邮箱、密码 `min_length=6` 强制。
- ✅ 扣积分用原子 `UPDATE ... WHERE credits >= :amount RETURNING`，防负分与并发竞态，基础扎实。
- ✅ 前端未检索到 `dangerouslySetInnerHTML`/`eval`/`innerHTML` 拼接用户输入渲染。
- ✅ SameSite=Lax Cookie 缓解常规 CSRF（POST 跨站不发送）。

---

## 五、修复优先级建议

**P0（上线前必须）：**
1. `config.py` 生产缺失密钥则启动失败，删除可用默认值。
2. `main.py` 生产 `DEBUG=false` + 全局异常处理器（只返回错误 ID，不返回 traceback）。
3. 上传目录取消公开静态挂载；下载强制 `Content-Disposition: attachment`；禁用 HTML/SVG 上传。
4. 前端 401 事件接入监听器 + 启用 `refreshToken()` 静默续期 + 续期失败跳登录。
5. 前端插件加载加来源白名单 + 后端签名校验（或 SaaS 禁止用户自装任意 URL 插件）。

**P1（重要）：**
6. Cookie `secure=True`（HTTPS）；刷新令牌加版本号/黑名单并校验用户状态。
7. 网关 proxy 收敛 endpoint 覆盖或校验重定向目标；`follow_redirects` 谨慎。
8. admin 守卫补 `!currentUser → /login`；积分不足引导充值。
9. CORS 生产收严禁名单；登录加限流；注册校验。
10. localStorage 凭据加密（WebDAV 密码等）。

**P2（体验/健壮性）：**
11. admin 删除二次确认、日志分页、统一 `Modal` 而非 `prompt/confirm`。
12. 网关失败统一退款、注册事务化、`get_user_credits` 冗余清理。
13. 上传实际大小校验、日志脱敏。

---
*报告生成：静态审查，未实际运行服务。建议在 staging 环境对上述 P0/P1 项做动态验证。*
