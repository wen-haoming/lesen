# 发布管线迁移（CNB → GitHub Actions）

本文档描述 **公开仓库 `wen-haoming/lesen`** 中的发布实现。  
**不代表** 已停用 CNB、已完成商店切换或已验证生产凭据。

## 分支策略（避免与私有 monorepo 双向覆盖）

| 范围 | 建议 |
| --- | --- |
| 本公开仓库 | 仅在 `main` 或 `cursor/*-c440` 功能分支改动 **GitHub Actions / 开源发布脚本 / 文档** |
| 私有 `ai-lib/xueqiu-dadao-reader` | 继续由你方协调；**不要** 在本任务中镜像私库或改写其历史 |
| 未来单向同步 | 若 GitHub 从私库脱敏同步插件提交，合并前先对比 `.github/workflows/` 与 `scripts/package-*.mjs`，以协调方指定的一侧为准 |

**本 PR 不自动**：merge、打 tag、创建 GitHub Release、商店 publish/撤审。

## 版本唯一来源

1. `package.json` 的 `version` 字段  
2. `wxt.config.ts` 在构建时注入 `manifest.version` 与 `__LESEN_VERSION__`  
3. `CHANGELOG.md` 顶部 `## x.y.z` 必须与 `package.json` 一致（由 `scripts/verify-versions.mjs` 校验）  
4. Release notes **仅** 从 `CHANGELOG.md` 对应版本节抽取（`scripts/extract-release-notes.mjs` / `src/lib/release-notes.ts`）

## 产物类型

| 产物 | 何时生成 | 说明 |
| --- | --- | --- |
| `lesen-*-unpacked.tar.gz` | 默认 `pnpm build` 后 `pnpm package:artifacts` | 开发者侧载 / QA，**非** 商店 OAuth 生产包 |
| `lesen-*-source.tar.gz` | `git archive` | 源码归档 |
| `lesen-*-chrome-store.zip` | `wxt zip` + 生产 `WXT_PUBLIC_*` | 商店上传包；本地默认构建**不会**生成 |
| `SHA256SUMS.txt` | 与上同批次 | 校验和清单 |
| `dist-artifacts/store-images/*` | `pnpm release:images` | 来自 `release-screenshots/public/` 的真实 UI；无截图时仅 icon + 版本说明卡 |

## GitHub Actions 工作流

| 工作流 | 触发 | Secrets |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `push` / `pull_request` | **无** |
| `.github/workflows/release.yml` | `v*.*.*` tag 或 `workflow_dispatch` | 可选：`chrome-web-store` Environment 下的生产 `WXT_PUBLIC_*` |
| `.github/workflows/chrome-web-store.yml` | **仅** `workflow_dispatch` | **必需**（见下表） |

### PR / CI 现状（核验于 2026-11-25）

- `main` @ `df86fc5`：`checks` workflow **success**（compile → test → typecheck → build → smoke）

## 需要的 Secrets / Environment

在 GitHub **Environment** `chrome-web-store`（建议启用 required reviewers）配置：

| Secret | 用途 |
| --- | --- |
| `WXT_PUBLIC_SUPABASE_URL` | 生产 Supabase（官方包） |
| `WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 生产 publishable key |
| `WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | 商店扩展 ID 对应的 Chrome Extension OAuth 客户端 |
| `WXT_PUBLIC_ANALYTICS_ENDPOINT` | 可选；允许的 workers.dev `/v1/events` |
| `CHROME_CLIENT_ID` | CWS API OAuth（与 refresh token 同项目） |
| `CHROME_CLIENT_SECRET` | CWS API |
| `CHROME_REFRESH_TOKEN` | `chrome.webstore` scope；**禁止** 写入仓库文件 |

扩展 ID（非 secret）：`dakdgplahfkbblfpafdjeipneioajgdf`

## 本地验证命令（无需 secrets）

```sh
pnpm install --frozen-lockfile
pnpm compile && pnpm test && pnpm typecheck
pnpm build
node scripts/smoke-verify.mjs
node scripts/verify-versions.mjs
node scripts/package-artifacts.mjs
node scripts/generate-release-images.mjs
node scripts/extract-release-notes.mjs
```

## 上线切换顺序（需你方协调）

1. 在 GitHub 配置 `chrome-web-store` Environment 与 secrets（对照 CNB 变量脱敏核对，**勿猜测** OAuth 客户端类型）。  
2. 合并本 PR 后，在 **不升版本** 前提下用 `workflow_dispatch` 跑 `release`（`create_github_release: false`）验证 artifacts。  
3. 确认 CWS 当前在审版本后，再决定是否升 `package.json` / `CHANGELOG` 并打 `vX.Y.Z` tag。  
4. 运行 `chrome-web-store` workflow：`publish: false` 先上传草稿 → 人工验收 → 再 `publish: true` 送审。  
5. **CNB 仍可用期间** 保持单侧发布，确认 GitHub 路径稳定后再停用 CNB（由你方操作，本文档不声明“已完成迁移”）。

## 图片素材说明

- **产品 UI**：仅 `release-screenshots/public/`（或 `incoming/`，本地 gitignore）— 见 [`release-screenshots/README.md`](../release-screenshots/README.md)。T-11 脱敏包就绪后拷贝到 `public/` 并再跑 `pnpm release:images`。  
- **不合成虚构界面**；账户相关页由采集方提供，流水线不重复采集。  
- 无截图时：`store-icon-128.png` + `version-card-changelog.png`（标明非 UI）。  
- `dist-artifacts/store-images/SOURCES.json` 记录模式（`ui-screenshots` / `placeholder-pending-screenshots`）。  
- 禁止 AGPL promo 视频模板。

## 已实现 vs 已启用

| 能力 | 仓库内已实现 | 生产已启用 |
| --- | --- | --- |
| CI test/build/smoke | ✅ | ✅（main checks） |
| 版本一致性校验 | ✅ | ✅（合并后 CI） |
| GitHub Release 打包 | ✅ | ❌（需 tag + 可选 secrets） |
| 商店 zip（生产 OAuth） | ✅ | ❌（需 `WXT_PUBLIC_*` secrets） |
| CWS 上传/送审 | ✅ | ❌（需 Chrome OAuth secrets） |
| 发布配图生成 | ✅ | ❌（本地/Release CI 可产出） |