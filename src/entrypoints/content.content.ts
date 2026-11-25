/**
 * ISOLATED world 数据层入口（WXT）。
 *
 * 原 src/content.js 是立即执行的 IIFE，通过 window.postMessage 与 MAIN world 的
 * page-bridge 通信，并写 chrome.storage.local。
 * 迁移要点：运行时代码全部推迟到 main()，模块顶层不执行任何浏览器 API。
 */
export default defineContentScript({
  matches: ["*://xueqiu.com/*", "*://*.xueqiu.com/*"],
  runAt: "document_idle",
  world: "ISOLATED",
  async main() {
    await import("@/lib/config-shared");
    await import("@/lib/xq-emoji-shared");
    await import("@/lib/content-isolated");
  },
});
