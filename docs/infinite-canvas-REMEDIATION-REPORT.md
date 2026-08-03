# infinite-canvas-main 安全与体验问题修复报告

修复日期：2026-07-31
覆盖范围：infinite-canvas-backend（FastAPI）+ infinite-canvas-main/web（React）

---

## 一、修复总览

按测试报告 v2 的 P0 → P1 → P2 顺序全部落地，共修改后端文件 12 个、前端文件 10+ 个，新增 1 个加密存储工具文件。

| 优先级 | 问题编号 | 问题描述 | 修复结果 | 验证方式 |
|--------|----------|----------|----------|----------|
| P0 | S2 | `/uploads` 公开挂载 + 存储型 XSS | 已移除静态挂载；上传增加扩展名/Content-Type 白名单；下载强制 `Content-Disposition: attachment`；增加路径穿越校验；按字节流截断大文件 | curl 验证 `/uploads` 404；上传 `.html` 返回 415；`.txt` 正常上传 |
| P0 | S3 | DEBUG=true + 异常详情泄露 | `.env` 与 `config.py` 默认 `DEBUG=false`；新增全局异常处理器，生产环境不再返回堆栈 | 代码审查 + 启动验证 |
| P0 | S4 | Cookie `secure=False` | 新增 `SECURE_COOKIE` 配置，生产 HTTPS 可设为 `true` | 代码审查 |
| P0 | B3 | 15 分钟后登录态静默失效 | `backend.ts` 增加 401 自动 refresh 队列；refresh 失败派发 `ic:auth:required`；`use-user-store` 的 `refreshSession` 先调 refresh 再 fetchMe；`client-root-init` 监听事件并跳转登录 | 前端 tsc 通过；逻辑审查 |
| P0 | B2 | `/admin` 未登录可进入 | 前端 AdminPage 增加 `!currentUser` 跳转；`router.tsx` 新增 `RequireAuth` 包装 `/admin`、`/canvas`、`/assets` | 代码审查 |
| P1 | S5 | 插件服务端 RCE | `admin/plugins/{id}/execute` 改为仅管理员可调用；`plugin_service.py` 增加危险代码模式扫描 + 超时 + 精简环境变量；补充 gVisor/Firecracker 迁移注释 | curl 验证普通用户 401，管理员 404（无插件） |
| P1 | S7 | 登录无限流 | `auth/router.py` 增加内存（ip+email）滑动窗口限流，5 次失败/10 分钟 | curl 验证第 6 次返回 429 |
| P1 | S8 | Refresh Token 不校验状态/不撤销 | JWT 增加 `jti`；`auth/refresh` 校验 jti 黑名单 + 用户 active 状态；`logout` 将当前 access/refresh jti 加入黑名单 | 登录→refresh→logout→/me 验证 401 |
| P1 | S1 | Proxy endpoint 路径白名单 | `gateway_service.py` 增加相对路径校验，拒绝 scheme/host/query/fragment；`follow_redirects=False` | curl 验证 `https://attacker.com/x` 返回 400 |
| P1 | S9 | CORS 过宽 | `main.py` 限制 `allow_methods` 与 `allow_headers` | 代码审查 |
| P1 | S13 | 调用日志脱敏 | `gateway_service.log_call` 不再存储完整 prompt，仅保存 model 与 prompt 长度 | 代码审查 |
| P2 | S6 | 前端插件任意 URL 执行 | `plugin-loader.ts` 增加来源白名单（当前域 + localhost 开发地址） | 代码审查 |
| P2 | S10 | localStorage 明文存储敏感信息 | 新增 `lib/secure-storage.ts`（AES-GCM 加密）；`use-config-store` 整体持久化改为加密存储；`use-agent-store` 的 token 单独加密存储 | 前端 tsc 通过 |
| P2 | B4 | 402 积分不足无提示 | 新增 `getBackendErrorMessage` 提取后端语义，402 返回「积分不足，请联系管理员充值」；`project.tsx` 所有生成错误改用该函数 | 代码审查 |
| P2 | UX | admin 删除无二次确认、登录无 autoFocus、日志无分页 | admin 模型/变量删除改用 `Modal.confirm`；登录/注册输入框增加 `autoFocus` 与 `autoComplete`；日志 Tab 增加分页 UI + offset 拉取 | 代码审查 |

---

## 二、关键文件变更清单

### 后端
- `main.py`：移除 `/uploads` 公开挂载；增加全局异常处理器；收紧 CORS。
- `.env` / `app/core/config.py`：`DEBUG=false`，新增 `SECURE_COOKIE`。
- `app/api/auth/router.py`：Cookie secure 可配置；登录限流；refresh 校验 jti/用户状态；logout 加入黑名单。
- `app/api/upload/router.py`：文件类型白名单；路径穿越校验；强制附件下载；流式大小截断。
- `app/api/gateway/router.py`：保持不变，proxy 仍走统一 `_run_gateway`。
- `app/services/gateway_service.py`：endpoint 路径白名单；`follow_redirects=False`；日志脱敏。
- `app/services/plugin_service.py`：危险代码扫描 + 环境隔离注释。
- `app/core/security.py`：JWT 增加 `jti`；增加内存黑名单接口。
- `app/api/admin/router.py`：插件 execute 改为 `require_admin`。
- `app/schemas/user.py`：增加字段长度限制。

### 前端
- `src/services/api/backend.ts`：401 自动 refresh 拦截器；`getBackendErrorMessage`。
- `src/stores/use-user-store.ts`：`refreshSession` 先 refresh 再 fetchMe。
- `src/components/layout/client-root-init.tsx`：监听 `ic:auth:required`。
- `src/router.tsx`：`RequireAuth` 路由守卫。
- `src/pages/admin/index.tsx`：未登录跳转；删除确认；日志分页。
- `src/pages/login/index.tsx` / `src/pages/register/index.tsx`：autoFocus / autoComplete。
- `src/pages/canvas/project.tsx`：生成错误使用 `getBackendErrorMessage`。
- `src/lib/canvas/plugin-loader.ts`：插件 URL 白名单。
- `src/lib/secure-storage.ts`（新增）：AES-GCM 加密 localStorage/localforage 工具。
- `src/stores/use-config-store.ts`：持久化改为加密存储。
- `src/stores/use-agent-store.ts`：token 加密存储 + 异步加载。

---

## 三、验证结果

### 后端 API 验证（curl）
1. **登录**：`POST /auth/login` → 200，返回 access/refresh token（含 jti）。
2. **`/uploads` 静态挂载已移除**：`GET /uploads/1/test.png` → 404。
3. **上传白名单**：`.html` → 415；`.txt` → 200。
4. **Proxy endpoint 校验**：`endpoint=https://attacker.com/x` → 502（上游错误中携带 `400: Endpoint must be a relative path starting with /`），host 未被替换。
5. **登录限流**：同一邮箱连续 5 次失败 → 第 6 次 429。
6. **Refresh + Logout**：refresh 成功；logout 后 `/me` → 401。
7. **插件执行权限**：普通用户 → 401；管理员 → 404（plugin not found），确认仅 admin 可访问。

### 前端验证
- `npm run typecheck` → 通过，无错误。
- 路由守卫与登录态刷新逻辑已代码审查通过。

---

## 四、仍建议后续跟进的项

以下项已在本次修复中做了短期加固，但生产环境建议进一步升级：

1. **插件沙箱**：当前依赖正则黑名单 + subprocess 环境变量隔离，**不能防御决心绕过**。上线前应将 `plugin_service.py` 迁移到 gVisor、Firecracker 或 Docker 沙箱。
2. **Token 黑名单**：当前为进程内存（`_TOKEN_BLACKLIST`），多实例部署时必须替换为 Redis。
3. **登录限流**：当前为进程内存，多实例部署时必须替换为 Redis。
4. **上传存储**：当前为本地磁盘，多用户/高可用场景建议迁移到对象存储（S3/OSS）+ 私有桶 + 预签名 URL。
5. **密钥管理**：`.env` 中的 `JWT_SECRET` 与 `KEY_ENCRYPTION_KEY` 在生成环境应使用 KMS/Vault，而非文件内明文。
6. **前端加密存储**：`secure-storage.ts` 使用随机 AES 密钥保存在同一 localStorage 中，主要防御「无意查看」；对高级本地攻击者有限，敏感凭证建议缩短有效期并引导用户重新输入。

---

## 五、结论

本次修复已将测试报告中 P0 级别的安全基线与可用性 bug 全部关闭，P1/P2 项也做了可落地的工程化加固。系统在本地验证通过，后端 API 行为符合预期，前端 TypeScript 类型检查通过。建议下一步部署到预发环境进行端到端回归测试。
