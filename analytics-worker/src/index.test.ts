import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";

class MemoryKV {
  values = new Map<string, string>();
  listCalls = 0;
  async get(key: string) { return this.values.get(key) ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    this.listCalls += 1;
    const names = [...this.values.keys()].filter((name) => name.startsWith(options.prefix || "")).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit || 1000;
    const keys = names.slice(start, start + limit).map((name) => ({ name }));
    const end = start + keys.length;
    return { keys, list_complete: end >= names.length, cursor: end < names.length ? String(end) : undefined };
  }
}

const install = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "123e4567-e89b-42d3-a456-426614174001";
const adminKey = "test-admin-key";
function request(path: string, init: RequestInit = {}) { return new Request(`https://worker.test${path}`, init); }
function admin(path: string, authorization = `Bearer ${adminKey}`) { return request(path, { headers: { Authorization: authorization } }); }
function ingestEvent(properties: Record<string, unknown> = {}) {
  return request("/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, install_id: install, release: "1.8.7", events: [{ id: eventId, event: "error_occurred", at: Date.now(), properties: { category: "network_failure", context: "background", platform: "weibo", operation: "hot", stage: "response", status_code: 503, duration_ms: 512, ...properties } }] }),
  });
}

describe("analytics worker ingest and admin", () => {
  it("requires an exact strict Bearer token", async () => {
    const env = { EVENTS: new MemoryKV(), ANALYTICS_ADMIN_KEY: adminKey } as unknown as Env;
    for (const authorization of ["", adminKey, `Basic ${adminKey}`, `Bearer ${adminKey} extra`, `Bearer  ${adminKey}`]) {
      const response = await worker.fetch(admin("/v1/admin/summary", authorization), env);
      expect(response.status).toBe(401);
    }
    expect((await worker.fetch(admin("/v1/admin/summary"), env)).status).toBe(200);
  });

  it("ingests sanitized errors once, exposes summary and paginated events", async () => {
    const kv = new MemoryKV();
    const env = { EVENTS: kv, ANALYTICS_ADMIN_KEY: adminKey } as unknown as Env;
    expect((await worker.fetch(ingestEvent({ cookie: "must-not-store", message: "secret text" }), env)).status).toBe(200);
    expect((await worker.fetch(ingestEvent(), env)).status).toBe(200);
    const stored = [...kv.values.entries()].find(([key]) => key.startsWith("evt:"))?.[1] || "";
    expect(stored).not.toMatch(/must-not-store|secret text/);
    const summary = await (await worker.fetch(admin("/v1/admin/summary?days=1"), env)).json() as any;
    expect(summary.totals.error_occurred).toBe(1);
    expect(summary.error_categories.network_failure).toBe(1);
    expect(summary.error_dimensions["network_failure:weibo:background"]).toBe(1);
    expect(summary.by_day[0].error_occurred).toBe(1);
    const events = await (await worker.fetch(admin("/v1/admin/events?days=1&limit=10"), env)).json() as any;
    expect(events.events).toHaveLength(1);
    expect(events.events[0].properties).toMatchObject({ operation: "hot", status_code: 503, duration_ms: 512 });
  });

  it("bounds administrative scans and marks truncated results", async () => {
    const kv = new MemoryKV();
    const day = new Date().toISOString().slice(0, 10);
    for (let index = 0; index < 5100; index += 1) {
      const id = String(index).padStart(8, "0");
      kv.values.set(`evt:${day}:install:${id}`, JSON.stringify({ event: "reader_opened", received_at: index }));
    }
    const env = { EVENTS: kv, ANALYTICS_ADMIN_KEY: adminKey } as unknown as Env;
    const response = await worker.fetch(admin("/v1/admin/events?days=1&limit=500"), env);
    const result = await response.json() as any;
    expect(result.scanned).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(0);
    expect(kv.listCalls).toBeLessThanOrEqual(50);
  });
});
