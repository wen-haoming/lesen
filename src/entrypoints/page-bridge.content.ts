/**
 * MAIN world 桥接层入口（WXT）。
 *
 * 原 src/page-bridge.js 是立即执行的 IIFE，依赖 globalThis.XQ_DADAO_CONFIG / XQ_EMOJI。
 * 迁移要点：
 * - 所有运行时代码必须在 main() 内触发；模块顶层不能执行浏览器 API 或 IIFE，
 *   否则 WXT 构建期会在 Node 环境求值并报错。
 * - config / xq-emoji 通过动态 import 注入本模块，运行时仍挂到 globalThis，
 *   与 ISOLATED world 的 content script 各持有一份只读副本，契约不变。
 */
export default defineContentScript({
  matches: ["*://xueqiu.com/*", "*://*.xueqiu.com/*"],
  runAt: "document_start",
  world: "MAIN",
  async main() {
    await import("@/lib/config-shared");
    await import("@/lib/xq-emoji-shared");
    await import("@/lib/page-bridge-main");
  },
});
