import { Component, type ErrorInfo, type ReactNode } from "react";
import { ANALYTICS_BUILD_ENABLED } from "@/lib/analytics-config";

let lastReported = "";
let lastReportedAt = 0;

export class AnalyticsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (import.meta.env.MODE !== "production" || !ANALYTICS_BUILD_ENABLED) return;
    const signature = `${error.name}:${error.message.slice(0, 100)}`;
    if (signature === lastReported && Date.now() - lastReportedAt < 3000) return;
    lastReported = signature; lastReportedAt = Date.now();
    try { void chrome.runtime.sendMessage({ type: "ANALYTICS_ERROR", error: { name: error.name, message: error.message, stack: error.stack }, context: "reader", handled: true }).catch(() => {}); } catch { /* reporting must not affect reading */ }
  }
  render() { return this.state.failed ? <div role="alert" className="p-4 text-sm text-muted-foreground">阅读界面遇到问题，请重新打开扩展。</div> : this.props.children; }
}
