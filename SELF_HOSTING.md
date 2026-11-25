# 可选服务自部署

默认不配置任何服务即可构建并使用本地阅读。不要把下列操作与自动部署或已完成线上验收混淆。

## 订阅同步与 Google 登录

1. 使用自己的 Supabase 项目。在 `src/lib/owlivo-auth-config.ts` 将 `OWLIVO_SUPABASE_PROJECT_REF` 的合成占位值改为自己的项目 ref。此单项目绑定同时限制 URL、host permission 和旧 anon JWT 的 ref，不能仅替换 URL 或放宽为任意主机。
2. 审核并按顺序应用 `supabase/migrations/` 的两个迁移，保留每个用户只能读取/更改自己订阅的 RLS、受限 grant 和 invoker 包装。它们是源码，不包含用户数据。本候选没有连接数据库或执行迁移，生产前需独立验证授权/删除行为。
3. 在自己的项目部署 `supabase/functions/delete-account/`。服务端通过环境读取 `SUPABASE_URL`、publishable/anon 配置和 `SUPABASE_SERVICE_ROLE_KEY`；服务角色密钥仅供 Edge Function 服务端使用，不进入 WXT_PUBLIC 环境或 Git。
4. 复制 `.env.example` 为 `.env.local`，填写自己的 HTTPS Supabase URL、publishable key 与 Google OAuth client ID；配置 Supabase 的 Google provider。浏览器客户端不需要 OAuth client secret，provider 服务端秘密只存于服务商。
5. 本地 unpacked extension ID 与商店 ID 不同。依据自己使用的 Google OAuth 客户端类型，登记 `chrome.identity.getRedirectURL()` 返回的完整 URI，并使用匹配的 client ID。不要复用原作者生产 OAuth 配置。
6. 重新 compile/build，检查仅出现自己的 Supabase 主机权限。真实登录、同步与删除必须在自己的测试项目和测试账号独立验收，本次只做无账号离线单测。

官方参考：https://supabase.com/docs/guides/auth/social-login/auth-google 、https://supabase.com/docs/guides/api/api-keys 。本仓库不提供任何生产服务访问授权。

## 可选统计

见 `analytics-worker/README.md`。扩展只有在 `WXT_PUBLIC_ANALYTICS_ENDPOINT` 是允许的 HTTPS workers.dev `/v1/events` 接收端时才启用发送通路。默认留空，不发送；不要为了演示把原作者接收端填回来。管理员查询密钥只保留在 Worker 服务端。

## 发布边界

没有商店自动送审、上传、部署工作流，也不附带发布认证脚本。自行发行前应使用自己的发布账号、审核数据政策和平台访问授权。不要用全局搜索替换内部 owlivo 存储键或协议名来改品牌。
