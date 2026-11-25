import { describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY, ANALYTICS_ID_KEY, ANALYTICS_QUEUE_KEY, createAnalytics, isAllowedAnalyticsEndpoint, platformFromKnownHost, sanitizeEvent, sanitizeException } from "./analytics";

const ENDPOINT = "https://owlivo-analytics.example.workers.dev/v1/events";

function harness(initial: Record<string, unknown> = {}, options: { endpoint?: string; enabledBuild?: boolean; now?: () => number; fetch?: typeof fetch } = {}) {
  const data = { ...initial };
  const storage = { get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))), set: vi.fn(async (v: Record<string, unknown>) => Object.assign(data, v)) };
  const fetch = options.fetch || vi.fn(async () => new Response("ok", { status: 200 })); const alarm = vi.fn(); let id = 0;
  const api = createAnalytics({ storage, fetch: fetch as typeof globalThis.fetch, now: options.now || (() => 5000), randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`, alarm, endpoint: options.endpoint === undefined ? ENDPOINT : options.endpoint, enabledBuild: options.enabledBuild });
  return { api, data, fetch: fetch as ReturnType<typeof vi.fn>, alarm, storage };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("analytics consent pipeline", () => {
  it("defaults to enabled when consent is unset and the build has a first-party endpoint", async () => {
    const h = harness();
    expect(await h.api.enabled()).toBe(true);
    await h.api.capture("reader_opened", {});
    await h.api.flush();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.data[ANALYTICS_ID_KEY]).toMatch(/^00000000-0000-4000-8000-/);
  });
  it("keeps explicit opt-out at zero requests and without an identifier", async () => {
    const h = harness({ [ANALYTICS_CONSENT_KEY]: false });
    await h.api.capture("reader_opened", {});
    await h.api.flush();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.data[ANALYTICS_ID_KEY]).toBeUndefined();
  });
  it("sends only allowlisted properties and a first-party payload", async () => {
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true });
    expect(sanitizeEvent("source_added", { platform: "x", id: "SECRET", query: "hidden", count: 1 })?.properties).toEqual({ platform: "x", count: 1 });
    expect(sanitizeEvent("source_added", { platform: "weibo", id: "PRIVATE_ID", query: "private query", account: "private-account", count: 2 })?.properties).toEqual({ platform: "weibo", count: 2 });
    expect(sanitizeEvent("source_added", { platform: "unsupported", count: 1 })).toBeNull();
    expect(sanitizeEvent("feed_selected", { platform: "weibo", feed: "PRIVATE_ID", id: "PRIVATE_ID", query: "private query", account: "private-account" })?.properties).toEqual({ platform: "weibo" });
    expect(sanitizeEvent("refresh_completed", { platform: "weibo", ok: true, trigger: "feed", duration_ms: 345, status_code: 503, id: "PRIVATE_ID", query: "private query", account: "private-account" })?.properties).toEqual({ ok: true, trigger: "feed", duration_ms: 345, status_code: 503, platform: "weibo" });
    expect(sanitizeEvent("original_opened", { platform: "xueqiu", url: "https://xueqiu.com/u/SECRET/123", title: "secret post" })?.properties).toEqual({ platform: "xueqiu" });
    expect(sanitizeEvent("login_detected", { platform: "x", logged_in: false, uid: "99", cookie: "token" })?.properties).toEqual({ platform: "x", logged_in: false });
    expect(sanitizeEvent("extension_installed", { version: "1.8.7", email: "a@b.c" })?.properties).toEqual({ version: "1.8.7" });
    expect(sanitizeEvent("extension_updated", { version: "1.8.7", from_version: "1.8.0", path: "/u/1" })?.properties).toEqual({ version: "1.8.7", from_version: "1.8.0" });
    expect(JSON.stringify([
      sanitizeEvent("source_added", { platform: "weibo", id: "PRIVATE_ID", query: "private query", account: "private-account", count: 2 }),
      sanitizeEvent("original_opened", { platform: "xueqiu", url: "https://xueqiu.com/u/SECRET/123" }),
      sanitizeEvent("login_detected", { platform: "x", logged_in: true, uid: "SECRET" }),
    ])).not.toMatch(/PRIVATE_ID|private query|private-account|SECRET|xueqiu\.com\/u/);
    expect(sanitizeEvent("settings_changed", { field: "readingFont", value: "real-font-name" })?.properties).toEqual({ field: "readingFont" });
    const stack = "Error: forbidden developer@example.invalid token=abc\n    at refresh (chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/chunks/App.js:12:34)\n    at fetcher (https://private.example/alice/account.js:12:34)\n    at bare (src/lib/background.ts:9:1)";
    const error = sanitizeException({ name: "BadThing", message: "https://host/path?secret=1", stack }, "reader");
    expect(error).toMatchObject({ type: "Error", category: "unexpected_failure", frames: [{ function: "refresh", filename: "chunks/App.js", lineno: 12, colno: 34 }] });
    expect(JSON.stringify(error)).not.toMatch(/alice|xueqiu|private\.example|account\.js|src\/lib|token=|secret|email/i);
    expect(sanitizeException({ name: "Error", message: "", stack: "Error\n at fetcher (https://private.example/alice/account.js:12:34)" }, "reader").frames).toEqual([]);
    await h.api.capture("reader_opened", { count: 2 });
    await h.api.flush();
    expect(h.fetch.mock.calls[0][0]).toBe(ENDPOINT);
    const body = JSON.parse(String(h.fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      v: 1,
      install_id: "00000000-0000-4000-8000-000000000002",
      release: "1.8.7",
      events: [{ event: "reader_opened", properties: { count: 2 }, at: 5000 }],
    });
    expect(JSON.stringify(body)).not.toMatch(/api_key|posthog|distinct_id|cookie|SECRET/i);
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });
  it("clears queued and in-flight requests when disabled", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn((_url: string, options: RequestInit) => { (globalThis as any).lastSignal = options.signal; return pending.promise; });
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true }, { fetch: fetch as typeof globalThis.fetch });
    await h.api.capture("reader_opened", {});
    const flushing = h.api.flush();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await h.api.disable();
    await expect((globalThis as any).lastSignal.aborted).toBe(true);
    pending.resolve(new Response("ok", { status: 200 }));
    await flushing;
    expect(h.data[ANALYTICS_QUEUE_KEY]).toEqual([]);
    expect(h.data[ANALYTICS_ID_KEY]).toBe("");
    expect(h.data[ANALYTICS_CONSENT_KEY]).toBe(false);
  });
  it("does not mutate storage when analytics is unavailable in this build", async () => {
    for (const options of [{ endpoint: "" }, { endpoint: "https://us.i.posthog.com/i/v0/e/" }, { enabledBuild: false }]) {
      const h = harness({ [ANALYTICS_CONSENT_KEY]: false, [ANALYTICS_QUEUE_KEY]: [{ id: "old-event" }] }, options);
      const before = { ...h.data };
      expect(await h.api.setConsent(true)).toBe(false);
      expect(h.data).toEqual(before);
      expect(h.storage.set).not.toHaveBeenCalled();
    }
  });
  it("returns true after valid enable processing", async () => {
    const h = harness({ [ANALYTICS_CONSENT_KEY]: false });
    expect(await h.api.setConsent(true)).toBe(true);
    expect(h.data[ANALYTICS_CONSENT_KEY]).toBe(true);
  });
  it("re-enabling creates a fresh non-empty installation identifier", async () => {
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true });
    const previousId = await h.api.installId();
    await h.api.disable();
    await h.api.setConsent(true);
    const reenabledId = await h.api.installId();
    expect(reenabledId).toBeTruthy();
    expect(reenabledId).not.toBe(previousId);
  });
  it("serializes concurrent enqueue and does not lose queue items during flush", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(new Response("ok", { status: 200 }));
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true }, { fetch: fetch as typeof globalThis.fetch });
    await Promise.all([h.api.capture("reader_opened", {}), h.api.capture("feed_selected", { platform: "all" })]);
    expect(h.data[ANALYTICS_QUEUE_KEY]).toHaveLength(2);
    const flush = h.api.flush();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await h.api.capture("source_added", { platform: "x", count: 1 });
    pending.resolve(new Response("ok", { status: 200 }));
    await flush;
    expect(h.data[ANALYTICS_QUEUE_KEY]).toHaveLength(2);
    expect((h.data[ANALYTICS_QUEUE_KEY] as any[]).map((x) => x.event)).toEqual(["feed_selected", "source_added"]);
  });
  it("retains retryAt across worker restart and does not send early", async () => {
    let now = 5000;
    const event = { id: "q1", event: "reader_opened", properties: {}, at: 1000, attempts: 1, retryAt: 10000 };
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true, [ANALYTICS_QUEUE_KEY]: [event] }, { now: () => now });
    await h.api.flush();
    expect(h.fetch).not.toHaveBeenCalled();
    now = 10000;
    await h.api.flush();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("cleans timeout timer and aborts hung network request", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const abort = vi.fn();
    const clear = vi.fn();
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true }, { fetch: fetch as typeof globalThis.fetch });
    const api = createAnalytics({ storage: h.storage, fetch: fetch as typeof globalThis.fetch, now: () => 5000, randomId: () => "00000000-0000-4000-8000-000000000010", alarm: h.alarm, endpoint: ENDPOINT, timeout: (callback) => { abort.mockImplementation(callback); return 1; }, clearTimeout: clear });
    await api.capture("reader_opened", {});
    const run = api.flush();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    abort();
    await run;
    expect(clear).toHaveBeenCalledWith(1);
  });
  it("does not generate ids or issue requests without an endpoint or in dev/fixture builds", async () => {
    for (const options of [{ endpoint: "" }, { endpoint: "https://www.google-analytics.com/mp/collect" }, { enabledBuild: false }]) {
      const h = harness({ [ANALYTICS_CONSENT_KEY]: true }, options);
      await h.api.capture("reader_opened", {});
      await h.api.flush();
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.data[ANALYTICS_ID_KEY]).toBeUndefined();
      expect(h.data[ANALYTICS_QUEUE_KEY]).toBeUndefined();
    }
  });
  it("bounds failure retry without recursive error reporting", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network secret"));
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true }, { fetch: fetch as typeof globalThis.fetch });
    await h.api.capture("reader_opened", {});
    await h.api.flush();
    expect(h.data[ANALYTICS_QUEUE_KEY]).toHaveLength(1);
    expect(h.data[ANALYTICS_QUEUE_KEY][0]).not.toHaveProperty("message");
    expect(h.alarm).toHaveBeenCalled();
  });
  it("keeps guarded error metadata on a bounded, allowlisted shape", async () => {
    const h = harness({ [ANALYTICS_CONSENT_KEY]: true });
    await h.api.captureError(new Error("HTTP 429 rate limit"), "background", 125, 429, true, {
      platform: "weibo", operation: "hot", stage: "response", provider_code: "RATE_LIMIT",
      retry_after_ms: 30000, cache_hit: true, stale: true, status_code: 429, duration_ms: 125,
      user: "private-user", query: "private query",
    });
    const event = h.data[ANALYTICS_QUEUE_KEY][0];
    expect(event.properties).toMatchObject({
      platform: "weibo", operation: "hot", stage: "response", provider_code: "RATE_LIMIT",
      retry_after_ms: 30000, cache_hit: true, stale: true, status_code: 429, duration_ms: 125,
    });
    expect(JSON.stringify(event)).not.toMatch(/private-user|private query/);
  });
  it("rejects unsafe events and only maps known platform hosts", () => {
    expect(sanitizeEvent("reader_opened", { account: "me", cookie: "c" })?.properties).toEqual({});
    expect(sanitizeEvent("unknown", {})).toBeNull();
    expect(sanitizeEvent("login_detected", { platform: "x", logged_in: "yes" })).toBeNull();
    expect(sanitizeEvent("original_opened", { platform: "all" })).toBeNull();
    expect(sanitizeException({ name: "Error", message: "denied", stack: "at anything (https://x.com/secret:1:2)" }, "reader", false)).toMatchObject({ category: "permission_failure", frames: [] });
    expect(sanitizeException({ name: "Error", message: "HTTP 429 rate limit", stack: "" }, "background")).toMatchObject({ category: "rate_limit" });
    expect(platformFromKnownHost("https://xueqiu.com/123456/status")).toBe("xueqiu");
    expect(platformFromKnownHost("https://x.com/someone/status/1")).toBe("x");
    expect(platformFromKnownHost("https://evil.example/xueqiu.com")).toBeNull();
    expect(isAllowedAnalyticsEndpoint(ENDPOINT)).toBe(true);
    expect(isAllowedAnalyticsEndpoint("https://us.i.posthog.com/i/v0/e/")).toBe(false);
    expect(isAllowedAnalyticsEndpoint("https://www.google-analytics.com/mp/collect")).toBe(false);
  });
});
