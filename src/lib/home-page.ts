import { hasChromeRuntime, openTab, sendRuntime } from "./chrome-api";
import { detectShellMode } from "./shell-mode";

/** WXT 将 entrypoints/home/index.html 输出为扩展根路径 home.html */
export const HOME_PAGE_PATH = "home.html";

export function getHomePageUrl(): string {
  if (hasChromeRuntime() && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(HOME_PAGE_PATH);
  }
  return "/" + HOME_PAGE_PATH;
}

export function isHomePagePath(pathname: string): boolean {
  const path = String(pathname || "").split("?")[0];
  return /home\.html$/i.test(path) || /\/entrypoints\/home(?:\/index\.html)?$/i.test(path);
}

export function isCurrentHomeShell(): boolean {
  if (typeof document !== "undefined" && document.documentElement?.dataset?.mode === "home") return true;
  if (typeof location !== "undefined" && isHomePagePath(location.pathname)) return true;
  if (typeof location !== "undefined") return detectShellMode() === "home";
  return false;
}

export function isExtensionHomeTabUrl(tabUrl: string, homeUrl: string): boolean {
  const raw = String(tabUrl || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const home = new URL(homeUrl, raw);
    return parsed.protocol === home.protocol && parsed.host === home.host && isHomePagePath(parsed.pathname);
  } catch {
    const path = raw.split("#")[0].split("?")[0];
    return path === homeUrl || isHomePagePath(path);
  }
}

function focusExistingHomeTab(): void {
  const homeUrl = getHomePageUrl();
  if (!hasChromeRuntime() || !chrome.tabs?.query) {
    openTab(homeUrl);
    return;
  }
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      openTab(homeUrl);
      return;
    }
    const match = (tabs || []).find((tab) => {
      const tabUrl = String(tab.url || tab.pendingUrl || "");
      return tab.id != null && isExtensionHomeTabUrl(tabUrl, homeUrl);
    });
    if (match?.id == null) {
      openTab(homeUrl);
      return;
    }
    chrome.tabs.update(match.id, { active: true }, () => {
      if (chrome.runtime.lastError) openTab(homeUrl);
    });
    if (typeof match.windowId === "number" && chrome.windows?.update) {
      chrome.windows.update(match.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

/** 仅在用户点击时调用；不要在启动、安装或页面加载时自动打开。 */
export function openHomePage(): void {
  if (isCurrentHomeShell()) return;
  focusExistingHomeTab();
  if (hasChromeRuntime()) void sendRuntime({ type: "POPUP_CLOSE_SIDEBAR" });
}
