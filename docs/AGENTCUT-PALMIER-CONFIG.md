# AgentCut Pro 本地配置说明

> 原项目为 Palmier Pro，已按「仅改前端显示名」方案完成重命名为 **AgentCut Pro**，并彻底移除对 Palmier 云端 Clerk/Convex 的依赖，全部功能迁移到自托管的 **infinite-canvas-backend**。

## 1. 登录入口

已新增原生邮箱/密码登录窗口，替代原来的 Clerk/Google 登录。

- 启动应用时如果 Keychain 中没有 token，会自动弹出登录窗口。
- 如果 `Info.plist` 或 `.env` 中预配了 token，首次启动会自动登录并把 token 写入 Keychain。
- 登录调用 `POST /api/v1/auth/login`，成功后保存 access token 到 Keychain。
- 退出登录会删除 Keychain 中的 token。

## 2. 积分消耗

**需要消耗积分。**

- 后端 `/api/v1/gateway/{variable_name}/submit` 提交任务时会按模型类型扣积分：
  - `text`: 1 credit
  - `image`: 5 credits
  - `audio`: 3 credits
  - `video`: 10 credits
  - `upscale`: 2 credits
- 余额不足返回 HTTP 402。
- 任务失败会自动退款。
- 当前测试用户 `palmier-dev@example.com` 注册即送 100 credits。

## 3. 占位符含义与当前值

| 占位符 | 含义 | 获取方式 | 当前已替换为 |
|---|---|---|---|
| `YOURTEAMID` | Apple Developer Team ID | 加入 Apple Developer Program（约 688 元/年）后在 https://developer.apple.com/account 查看 Membership 中的 Team ID | **待你提供** |
| `io.yourname.palmier-pro` | Bundle ID | 在 Apple Developer 网站或 Xcode 中注册 App ID 时自定义 | `io.yang2026.palmier-pro` |
| `YOURTEAMID.io.yourname.palmier-pro` | Keychain Group | 格式固定为 `<TeamID>.<BundleID>` | `YOURTEAMID.io.yang2026.palmier-pro` |
| `InfiniteCanvasBackendURL` | FastAPI 后端地址 | 本地开发填 `http://localhost:8081`，生产填你的域名 | `http://localhost:8081` |
| `InfiniteCanvasBackendToken` | 用户的 JWT access token | 调用 `POST /api/v1/auth/login` 返回 | 已填入本地测试用户 token |

## 4. 已修改文件清单

- `palmier-pro-main/Package.swift`
- `palmier-pro-main/Sources/PalmierPro/Backend/KeychainTokenStore.swift` （新增）
- `palmier-pro-main/Sources/PalmierPro/Backend/BackendConfig.swift`
- `palmier-pro-main/Sources/PalmierPro/Backend/BackendStorage.swift`
- `palmier-pro-main/Sources/PalmierPro/Account/AccountService.swift`
- `palmier-pro-main/Sources/PalmierPro/Account/SignInView.swift` （新增）
- `palmier-pro-main/Sources/PalmierPro/Account/AccountPopoverCard.swift`
- `palmier-pro-main/Sources/PalmierPro/Account/CreditSummaryView.swift`
- `palmier-pro-main/Sources/PalmierPro/Home/HomeView.swift`
- `palmier-pro-main/Sources/PalmierPro/Home/WelcomeOverlay.swift`
- `palmier-pro-main/Sources/PalmierPro/Home/MyProjectsSection.swift`
- `palmier-pro-main/Sources/PalmierPro/Home/UpdateOverlay.swift`
- `palmier-pro-main/Sources/PalmierPro/Settings/AccountPane.swift`
- `palmier-pro-main/Sources/PalmierPro/Settings/SettingsView.swift`
- `palmier-pro-main/Sources/PalmierPro/App/AppDelegate.swift`
- `palmier-pro-main/Sources/PalmierPro/App/MainMenu.swift`
- `palmier-pro-main/Sources/PalmierPro/Utilities/Constants.swift`
- `palmier-pro-main/Sources/PalmierPro/Agent/Clients/PalmierClient.swift`
- `palmier-pro-main/Sources/PalmierPro/Transcription/TranscriptionBackend.swift`
- `palmier-pro-main/Sources/PalmierPro/Project/SampleProjectService.swift`
- `palmier-pro-main/Sources/PalmierPro/Resources/Info.plist`
- `palmier-pro-main/Sources/PalmierPro/Resources/Localization/zh-Hans.lproj/Localizable.strings`
- `palmier-pro-main/Sources/PalmierPro/Resources/Localization/en.lproj/Localizable.strings`
- `palmier-pro-main/scripts/PalmierPro.entitlements`
- `palmier-pro-main/scripts/bundle.sh`
- `palmier-pro-main/.env.example`
- `palmier-pro-main/.env` （新增，已填真实值）
- `infinite-canvas-backend/app/api/gateway/router.py`
- `infinite-canvas-backend/app/api/upload/router.py`
- `infinite-canvas-backend/app/api/samples/router.py` （新增）
- `infinite-canvas-backend/app/services/upload_service.py` （新增）
- `infinite-canvas-backend/app/services/model_service.py`
- `infinite-canvas-backend/main.py`

## 5. 本地启动验证步骤

> **重要：当前 AI 沙箱无法运行 `swift build`（会被 `posix_spawn` 拒绝），所以必须在你自己的 Mac 上用 Xcode 26 或命令行执行以下步骤。**
>
> 项目代码依赖 macOS 26.0 API（SpeechTranscriber、Observation 等），所以最低系统版本已设置为 **macOS 26.0**，需要 Xcode 26+ 和 macOS 26 设备才能编译运行。

### 5.1 启动后端

```bash
cd infinite-canvas-backend
# 如果虚拟环境还没建
/Users/macminim4/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m venv /Users/macminim4/.workbuddy/binaries/python/envs/agentcut
/Users/macminim4/.workbuddy/binaries/python/envs/agentcut/bin/pip install -r requirements.txt
/Users/macminim4/.workbuddy/binaries/python/envs/agentcut/bin/alembic upgrade head
/Users/macminim4/.workbuddy/binaries/python/envs/agentcut/bin/python seed.py

# 启动服务
/Users/macminim4/.workbuddy/binaries/python/envs/agentcut/bin/uvicorn main:app --host 0.0.0.0 --port 8081
```

### 5.2 构建并运行 AgentCut Pro（本地 ad-hoc，不需要 Team ID）

**注意**：如果你本机 Swift 版本是 6.2.x，需要先把 `Package.swift` 中的 `mlx-swift` 从 `0.31.5` 改为 `0.31.4`（已修改），因为 `0.31.5` 要求 Swift 6.3。

**方式 A：用脚本构建 `.app` 后双击运行**

```bash
cd palmier-pro-main

# 清理缓存（如果之前解析或编译失败过）
rm -rf .build/checkouts/mlx-swift .build/repositories/mlx-swift* .build/workspace-state.json
rm -rf .build/plugins

# 确保使用 Xcode 自带的工具链
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

scripts/bundle.sh debug
```

> **macOS 26 Metal Toolchain 问题**：macOS 26 把 Metal Toolchain 放在 cryptex 路径下（如 `/var/run/com.apple.security.cryptexd/.../Metal.xctoolchain`），`swift build` 默认只在 `XcodeDefault.xctoolchain/usr/bin` 查找 `metal`，因此会报 `missing Metal Toolchain`。
>
> `scripts/bundle.sh` 已自动处理：启动时会用 `xcrun -f metal` 找到 cryptex 中的 `metal`/`metallib`，并 `sudo ln -sf` 链接到 `XcodeDefault.xctoolchain/usr/bin/`（每个 Xcode/系统更新只需执行一次）。同时 `Plugins/MetalCIKernelPlugin` 也会动态解析工具绝对路径作为双重保险。
>
> 如果你手动用 `swift build`，请先运行 `scripts/bundle.sh` 一次完成链接，或手动执行：
> ```bash
> METAL_BIN="$(dirname "$(xcrun -f metal)")"
> DEFAULT_BIN="/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
> sudo ln -sf "$METAL_BIN/metal" "$DEFAULT_BIN/metal"
> sudo ln -sf "$METAL_BIN/metallib" "$DEFAULT_BIN/metallib"
> ```

构建完成后会生成 `palmier-pro-main/.build/PalmierPro.app`。双击即可在本地运行，Dock/菜单/关于会显示 **AgentCut Pro**。

**方式 B：直接用 Xcode 打开运行（推荐调试）**

```bash
cd palmier-pro-main
open Package.swift
```

Xcode 打开后，选择 My Mac，按 ⌘R 运行。首次运行可能需要你在「系统设置 → 隐私与安全性」中允许该开发者。

### 5.3 登录

首次启动会弹出登录窗口，输入：

- 邮箱：`palmier-dev@example.com`
- 密码：`PalmierDev123!`

登录成功后 token 写入 Keychain，后续自动登录。

## 6. 已彻底移除 Clerk / Convex 依赖

原 Palmier Pro 依赖 Clerk（登录）和 Convex（项目云存储、转写、Agent 流）。已全部替换为自托管的 infinite-canvas-backend：

| 原依赖功能 | 新实现 |
|---|---|
| Clerk 登录回调 | 原生邮箱/密码登录窗口 + `/api/v1/auth/login` |
| Convex 文件 staging | `POST /api/v1/gateway/upload` |
| Convex 转写任务 | `POST /api/v1/gateway/transcription/submit` + `/status` + `/result` |
| Convex Agent 流 | `POST /api/v1/gateway/agent/stream`（SSE） |
| Convex 示例项目 | `GET /api/v1/samples`（当前返回空列表） |

因此 `Package.swift` 已删除 `clerk-convex-swift`、`clerk-ios`、`convex-swift`，构建时不再从 GitHub 下载这些仓库。

## 7. 汉化与重命名

- 默认开发语言已改为简体中文（`CFBundleDevelopmentRegion = zh-Hans`）。
- 已扩展 `zh-Hans.lproj/Localizable.strings`，核心界面（菜单、首页、登录、账户、设置、智能体、生成、项目列表等）已汉化。
- `en.lproj/Localizable.strings` 保留英文 fallback。
- 前端显示名已从 **Palmier Pro** 统一改为 **AgentCut Pro**（`Info.plist` 显示名、菜单、欢迎语、通知、隐私页、导出格式、MCP 说明等）。

> 注：AI prompt 内容、发送给后端的标签（如 `@Image1`）、Swift 模块名/目录名、Bundle ID 保持不变，避免编译或解析问题。

## 7. 能否「安装」到 /Applications？

**当前不能直接安装到 /Applications 作为正式应用分发。**

可以本地调试运行，但缺少以下环节：

| 条件 | 当前状态 | 影响 |
|---|---|---|
| Apple Developer Team ID | 仍为 `YOURTEAMID` 占位符 | 无法做 Developer ID 签名 |
| Developer ID 证书 | 未配置 | Gatekeeper 会阻止运行 |
| Notary 公证 | 未做 | 其他 Mac 无法打开 |
| `.app`/DMG 产物名 | 脚本仍生成 `PalmierPro.app` | 仅影响文件名，不影响功能 |

### 7.1 本机调试（现在就能做）

- 不需要 Team ID
- 不需要 Apple Developer 账号
- 用 `scripts/bundle.sh debug` 做 ad-hoc 签名，或直接用 Xcode ⌘R
- 生成的 `.app` 只能在当前 Mac 运行，不能分发

### 7.2 正式安装到 /Applications 或打包 DMG（后续再做）

1. 加入 [Apple Developer Program](https://developer.apple.com)（约 688 元/年）。
2. 获取你的 10 位 Team ID。
3. 告诉我 Team ID，我把 `YOURTEAMID` 全部替换。
4. 生成 Developer ID Application 证书并下载。
5. 配置 Notary 工具的 keychain profile。
6. 运行：

```bash
cd palmier-pro-main
scripts/bundle.sh release --dist
```

7. 生成的 DMG 可以拖到 /Applications 分发。

如果你现在只是想在本机用，直接执行 **5.2** 的步骤即可。
