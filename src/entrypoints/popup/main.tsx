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
window.addEventListener("error", (event) => { if (allowErrorReporting) reportWindowError(event.error, "popup"); });
window.addEventListener("unhandledrejection", (event) => { if (allowErrorReporting) reportWindowError(event.reason, "popup"); });

applyShellMode();
// 首帧套用外观：URL ?theme=&scheme=&font=&size= 优先，其次 localStorage 镜像
bootstrapAppearance();

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <AnalyticsErrorBoundary><App /></AnalyticsErrorBoundary>
  </StrictMode>,
);
