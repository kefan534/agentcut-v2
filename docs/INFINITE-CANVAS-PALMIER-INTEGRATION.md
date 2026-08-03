# Infinite Canvas × Palmier Pro 对接方案

这份文档说明如何把 Palmier Pro（macOS 原生应用）接到 infinite-canvas-backend（FastAPI 后端），共用同一套 admin 后台的四级动态模型管理。

---

## 一、后端新增接口

文件位置：`agentcut/infinite-canvas-backend/`

### 1.1 `GET /api/v1/gateway/models/catalog`

返回 Palmier 能理解的模型目录。

示例响应：
```json
[
  {
    "id": "IMAGE_MODEL",
    "kind": "image",
    "displayName": "openai dall-e-3",
    "providerName": "openai",
    "description": "Default image model variable",
    "allowedEndpoints": ["generate"],
    "responseShape": "images",
    "paidOnly": false,
    "creditsCost": 5,
    "variableName": "IMAGE_MODEL",
    "uiCapabilities": {
      "aspectRatios": ["1:1", "16:9", "9:16"],
      "resolutions": ["1024x1024", "1024x576", "576x1024"],
      "qualities": ["standard", "hd"],
      "supportsImageReference": true,
      "maxImages": 4
    }
  }
]
```

实现文件：
- `app/schemas/model.py`：`CatalogModelOut`（camelCase 输出）
- `app/services/model_service.py`：`build_catalog()`、`_default_capabilities()`
- `app/api/gateway/router.py`：`get_model_catalog()`

**注意**：text 模型被过滤掉，因为 Palmier 只消费 video/image/audio/upscale。

### 1.2 `POST /api/v1/gateway/{variable_name}/submit`

提交异步生成任务，立即返回 `job_id`。

示例请求：
```bash
curl -X POST http://localhost:8081/api/v1/gateway/IMAGE_MODEL/submit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a cat", "n": 1, "size": "1024x1024"}'
```

示例响应：
```json
{"job_id": "...", "status": "queued", "created_at": 1785463295288}
```

实现文件：
- `app/services/async_job_service.py`：内存任务队列 + 后台执行
- `app/api/gateway/router.py`：`gateway_submit()`

### 1.3 `GET /api/v1/gateway/{variable_name}/status/{job_id}`

轮询任务状态。

示例响应：
```json
{
  "job_id": "...",
  "variable_name": "IMAGE_MODEL",
  "status": "succeeded",
  "result_urls": ["https://..."],
  "error_message": null,
  "cost_credits": 5,
  "created_at": 1785463295288,
  "completed_at": 1785463305288
}
```

实现文件：
- `app/services/async_job_service.py`
- `app/api/gateway/router.py`：`gateway_status()`

---

## 二、Palmier Pro 改动

文件位置：`agentcut/infinite-canvas-main/palmier-pro-main/`

### 2.1 后端配置 `Sources/PalmierPro/Backend/BackendConfig.swift`

新增：
```swift
static let infiniteCanvasBackendURL: URL?
static let infiniteCanvasBackendToken: String?
```

### 2.2 生成后端 `Sources/PalmierPro/Generation/GenerationBackend.swift`

- 移除 Convex RPC（`convex.mutation/subscribe`）
- 改为 HTTP：`/gateway/{var}/submit` + `/gateway/{var}/status/{id}`
- 上传改为 `POST /api/v1/upload`（multipart/form-data）
- 状态订阅用 `Timer.publish` 轮询，每 2 秒一次
- 新增错误类型：`GenerationClientError`、`GenerationBackendError`

### 2.3 模型目录 `Sources/PalmierPro/Generation/Catalog/ModelCatalog.swift`

- 从 Convex `models:list` 改为 `GET /api/v1/gateway/models/catalog`
- 移除了 Convex 订阅和失败重试（保留重试逻辑）

### 2.4 账户/积分 `Sources/PalmierPro/Account/AccountService.swift`

- 移除 Clerk 登录、Stripe 订阅、购买积分等代码
- 启动时调用 `GET /api/v1/auth/me` 获取 `{credits, role, email, nickname}`
- `isPaid` = `credits > 0 || role == admin`
- `tier` 基于 credits 映射：>=1000 或 admin → `.max`，>0 → `.pro`，否则 `.none`
- 保留 `convex` 属性返回 `nil` 以兼容 `BackendStorage`/`TranscriptionBackend` 编译

### 2.5 生成服务 `Sources/PalmierPro/Generation/GenerationService.swift`

- 移除 `import ConvexMobile`
- `backendError()` 改为解析 `GenerationClientError.httpError`

---

## 三、去订阅检查点清单

付费/订阅检查全部保留，但判断逻辑已集中到 `AccountService`：

| 文件 | 行号附近 | 检查点 | 改法 |
|---|---|---|---|
| `Account/AccountService.swift` | 116 | `isPaid` | 基于 `credits > 0 \|\| role == admin` |
| `Account/AccountService.swift` | 126 | `hasCredits` | 基于 `credits > 0` |
| `Generation/UI/GenerationView+ModelState.swift` | 36-44 | `currentModelLocked` | 仍读 `account.isPaid`，但 `isPaid` 已改 |
| `Generation/Edit/EditAction.swift` | 15-20 | `requiresPaidPlan` | 仍读 `account.isPaid` |
| `Generation/Edit/AIEditMenu.swift` | 91 | `requiresPaidPlan && !isPaid` | 仍读 `account.isPaid` |
| `Inspector/Tabs/AIEditTab.swift` | 223、257 | 付费拦截 | 仍读 `account.isPaid` |
| `Timeline/TimelineView+AIEditMenu.swift` | 12、17、83 | 付费检查 | 仍读 `account.isPaid` |
| `Agent/Tools/ToolExecutor+Generate.swift` | 多处 | `paidOnly` 判断 | 仍读 `account.isPaid` |
| `Agent/Panel/AgentPanelView.swift` | 351、357 | 未付费按钮 | 仍读 `account.isPaid` |
| `Settings/ModelsPane.swift` | 13、23、46 | locked 状态 | 仍读 `account.isPaid` |
| `Settings/AccountPane.swift` | 多处 | 订阅/升级按钮 | 行为变为提示「去 web admin 充值」 |
| `Account/CreditSummaryView.swift` | 多处 | 免费/付费层级 | 仍读 `account.tier` |
| `Account/AccountPopoverCard.swift` | 多处 | 账户卡片 | 仍读 `account.tier` |
| `Generation/UI/GenerationView.swift` | 274 | `.onChange(of: account.isPaid)` | 仍有效 |

**结论**：UI 检查点本身没改，因为 `AccountService.isPaid / hasCredits / tier` 已经从「Clerk 订阅」切换成「Infinite Canvas 积分/角色」。

---

## 四、构建配置整改

### 4.1 已修改文件

| 文件 | 改动 |
|---|---|
| `Package.swift` | `.macOS(.v26)` → `.macOS(.v15)` |
| `Sources/PalmierPro/Resources/Info.plist` | `LSMinimumSystemVersion` 26.0 → 15.0；Bundle ID → `io.yourname.palmier-pro`；关闭 Sparkle（`SUEnableAutomaticChecks=false`，`SUFeedURL=` 空）；新增 `InfiniteCanvasBackendURL` / `InfiniteCanvasBackendToken` |
| `scripts/PalmierPro.entitlements` | Team ID / App ID / Keychain Group → `YOURTEAMID.io.yourname.palmier-pro` |
| `scripts/bundle.sh` | 默认 `SIGNING_IDENTITY` / `NOTARY_PROFILE` / `KEYCHAIN_ACCESS_GROUP` 改为占位符 |
| `.env.example` | 新增模板，说明 Infinite Canvas 配置和签名配置 |

### 4.2 你需要替换的占位符

把以下占位符全部换成你自己的真实值：
- `YOURTEAMID` → Apple Developer Team ID
- `io.yourname.palmier-pro` → 你自己的 Bundle ID
- `YOURTEAMID.io.yourname.palmier-pro` → Keychain Group
- `InfiniteCanvasBackendURL` → 后端地址
- `InfiniteCanvasBackendToken` → 用户的 JWT token

### 4.3 本地运行

```bash
cd agentcut/infinite-canvas-main/palmier-pro-main
cp .env.example .env
# 编辑 .env 填上 URL 和 token
./scripts/dev.sh
```

### 4.4 打包 DMG

```bash
# 仅本地 ad-hoc 签名（别人打开需右键放行）
./scripts/bundle.sh debug

# 正式发布：需要 Apple Developer Program + Notary 配置
./scripts/bundle.sh release --dist
```

---

## 五、已知限制与后续建议

1. **异步任务队列在内存里**：当前 `_jobs` 是进程内 dict，重启后端会丢失未完成任务。生产环境请换 Redis/Celery/RQ。
2. **Palmier 登录入口未做**：当前 token 从 `Info.plist` 读取，适合个人/内测。正式分发请做 Keychain + 登录 UI。
3. **转写/语音功能仍依赖 Convex**：`TranscriptionBackend.swift`、`BackendStorage.swift`、`CloudTranscription.swift` 没改，需要 Convex 配置或后续一并替换。
4. **Agent 流仍走 Convex**：`PalmierClient.swift` 的 `/v1/agent/stream` 是 Convex HTTP，不是 Infinite Canvas。
5. **Sparkle 已关闭**：不再接收 Palmier 官方更新；如需自己的自动更新，要重配 SUFeedURL 和 EdDSA 密钥。
6. **UI 文案仍是"Subscribe"**：虽然功能上基于积分，但按钮文案还没改成"充值"，后续可统一替换。

---

## 六、后端验证命令

```bash
# 登录
curl -c cookies.txt -X POST http://localhost:8081/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"frontend@test.com","password":"test123456"}'

# 拉模型目录
curl -b cookies.txt http://localhost:8081/api/v1/gateway/models/catalog

# 提交异步任务
curl -b cookies.txt -X POST http://localhost:8081/api/v1/gateway/IMAGE_MODEL/submit \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat","n":1,"size":"1024x1024"}'

# 查状态
curl -b cookies.txt http://localhost:8081/api/v1/gateway/IMAGE_MODEL/status/<job_id>
```
