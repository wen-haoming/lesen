import { installAnalyticsBackgroundHooks } from "@/lib/analytics-background";
import { installAnalyticsHooks, installBackgroundMain } from "@/lib/background-main";
import { installAuthSessionHooks } from "@/lib/owlivo-auth-background";
import { installSubscriptionSyncHooks } from "@/lib/subscription-sync-background";

/**
 * 后台 service worker 入口（WXT）。
 *
 * 所有 chrome.* 事件监听器必须在 Service Worker 首次求值回合同步注册，
 * 避免冷启动唤醒（点击图标、闹钟、runtime.onMessage）因动态 import 微任务延迟而丢失。
 */
export default defineBackground(() => {
  installAnalyticsBackgroundHooks();
  installBackgroundMain();
  installAnalyticsHooks?.();
  installAuthSessionHooks();
  installSubscriptionSyncHooks();
});
