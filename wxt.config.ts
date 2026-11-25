import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "wxt";
import { isAuthConfigured, isGoogleLoginConfigured, supabaseHostPermissions } from "./src/lib/owlivo-auth-config";
import { PRODUCT_DISPLAY_NAME, PRODUCT_DISPLAY_NAME_FULL } from "./src/lib/product-brand";
import {
  isOfficialZipCommand,
  mergeWxtPublicEnvFiles,
  officialPackClientConflict,
  parseWxtPublicEnvFile,
  publicEnvFileNames,
} from "./src/lib/wxt-public-env";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
const productVersion = String(packageJson.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(productVersion)) {
  throw new Error(`package.json version must be semver x.y.z, got: ${productVersion || "(empty)"}`);
}
function readPublicEnvFile(name: string): Record<string, string> {
  const full = path.resolve(rootDir, name);
  if (!fs.existsSync(full)) return {};
  return parseWxtPublicEnvFile(fs.readFileSync(full, "utf8"));
}
function applyLocalPublicEnv() {
  const mode = process.env.NODE_ENV === "development" ? "development" : "production";
  const names = publicEnvFileNames(mode);
  const merged = mergeWxtPublicEnvFiles(names.map(readPublicEnvFile), process.env);
  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value;
  }
  if (isOfficialZipCommand(process.argv, process.env.npm_lifecycle_event)) {
    const supabaseUrl = process.env.WXT_PUBLIC_SUPABASE_URL || "";
    const publishableKey = process.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
    const productionClientId = process.env.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";
    if (!isGoogleLoginConfigured(supabaseUrl, publishableKey, productionClientId)) {
      throw new Error(
        "Official zip requires WXT_PUBLIC_SUPABASE_URL, WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and a production WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID (Chrome Extension client for the store item ID).",
      );
    }
    const localDevClientId = readPublicEnvFile(".env.local").WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";
    const conflict = officialPackClientConflict(productionClientId, localDevClientId);
    if (conflict) throw new Error(conflict);
  }
}
applyLocalPublicEnv();
function analyticsHostPermissions(endpoint: string): string[] {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.pathname !== "/v1/events" || url.search || url.hash) return [];
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+workers\.dev$/i.test(url.hostname)) return [];
    return [`https://${url.hostname}/*`];
  } catch {
    return [];
  }
}
const analyticsPermissions = analyticsHostPermissions(process.env.WXT_PUBLIC_ANALYTICS_ENDPOINT || "");
const supabaseUrl = process.env.WXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey = process.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const supabasePermissions = supabaseHostPermissions(supabaseUrl);
const authPermissions = isAuthConfigured(supabaseUrl, supabasePublishableKey) ? (["identity"] as const) : [];

/**
 * WXT 迁移配置（替代原 vite.config.ts + manifest.json + package-extension.mjs）。
 *
 * 硬约束（与迁移前一致，禁止放宽）：
 * - CSP：script-src 'self'; object-src 'self'; img-src / media-src 'self' https: data:
 * - 权限仅限 storage/scripting/cookies/notifications/alarms/declarativeNetRequest（用于微博接口及媒体请求头规则；sidePanel 由 WXT 侧栏入口自动追加）。配置了托管登录公开参数时追加 identity，仅用于可选的 Google 登录与扩展重定向
 * - host_permissions 仅限雪球 / 微博 / 微博图床 sinaimg / X / twitter syndication / fxtwitter / 构建时选定的第一方 Cloudflare Worker 上报域名，以及已校验的本项目 Supabase HTTPS 主机（仅 publishable 配置存在时）
 * - 匿名统计仅使用 https://*.workers.dev/v1/events；未配置接收端时不添加主机权限，也不会发送
 * - target chrome114（Side Panel API），关闭 modulePreload polyfill，避免注入不合规运行时垫片
 */
export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  manifest: {
    name: PRODUCT_DISPLAY_NAME_FULL,
    short_name: PRODUCT_DISPLAY_NAME,
    version: productVersion,
    description:
      "Your feeds, together. 把你关注的信息，聚在一起。当前支持雪球、微博与 X 信息源；可在弹窗、独立窗口或侧栏中统一阅读。",
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
    action: {
      default_title: PRODUCT_DISPLAY_NAME,
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
      },
    },
    permissions: ["storage", "scripting", "cookies", "notifications", "alarms", "declarativeNetRequest", ...authPermissions],
    host_permissions: [
      "*://xueqiu.com/*",
      "*://*.xueqiu.com/*",
      "*://weibo.com/*",
      "*://*.weibo.com/*",
      "*://m.weibo.cn/*",
      "*://*.sinaimg.cn/*",
      "*://*.weibocdn.com/*",
      "*://*.video.weibo.com/*",
      "*://x.com/*",
      "*://twitter.com/*",
      "*://cdn.syndication.twimg.com/*",
      "*://syndication.twitter.com/*",
      "*://api.fxtwitter.com/*",
      ...analyticsPermissions,
      ...supabasePermissions,
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' https: data:; media-src 'self' https:",
    },
    minimum_chrome_version: "114",
  },
  vite: () => ({
    define: {
      __LESEN_VERSION__: JSON.stringify(productVersion),
    },
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
      },
    },
    build: {
      target: "chrome114",
      modulePreload: false,
      cssCodeSplit: true,
      sourcemap: false,
    },
    plugins: [react(), tailwindcss()],
  }),
});
