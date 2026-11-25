import { ANALYTICS_ALARM, ANALYTICS_CONSENT_KEY, ANALYTICS_ID_KEY, ANALYTICS_QUEUE_KEY, ANALYTICS_SURFACE_KEY, RELEASE_VERSION, createAnalytics, isAllowedAnalyticsEndpoint, platformFromKnownHost } from "./analytics";
import { isTrustedAnalyticsSender } from "./analytics-sender";

const endpoint = String(import.meta.env.WXT_PUBLIC_ANALYTICS_ENDPOINT || "");
const production = import.meta.env.MODE === "production";
export const analyticsRuntime = createAnalytics({
  storage: {
    get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {}))),
    set: (values) => new Promise((resolve) => chrome.storage.local.set(values, resolve)),
  },
  fetch: globalThis.fetch.bind(globalThis),
  now: Date.now,
  randomId: () => crypto.randomUUID(),
  alarm: (when) => { if (!when) chrome.alarms.clear(ANALYTICS_ALARM); else chrome.alarms.create(ANALYTICS_ALARM, { when }); },
  endpoint,
  enabledBuild: production && isAllowedAnalyticsEndpoint(endpoint),
});
export const analyticsBuildEnabled = analyticsRuntime.isBuildEnabled;

export async function handleAnalyticsMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): Promise<boolean> {
  if (!message || typeof message.type !== "string" || !message.type.startsWith("ANALYTICS_")) return false;
  if (!isTrustedAnalyticsSender(sender, chrome.runtime.id)) { sendResponse({ ok: false }); return true; }
  if (message.type === "ANALYTICS_CAPTURE") {
    const accepted = await analyticsRuntime.capture(message.event, message.properties);
    if (analyticsBuildEnabled && await analyticsRuntime.enabled()) void analyticsRuntime.flush();
    sendResponse({ ok: accepted }); return true;
  }
  if (message.type === "ANALYTICS_ERROR") {
    const incoming = message.error && typeof message.error === "object" ? { name: message.error.name, message: message.error.message, stack: message.error.stack } : {};
    const accepted = await analyticsRuntime.captureError(incoming, message.context, message.duration, message.status, message.handled !== false, message.details);
    if (analyticsBuildEnabled && await analyticsRuntime.enabled()) void analyticsRuntime.flush();
    sendResponse({ ok: accepted }); return true;
  }
  if (message.type === "ANALYTICS_SET_SURFACE") {
    await chrome.storage.local.set({ [ANALYTICS_SURFACE_KEY]: message.surface === "popup" ? "popup" : "sidebar" });
    analyticsRuntime.setSurface(message.surface);
    sendResponse({ ok: true }); return true;
  }
  if (message.type === "ANALYTICS_SET_CONSENT") {
    const enabled = message.enabled === true;
    const accepted = await analyticsRuntime.setConsent(enabled);
    if (accepted && enabled && analyticsBuildEnabled) void analyticsRuntime.flush();
    sendResponse({ ok: enabled ? accepted === true : true }); return true;
  }
  sendResponse({ ok: false }); return true;
}

async function maybeFlush() {
  if (analyticsBuildEnabled && await analyticsRuntime.enabled()) void analyticsRuntime.flush();
}

export function recordOriginalOpenedFromUrl(url: string) {
  const platform = platformFromKnownHost(url);
  if (!platform) return;
  void analyticsRuntime.capture("original_opened", { platform }).then((ok) => {
    if (ok) void maybeFlush();
  });
}

let analyticsHooksInstalled = false;

export function installAnalyticsBackgroundHooks(): void {
  if (analyticsHooksInstalled) return;
  analyticsHooksInstalled = true;
  const local = chrome.storage.local;
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ANALYTICS_ALARM) void maybeFlush(); });
  chrome.runtime.onStartup.addListener(() => { void maybeFlush(); });
  chrome.runtime.onInstalled.addListener((details) => {
    void (async () => {
      const data = await new Promise<Record<string, unknown>>((resolve) => local.get([ANALYTICS_CONSENT_KEY], (value) => resolve(value || {})));
      if (!analyticsBuildEnabled) {
        if (data[ANALYTICS_CONSENT_KEY] === undefined) {
          // Do not pretend a receiver exists: leave unset and do not send.
          return;
        }
        if (data[ANALYTICS_CONSENT_KEY] !== true) {
          await new Promise<void>((resolve) => local.set({ [ANALYTICS_QUEUE_KEY]: [], [ANALYTICS_ID_KEY]: "" }, resolve));
          chrome.alarms.clear(ANALYTICS_ALARM);
        }
        return;
      }
      if (data[ANALYTICS_CONSENT_KEY] === false) {
        await new Promise<void>((resolve) => local.set({ [ANALYTICS_QUEUE_KEY]: [], [ANALYTICS_ID_KEY]: "" }, resolve));
        chrome.alarms.clear(ANALYTICS_ALARM);
        return;
      }
      if (data[ANALYTICS_CONSENT_KEY] === undefined) {
        await new Promise<void>((resolve) => local.set({ [ANALYTICS_CONSENT_KEY]: true }, resolve));
      }
      const props: Record<string, unknown> = { version: RELEASE_VERSION };
      if (details.reason === "update") {
        const from = String(details.previousVersion || "");
        if (from) props.from_version = from;
        await analyticsRuntime.capture("extension_updated", props);
      } else if (details.reason === "install") {
        await analyticsRuntime.capture("extension_installed", props);
      }
      void analyticsRuntime.flush();
    })();
  });
  void maybeFlush();
  self.addEventListener("error", (event) => {
    const e = event as ErrorEvent;
    void analyticsRuntime.captureError({ name: e.error?.name, message: e.error?.message, stack: e.error?.stack }, "background", undefined, undefined, false).catch(() => {});
  });
  self.addEventListener("unhandledrejection", (event) => {
    const r = (event as PromiseRejectionEvent).reason;
    void analyticsRuntime.captureError({ name: r?.name, message: r?.message, stack: r?.stack }, "background", undefined, undefined, false).catch(() => {});
  });
}
