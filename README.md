# Lesen · 莱森

Your feeds, together. 把你关注的信息，聚在一起。

面向 Chrome 114+ 的多源信息聚合阅读扩展，支持雪球、微博和 X，可在弹窗、独立阅读窗或侧栏中使用。采用 WXT、React、TypeScript 与 Tailwind CSS。

[Chrome 网上应用店](https://chromewebstore.google.com/detail/lesen-%C2%B7-%E8%8E%B1%E6%A3%AE-%C2%B7-%E5%A4%9A%E6%BA%90%E4%BF%A1%E6%81%AF%E8%81%9A%E5%90%88/dakdgplahfkbblfpafdjeipneioajgdf?hl=zh-CN)

本目录是独立开源候选源码，版本 1.8.9；不表示此候选已经上架或 GitHub 仓库已经创建。拟用仓库名为 `wen-haoming/lesen`。原有 `owlivo` 内部存储键/消息协议保留以维持兼容，不包含父项目的 Git 历史。

## 功能与边界

- 聚合阅读、单源切换、搜索、排序、刷新与分页，发现页提供平台热搜/话题入口。
- 新安装不预置私人订阅；广场推荐包含少量公开账号，不会自动订阅。添加信息源由使用者自行决定。
- 可选系统通知；后台更新检查目前仅适用于 X 公共内容。
- 可选自部署 Google 登录与订阅同步；未配置时仍可本地阅读和保存订阅。
- 默认不配置遥测接收端，不会发送遥测。仅在自行配置接收端后才有统计选项。
- 平台接口可能变化、限流或要求登录；不承诺接口长期可用，不提供绕过验证码或平台限制的保证。请遵守对应平台条款和当地法律。
- Firefox 构建脚本仅供开发，尚未完整验收。

## 本地构建与安装

需要 Node.js 20.19+（本次验证 20.20.2）、pnpm 10.11.1。不要复制生产环境文件或发布凭据。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm compile
pnpm test
pnpm typecheck
pnpm build
node scripts/smoke-verify.mjs
```

安装生命周期脚本默认不执行；`compile` 显式生成 WXT 类型。无需任何账号或 env 即可测试、构建。

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，载入 `.output/chrome-mv3`。不要将开发构建当成官方签名商店包。

`pnpm dev` 用于开发；`pnpm icons` 从项目图标母版生成尺寸图标，macOS 使用 sips，其他系统使用已提供的尺寸图标。`pnpm smoke` 会重新构建并静态验证产物。

## 可选自部署

见 [SELF_HOSTING.md](SELF_HOSTING.md)。`supabase/` 保留通用订阅同步迁移与账号删除函数；`analytics-worker/` 保留可选统计接收端源码。没有附带生产数据库、账号、域名配置、KV ID 或管理员密钥。

`.env.example` 和 `.env.analytics.example` 只有空配置项。默认本地构建不申请 Supabase 主机/identity 权限，不启用统计。浏览器可见的 publishable/anon key、OAuth client ID 是公开客户端配置，不等于服务端秘密；service_role、OAuth client secret、发布 token 永远不能进入扩展。

## 目录

- `src/`：扩展入口、平台适配、UI 与单元测试。
- `public/`、`icons/`：运行资源、程序化演示头像与项目图标。
- `scripts/`：仅图标生成与离线静态 smoke；不带商店认证、发布、运营统计查询工具。
- `supabase/`、`analytics-worker/`：可选自部署服务源码，不会由 CI 部署。
- `.github/workflows/ci.yml`：只运行 test/typecheck/build/smoke，无发布凭据或写权限。

开发预览 fixture 使用合成文本/头像/编号，并非真实账号导出。演示图片使用本地几何图形，不请求外部图库。平台适配内保留实现公开阅读所需的官方/公共 API 主机。

## 隐私与许可

见 [PRIVACY.md](PRIVACY.md)。扩展内部隐私入口使用随包附带的 `privacy.html`，不指向私有服务。

主项目采用 [MIT](LICENSE)。第三方库仍适用各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [依赖许可文本](licenses/dependencies.txt)。品牌/第三方平台名称不表示官方合作。视频、宣传工程及其 AGPL 起步素材不在本候选范围。
