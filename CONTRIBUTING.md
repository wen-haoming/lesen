# 贡献指南

## 源码与协作

- 公开协作仓库：**[wen-haoming/lesen](https://github.com/wen-haoming/lesen)**（MIT）。  
- 变更通过 **GitHub Pull Request** 进入 `main`；不在此承诺与私有 monorepo 的自动双向同步。若你同时维护内部仓库，请自行对照合并，避免覆盖 `.github/workflows/` 与 `scripts/package-*.mjs`。

## 开发环境

- Node.js **20.19+**（CI 使用 20.20.2）、**pnpm 10.11.1**  
- 不要提交 `.env.production.local`、CWS 凭据或任何 token

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm compile
pnpm test
pnpm typecheck
pnpm build
node scripts/smoke-verify.mjs
node scripts/verify-versions.mjs
```

可选：`node scripts/package-artifacts.mjs`、`pnpm release:images`（需 `release-screenshots/public/` 中的真实 UI）。

## PR 期望

- 版本号：仅在有正式发布意图时改 `package.json` 与 `CHANGELOG.md` 顶节，并由 `scripts/verify-versions.mjs` 通过  
- UI 截图：仅使用 `release-screenshots/` 中脱敏 PNG，不合成假界面  
- CI：`checks` 与 `cws-pipeline` 的 `pr-checks` 需绿；fork PR 不跑发布脚本

## 行为准则

尊重平台服务条款与当地法律；勿提交绕过登录、验证码或限速的逻辑用于生产。