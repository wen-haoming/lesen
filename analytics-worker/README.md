# 可选 Lesen 统计接收端

默认扩展构建不启用此服务。源码不含生产数据和管理员凭据。

自行部署前，自行选择并固定审核过的 Wrangler CLI 版本（本目录不捆绑部署工具），再使用自己的 Cloudflare 账号创建 KV namespace，将 `wrangler.toml` 的 namespace id 与 preview_id 占位值替换为自己的 ID。Worker 入口为 `src/index.ts`，KV binding 名为 `EVENTS`。不要提交真实部署状态或密钥。

如需管理员统计接口，仅在 Worker 的服务端秘密存储中设置 `ANALYTICS_ADMIN_KEY`，不得写入扩展、公有配置或浏览器。管理员路径读取匿名聚合统计，部署前应独立审查访问控制、限流与隐私保留政策。

扩展配置 `WXT_PUBLIC_ANALYTICS_ENDPOINT=https://<your-worker>.<your-subdomain>.workers.dev/v1/events` 后重新构建，才会开启统计通路。开发者须公布自己的政策；不需要统计就保持空配置。原接收端不是本开源候选提供的公共服务。

本次仅保留通用实现，没有安装该子目录依赖、部署 Worker、读取 KV 或向任何接收端发送事件。`package.json` 仅声明模块类型，无部署脚本或隐藏工具依赖。根目录测试配置覆盖接收端的离线单测；Worker/Edge Function 的生产部署和类型环境须由自部署者独立配置与验收。
