# Infinite Canvas（前后端）测试报告 v2

> 测试角色：测试工程师（QA）
> 测试对象：`infinite-canvas-main/web`（前端 Vite+React） + `infinite-canvas-backend`（FastAPI）
> 测试方式：代码静态审查 + 动态/实证验证（后端 8081 运行中；对 SSRF、插件沙箱逃逸、`/uploads` 越权均做了实测）
> 测试日期：2026-07-31
> 版本：v2（对 v1 的复核与纠错版，文末附「v1↔v2 对比」）

---

## 0. 与 v1 的核心差异（先看这里）

| # | v1 结论 | v2 结论（复核后） | 依据 |
|---|---------|-------------------|------|
| S1 | 🔴严重 SSRF + 供应商密钥泄露（`@` 注入换 host） | 🟡中 误报纠正 | 实测 urlparse：`@` 始终落在 path，host 不变；httpx 跨域重定向会剥离 Authorization（已起本地 server 验证）。残余风险仅是「任意登录用户可用供应商 key 调供应商任意路径」 |
| S2 | 🔴严重 上传越权+XSS | 🟠高 降级 | `/uploads` 免鉴权确实存在（curl 200 已验证），但文件名是 128 位随机 UUID（不可猜），且前端实际走鉴权路径 `/api/v1/upload/`；公开挂载主要形成「存储型 XSS」（上传 .html 分享链接触发）而非批量越权读取 |
| S5 | 🟠高 插件 subprocess=RCE | 🟠高 维持但措辞修正 | 实测确认沙箱**可逃逸**（subclass 链拿到 `os.system`，写出 `/tmp/plugin_pwn.txt`）；但脚本仅管理员可写、execute 端点任意用户可调，故实际 RCE 需管理员账号被攻破 |
| 日志分页 | 中「无服务端分页」 | 🟢低 纠错 | 后端 `list_logs` 支持 offset/limit(≤200) 及多过滤项；仅前端固定 `limit:100` 未做分页 UI |
| 新增正面项 | — | ✅补录 | `get_current_user` 校验 `status=="active"`（封禁用户 token 即时失效）；`resolve_source_for_variable` 强制校验 `allowed_user_levels`（用户等级隔离生效） |

> 净效果：v1 把 **2 个 Critical** 中的 S1 判错（误报）、S2 高估；v2 无 Critical，但 High 项更扎实、可复现。

---

## 一、测试结论概览（v2）

| 类别 | 严重 | 高 | 中 | 低 |
|------|------|----|----|----|
| 安全隐患 | 0 | 5 | 5 | 3 |
| 重大 Bug | 0 | 3 | 2 | 0 |
| UX 体验问题 | 0 | 3 | 5 | 3 |

**总评**：多用户框架（鉴权/积分/网关/后台）结构完整，数据层隔离做得较扎实（无 IDOR、积分原子扣减、用户等级强校验）。主要风险集中在**安全默认值与边界校验**（DEBUG 显式开启、Cookie 不 secure、上传公开挂载、插件沙箱形同虚设）与**前端登录态工程化缺失**（刷新 token 死代码、401 无人监听、无路由守卫）。无「即开即打」的 Critical，但 High 项需上线前清零。

---

## 二、安全隐患

### 🟠 高 / High

#### S2. `/uploads` 公开静态挂载 + 存储型 XSS（已实测）
- **位置**：`main.py:37` `app.mount("/uploads", StaticFiles(...))`（无鉴权依赖）；`upload/router.py:42-43` 上传不校验扩展名/MIME
- **实测**：`curl http://localhost:8081/uploads/{uid}/{file}` → **HTTP 200**（无 token）。
- **纠正说明**：文件名 `{uuid4.hex}{ext}` 为 128 位随机，不可枚举；前端 `assets/router.py:18` 与 `backend.ts:getAssetUrl` 实际返回鉴权路径 `/api/v1/upload/{storage_key}`，并不依赖 `/uploads`。故**批量越权读取的现实性低于 v1 描述**。
- **仍成立的风险**：① 任何登录用户上传 `evil.html`/`evil.svg` → 访问 `/uploads/{自己uid}/{uuid}.html` → StaticFiles 按 `.html` 设 `text/html` 内联渲染 → 脚本在**后端源**执行（若生产前后端同域则为同源 XSS，可携 cookie 调鉴权接口）；分享该链接即可触发。② `get_file`（鉴权端点）也未设 `Content-Disposition: attachment`，对文件属主同样内联渲染（self-XSS）。
- **修复**：移除 `/uploads` 公开挂载（前端已用鉴权路径）；上传做 MIME/扩展名白名单；返回时强制 `Content-Disposition: attachment` + 对 HTML/SVG 拒绝内联。

#### S3. `DEBUG=true` 显式开启 + 错误堆栈透传
- **位置**：`config.py:8` 默认 `True`；`.env` **显式** `DEBUG=true`；`main.py:16` `debug=settings.DEBUG`；前端各生成模块 `error.message` 直接 `message.error`
- **纠正**：v1 仅说「默认值危险」；实测 `.env` 已显式 `DEBUG=true`，运行实例确会向客户端返回完整 traceback（路径/SQL/依赖）。
- **修复**：生产 `DEBUG=false`；加全局异常处理器只回通用错误 ID；前端不展示 `detail`/`error.message` 原文。

#### S4. 认证 Cookie `secure=False`（硬编码）
- **位置**：`auth/router.py:26,34` `secure=False`（注释「Set True in production」但**未做成配置项**）
- **问题**：即使上 HTTPS，cookie 仍可被中间人在 HTTP 跳转时截获。
- **修复**：改为 `secure=settings.ENV=="production"` 或独立配置。

#### S5. 插件沙箱可逃逸（实测确认）+ execute 未限管理员
- **位置**：`admin/router.py:167` `execute_plugin_endpoint` 用 `get_current_user`（任意登录用户可调）；`plugin_service.py:33,42` `exec(user_code, _globals)` + 受限 builtins 字典
- **实测**：复刻沙箱后，用经典 subclass 链 `[c for c in ().__class__.__bases__[0].__subclasses__() if c.__name__=="_wrap_close"][0].__init__.__globals__["system"]("...")` 成功调用 `os.system` 并写出文件。**所谓「builtins 白名单沙箱」形同虚设。**
- **纠正**：v1 笼统称「subprocess=RCE」；v2 明确——脚本内容由管理员写入（普通用户无法注入代码），故直接 RCE 需管理员账号被攻破；但「受限沙箱」是虚假安全感，且 execute 未收 admin 权限，任意用户可触发已上架插件的执行（扣 1 积分）。
- **修复**：放弃纯 Python 沙箱，改用容器/gVisor 隔离 + 网络出口限制；execute 收 `require_admin` 或对插件签名。

#### S6. 前端插件从任意 URL 加载并 `import()` 执行
- **位置**：`plugin-loader.ts:47-68` `installPluginFromUrl` → `fetchPluginSource(url)` → `evaluatePluginSource` 用 `import(blobURL)`
- **问题**：仅校验 `id/nodes` 结构，无来源白名单/签名。诱导用户安装恶意 URL 即在已认证会话中执行任意 JS（持久化 XSS 等价）。
- **修复**：插件来源白名单 + 后端签名/哈希校验；禁止运行时从任意 URL 拉取执行。

### 🟡 中 / Medium

#### S1. 网关 proxy 允许用户自选 endpoint（误报纠正后的残余风险）
- **位置**：`gateway/router.py:171` `/gateway/{var}/proxy`；`gateway_service.py:17-19` `_build_upstream_url`
- **纠正（重要）**：v1 称「`endpoint=foo@attacker.com/x` 可换 host 泄露密钥」——**实测为误报**：Python urlparse 在所有拼接形式下 host 始终为 `source.base_url` 的 host，`@` 只落在 path；另测 httpx `follow_redirects=True` 时**跨域重定向会剥离 Authorization**（起本地 302 server 验证，受害 host 收到 `<none>`）。故不存在「把供应商密钥发到攻击者主机」的路径。
- **仍成立**：任意登录用户可传任意 `endpoint`（路径），用供应商 key 调供应商**任意路径**（如 `/v1/embeddings`、`/v1/models`），绕过变量映射，且计费按 `modal_category` 固定扣分、与实际调用的供应商端点解耦（可被薅高价端点/造成账目不一致）。中。
- **修复**：endpoint 限制为纯路径白名单（正则 `^/[A-Za-z0-9_./-]*$`）；或 proxy 仅限 admin。

#### S7. 登录无限流 / 锁定 / 验证码
- **位置**：`auth/router.py:69` `/login`
- **问题**：无失败计数、无验证码、无 IP 限流；密码仅 `min_length=6`。可撞库，且 admin 账号一旦被撞即联动 S5 形成 RCE 链。
- **修复**：Redis 限流（如 5 次/10 分钟锁 15 分钟）+ 登录失败计数。

#### S8. Refresh 不校验账号状态 / 令牌不撤销
- **位置**：`auth/router.py:82-95` `/refresh`
- **纠正**：v1 称「封禁用户 refresh 仍可用」——部分成立但影响有限：`get_current_user`（`deps.py:47`）会校验 `status=="active"`，故封禁用户即使 refresh 拿到新 access token，使用时仍被 401 拒。真正问题是：① refresh 不查库不校验状态（可继续签发「无用」token，浪费且语义混乱）；② 旧 refresh 不撤销（无 jti/黑名单），被盗后 7 天内始终可签发新 access（虽然封禁后无用，但正常用户被盗号后改密码无法即时踢下线）；③ logout 不服务端失效。
- **修复**：refresh 校验 `status`；引入 token 版本/黑名单；改密/封禁即作废已签发令牌。

#### S9. CORS methods/headers 全开 + credentials
- **位置**：`main.py:21-24`
- **问题**：`allow_methods/headers=["*"]` + `allow_credentials=True`，完全依赖 `CORS_ORIGINS` 白名单（`.env` 已收敛为本地 4 个源，尚可）。
- **修复**：methods/headers 收敛为实际所需；生产 origins 严格白名单。

#### S10. 前端 localStorage 明文存敏感凭据
- **位置**：`use-config-store.ts`（apiKey、WebDAV password）、`use-agent-store.ts`（canvas-agent-token）
- **问题**：任一 XSS（如 S2/S6）即可读取外传。
- **修复**：WebDAV 密码用 `crypto.subtle` 经用户口令派生密钥加密后存；agent token 不持久化；apiKey 仅内存。

### 🟢 低 / Low

#### S11. `get_file` 潜在路径穿越
- **位置**：`upload/router.py:64-73` `Path(UPLOAD_DIR)/user_id/filename` 未规范化
- **问题**：`filename` 含 `../` 时 `file_path.exists()` 会按 OS 解析跳出目录（需 URL 编码绕过单段路由匹配，可行性低）。鉴权端点仅限属主/admin，影响有限。
- **修复**：`Path(filename).name` 取纯文件名，或 `os.path.realpath` 后校验仍在 `UPLOAD_DIR` 内。

#### S12. 上传大小仅靠 `content-length` 头
- **位置**：`upload/router.py:36-40`
- **问题**：客户端可伪造/省略该头绕过 500MB 限制；`copyfileobj` 不计字节。
- **修复**：流式读取累计字节数硬截断。

#### S13. 调用日志存完整 `request_body`（含用户 prompt）
- **位置**：`gateway_service.py:89-119` `log_call`
- **问题**：admin 可见全部用户原始 prompt，隐私顾虑。
- **修复**：脱敏或仅存摘要/长度。

---

## 三、重大 Bug（功能 / 数据）

### B2. [高] `/admin` 未拦截未登录用户
- **位置**：`admin/index.tsx:41-46`
- **复现**：守卫 `if (currentUser && currentUser.role !== "admin")`——`currentUser===null` 时为假，**不跳转**。未登录直接访问 `/admin` 可看到完整后台 UI（各 Tab 随后 401，因 `ic:auth:required` 无人监听，仅静默「加载失败」）。
- **修复**：`if (!currentUser) navigate("/login"); else if (currentUser.role!=="admin") navigate("/");`

### B3. [高] 刷新 token 是死代码 + 401 无人监听（无静默续期）
- **位置**：`backend.ts:14-17`（401 仅 `dispatchEvent("ic:auth:required")`）；`backend.ts:63` `refreshToken()`；`use-user-store.ts:66` `refreshSession`
- **实证**：全仓 grep——`ic:auth:required` **仅 1 处派发、0 处监听**；`refreshToken` **仅定义、0 调用**。`refreshSession` 只调 `fetchMe()`，从不调 `refreshToken()`。
- **后果**：access token 15 分钟过期后，前端仍显示「已登录」，但所有接口 401，操作只弹技术错误；不跳登录、不续期。后端明明有可用 `/auth/refresh` + 7 天 refresh cookie，前端却从不用。
- **修复**：在 `backend.ts` 401 拦截里自动调 `/auth/refresh` 重试一次，失败再清会话跳 `/login`；或监听 `ic:auth:required` 触发 `refreshToken`。

### B4. [高] 积分不足(402)/失败 无友好提示与充值入口
- **位置**：`project.tsx:1747,1829,2066` 等 `error instanceof Error ? error.message : "生成失败"`；前端无任何充值 UI
- **问题**：402 时 axios 的 `error.message` 是 `"Request failed with status code 402"`（非后端 `detail`），直接 `message.error` 给用户看；且普通用户无自助充值入口（仅 admin 后台可加积分），余额归零即卡死。
- **修复**：识别 402 弹「积分不足」+ 提供「联系管理员/去充值」；提取 `error.response.data.detail` 展示后端语义。

### B5. [中] 路由级守卫缺失
- **位置**：`router.tsx:18-41`
- **问题**：无 `RequireAuth`，`/canvas`、`/assets`、`/admin` 等均可未登录直入，触发 401 后才暴露。
- **修复**：加路由守卫统一跳 `/login`。

### B6. [中] 网关流式分支不退款
- **位置**：`gateway/router.py:74-94`
- **问题**：`StreamingResponse` 已返回后，`try/except` 不再包住生成器；流式中途失败已扣积分不退、错误也无法以 HTTP 返回。
- **修复**：生成器内捕获异常并退款/记日志。

---

## 四、UX 体验问题

| 级别 | 问题 | 位置 |
|------|------|------|
| 高 | 401 无监听 + 无静默刷新（见 B3） | backend.ts / use-user-store |
| 高 | /admin 未拦截未登录（见 B2） | admin/index.tsx:41 |
| 高 | 积分不足无友好提示与充值入口（见 B4） | project.tsx |
| 中 | 路由级守卫缺失（见 B5） | router.tsx |
| 中 | 进入 `/canvas/:id` 整体隐藏顶栏，退出登录/用户菜单不可达 | app-top-nav.tsx:27 |
| 中 | 导出失败仅 `console.error` + 笼统「导出失败」 | project.tsx:999-1001 |
| 中 | admin 删除模型/变量无二次确认（禁用用户反有 `confirm`） | admin/index.tsx:139,304 |
| 中 | admin 用原生 `window.prompt`(充值)/`confirm`(禁用) | admin/index.tsx:387,404 |
| 低 | 调用日志前端固定 `limit:100`、无分页/过滤 UI（后端已支持 offset/limit/过滤） | admin/index.tsx:452 |
| 低 | 登录框无自动聚焦、无密码强度提示 | login/index.tsx |
| 低 | 首页 showcase 无 skeleton | home/index.tsx |

---

## 五、已确认的良好实践（v2 补录）
- ✅ **`get_current_user` 校验 `User.status=="active"`**（`deps.py:47`）——封禁用户 access token 即时失效（v1 漏记）。
- ✅ **`resolve_source_for_variable` 强制校验 `allowed_user_levels`**（`model_service.py:25,33,42`）——用户等级与源隔离生效（v1 漏记）。
- ✅ 工程/资产全端点按 `user_id` 过滤，**无 IDOR**（projects/assets router 逐一核对）。
- ✅ 积分扣减原子 `UPDATE ... WHERE credits >= :amount`，无负余额/竞态。
- ✅ 供应商 api_key 用 Fernet 加密存储，`ApiSourceOut` 不返回明文 key。
- ✅ JWT 走 HttpOnly Cookie（非 localStorage）。
- ✅ `.env` 已用真实密钥覆盖 `change-me` 默认值（但代码默认值仍危险，新部署需注意）。

---

## 六、修复优先级

**P0（上线前必修）**
1. S2 移除 `/uploads` 公开挂载 + 上传类型白名单 + Content-Disposition
2. S3 `DEBUG=false` + 全局异常处理
3. S4 Cookie `secure` 可配置
4. B3 401 拦截自动 refresh + 失败跳登录
5. B2 admin 守卫补 `!currentUser` 分支

**P1（上线前尽量修）**
6. S5 插件改容器沙箱 + execute 收 admin
7. S6 插件来源白名单 + 签名
8. S7 登录限流
9. S8 refresh 校验状态 + 令牌撤销
10. B4 402 友好提示 + 充值入口

**P2（迭代）**
11. S1 endpoint 路径白名单；S9 CORS 收敛；S10 localStorage 加密；S11/S12 上传校验；S13 日志脱敏；B5/B6 守卫与流式退款；UX 低项

---

## 七、v1 ↔ v2 对比总表

| 编号 | v1 级别 | v2 级别 | 变化原因 |
|------|---------|---------|----------|
| S1 | 🔴严重 | 🟡中 | `@` 换 host 误报（实测）；httpx 跨域重定向剥 Authorization（实测）；残余仅是供应商路径滥用 |
| S2 | 🔴严重 | 🟠高 | 文件名随机 UUID 不可猜 + 前端用鉴权路径；主风险收敛为存储型 XSS |
| S3 | 🟠高 | 🟠高 | 维持；补充 `.env` 显式 DEBUG=true 的实测证据 |
| S4 | 🟠高 | 🟠高 | 维持；补充「硬编码未做配置项」 |
| S5 | 🟠高 | 🟠高 | 维持；实测确认沙箱可逃逸；措辞修正（需管理员写脚本） |
| S6 | 🟠高 | 🟠高 | 维持 |
| S7 | 🟡中 | 🟡中 | 维持；补「联动 S5 成 RCE 链」 |
| S8 | 🟡中 | 🟡中 | 维持；修正「封禁用户 refresh 仍可用」的夸大（access 使用时被拦） |
| S9 | 🟡中 | 🟡中 | 维持；补「.env 已收敛 origins」 |
| S10 | 🟡中 | 🟡中 | 维持 |
| S11 输入长度 | 🟡中 | 删除 | v1 笼统称输入无长度校验；复核后 createProject 等为业务 JSON，无明确安全隐患，移除以免稀释 |
| S12 流式退款 | 🟡中 | B6 中 | 归入 Bug 类更准确 |
| S13 日志 | 🟢低 | 🟢低 | 维持 |
| 日志分页(UX) | 中 | 低 | 后端支持分页，仅前端未暴露；降级 |
| 新增 S11 路径穿越 | — | 🟢低 | v2 新发现 |
| 新增 S12 上传大小 | — | 🟢低 | v2 新发现 |
| 良好实践 | 部分 | ✅补录 | 补 `status` 校验、`allowed_user_levels` 强校验 |

**结论**：v1 方向正确但有两处**严重性误判**（S1 误报、S2 高估）与若干**漏记的正向项**；v2 通过实测把误报剔除、把正向项补齐，剩余 High 项均可复现、修复路径清晰。
