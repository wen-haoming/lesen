import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { App } from "@/popup/App";
import { AnalyticsErrorBoundary } from "@/popup/components/AnalyticsErrorBoundary";
import { bootstrapAppearance } from "@/lib/appearance";
import { applyShellMode } from "@/lib/shell-mode";
import { ANALYTICS_BUILD_ENABLED } from "@/lib/analytics-config";

let lastErrorSignature = "";
let lastErrorAt = 0;
function reportWindowError(error: unknown, context: string) {
  const name = error instanceof Error ? error.name : "Error";
  const msg = error instanceof Error ? error.message : "";
  const signature = `${name}:${msg.slice(0, 100)}`;
  if (signature === lastErrorSignature && Date.now() - lastErrorAt < 3000) return;
  lastErrorSignature = signature; lastErrorAt = Date.now();
  void chrome.runtime.sendMessage({ type: "ANALYTICS_ERROR", error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "Error", message: "" }, context, handled: false }).catch(() => {});
}
const allowErrorReporting = import.meta.env.MODE === "production" && ANALYTICS_BUILD_ENABLED;
window.addEventListener("error", (event) => { if (allowErrorReporting) reportWindowError(event.error, "sidepanel"); });
window.addEventListener("unhandledrejection", (event) => { if (allowErrorReporting) reportWindowError(event.reason, "sidepanel"); });

applyShellMode("sidebar");

if (typeof chrome !== "undefined" && chrome.runtime?.connect && chrome.windows?.getCurrent) {
  let attempts = 0;
  const announce = () => {
    attempts += 1;
    const port = chrome.runtime.connect({ name: "sidebar" });
    chrome.windows.getCurrent((win) => {
      void chrome.runtime.lastError;
      if (win?.id) port.postMessage({ windowId: win.id });
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (attempts >= 5) return;
      window.setTimeout(announce, 250);
    });
  };
  announce();
}

bootstrapAppearance();

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <AnalyticsErrorBoundary><App /></AnalyticsErrorBoundary>
  </StrictMode>,
);
