# Lesen 商店 / 发布配图（真实 UI 截图）

本目录是 **唯一** 的产品 UI 输入。流水线**不**合成、不重绘、不抹除脱敏标注。

## 当前包（v1.8.9）

- 路径：`public/v1.8.9/`（10 张 PNG + `PROVENANCE.json`）
- 来源：已安装正式 **Lesen 1.8.9** 真实界面；账号/订阅/联系方式在 `*-redacted` 文件中已遮盖（**保留**脱敏样式，流水线不二次处理像素）
- **侧栏**：`03-sidebar-redacted.png` 为真实 `sidepanel.html` 窄宽页面截图，**不是**浏览器原生侧栏停靠合影
- **未纳入**：微博服务不可用错误页、关于页动画过渡帧（见 `PROVENANCE.json`）

代表性文件（完整列表见 `manifest.json`）：

- [`01-homeboard-redacted.png`](public/v1.8.9/01-homeboard-redacted.png) — 多栏首页
- [`02-public-square.png`](public/v1.8.9/02-public-square.png) — 公开广场
- [`03-sidebar-redacted.png`](public/v1.8.9/03-sidebar-redacted.png) — 侧栏（窄宽 sidepanel）

## 生成

```sh
pnpm release:images
```

产出：`dist-artifacts/store-images/`

| 子目录 | 说明 |
| --- | --- |
| `source/` | 源尺寸 PNG（未拉伸） |
| `store-1280x800/` | 商店大图，`contain` + 留白 |
| `store-440x280/` | 商店缩略图 |
| `SOURCES.json` / `SHA256SUMS.txt` / `PROVENANCE.json` | 元数据 |

## 目录约定

| 路径 | 用途 |
| --- | --- |
| `manifest.json` | 文件列表与 `storeMarquee` 标记 |
| `public/vX.Y.Z/` | 可提交的脱敏截图包 |
| `incoming/` | 本地试验（gitignore） |