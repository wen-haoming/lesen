# Release 下载与校验

面向最终用户的安装包在 **GitHub Releases**（按版本 tag），不在 Actions 产物里。CI 里的 `main-release-drill-*`、`lesen-<ver>-store-images` 等仅供维护者验收，需要仓库读权限，**不能**当作公开下载渠道。

## 何时产生 Release

推送符合下列规则的 **annotated tag** 时，`.github/workflows/release.yml` 会：

1. 校验 tag 名与 `package.json` / 提交一致  
2. 跑测试并 `pnpm build`  
3. 在 CI 内生成完整 `dist-artifacts/`（含截图、源码包、manifest 等，用于 drill）  
4. 若 Release 尚不存在：**仅**将侧载 zip + 专用 `SHA256SUMS.txt` 上传到 GitHub Release（已存在则 **跳过上传**，幂等）

Tag 命名：

| 形式 | 示例 |
| --- | --- |
| 推荐 | `lesen-v1.8.9` |
| 兼容 | `owlivo-v1.8.9` |

**不会**在本仓库 push `main` 时自动创建 Release（避免无版本号的快照冒充发行版）。

## Release 页面附件（用户可见）

每个版本的 GitHub Release **只应出现 2 个附件**：

| 文件 | 用途 |
| --- | --- |
| `lesen-<ver>-sideload-chrome-mv3.zip` | **唯一推荐安装包**：解压后在 `chrome://extensions` 选「加载已解压的扩展程序」 |
| `SHA256SUMS.txt` | **仅含上述 zip 一行**校验和（与 `dist-artifacts` 内完整校验文件分开，避免与商店截图目录同名覆盖） |

页面底部的 **Source code (zip/tar.gz)** 为 GitHub **自动生成**的仓库源码快照，**不能**直接作为扩展加载。

## 侧载安装（Chrome 114+）

1. 打开 [Releases](https://github.com/wen-haoming/lesen/releases) 对应版本。  
2. 下载 **`lesen-<ver>-sideload-chrome-mv3.zip`** 与同页 **`SHA256SUMS.txt`**。  
3. `sha256sum -c SHA256SUMS.txt`（在 zip 所在目录）。  
4. 解压 zip → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选解压后的文件夹（内含 `manifest.json`）。

侧载版本 **不会** 随 Chrome 网上应用店自动更新；商店安装请用下方链接。

## 与商店的区别

| 渠道 | 更新 | OAuth / 同步 |
| --- | --- | --- |
| [Chrome 网上应用店](https://chromewebstore.google.com/detail/lesen-%C2%B7-%E8%8E%B1%E6%A3%AE-%C2%B7-%E5%A4%9A%E6%BA%90%E4%BF%A1%E6%81%AF%E8%81%9A%E5%90%88/dakdgplahfkbblfpafdjeipneioajgdf) | 自动 | 官方生产配置 |
| GitHub Release 侧载包 | 手动换新包 | 默认构建，无生产 secret；自部署见 [SELF_HOSTING.md](../SELF_HOSTING.md) |

## Latest 链接行为

GitHub 将 **最新非预发布、非 draft** 的 Release 标为 Latest。本仓库不会为每次 `main` 推送打 tag；Latest 仅在维护者推送版本 tag 后移动。

## 维护者与 CI

以下产物在 **Actions** 中生成并保留，**不上传**到 GitHub Release 附件：

| 产物 / artifact 名 | 内容 |
| --- | --- |
| `lesen-<ver>-artifacts`（job 内 `dist-artifacts/`） | unpacked tar、source tar、`manifest.json`、完整三件套 `SHA256SUMS.txt` |
| `lesen-<ver>-store-images` | 商店截图、SOURCES/PROVENANCE、配图校验 |
| `main-release-drill-*` 等 | main 推送离线演练 |

本地复现：

```sh
pnpm build
node scripts/package-artifacts.mjs
node scripts/generate-release-images.mjs
node scripts/ci/prepare-github-release-upload.mjs dist-artifacts upload   # 模拟 Release 白名单
```

`prepare-github-release-upload.mjs` 在发版 job 中校验：恰好 2 个文件、zip 名、SHA256 与 `manifest.json` / 包内 `SHA256SUMS.txt` 一致。

## 维护者：`workflow_dispatch`

可在 Actions 中手动跑 `release` workflow 核对构建（`create_github_release` 默认 false）。**创建对外 Release 仍应使用版本 tag 推送**，以保证 tag ↔ commit ↔ `package.json` 对齐。