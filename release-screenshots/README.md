# Lesen 商店 / 发布配图（真实 UI 截图）

本目录是 **唯一** 的产品 UI 截图输入入口。流水线**不**合成虚构界面；账户/登录相关页面由采集方单独提供，Agent 不会重复采集。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| `public/` | 可提交到仓库的脱敏截图包（公司 Mac 采集完成后复制到此） |
| `incoming/` | 本地临时投放区（已 gitignore，适合 CI 通过 `workflow_dispatch` 上传 artifact 前本地试验） |
| `manifest.json` | 可选；声明文件名 → 商店用途映射（见 `manifest.example.json`） |

## 如何接入 T-11 截图包

1. 将脱敏后的 PNG 放入 `release-screenshots/public/`（可分子目录，如 `public/v1.8.9/`）。
2. 可选：复制 `manifest.example.json` 为 `manifest.json` 并填写 `files` 列表。
3. 运行 `pnpm release:images` → 产出在 `dist-artifacts/store-images/`。
4. Release / CWS 工作流会自动跑同一脚本并上传 artifact。

## 文件名建议（无 manifest 时的默认排序）

按字母序取前 N 张作为商店轮播素材；建议使用：

- `01-popup.png` — 弹窗阅读
- `02-sidepanel.png` — 侧栏
- `03-home.png` — 多列首页
- `04-discover.png` — 发现页  
  （**不要**在此目录放置含私人订阅、私信、token 或完整账号资料的截图。）

## 当前状态

仓库内 **尚无** 提交的 `public/` 截图。合并发布管线 PR 后，待你方 T-11 包就绪再放入；在此之前仅生成 `store-icon-128.png` 与可选 CHANGELOG 版本卡。