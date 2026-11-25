import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  createXueqiuHotService,
  normalizeXueqiuTopicPost,
  parseXueqiuHotData,
  parseXueqiuTopicData,
  validXueqiuTopicParams,
  xueqiuHotUrl,
  xueqiuTopicUrl,
} from "./xueqiu-hot";

const word = "雪球热点 & #话题";
const hotResponse = () => ({
  code: 200,
  success: true,
  data: [
    {
      id: "dG9waWMtMQ==",
      title: word,
      content: "话题介绍",
      reason: "热度值 210.5万",
      statusCount: 131,
      stocks: [
        { code: "00700", name: "腾讯控股" },
        { code: "AAPL", name: "苹果" },
      ],
    },
  ],
});
const status = (id: string, userId: string, author: string) => ({
  id,
  user_id: userId,
  user: {
    screen_name: author,
    profile_image_url: "community/202211/avatar.jpg,community/202211/avatar.jpg!50x50.png",
    photo_domain: "http://xavatar.imedao.com/",
  },
  text: "<b>真实正文</b>",
  description: "描述优先",
  created_at: "1700000000000",
  like_count: 21,
  reply_count: 4,
  retweet_count: 3,
  pic: ["https://img.xueqiu.com/pic.jpg"],
});
const topicResponse = (page = 1, list = [status("456", "12345", "真实作者")]) => ({
  list,
  count: 131,
  maxPage: 17,
  page,
});

function harness() {
  let now = 1_000_000;
  const store: Record<string, any> = {};
  const request = vi.fn(async (url: string): Promise<unknown> =>
    url.includes("/rich_tag.json") ? hotResponse() : topicResponse(),
  );
  const service = () =>
    createXueqiuHotService({
      request,
      readCache: async (key) => store[key],
      writeCache: async (key, value) => {
        store[key] = structuredClone(value);
      },
      now: () => now,
    });
  return {
    service: service(),
    restart: service,
    request,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("雪球热搜接口解析", () => {
  it("构造固定雪球 API 地址并完整编码话题分页参数", () => {
    expect(xueqiuHotUrl()).toBe(
      "https://api.xueqiu.com/query/v1/hot_event/rich_tag.json?size=10",
    );
    const url = new URL(xueqiuTopicUrl(word, 2));
    expect(url.hostname).toBe("www.xueqiu.com");
    expect(url.pathname).toBe("/query/v1/hot_event/search.json");
    expect(url.searchParams.get("count")).toBe("10");
    expect(url.searchParams.get("sort")).toBe("time");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("q")).toBe(word);
    expect(xueqiuTopicUrl(word, 1)).toContain("&q=" + encodeURIComponent(word));
  });

  it("解析真实榜单字段并仅生成雪球话题链接", () => {
    const items = parseXueqiuHotData(hotResponse());
    expect(items).toEqual([
      {
        rank: 1,
        word,
        heat: 2_105_000,
        heatLabel: "210.5万",
        label: "热度值 210.5万",
        url: "https://www.xueqiu.com/hashtag/dG9waWMtMQ%3D%3D",
        statusCount: 131,
        summary: "话题介绍",
        stocks: ["腾讯控股", "苹果"],
      },
    ]);
    expect(new URL(items[0].url).hostname).toBe("www.xueqiu.com");
    expect(items[0].heatLabel).toBe("210.5万");
    expect(() => parseXueqiuHotData({ code: 200, success: false, data: [] })).toThrow();
    expect(() =>
      parseXueqiuHotData({ code: 200, success: true, data: [{ id: "../bad", title: "<script>" }] }),
    ).toThrow();
  });

  it("拒绝无效话题词或分页参数", () => {
    for (const input of [
      { word: "" },
      { word: " " + word },
      { word: "<script>" },
      { word: "bad\u0001word" },
      { word, page: 0 },
      { word, page: 1.5 },
      { word, page: "2" },
      { word, page: Infinity },
      { word, force: 1 },
    ])
      expect(validXueqiuTopicParams(input)).toBe(false);
    expect(validXueqiuTopicParams({ word, page: 2, force: true })).toBe(true);
  });

  it("保留每篇帖子真实作者 UID、作者信息、互动数与媒体", () => {
    const result = parseXueqiuTopicData(
      topicResponse(1, [status("456", "12345", "第一作者"), status("789", "67890", "第二作者")]),
      1,
    );
    expect(result.hasMore).toBe(true);
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].authorAvatar).toBe(
      "https://xavatar.imedao.com/community/202211/avatar.jpg",
    );
    expect(result.posts[0]).toMatchObject({
      id: "456",
      userId: "12345",
      authorName: "第一作者",
      authorAvatar: "https://xavatar.imedao.com/community/202211/avatar.jpg",
      title: "描述优先",
      summary: "描述优先",
      timestamp: 1_700_000_000_000,
      likeCount: 21,
      replyCount: 4,
      retweetCount: 3,
      url: "https://xueqiu.com/12345/456",
      mediaUrls: ["https://img.xueqiu.com/pic.jpg"],
    });
    expect(result.posts[1]).toMatchObject({ userId: "67890", authorName: "第二作者" });
    expect(normalizeXueqiuTopicPost({ ...status("../bad", "12345", "坏帖") })).toBeNull();
    const unsafeAvatar = {
      ...status("999", "12345", "作者"),
      user: { ...status("999", "12345", "作者").user, photo_domain: "https://evil.invalid/" },
    };
    expect(normalizeXueqiuTopicPost(unsafeAvatar)?.authorAvatar ?? "").toBe("");
    expect(parseXueqiuTopicData(topicResponse(17, []), 17)).toEqual({ posts: [], hasMore: false });
    expect(() =>
      parseXueqiuTopicData({ list: [{ id: "1", user_id: "not-a-uid" }], maxPage: 2 }, 1),
    ).toThrow();
  });
});

describe("雪球热搜与话题缓存", () => {
  it("只接受真实热搜词，合并并发请求并按话题和页独立缓存", async () => {
    const h = harness();
    expect(await h.service.topic({ word: "任意搜索词" })).toMatchObject({
      ok: false,
      posts: [],
      error: "话题不在当前雪球热搜榜单中",
    });
    expect(h.request).not.toHaveBeenCalled();
    const hotA = h.service.hot();
    const hotB = h.service.hot(true);
    expect(hotA).toBe(hotB);
    await hotA;
    const topicA = h.service.topic({ word });
    const topicB = h.service.topic({ word, force: true });
    expect(topicA).toBe(topicB);
    expect(await topicA).toMatchObject({
      ok: true,
      page: 1,
      hasMore: true,
      posts: [{ userId: "12345" }],
    });
    expect(await h.service.topic({ word })).toMatchObject({ ok: true, cached: true });
    expect(await h.service.topic({ word, page: 2 })).toMatchObject({ ok: true, page: 2 });
    expect(h.request).toHaveBeenCalledTimes(3);
    expect(h.request.mock.calls[1][0]).toBe(xueqiuTopicUrl(word, 1));
    expect(h.request.mock.calls[2][0]).toBe(xueqiuTopicUrl(word, 2));
    expect(Object.keys(h.store).sort()).toEqual(
      [
        `xueqiuHotCache`,
        `xueqiuTopicCache:${encodeURIComponent(word)}:1`,
        `xueqiuTopicCache:${encodeURIComponent(word)}:2`,
      ].sort(),
    );
  });

  it("限制强刷间隔、两分钟缓存期并保留失败前的帖子", async () => {
    const h = harness();
    await h.service.hot();
    const initial = await h.service.topic({ word });
    h.advance(9_000);
    expect(await h.service.topic({ word, force: true })).toMatchObject({
      ok: true,
      cached: true,
      retryAfterMs: 1000,
    });
    expect(h.request).toHaveBeenCalledTimes(2);
    h.advance(111_000);
    h.request.mockRejectedValueOnce(
      Object.assign(new Error("雪球接口失败"), { retryAfterMs: 90_000 }),
    );
    const failed = await h.service.topic({ word, force: true });
    expect(failed).toMatchObject({
      ok: false,
      posts: initial.posts,
      updatedAt: initial.updatedAt,
      stale: true,
      retryAfterMs: 90_000,
    });
    const restarted = h.restart();
    expect(await restarted.topic({ word, force: true })).toMatchObject({
      ok: false,
      stale: true,
      cached: true,
      retryAfterMs: 90_000,
    });
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it("为匿名登录拒绝明确提示并实施失败冷却", async () => {
    const h = harness();
    await h.service.hot();
    h.request.mockRejectedValueOnce(
      Object.assign(new Error("请先登录雪球后重试"), { needsLogin: true }),
    );
    const failed = await h.service.topic({ word });
    expect(failed).toMatchObject({
      ok: false,
      error: "请先登录雪球后重试",
      needsLogin: true,
      retryAfterMs: 30_000,
    });
    expect(await h.restart().topic({ word, force: true })).toMatchObject({
      ok: false,
      needsLogin: true,
      retryAfterMs: 30_000,
    });
    expect(h.request).toHaveBeenCalledTimes(2);
  });
});

describe("雪球热搜后台接线", () => {
  it("调用既有匿名安全请求链，按真实作者 UID 归一化且不触碰个人时间线", async () => {
    const source = readFileSync(new URL("./background-main.js", import.meta.url), "utf8");
    const start = source.indexOf("let xueqiuHotService = null;");
    const end = source.indexOf("function normalizeSquarePosts", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const storage: Record<string, any> = {};
    const calls: string[] = [];
    const request = vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes("/rich_tag.json")
        ? hotResponse()
        : topicResponse(1, [status("456", "54321", "真实作者")]);
    });
    const context = createContext({
      Date,
      URL,
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
      encodeURIComponent,
      createXueqiuHotService,
      fetchXueqiuJson: request,
      riskDetails: () => null,
      registerPlatformRisk: vi.fn(),
      guardedRequestBackoff: new Map(),
      chrome: {
        storage: {
          local: {
            get: async (keys: string[]) =>
              Object.fromEntries(keys.map((key) => [key, storage[key]])),
            set: async (values: Record<string, unknown>) => {
              Object.assign(storage, values);
            },
          },
        },
      },
    });
    runInContext(source.slice(start, end), context);
    await context.fetchXueqiuHot(false);
    const result = await context.fetchXueqiuTopic({ word, page: 1 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      posts: [{ userId: "54321", authorName: "真实作者" }],
    });
    expect(calls[0]).toMatch(/^https:\/\/api\.xueqiu\.com\/query\/v1\/hot_event\/rich_tag\.json\?size=10&_=[0-9]+$/);
    expect(calls[1]).toBe(xueqiuTopicUrl(word, 1));
    expect(request.mock.calls.every((call) => call[1]?.sessionFallback === true)).toBe(true);
    expect(source.slice(start, end)).not.toMatch(
      /broadcast|authorReadAt|selectedUserId|timelines|fetchTimelineBackground/,
    );
    expect(source).toContain(
      'if (message.type === "POPUP_XUEQIU_HOT" || message.type === "POPUP_XUEQIU_TOPIC")',
    );
    expect(source).toContain("sender?.id === chrome.runtime.id");
  });

  it("把匿名接口的雪球登录拒绝转换成明确提示", async () => {
    const source = readFileSync(new URL("./background-main.js", import.meta.url), "utf8");
    const start = source.indexOf("let xueqiuHotService = null;");
    const end = source.indexOf("function normalizeSquarePosts", start);
    const storage: Record<string, any> = {};
    const context = createContext({
      Date,
      URL,
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
      encodeURIComponent,
      createXueqiuHotService,
      fetchXueqiuJson: async () => {
        throw new Error("请先登录雪球后重试");
      },
      riskDetails: () => null,
      registerPlatformRisk: vi.fn(),
      guardedRequestBackoff: new Map(),
      chrome: {
        storage: {
          local: {
            get: async (keys: string[]) =>
              Object.fromEntries(keys.map((key) => [key, storage[key]])),
            set: async (values: Record<string, unknown>) => {
              Object.assign(storage, values);
            },
          },
        },
      },
    });
    runInContext(source.slice(start, end), context);
    expect(await context.fetchXueqiuHot(false)).toMatchObject({
      ok: false,
      error: "请先登录雪球后重试",
      needsLogin: true,
    });
  });
});
