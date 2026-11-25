const ALLOWED_EVENTS = new Set([
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
  "error_occurred",
]);
const PLATFORMS = new Set(["x", "xueqiu", "weibo", "xiaohongshu", "all"]);
const MAX_BODY = 32_768;
const MAX_EVENTS = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export interface Env {
  EVENTS: KVNamespace;
  ANALYTICS_ADMIN_KEY?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearer ([^\s,]+)$/i);
  return match ? match[1] : "";
}

function sameSecret(left: string, right: string): boolean {
  if (!left || !right) return false;
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function isAdmin(request: Request, env: Env): boolean {
  return !!env.ANALYTICS_ADMIN_KEY && sameSecret(bearerToken(request), env.ANALYTICS_ADMIN_KEY);
}

const SUMMARY_SCAN_CAP = 10_000;
const EVENT_SCAN_CAP = 5_000;
const KV_PAGE_SIZE = 100;

function utcDay(offset: number): string {
  const date = new Date(Date.now() - offset * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function increment(env: Env, key: string, ttl = 90 * 24 * 3600): Promise<void> {
  const current = Number((await env.EVENTS.get(key)) || 0);
  await env.EVENTS.put(key, String(current + 1), { expirationTtl: ttl });
}

async function adminSummary(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") || 7);
  const days = Math.max(1, Math.min(30, Number.isFinite(requestedDays) ? Math.round(requestedDays) : 7));
  const byDay: Array<Record<string, unknown>> = [];
  const totals: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const errorDimensions = new Map<string, number>();
  let scanned = 0;
  let truncated = false;
  let stoppedAtDay: string | undefined;
  for (let offset = 0; offset < days; offset += 1) {
    const day = utcDay(offset);
    let cursor: string | undefined;
    const dayCounts: Record<string, number> = {};
    do {
      const listed = await env.EVENTS.list({ prefix: `agg:${day}:`, limit: Math.min(KV_PAGE_SIZE, SUMMARY_SCAN_CAP - scanned), ...(cursor ? { cursor } : {}) });
      for (const key of listed.keys) {
        scanned += 1;
        const count = Number((await env.EVENTS.get(key.name)) || 0);
        const parts = key.name.split(":");
        const event = parts[2] || "unknown";
        if (parts.length === 3) {
          dayCounts[event] = (dayCounts[event] || 0) + count;
          totals[event] = (totals[event] || 0) + count;
        }
        if (event === "error_occurred" && parts.length > 3) {
          let category = "unknown";
          let platform = "unknown";
          let context = "unknown";
          try {
            category = decodeURIComponent(parts.find((part) => part.startsWith("category="))?.slice(9) || "unknown");
            platform = decodeURIComponent(parts.find((part) => part.startsWith("platform="))?.slice(9) || "unknown");
            context = decodeURIComponent(parts.find((part) => part.startsWith("context="))?.slice(8) || "unknown");
          } catch { /* Ignore malformed aggregate dimensions. */ }

          errors[category] = (errors[category] || 0) + count;
          const dimension = `${category}:${platform}:${context}`;
          errorDimensions.set(dimension, (errorDimensions.get(dimension) || 0) + count);
        }
        if (scanned >= SUMMARY_SCAN_CAP) break;
      }
      if (listed.list_complete) cursor = undefined;
      else if (listed.cursor && listed.cursor !== cursor) cursor = listed.cursor;
      else { truncated = true; cursor = undefined; }
      if (scanned >= SUMMARY_SCAN_CAP && cursor) truncated = true;
    } while (cursor && scanned < SUMMARY_SCAN_CAP);
    byDay.push({ day, ...dayCounts });
    if (scanned >= SUMMARY_SCAN_CAP) {
      stoppedAtDay = day;
      if (offset < days - 1) truncated = true;
      break;
    }
  }
  const completeDays = byDay.map((row) => row.day as string).filter((day) => day !== stoppedAtDay);
  return json({ ok: true, days, scanned, truncated, totals, error_categories: errors, error_dimensions: Object.fromEntries(errorDimensions), by_day: byDay, complete_days: completeDays });
}

async function adminEvents(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") || 7);
  const days = Math.max(1, Math.min(30, Number.isFinite(requestedDays) ? Math.round(requestedDays) : 7));
  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 100));
  const records: Record<string, unknown>[] = [];
  let scanned = 0;
  let truncated = false;
  for (let offset = 0; offset < days && scanned < EVENT_SCAN_CAP; offset += 1) {
    const day = utcDay(offset);
    let cursor: string | undefined;
    do {
      const listed = await env.EVENTS.list({ prefix: `evt:${day}:`, limit: Math.min(KV_PAGE_SIZE, EVENT_SCAN_CAP - scanned), ...(cursor ? { cursor } : {}) });
      for (const key of listed.keys) {
        scanned += 1;
        const raw = await env.EVENTS.get(key.name);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed.event === "error_occurred") records.push(parsed);
          } catch {
            /* Ignore one malformed historical record. */
          }
        }
        if (scanned >= EVENT_SCAN_CAP) break;
      }
      if (listed.list_complete) cursor = undefined;
      else if (listed.cursor && listed.cursor !== cursor) cursor = listed.cursor;
      else { truncated = true; cursor = undefined; }
      if (scanned >= EVENT_SCAN_CAP && cursor) truncated = true;
    } while (cursor && scanned < EVENT_SCAN_CAP);
    if (scanned >= EVENT_SCAN_CAP && offset < days - 1) truncated = true;
    if (scanned >= EVENT_SCAN_CAP) break;
  }
  records.sort((left, right) => Number(right.received_at || right.at || 0) - Number(left.received_at || left.at || 0));
  return json({ ok: true, days, limit, scanned, truncated, events: records.slice(0, limit) });
}

function sanitizeProperties(event: string, properties: unknown): Record<string, unknown> | null {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const input = properties as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const platform = typeof input.platform === "string" ? input.platform : "";
  if (event === "source_added" || event === "source_removed" || event === "original_opened") {
    if (!PLATFORMS.has(platform) || platform === "all") return null;
    out.platform = platform;
    if (event !== "original_opened" && typeof input.count === "number" && Number.isFinite(input.count)) {
      out.count = Math.max(0, Math.min(1000, Math.round(input.count)));
    }
    return out;
  }
  if (event === "reader_opened") {
    if (typeof input.count === "number" && Number.isFinite(input.count)) out.count = Math.max(0, Math.min(1000, Math.round(input.count)));
    return out;
  }
  if (event === "extension_installed" || event === "extension_updated") {
    if (!VERSION_RE.test(String(input.version || ""))) return null;
    out.version = String(input.version);
    if (event === "extension_updated" && VERSION_RE.test(String(input.from_version || ""))) out.from_version = String(input.from_version);
    return out;
  }
  if (event === "feed_selected") {
    if (!PLATFORMS.has(platform)) return null;
    out.platform = platform;
    return out;
  }
  if (event === "refresh_completed") {
    if (typeof input.ok !== "boolean") return null;
    out.ok = input.ok;
    if (["manual", "scheduled", "feed"].includes(String(input.trigger))) out.trigger = String(input.trigger);
    if (PLATFORMS.has(platform)) out.platform = platform;
    if (typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms)) out.duration_ms = Math.max(0, Math.min(120000, Math.round(input.duration_ms)));
    if (typeof input.status_code === "number" && Number.isFinite(input.status_code)) out.status_code = Math.max(0, Math.min(599, Math.round(input.status_code)));
    return out;
  }
  if (event === "login_detected") {
    if (!PLATFORMS.has(platform) || platform === "all" || typeof input.logged_in !== "boolean") return null;
    out.platform = platform;
    out.logged_in = input.logged_in;
    return out;
  }
  if (event === "settings_changed") {
    if (typeof input.field !== "string") return null;
    out.field = input.field.slice(0, 64);
    return out;
  }
  if (event === "notification_preference_changed") {
    if (typeof input.enabled !== "boolean") return null;
    out.enabled = input.enabled;
    return out;
  }
  if (event === "error_occurred") {
    if (typeof input.category === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(input.category)) out.category = input.category;
    if (typeof input.type === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(input.type)) out.type = input.type;
    if (typeof input.context === "string" && /^[A-Za-z0-9_.:-]{1,32}$/.test(input.context)) out.context = input.context;
    if (typeof input.surface === "string" && /^[A-Za-z0-9_.:-]{1,32}$/.test(input.surface)) out.surface = input.surface;
    if (typeof input.platform === "string" && PLATFORMS.has(input.platform) && input.platform !== "all") out.platform = input.platform;
    if (typeof input.operation === "string" && /^[A-Za-z0-9_.:-]{1,48}$/.test(input.operation)) out.operation = input.operation;
    if (typeof input.stage === "string" && /^[A-Za-z0-9_.:-]{1,32}$/.test(input.stage)) out.stage = input.stage;
    if (typeof input.provider_code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(input.provider_code)) out.provider_code = input.provider_code;
    if (typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms)) out.duration_ms = Math.max(0, Math.min(120000, Math.round(input.duration_ms)));
    if (typeof input.status_code === "number" && Number.isFinite(input.status_code)) out.status_code = Math.max(0, Math.min(599, Math.round(input.status_code)));
    if (typeof input.retry_after_ms === "number" && Number.isFinite(input.retry_after_ms)) out.retry_after_ms = Math.max(0, Math.min(1_800_000, Math.round(input.retry_after_ms)));
    if (typeof input.cache_hit === "boolean") out.cache_hit = input.cache_hit;
    if (typeof input.stale === "boolean") out.stale = input.stale;
    if (typeof input.release === "string" && VERSION_RE.test(input.release)) out.release = input.release;
    return out;
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/v1/admin/summary") return adminSummary(request, env);
    if (request.method === "GET" && url.pathname === "/v1/admin/events") return adminEvents(request, env);
    if (request.method !== "POST" || url.pathname !== "/v1/events") return json({ ok: false, error: "not_found" }, 404);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return json({ ok: false, error: "too_large" }, 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_body" }, 400);
    const payload = body as Record<string, unknown>;
    if (payload.v !== 1 || !UUID_RE.test(String(payload.install_id || "")) || !Array.isArray(payload.events) || payload.events.length === 0 || payload.events.length > MAX_EVENTS) {
      return json({ ok: false, error: "invalid_payload" }, 400);
    }
    const installId = String(payload.install_id);
    const release = VERSION_RE.test(String(payload.release || "")) ? String(payload.release) : "";
    const accepted: string[] = [];
    const day = new Date().toISOString().slice(0, 10);
    for (const raw of payload.events) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const event = String(item.event || "");
      if (!ALLOWED_EVENTS.has(event) || !UUID_RE.test(String(item.id || ""))) continue;
      const properties = sanitizeProperties(event, item.properties);
      if (!properties) continue;
      const at = typeof item.at === "number" && Number.isFinite(item.at) ? Math.round(item.at) : Date.now();
      const key = `evt:${day}:${installId}:${item.id}`;
      const record = { install_id: installId, event, properties, at, release, received_at: Date.now() };
      const existing = await env.EVENTS.get(key);
      if (existing) { accepted.push(String(item.id)); continue; }
      await env.EVENTS.put(key, JSON.stringify(record), { expirationTtl: 90 * 24 * 3600 });
      const aggKey = `agg:${day}:${event}`;
      await increment(env, aggKey);
      if (event === "error_occurred") {
        const category = encodeURIComponent(String(properties.category || "unknown").slice(0, 64));
        const platform = encodeURIComponent(String(properties.platform || "unknown").slice(0, 24));
        const context = encodeURIComponent(String(properties.context || "unknown").slice(0, 32));
        await increment(env, `agg:${day}:${event}:category=${category}:platform=${platform}:context=${context}`);
      }
      accepted.push(String(item.id));
    }
    if (!accepted.length) return json({ ok: false, error: "no_events" }, 400);
    return json({ ok: true, accepted: accepted.length }, 200);
  },
};
