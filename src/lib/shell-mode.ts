/** 阅读器外壳形态：弹窗 / 独立窗口 / Chrome 侧栏 / 手动打开的多列首页 */

export type ShellMode = "popup" | "window" | "sidebar" | "home";

export function detectShellMode(
  search = typeof location === "undefined" ? "" : location.search,
  pathname = typeof location === "undefined" ? "" : location.pathname,
): ShellMode {
  const params = new URLSearchParams(search);
  if (params.get("mode") === "window") return "window";
  if (params.get("mode") === "sidebar") return "sidebar";
  if (params.get("mode") === "home") return "home";
  if (/home\.html$/i.test(pathname)) return "home";
  if (/sidepanel\.html$/i.test(pathname)) return "sidebar";
  return "popup";
}

export function applyShellMode(mode: ShellMode = detectShellMode()): ShellMode {
  if (mode === "window" || mode === "sidebar" || mode === "home") {
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.removeProperty("--popup-h");
  } else {
    delete document.documentElement.dataset.mode;
    document.documentElement.style.setProperty("--popup-h", "600px");
  }
  return mode;
}
