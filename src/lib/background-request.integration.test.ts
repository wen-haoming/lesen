import { readFileSync } from "node:fs";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as policyHelpers from "./platform-request-risk";

const source = readFileSync(new URL("./background-main.js", import.meta.url), "utf8");
const slice = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not isolate source: ${startMarker}`);
  return source.slice(start, end);
};
const requestSource = slice(
  "const PRIVATE_API_REPEAT_GAP_MS =",
  "function readRefreshMinutes",
);
const weiboUidSource = slice("function pickWeiboUid(", "async function fetchWeiboSelfUid(");
const weiboAvatarSource = slice("function weiboAvatarUrl(", "function mapWeiboFollowUser(");
const weiboNormalizeSource = slice("function stripWeiboHtml(", "function weiboCardlistSinceId(");
const weiboFetchSource = slice("async function fetchWeiboJson", "async function fetchWeiboText");
const weiboTimelineSource = slice(
  "async function fetchWeiboTimeline",
  "async function refreshTimelineWeibo",
);
const xTimelineSource = slice("const X_TIMELINE_CACHE_MS =", "async function persistTimelineFeed");
const weiboMobileSource = slice("let weiboMobileChain =", "async function readWeiboFollowingFromMobile");

describe("Weibo mobile request fallback", () => {
  it.each([
    { tabs: [] },
    { tabs: [{ id: 8, url: "https://m.weibo.cn/" }] },
  ])(
    "never creates a browser window or tab after HTTP 432 (existing tabs: $tabs)",
    async ({ tabs }) => {
      const opened: string[] = [];
      const scriptTargets: number[] = [];
      const context = createContext({
        URL,
        guardedRequestBackoff: new Map(),
        runGuardedPlatformRequest: async () => ({ ok: false, error: "HTTP 432" }),
        riskDetails: () => null,
        chrome: {
          runtime: {},
          windows: { create: () => opened.push("window") },
          tabs: {
            query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback(tabs),
            create: () => opened.push("tab"),
          },
          scripting: {
            executeScript: async ({ target }: { target: { tabId: number } }) => {
              scriptTargets.push(target.tabId);
              return [{ result: { ok: true, status: 200, text: '{"ok":1}' } }];
            },
          },
        },
      });
      runInContext(weiboMobileSource, context);
      const request = runInContext('fetchWeiboMobileJson("https://m.weibo.cn/api/container/getIndex")', context);
      if (tabs.length) await expect(request).resolves.toEqual({ ok: 1 });
      else await expect(request).rejects.toThrow("HTTP 432");
      expect(scriptTargets).toEqual(tabs.length ? [8] : []);
      expect(opened).toEqual([]);
    },
  );
});

function harness(options: {
  now?: number;
  storage?: Record<string, unknown>;
  executeScript?: (...args: any[]) => any;
  persisted?: any[];
} = {}) {
  let now = options.now ?? 1_000_000;
  const store = options.storage || {};
  const date = class extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) super(now);
      else super(...(args as [any]));
    }
    static now() { return now; }
  };
  const chrome = {
    storage: {
      local: {
        async get(keys: string[]) {
          if (Array.isArray(keys))
            return Object.fromEntries(keys.map((key) => [key, structuredClone(store[key])]));
          return structuredClone(store);
        },
        async set(values: Record<string, unknown>) {
          Object.assign(store, structuredClone(values));
        },
      },
    },
    scripting: {
      executeScript: options.executeScript || (async () => [{ result: { code: 0, data: {} } }]),
    },
    tabs: { async query() { return [{ id: 8, url: "https://xueqiu.com/" }]; } },
  };
  const context = createContext({
    chrome,
    Date: date,
    URL,
    URLSearchParams,
    Map,
    Set,
    Promise,
    Error,
    String,
    Number,
    Object,
    Array,
    Math,
    JSON,
    RegExp,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    sleep: async (ms: number) => { now += Math.max(0, Number(ms) || 0); },
    ...policyHelpers,
    findXueqiuTab: async () => ({ id: 8 }),
    riskDetails: (status: number, body: string, headers: unknown) =>
      policyHelpers.inspectRisk(status, body, headers as any),
    broadcast: () => { },
    persistTimelineFeed: async (...args: any[]) => { options.persisted?.push(args); },
  });
  runInContext(requestSource, context);
  runInContext("globalThis.testStates = platformPolicyStates", context);
  return {
    context,
    store,
    currentTime: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

function weiboTimelineHarness(response: unknown) {
  const finalized: any[] = [];
  const context = createContext({
    fetchWeiboJson: async () => response,
    pickWeiboUid: (uid: unknown) => String(uid || ""),
    minimalWeiboPost: (post: any, expectedUid: string) =>
      post && post.id ? { id: String(post.id), userId: expectedUid, platform: "weibo" } : null,
    finishGuardedRequest: (platform: string, result: unknown) => finalized.push({ platform, result }),
  });
  runInContext(weiboTimelineSource, context);
  return { context, finalized };
}

function xTimelineHarness(responses: Array<{ status: number; body: unknown }>) {
  const requests: string[] = [];
  const finalized: any[] = [];
  const context = createContext({
    Date,
    Map,
    Promise,
    Error,
    String,
    Number,
    Object,
    Array,
    Math,
    JSON,
    encodeURIComponent,
    sleep: async () => undefined,
    fetch: async (url: string) => {
      requests.push(url);
      const next = responses.shift();
      if (!next) throw new Error("No fixture response available");
      return {
        status: next.status,
        headers: {},
        text: async () => JSON.stringify(next.body),
      };
    },
    riskDetails: () => null,
    runGuardedPlatformRequest: async (_platform: string, _url: string, request: () => Promise<unknown>) => ({
      ok: true,
      value: await request(),
    }),
    finishGuardedRequest: (platform: string, result: unknown) => finalized.push({ platform, result }),
    normalizeReplyHandle: (value: unknown) => String(value || "").replace(/^@/, "").toLowerCase(),
    postsFromFxTwitter: (json: any, handle: string) =>
      (Array.isArray(json?.results) ? json.results : []).map((post: any) => ({
        id: String(post.id),
        handle,
      })),
  });
  runInContext(xTimelineSource, context);
  return { context, requests, finalized };
}

describe("actual background request boundary integration", () => {
  it("dedupes identical in-flight work without adding a local request budget", async () => {
    const { context, currentTime } = harness();
    const dispatches: number[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = context.runGuardedPlatformRequest("demo", "https://xueqiu.com/a?_=1", async () => {
      dispatches.push(currentTime());
      await blocked;
      return "first";
    });
    const duplicate = context.runGuardedPlatformRequest("demo", "https://xueqiu.com/a?_=2", async () => {
      dispatches.push(currentTime());
      return "duplicate";
    });
    const second = context.runGuardedPlatformRequest("demo", "https://xueqiu.com/b", async () => {
      dispatches.push(currentTime());
      return "second";
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(dispatches).toHaveLength(1);
    release();
    await expect(first).resolves.toMatchObject({ ok: true, value: "first" });
    await expect(duplicate).resolves.toMatchObject({ ok: true, value: "first" });
    await expect(second).resolves.toMatchObject({ ok: true, value: "second" });
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1] - dispatches[0]).toBeGreaterThanOrEqual(0);

    const budget = harness();
    for (let i = 0; i < 20; i++) {
      const result = await budget.context.runGuardedPlatformRequest(
        "budget", `https://xueqiu.com/timeline?page=${i}`, async () => i,
      );
      expect(result.ok).toBe(true);
    }
    let executed = false;
    const denied = await budget.context.runGuardedPlatformRequest(
      "budget", "https://xueqiu.com/timeline?page=20", async () => { executed = true; },
    );
    expect(denied).toMatchObject({ ok: true, value: undefined });
    expect(executed).toBe(true);
  });

  it("allows a manual repeat after canonicalizing cachebuster URLs", async () => {
    const { context } = harness();
    const first = await context.runGuardedPlatformRequest(
      "separate", "https://xueqiu.com/timeline?page=0", async () => "sent",
    );
    expect(first).toMatchObject({ ok: true, value: "sent" });
    let forced = false;
    const denied = await context.runGuardedPlatformRequest(
      "separate", "https://xueqiu.com/timeline?page=0&_=1", async () => {
        forced = true;
        return "bad";
      }, { force: true },
    );
    expect(denied).toMatchObject({ ok: true, value: "bad" });
    expect(forced).toBe(true);
  });

  it("persists risk pause across restart and stops a queued request", async () => {
    const store: Record<string, unknown> = {};
    const first = harness({ storage: store });
    const risky = first.context.runGuardedPlatformRequest("risk", "https://weibo.com/a", async () => {
      const error: any = new Error("403 challenge");
      error.platformRisk = { retryAfterMs: 0 };
      throw error;
    });
    const queued = first.context.runGuardedPlatformRequest(
      "risk", "https://weibo.com/b", async () => "must not execute",
    );
    const [riskResult, queuedResult] = await Promise.all([risky, queued]);
    expect(riskResult).toMatchObject({ ok: false, platformPause: true, riskHandled: true });
    expect(queuedResult).toMatchObject({ ok: false, platformPause: true });
    const persisted = store.platformRequestState as any;
    expect(persisted.pauses.risk.until).toBeGreaterThan(first.currentTime());
    const restarted = harness({ now: first.currentTime(), storage: store });
    await expect(restarted.context.runGuardedPlatformRequest(
      "risk", "https://weibo.com/c", async () => "no",
    )).resolves.toMatchObject({ ok: false, platformPause: true });
  });

  it("reuses recent non-forced responses, paces bursts smoothly, and clears expired risk streaks on clean recovery", async () => {
    const h = harness({ now: 2_000_000 });
    let calls = 0;
    const first = await h.context.runGuardedPlatformRequest(
      "smooth",
      "https://weibo.com/ajax/statuses/mymblog?uid=1&page=1",
      async () => `resp-${++calls}`,
    );
    expect(first).toMatchObject({ ok: true, value: "resp-1" });
    h.advance(1000);
    const cached = await h.context.runGuardedPlatformRequest(
      "smooth",
      "https://weibo.com/ajax/statuses/mymblog?uid=1&page=1&_=99",
      async () => `resp-${++calls}`,
    );
    expect(cached).toMatchObject({ ok: true, value: "resp-1", cached: true });
    expect(calls).toBe(1);

    const forced = await h.context.runGuardedPlatformRequest(
      "smooth",
      "https://weibo.com/ajax/statuses/mymblog?uid=1&page=1&_=100",
      async () => `resp-${++calls}`,
      { force: true },
    );
    expect(forced).toMatchObject({ ok: true, value: "resp-2" });
    expect(calls).toBe(2);

    const beforePaced = h.currentTime();
    await h.context.runGuardedPlatformRequest(
      "smooth",
      "https://weibo.com/ajax/statuses/mymblog?uid=2&page=1",
      async () => "resp-3",
    );
    expect(h.currentTime() - beforePaced).toBeGreaterThanOrEqual(200);

    // Trigger risk pause, wait past cooldown, succeed once, and verify next failure starts back at streak=1 (2 min)
    await h.context.runGuardedPlatformRequest("smooth", "https://weibo.com/risk", async () => {
      const err: any = new Error("429");
      err.platformRisk = { retryAfterMs: 0 };
      throw err;
    });
    const firstPause = h.context.testStates.get("smooth").pause;
    expect(firstPause.failures).toBe(1);
    h.advance(firstPause.until - h.currentTime() + 5_000);
    await expect(
      h.context.runGuardedPlatformRequest("smooth", "https://weibo.com/ok", async () => "recovered"),
    ).resolves.toMatchObject({ ok: true, value: "recovered" });
    expect(h.context.testStates.get("smooth").pause).toBeNull();
  });

  it("parses m.weibo.cn Chinese relative and calendar created_at strings into accurate timestamps", () => {
    const fixedNow = Date.parse("2026-11-18T14:00:00+08:00");
    const h = harness({ now: fixedNow });
    runInContext(weiboUidSource, h.context);
    runInContext(weiboAvatarSource, h.context);
    runInContext(weiboNormalizeSource, h.context);
    const makePost = (createdAt: string) =>
      h.context.minimalWeiboPost({
        id: "4999999999",
        mid: "4999999999",
        user: { id: "12345", screen_name: "作者" },
        text: "实时内容",
        created_at: createdAt,
      });
    expect(makePost("刚刚").timestamp).toBe(fixedNow);
    expect(makePost("5分钟前").timestamp).toBe(fixedNow - 5 * 60_000);
    expect(makePost("2小时前").timestamp).toBe(fixedNow - 2 * 3_600_000);
    const yesterday = makePost("昨天 09:30");
    expect(yesterday.timestamp).toBeGreaterThan(Date.parse("2026-11-17T00:00:00+08:00"));
    expect(yesterday.timestamp).toBeLessThan(Date.parse("2026-11-18T00:00:00+08:00"));
    const monthDay = makePost("11-15");
    expect(new Date(monthDay.timestamp).getFullYear()).toBe(2026);
  });

  it("retries one transient empty FxTwitter cursor response before ending pagination", async () => {
    const transientThenPage = xTimelineHarness([
      { status: 404, body: { code: 404, results: [], cursor: { top: null, bottom: null } } },
      {
        status: 200,
        body: {
          code: 200,
          results: [{ type: "status", id: "older-post" }],
          cursor: { bottom: "next-cursor" },
        },
      },
    ]);
    const result = await transientThenPage.context.fetchXTimelineNetwork("karpathy", "page-cursor");

    expect(result).toMatchObject({
      ok: true,
      posts: [{ id: "older-post", handle: "karpathy" }],
      cursor: "next-cursor",
      hasMore: true,
    });
    expect(transientThenPage.requests).toHaveLength(2);
    expect(transientThenPage.requests[0]).toBe(transientThenPage.requests[1]);

    const exhausted = xTimelineHarness([
      { status: 404, body: { code: 404, results: [], cursor: { top: null, bottom: null } } },
      { status: 404, body: { code: 404, results: [], cursor: { top: null, bottom: null } } },
    ]);
    await expect(exhausted.context.fetchXTimelineNetwork("karpathy", "page-cursor")).resolves.toMatchObject({
      ok: true,
      posts: [],
      cursor: "",
      hasMore: false,
    });
    expect(exhausted.requests).toHaveLength(2);
  });

  it("includes the Weibo platform session and XSRF header for feed requests", async () => {
    const { context } = harness();
    let request: { url: string; options: any } | undefined;
    context.fetch = async (url: string, options: any) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "" },
        text: async () => '{"ok":1,"data":{"list":[]}}',
      };
    };
    context.readWeiboXsrfToken = async () => "test-xsrf-token";
    runInContext(weiboFetchSource, context);

    await context.fetchWeiboJson(
      "https://weibo.com/ajax/statuses/mymblog?uid=123456&page=1&feature=0",
      "https://weibo.com/u/123456",
    );

    expect(request?.options.credentials).toBe("include");
    expect(request?.options.headers["X-XSRF-TOKEN"]).toBe("test-xsrf-token");
  });

  it("surfaces Weibo API rejection codes instead of reporting an empty feed", async () => {
    const rejected = weiboTimelineHarness({ ok: -100, url: "https://weibo.com/" });
    const result = await rejected.context.fetchWeiboTimeline("123456", 1);
    expect(result).toMatchObject({ ok: false, error: "微博接口返回失败状态 (ok=-100)" });
    expect(result.posts).toBeUndefined();
    expect(rejected.finalized).toEqual([
      { platform: "weibo", result: { ok: false, error: "微博接口返回失败状态 (ok=-100)" } },
    ]);

    const empty = weiboTimelineHarness({ ok: 1, data: { list: [] } });
    await expect(empty.context.fetchWeiboTimeline("123456", 1)).resolves.toMatchObject({
      ok: true,
      posts: [],
      hasMore: false,
    });
  });


  it("keeps Xueqiu JSON and ordinary Weibo homepage reads on actual guarded paths", async () => {
    const { context } = harness();
    context.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => '{"ok":true}',
    });
    context.readWeiboXsrfToken = async () => "";
    runInContext(slice("async function fetchXueqiuJson", "async function probeBackgroundSession"), context);
    const json = await context.fetchXueqiuJson("https://xueqiu.com/test.json?_=1");
    expect(json).toEqual({ ok: true });
    context.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => "<html><body>Weibo normal home</body></html>",
    });
    runInContext(slice("async function fetchWeiboText", "function pickWeiboUid"), context);
    await expect(context.fetchWeiboText("https://weibo.com/")).resolves.toContain("normal home");
  });

  it("retries Xueqiu 400016 in the extension background with browser credentials", async () => {
    const credentials: string[] = [];
    const { context } = harness();
    context.fetch = async (_url: string, options: any) => {
      credentials.push(options.credentials);
      return credentials.length === 1
        ? {
          ok: false,
          status: 400,
          headers: { get: () => "" },
          text: async () => '{"error_code":400016,"error_description":"login needed"}',
        }
        : {
          ok: true,
          status: 200,
          headers: { get: () => "" },
          text: async () => '{"statuses":[{"id":"post-background"}]}',
        };
    };
    context.findXueqiuTab = async () => {
      throw new Error("background cookie request should succeed without a page");
    };
    runInContext(
      slice("function closeTemporaryXueqiuTab", "async function probeBackgroundSession"),
      context,
    );

    const data = await context.fetchXueqiuJson(
      "https://xueqiu.com/statuses/user_timeline.json?user_id=12345&page=1",
      { sessionFallback: true },
    );

    expect(data).toEqual({ statuses: [{ id: "post-background" }] });
    expect(credentials).toEqual(["omit", "include"]);
  });

  it("retries Xueqiu 400016 through the existing page session for timeline reads", async () => {
    let pageRequest: { url: string; credentials: string } | undefined;
    const executeScript = async ({ func, args }: any) => {
      const result = await runInNewContext(`(${func.toString()})(...args)`, {
        URL,
        location: {
          href: "https://www.xueqiu.com/u/12345",
          origin: "https://www.xueqiu.com",
          protocol: "https:",
          hostname: "www.xueqiu.com",
        },
        fetch: async (url: string, options: any) => {
          pageRequest = { url, credentials: options.credentials };
          return {
            ok: true,
            status: 200,
            text: async () => '{"statuses":[{"id":"post-1"}]}',
          };
        },
        args,
      });
      return [{ result }];
    };
    const fetchCredentials: string[] = [];
    const { context } = harness({ executeScript });
    context.fetch = async (_url: string, options: any) => {
      fetchCredentials.push(options.credentials);
      return {
        ok: false,
        status: 400,
        headers: { get: () => "" },
        text: async () =>
          '{"error_code":400016,"error_description":"遇到错误，请刷新页面或者重新登录帐号后再试"}',
      };
    };
    runInContext(
      slice("function closeTemporaryXueqiuTab", "async function probeBackgroundSession"),
      context,
    );

    const data = await context.fetchXueqiuJson(
      "https://xueqiu.com/statuses/user_timeline.json?user_id=12345&page=1",
      { sessionFallback: true },
    );

    expect(data).toEqual({ statuses: [{ id: "post-1" }] });
    expect(pageRequest).toEqual({
      url: "https://www.xueqiu.com/statuses/user_timeline.json?user_id=12345&page=1",
      credentials: "include",
    });
    expect(fetchCredentials).toEqual(["omit", "include"]);
  });

  it("opens and closes a non-active temporary Xueqiu tab when no page is open", async () => {
    let createOptions: any;
    let removedTabId: number | undefined;
    const executeScript = async ({ func, args }: any) => {
      const result = await runInNewContext(`(${func.toString()})(...args)`, {
        URL,
        location: {
          href: "https://xueqiu.com/",
          origin: "https://xueqiu.com",
          protocol: "https:",
          hostname: "xueqiu.com",
        },
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '{"statuses":[{"id":"post-2"}]}',
        }),
        args,
      });
      return [{ result }];
    };
    const { context } = harness({ executeScript });
    context.findXueqiuTab = async () => null;
    context.XUEQIU_HOME = "https://xueqiu.com/";
    context.waitForComplete = async () => true;
    context.getTab = async (id: number) => ({ id, status: "complete", url: "https://xueqiu.com/" });
    context.chrome.runtime = { lastError: null };
    context.chrome.tabs.create = (options: any, callback: (tab: any) => void) => {
      createOptions = options;
      callback({ id: 91, status: "loading" });
    };
    context.chrome.tabs.remove = (id: number, callback: () => void) => {
      removedTabId = id;
      callback();
    };
    context.fetch = async () => ({
      ok: false,
      status: 400,
      headers: { get: () => "" },
      text: async () => '{"error_code":400016,"error_description":"retry in page context"}',
    });
    runInContext(
      slice("function closeTemporaryXueqiuTab", "async function probeBackgroundSession"),
      context,
    );

    const data = await context.fetchXueqiuJson(
      "https://xueqiu.com/statuses/user_timeline.json?user_id=12345&page=1",
      { sessionFallback: true },
    );

    expect(data).toEqual({ statuses: [{ id: "post-2" }] });
    expect(createOptions).toEqual({ url: "https://xueqiu.com/", active: false });
    expect(removedTabId).toBe(91);
  });
});
