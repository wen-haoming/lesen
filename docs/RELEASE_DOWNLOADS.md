# Release 下载与校验

面向最终用户的安装包在 **GitHub Releases**（按版本 tag），不在 Actions 产物里。CI 里的 `main-release-drill-*` / `pr-release-drill-*` 仅供维护者验收，需要仓库读权限，**不能**当作公开下载渠道。

## 何时产生 Release

推送符合下列规则的 **annotated tag** 时，`.github/workflows/release.yml` 会：

1. 校验 tag 名与 `package.json` / 提交一致  
2. 跑测试并 `pnpm build`  
3. 生成 `dist-artifacts/`（见下）  
4. 若 Release 尚不存在：用 `CHANGELOG.md` 中对应版本节创建 GitHub Release 并上传附件（已存在则 **跳过上传**，幂等）

Tag 命名：

| 形式 | 示例 |
| --- | --- |
| 推荐 | `lesen-v1.8.9` |
| 兼容 | `owlivo-v1.8.9` |

**不会**在本仓库 push `main` 时自动创建 Release（避免无版本号的快照冒充发行版）。

## Release 附件说明

| 文件 | 用途 |
| --- | --- |
| `lesen-<ver>-sideload-chrome-mv3.zip` | **侧载安装**：解压后在 `chrome://extensions` 选「加载已解压的扩展程序」指向解压后的文件夹（见下方步骤） |
| `lesen-<ver>-unpacked.tar.gz` | 同上内容的 tar 包，适合脚本分发 |
| `lesen-<ver>-source.tar.gz` | `git archive` 源码，**不是**可直接加载的扩展 |
| `SHA256SUMS.txt` | 附件校验和 |
| `dist-artifacts/manifest.json` | 本批次产物清单与 SHA（在合并 artifact 后随包上传） |
| `store-images/*` 可选 | 商店配图元数据；不含私人原图 |

`lesen-<ver>-chrome-store.zip` **仅**在配置了生产 `WXT_PUBLIC_*` 的 `official-zip` job 时出现；默认公开构建 **不含** 该文件，且侧载包 **不能** 等同于商店签名包或官方登录配置。

## 侧载安装（Chrome 114+）

1. 打开 [Releases](https://github.com/wen-haoming/lesen/releases)（有正式 tag 后会出现对应条目）。  
2. 下载 `lesen-<ver>-sideload-chrome-mv3.zip`，解压到固定目录。  
3. `sha256sum -c SHA256SUMS.txt`（或手动对照 `SHA256SUMS.txt`）。  
4. `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选解压后的文件夹（内含 `manifest.json`）。

侧载版本 **不会** 随 Chrome 网上应用店自动更新；商店安装请用下方链接。

## 与商店的区别

| 渠道 | 更新 | OAuth / 同步 |
| --- | --- | --- |
| [Chrome 网上应用店](https://chromewebstore.google.com/detail/lesen-%C2%B7-%E8%8E%B1%E6%A3%AE-%C2%B7-%E5%A4%9A%E6%BA%90%E4%BF%A1%E6%81%AF%E8%81%9A%E5%90%88/dakdgplahfkbblfpafdjeipneioajgdf) | 自动 | 官方生产配置 |
| GitHub Release 侧载包 | 手动换新包 | 默认构建，无生产 secret；自部署见 [SELF_HOSTING.md](../SELF_HOSTING.md) |

## Latest 链接行为

GitHub 将 **最新非预发布、非 draft** 的 Release 标为 Latest。本仓库不会为每次 `main` 推送打 tag；Latest 仅在维护者推送版本 tag 后移动。

## 维护者：`workflow_dispatch`

可在 Actions 中手动跑 `release` workflow 核对构建（`create_github_release` 默认 false）。**创建对外 Release 仍应使用版本 tag 推送**，以保证 tag ↔ commit ↔ `package.json` 对齐。