import { readFileSync } from "node:fs";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { normalizeWeiboHotItems } from "./weibo-hot";
import { sanitizeFeedPost } from "./sanitize";
import { inspectRisk } from "./platform-request-risk";

const source = readFileSync(new URL("./background-main.js", import.meta.url), "utf8");
const featureSource = source.slice(source.indexOf("const WEIBO_HOT_CACHE_KEY ="), source.indexOf("function isTrustedExtensionPageSender"));
const boardSource = { key: "xueqiu:123", id: "123", platform: "xueqiu", name: "广场作者" };
const hot = { ok: 1, data: { band_list: [{ realpos: 1, word: "测试话题", num: 10 }] } };
const post = { id: "456", userId: "123", timestamp: 123, summary: "正文", url: "javascript:alert(1)" };

function harness(options: { storage?: Record<string, any>; fetchHot?: () => Promise<any>; viaTab?: () => Promise<any>; fetchFeed?: () => Promise<any> } = {}) {
  let now = 1_000_000;
  const store = options.storage || {};
  const writes: any[] = [];
  const fetchHot = vi.fn(options.fetchHot || (async () => hot));
  const viaTab = vi.fn(options.viaTab || (async () => hot));
  const fetchFeed = vi.fn(options.fetchFeed || (async () => ({ ok: true, posts: [post] })));
  const broadcast = vi.fn();
  const context = createContext({
    Date: class extends Date { static now() { return now; } },
    normalizeWeiboHotItems, sanitizeFeedPost, SQUARE_SOURCES: [boardSource,
      { key: "x:tester", id: "tester", platform: "x" },
      { key: "weibo:789", id: "789", platform: "weibo" }],
    chrome: {
      storage: {
        local: {
          async get(keys: string[]) { return Object.fromEntries(keys.map((key) => [key, structuredClone(store[key])])); },
          async set(values: any) { writes.push(structuredClone(values)); Object.assign(store, structuredClone(values)); },
        }
      }
    },
    fetchWeiboJson: fetchHot, fetchWeiboJsonViaTab: viaTab,
    fetchWeiboTimeline: fetchFeed, fetchXTimeline: fetchFeed, fetchTimelineBackground: fetchFeed,
    guardedRequestBackoff: new Map(),
    riskDetails: inspectRisk,
    registerPlatformRisk: async (_platform: string, retry: number) => runInContext(`guardedRequestBackoff.set('weibo', {until: Date.now() + ${Math.max(retry, 300_000)}})`, context),
    broadcast, encodeURIComponent, URL,
  });
  runInContext(featureSource, context);
  return {
    store, writes, fetchHot, viaTab, fetchFeed, broadcast,
    hot: (force = false) => runInContext(`fetchWeiboHot(${force})`, context),
    feed: (key: unknown, force = false) => { context.requestKey = key; return runInContext(`fetchSquareFeed(requestKey, ${force})`, context); },
    advance: (ms: number) => { now += ms; },
  };
}

describe("微博标签页共用请求安全", () => {
  it("在隔离页面读取响应，由后台检测验证码与限频而不依赖页面全局函数", async () => {
    const tabSource = source.slice(source.indexOf("async function fetchWeiboJsonViaTab("), source.indexOf("async function fetchWeiboJson("));
    for (const fixture of [{ status: 200, text: JSON.stringify(hot) },
    { status: 429, text: "too many requests" }, { status: 200, text: "<html>captcha</html>" }]) {
      const context = createContext({
        Date, URL, guardedRequestBackoff: new Map(), findWeiboTab: async () => ({ id: 1 }),
        readWeiboXsrfToken: async () => "token", riskDetails: inspectRisk,
        runGuardedPlatformRequest: async (_platform: string, _url: string, request: () => Promise<any>) => {
          const value = await request();
          return value?.__platformRisk ? { ok: false, platformPause: true, retryAfterMs: 300_000, error: "暂停" } : { ok: true, value };
        },
        chrome: {
          scripting: {
            executeScript: async ({ func, args }: any) => {
              const page = runInNewContext(`(${func.toString()})`, {
                fetch: async () => ({
                  status: fixture.status, ok: fixture.status === 200,
                  text: async () => fixture.text, headers: { get: () => "300" }
                }),
              });
              return [{ result: await page(...args) }];
            }
          }
        },
      });
      runInContext(tabSource, context);
      const request = runInContext('fetchWeiboJsonViaTab("https://weibo.com/ajax/side/hotSearch", "https://weibo.com/")', context);
      if (fixture.text === JSON.stringify(hot)) expect(await request).toEqual(hot);
      else await expect(request).rejects.toMatchObject({ platformPause: true, retryAfterMs: 300_000 });
    }
  });
});

describe("热搜后台缓存与错误合同", () => {
  it("共享并发、持久化独立缓存、普通缓存两分钟且强刷仍受十秒约束", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.hot(), h.hot(true)]);
    expect(a).toEqual(b);
    expect(h.fetchHot).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.writes[0])).toEqual(["weiboHotCache"]);
    h.advance(9_000);
    expect(await h.hot(true)).toMatchObject({ ok: true, cached: true, retryAfterMs: 1000 });
    h.advance(1000);
    expect(await h.hot()).toMatchObject({ ok: true, cached: true });
    expect(h.fetchHot).toHaveBeenCalledTimes(1);
    await h.hot(true);
    expect(h.fetchHot).toHaveBeenCalledTimes(2);
    h.advance(120_000);
    await h.hot();
    expect(h.fetchHot).toHaveBeenCalledTimes(3);
  });

  it("失败保留上次成功榜与时点，空榜不覆盖为成功且重启后仍限频", async () => {
    let fail = false;
    const h = harness({ fetchHot: async () => fail ? { ok: 1, data: { band_list: [] } } : hot });
    const first = await h.hot();
    h.advance(120_000);
    fail = true;
    const failure = await h.hot();
    expect(failure).toMatchObject({ ok: false, stale: true, items: first.items, updatedAt: first.updatedAt });
    expect(h.store.weiboHotCache.items).toEqual(first.items);
    await h.hot(true);
    expect(h.fetchHot).toHaveBeenCalledTimes(2);
    const restart = harness({ storage: h.store });
    expect(await restart.hot(true)).toMatchObject({ ok: false });
    expect(restart.fetchHot).not.toHaveBeenCalled();
  });

  it("限频、验证码与暂停不可通过标签页绕过", async () => {
    for (const fetchHot of [
      async () => { throw Object.assign(new Error("暂停"), { platformPause: true, retryAfterMs: 300_000 }); },
      async () => { throw Object.assign(new Error("限频"), { retryAfterMs: 5000 }); },
      async () => ({ ok: -100, message: "请完成验证码" }),
      async () => ({ ok: 0, code: 429, message: "too many requests" }),
    ]) {
      const h = harness({ fetchHot });
      expect(await h.hot()).toMatchObject({ ok: false, items: [], updatedAt: 0 });
      expect(h.viaTab).not.toHaveBeenCalled();
      await h.hot(true);
      expect(h.fetchHot).toHaveBeenCalledTimes(1);
    }
  });

  it("仅非风险登录错误和格式错误允许标签页回退，登录失败明确标示", async () => {
    const h = harness({ fetchHot: async () => ({ ok: -100 }) });
    expect(await h.hot()).toMatchObject({ ok: true });
    expect(h.viaTab).toHaveBeenCalledTimes(1);
    const login = harness({ fetchHot: async () => ({ ok: -100 }), viaTab: async () => ({ ok: -100 }) });
    expect(await login.hot()).toMatchObject({ ok: false, needsLogin: true, updatedAt: 0 });
    const nonJson = harness({ fetchHot: async () => { throw new Error("NON_JSON"); } });
    expect(await nonJson.hot()).toMatchObject({ ok: true });
    const network = harness({ fetchHot: async () => { throw new Error("网络异常 javascript:alert(1)"); } });
    expect(await network.hot()).toMatchObject({ ok: false, error: "微博热搜暂不可用，请稍后重试" });
    expect(network.viaTab).not.toHaveBeenCalled();
  });

  it("重读持久化榜单时清理不可信跳转并拒绝未来更新时间", async () => {
    const items = [{ rank: 1, word: "缓存话题", heat: 3, label: "<img>", url: "https://evil.test" }];
    const h = harness({ storage: { weiboHotCache: { items, updatedAt: 999_000 } } });
    expect(await h.hot()).toMatchObject({ ok: true, cached: true, items: [{ url: "https://s.weibo.com/weibo?q=%E7%BC%93%E5%AD%98%E8%AF%9D%E9%A2%98", label: "" }] });
    expect(h.fetchHot).not.toHaveBeenCalled();
    const future = harness({ storage: { weiboHotCache: { items, updatedAt: 9_999_999 } } });
    await future.hot();
    expect(future.fetchHot).toHaveBeenCalledTimes(1);
  });
});

describe("广场后台白名单、数据安全与订阅隔离", () => {
  it("拒绝未知、伪造与非字符串 feedKey，不发请求", async () => {
    const h = harness();
    for (const key of ["xueqiu:999", "__proto__", "https://evil.test", "xueqiu:123?uid=999", "weibo:123", null, {}, 123]) {
      expect(await h.feed(key)).toMatchObject({ ok: false, posts: [], updatedAt: 0 });
    }
    expect(h.fetchFeed).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("按源共享并发与独立缓存，不写订阅和个人阅读状态、不广播", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.feed(boardSource.key), h.feed(boardSource.key)]);
    expect(a).toEqual(b);
    expect(h.fetchFeed).toHaveBeenCalledTimes(1);
    expect(a.posts[0]).toMatchObject({ url: "https://xueqiu.com/123/456", feedKey: boardSource.key, feedName: "广场作者" });
    expect(Object.keys(h.writes[0])).toEqual(["squareFeedCache:xueqiu:123"]);
    await h.feed(boardSource.key);
    expect(h.fetchFeed).toHaveBeenCalledTimes(1);
    await h.feed("x:tester");
    expect(h.fetchFeed).toHaveBeenCalledTimes(2);
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.store.sources).toBeUndefined();
    expect(h.store.timelines).toBeUndefined();
    expect(h.store.authorReadAt).toBeUndefined();
  });

  it("跨作者和恶意路径被丢弃、去重，失败返回旧内容与原更新时间", async () => {
    let fail = false;
    const quotedPost = { ...post, quoted: { authorName: "引用作者", text: "引用正文", url: "javascript://weibo.com/alert(1)" } };
    const h = harness({
      fetchFeed: async () => fail ? { ok: false, error: "敏感服务详情" } :
        { ok: true, posts: [quotedPost, post, { ...post, id: "789", userId: "999" }, { ...post, id: "../login" }] }
    });
    const first = await h.feed(boardSource.key);
    expect(first.posts).toHaveLength(1);
    expect(first.posts[0].quoted.url).toBe("");
    h.advance(120_000);
    fail = true;
    expect(await h.feed(boardSource.key)).toMatchObject({ ok: false, stale: true, posts: first.posts, updatedAt: first.updatedAt, error: "广场内容暂不可用，请稍后重试" });
    expect(h.store["squareFeedCache:xueqiu:123"].updatedAt).toBe(first.updatedAt);
  });

  it("全无效内容不能缓存为空榜成功", async () => {
    const h = harness({ fetchFeed: async () => ({ ok: true, posts: [{ ...post, userId: "999" }] }) });
    expect(await h.feed(boardSource.key)).toMatchObject({ ok: false, posts: [], updatedAt: 0 });
    expect(h.writes[0]["squareFeedCache:xueqiu:123"]).toMatchObject({ failure: true, updatedAt: 0, posts: [] });
  });

  it("精选支持强刷且失败保留冷却与底层限频时间", async () => {
    const h = harness();
    await h.feed(boardSource.key);
    h.advance(30_000);
    await h.feed(boardSource.key, true);
    expect(h.fetchFeed).toHaveBeenCalledTimes(2);
    await h.feed(boardSource.key, true);
    expect(h.fetchFeed).toHaveBeenCalledTimes(2);
    const failed = harness({ fetchFeed: async () => ({ ok: false, retryAfterMs: 300_000, platformPause: true }) });
    expect(await failed.feed(boardSource.key)).toMatchObject({ ok: false, retryAfterMs: 300_000 });
    await failed.feed(boardSource.key, true);
    expect(failed.fetchFeed).toHaveBeenCalledTimes(1);
    const restarted = harness({ storage: failed.store });
    await restarted.feed(boardSource.key, true);
    expect(restarted.fetchFeed).not.toHaveBeenCalled();
  });
});
