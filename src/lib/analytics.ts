export const ANALYTICS_CONSENT_KEY = "analyticsConsent";
export const ANALYTICS_QUEUE_KEY = "analyticsQueue";
export const ANALYTICS_ID_KEY = "analyticsInstallId";
export const ANALYTICS_SURFACE_KEY = "analyticsSurface";
export const ANALYTICS_ALARM = "owlivo-analytics-flush";
export const RELEASE_VERSION = "1.8.7";
export const ERROR_CATEGORIES = ["TypeError", "ReferenceError", "RangeError", "SyntaxError", "Error", "Rejection"] as const;
export const EVENTS = [
  "reader_opened",
  "extension_installed",
  "extension_updated",
  "source_added",
  "source_removed",
  "feed_selected",
  "refresh_completed",
  "original_opened",
  "login_detected",
  "settings_changed",
  "notification_preference_changed",
] as const;
const FIELDS = ["refreshMinutes", "notifyForm", "surface", "themeStyle", "colorScheme", "readingFont", "readingSize", "analyticsConsent", "sort", "density"] as const;
export const PLATFORMS = ["x", "xueqiu", "weibo"] as const;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export interface AnalyticsEvent { id: string; event: string; properties: Record<string, unknown>; at: number; attempts?: number; retryAt?: number; }
export interface AnalyticsErrorDetails {
  platform?: unknown;
  operation?: unknown;
  stage?: unknown;
  provider_code?: unknown;
  retry_after_ms?: unknown;
  cache_hit?: unknown;
  stale?: unknown;
  status_code?: unknown;
  duration_ms?: unknown;
}
export interface AnalyticsStorage { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>; }
export interface AnalyticsDeps {
  storage: AnalyticsStorage;
  fetch: typeof fetch;
  now: () => number;
  randomId: () => string;
  alarm: (when: number | null) => void;
  endpoint: string;
  enabledBuild?: boolean;
  timeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const safeNumber = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : null;
const randomUuid = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate);

/** First-party Cloudflare Worker ingest only. Rejects PostHog/GA and arbitrary hosts. */
export function isAllowedAnalyticsEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    if (url.pathname !== "/v1/events") return false;
    if (url.search || url.hash || url.username || url.password) return false;
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+workers\.dev$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function sanitizeEvent(event: unknown, properties: unknown, now = Date.now()): Omit<AnalyticsEvent, "id"> | null {
  if (typeof event !== "string" || !(EVENTS as readonly string[]).includes(event) || !properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const input = properties as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (event === "source_added" || event === "source_removed") {
    if (!(PLATFORMS as readonly string[]).includes(String(input.platform))) return null;
    out.platform = String(input.platform);
    const count = safeNumber(input.count, 0, 1000);
    if (count !== null) out.count = count;
  } else if (event === "reader_opened") {
    const count = safeNumber(input.count, 0, 1000);
    if (count !== null) out.count = count;
  } else if (event === "extension_installed" || event === "extension_updated") {
    if (!VERSION_RE.test(String(input.version || ""))) return null;
    out.version = String(input.version);
    if (event === "extension_updated" && VERSION_RE.test(String(input.from_version || ""))) out.from_version = String(input.from_version);
  } else if (event === "feed_selected") {
    if (!(PLATFORMS as readonly string[]).includes(String(input.platform)) && input.platform !== "all") return null;
    out.platform = String(input.platform);
  } else if (event === "refresh_completed") {
    if (typeof input.ok !== "boolean" || !["manual", "scheduled", "feed"].includes(String(input.trigger))) return null;
    out.ok = input.ok;
    out.trigger = String(input.trigger);
    const duration = safeNumber(input.duration_ms, 0, 120000);
    if (duration !== null) out.duration_ms = duration;
    const status = safeNumber(input.status_code, 0, 599);
    if (status !== null) out.status_code = status;
    if (input.platform === "all" || (PLATFORMS as readonly string[]).includes(String(input.platform))) out.platform = String(input.platform);
  } else if (event === "original_opened") {
    if (!(PLATFORMS as readonly string[]).includes(String(input.platform))) return null;
    out.platform = String(input.platform);
  } else if (event === "login_detected") {
    if (!(PLATFORMS as readonly string[]).includes(String(input.platform)) || typeof input.logged_in !== "boolean") return null;
    out.platform = String(input.platform);
    out.logged_in = input.logged_in;
  } else if (event === "settings_changed") {
    if (!(FIELDS as readonly string[]).includes(String(input.field))) return null;
    out.field = String(input.field);
  } else if (event === "notification_preference_changed") {
    if (typeof input.enabled !== "boolean") return null;
    out.enabled = input.enabled;
  }
  return { event, properties: out, at: now };
}

function safeFunctionName(raw: string): string {
  const candidate = raw.trim().replace(/^async\s+/, "");
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3}$/.test(candidate) ? candidate : "<anonymous>";
}

export function sanitizeException(error: unknown, context: unknown, _handled = true): Record<string, unknown> {
  const err = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; stack?: unknown } : {};
  const typeCandidate = typeof err.name === "string" ? err.name : "Error";
  const type = (ERROR_CATEGORIES as readonly string[]).includes(typeCandidate) ? typeCandidate : "Error";
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";
  const category = /rate.?limit|too many|429|403|captcha|验证码|风控|安全验证/.test(message) ? "rate_limit" : /network|fetch|offline|timeout|abort/.test(message) ? "network_failure" : /permission|denied/.test(message) ? "permission_failure" : /json|parse|non_json/.test(message) ? "parse_failure" : "unexpected_failure";
  const contextValue = ["reader", "refresh", "source", "settings", "background", "popup", "sidepanel"].includes(String(context)) ? String(context) : "unknown";
  const frames: Record<string, unknown>[] = [];
  const stack = typeof err.stack === "string" ? err.stack : "";
  for (const line of stack.split("\n")) {
    const match = line.match(/^\s*at\s+([^\n(]+)\s+\(chrome-extension:\/\/([a-z]{32})\/(background\.js|chunks\/[A-Za-z0-9_.-]+\.js|assets\/[A-Za-z0-9_.-]+\.js):(\d+):(\d+)\)\s*$/i);
    if (!match) continue;
    const filename = match[3];
    frames.push({ function: safeFunctionName(match[1] || ""), filename, lineno: Number(match[4]), colno: Number(match[5]) });
    if (frames.length >= 20) break;
  }
  return { type, category, context: contextValue, release: RELEASE_VERSION, surface: contextValue === "sidepanel" ? "sidebar" : contextValue === "popup" ? "popup" : "background", frames };
}

function safeErrorDetailString(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > max || /[\r\n]/.test(candidate)) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(candidate) ? candidate : null;
}

function safeErrorDetails(details: AnalyticsErrorDetails | undefined): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  const out: Record<string, unknown> = {};
  const platform = safeErrorDetailString(details.platform, 24);
  const operation = safeErrorDetailString(details.operation, 48);
  const stage = safeErrorDetailString(details.stage, 32);
  const providerCode = safeErrorDetailString(details.provider_code, 64);
  if (platform && ["x", "xueqiu", "weibo"].includes(platform)) out.platform = platform;
  if (operation) out.operation = operation;
  if (stage) out.stage = stage;
  if (providerCode) out.provider_code = providerCode;
  if (typeof details.cache_hit === "boolean") out.cache_hit = details.cache_hit;
  if (typeof details.stale === "boolean") out.stale = details.stale;
  const retryAfter = safeNumber(details.retry_after_ms, 0, 1_800_000);
  if (retryAfter !== null) out.retry_after_ms = retryAfter;
  const status = safeNumber(details.status_code, 0, 599);
  if (status !== null) out.status_code = status;
  const duration = safeNumber(details.duration_ms, 0, 120000);
  if (duration !== null) out.duration_ms = duration;
  return out;
}

export function platformFromKnownHost(urlValue: unknown): (typeof PLATFORMS)[number] | null {
  if (typeof urlValue !== "string" || !urlValue) return null;
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    if (host === "xueqiu.com" || host.endsWith(".xueqiu.com")) return "xueqiu";
    if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return "x";
    if (host === "weibo.com" || host === "m.weibo.cn" || host.endsWith(".weibo.com")) return "weibo";
    return null;
  } catch {
    return null;
  }
}

export function createAnalytics(deps: AnalyticsDeps) {
  const isBuildEnabled = deps.enabledBuild !== false && isAllowedAnalyticsEndpoint(deps.endpoint);
  let surface: "popup" | "sidebar" = "sidebar";
  const setSurface = (value: unknown) => { if (value === "popup" || value === "sidebar") surface = value; };
  const setContext = async (context: unknown) => {
    const data = await deps.storage.get([ANALYTICS_SURFACE_KEY]);
    setSurface(data[ANALYTICS_SURFACE_KEY]);
    if (["reader", "refresh", "source", "settings", "background", "popup", "sidepanel"].includes(String(context))) return String(context);
    return "unknown";
  };
  let inFlight: AbortController | null = null;
  let flushing = false;
  let epoch = 0;
  let lastCaptureAt = -Infinity;
  let lastCaptureSignature = "";
  let queueOps = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queueOps.then(operation, operation);
    queueOps = result.then(() => undefined, () => undefined);
    return result;
  };
  // Default on: unset consent is treated as enabled. Explicit false is opt-out.
  const enabled = async () => {
    if (!isBuildEnabled) return false;
    const data = await deps.storage.get([ANALYTICS_CONSENT_KEY]);
    return data[ANALYTICS_CONSENT_KEY] !== false;
  };
  const installId = async () => serialize(async () => {
    if (!(await enabled())) return null;
    const data = await deps.storage.get([ANALYTICS_ID_KEY]);
    if (randomUuid(data[ANALYTICS_ID_KEY])) return data[ANALYTICS_ID_KEY] as string;
    const id = deps.randomId();
    if (!randomUuid(id) || !(await enabled())) return null;
    await deps.storage.set({ [ANALYTICS_ID_KEY]: id });
    return id;
  });
  const enqueue = async (event: Omit<AnalyticsEvent, "id"> | Record<string, unknown>) => {
    if (!(await enabled())) return false;
    return serialize(async () => {
      const token = epoch;
      if (!(await enabled()) || token !== epoch) return false;
      const candidate = event as Omit<AnalyticsEvent, "id">;
      const signature = `${candidate.event}:${JSON.stringify(candidate.properties)}`;
      const now = deps.now();
      if (signature === lastCaptureSignature && now - lastCaptureAt < 3000) return false;
      lastCaptureSignature = signature;
      lastCaptureAt = now;
      const queueData = await deps.storage.get([ANALYTICS_QUEUE_KEY]);
      const queue = Array.isArray(queueData[ANALYTICS_QUEUE_KEY]) ? queueData[ANALYTICS_QUEUE_KEY] as AnalyticsEvent[] : [];
      if (token !== epoch || !(await enabled())) return false;
      const id = deps.randomId();
      if (!randomUuid(id)) return false;
      await deps.storage.set({ [ANALYTICS_QUEUE_KEY]: [...queue.slice(-99), { ...candidate, id }] });
      if (token === epoch) deps.alarm(deps.now() + 1000);
      return true;
    });
  };
  const capture = async (name: unknown, props: unknown) => {
    if (!isBuildEnabled) return false;
    const event = sanitizeEvent(name, props, deps.now());
    if (!event) return false;
    return enqueue(event);
  };
  const captureError = async (error: unknown, context: unknown, duration?: number, status?: number, handled = true, details?: AnalyticsErrorDetails) => {
    if (!isBuildEnabled || !(await enabled())) return false;
    const safeContext = await setContext(context);
    const safe = sanitizeException(error, safeContext, handled);
    const safeDetails = safeErrorDetails(details);
    const props = { ...safe, ...safeDetails, surface } as Record<string, unknown>;
    if (typeof safeDetails.duration_ms === "number") duration = safeDetails.duration_ms;
    if (typeof safeDetails.status_code === "number") status = safeDetails.status_code;
    if (duration !== undefined) props.duration_ms = Math.max(0, Math.min(120000, Math.round(duration)));
    if (status !== undefined && Number.isFinite(status)) props.status_code = Math.max(0, Math.min(599, Math.round(status)));
    return enqueue({ event: "error_occurred", properties: props, at: deps.now() });
  };
  const flush = async () => {
    if (flushing || !(await enabled())) return;
    flushing = true;
    const token = epoch;
    try {
      const data = await deps.storage.get([ANALYTICS_QUEUE_KEY]);
      const queue = Array.isArray(data[ANALYTICS_QUEUE_KEY]) ? data[ANALYTICS_QUEUE_KEY] as AnalyticsEvent[] : [];
      const event = queue[0];
      if (!event) { deps.alarm(null); return; }
      if (Number(event.retryAt || 0) > deps.now()) { deps.alarm(Number(event.retryAt)); return; }
      const id = await installId();
      if (!id || token !== epoch || !(await enabled())) return;
      const controller = new AbortController();
      inFlight = controller;
      let timeoutHandle: unknown;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeout = deps.timeout || ((callback, ms) => setTimeout(callback, ms));
        timeoutHandle = timeout(() => { controller.abort(); reject(new Error("timeout")); }, 8000);
      });
      try {
        const body = {
          v: 1,
          install_id: id,
          release: RELEASE_VERSION,
          events: [{ id: event.id, event: event.event, properties: event.properties, at: event.at }],
        };
        const request = deps.fetch(deps.endpoint, {
          method: "POST",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const response = await Promise.race([request, timeoutPromise]);
        if (token !== epoch || !(await enabled())) return;
        const retryable = response.status === 429 || response.status >= 500;
        const drop = response.ok || (!retryable && response.status >= 400) || Number(event.attempts || 0) >= 4;
        await serialize(async () => {
          if (token !== epoch || !(await enabled())) return;
          const latest = await deps.storage.get([ANALYTICS_QUEUE_KEY]);
          const current = Array.isArray(latest[ANALYTICS_QUEUE_KEY]) ? latest[ANALYTICS_QUEUE_KEY] as AnalyticsEvent[] : [];
          const index = current.findIndex((item) => item.id === event.id);
          if (index < 0) return;
          if (drop) current.splice(index, 1);
          else {
            const item = current[index];
            item.attempts = Number(item.attempts || 0) + 1;
            item.retryAt = deps.now() + Math.min(60000, 1000 * 2 ** item.attempts);
          }
          await deps.storage.set({ [ANALYTICS_QUEUE_KEY]: current });
          if (current.length) deps.alarm(Math.max(deps.now() + 1000, Number(current[0].retryAt || 0)));
          else deps.alarm(null);
        });
      } catch {
        if (token === epoch && await enabled()) {
          await serialize(async () => {
            if (token !== epoch || !(await enabled())) return;
            const latest = await deps.storage.get([ANALYTICS_QUEUE_KEY]);
            const current = Array.isArray(latest[ANALYTICS_QUEUE_KEY]) ? latest[ANALYTICS_QUEUE_KEY] as AnalyticsEvent[] : [];
            const index = current.findIndex((item) => item.id === event.id);
            if (index < 0) return;
            const item = current[index];
            if (Number(item.attempts || 0) >= 4) current.splice(index, 1);
            else {
              item.attempts = Number(item.attempts || 0) + 1;
              item.retryAt = deps.now() + Math.min(60000, 1000 * 2 ** item.attempts);
            }
            await deps.storage.set({ [ANALYTICS_QUEUE_KEY]: current });
            deps.alarm(current.length ? Math.max(deps.now() + 1000, Number(current[0].retryAt || 0)) : null);
          });
        }
      } finally {
        if (timeoutHandle !== undefined) (deps.clearTimeout || clearTimeout)(timeoutHandle as ReturnType<typeof setTimeout>);
        if (inFlight === controller) inFlight = null;
      }
    } finally {
      flushing = false;
    }
  };
  const disable = async () => {
    epoch += 1;
    const controller = inFlight;
    inFlight = null;
    controller?.abort();
    await serialize(async () => {
      epoch += 1;
      await deps.storage.set({ [ANALYTICS_CONSENT_KEY]: false, [ANALYTICS_QUEUE_KEY]: [], [ANALYTICS_ID_KEY]: "" });
      deps.alarm(null);
    });
  };
  const setConsent = async (enabledValue: boolean) => {
    if (!enabledValue) return disable();
    if (!isBuildEnabled) return false;
    const accepted = await serialize(async () => {
      const current = await deps.storage.get([ANALYTICS_CONSENT_KEY]);
      if (current[ANALYTICS_CONSENT_KEY] !== false && current[ANALYTICS_ID_KEY]) return true;
      epoch += 1;
      const state = await deps.storage.get([ANALYTICS_SURFACE_KEY]);
      setSurface(state[ANALYTICS_SURFACE_KEY]);
      const next: Record<string, unknown> = { [ANALYTICS_CONSENT_KEY]: true };
      if (!randomUuid((await deps.storage.get([ANALYTICS_ID_KEY]))[ANALYTICS_ID_KEY])) next[ANALYTICS_ID_KEY] = "";
      await deps.storage.set(next);
      return true;
    });
    if (!accepted) return false;
    const captured = await capture("reader_opened", {});
    if (captured) void flush().catch(() => {});
    return true;
  };
  return { capture, captureError, flush, disable, setConsent, enabled, installId, enqueue, setSurface, isBuildEnabled };
}
