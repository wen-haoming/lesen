import { describe, expect, it, vi } from "vitest";
import {
  applySquareResult, createSquareClient, emptySquareResource, formatSquareError, safeWeiboHotUrl,
  WEIBO_HOT_RESOURCE, DEMO_WEIBO_HOT_ITEMS, type SquareResource, type SquareResult,
} from "./square-data";

const item = { rank: 1, word: "测试话题", heat: 100, label: "热", url: "https://s.weibo.com/weibo?q=test" };

function deferred() {
  let resolve!: (result: SquareResult) => void;
  const promise = new Promise<SquareResult>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("广场独立请求", () => {
  it("隐藏视图不请求，同一资源并发去重，已尝试的资源不循环自动请求", async () => {
    const request = deferred();
    const send = vi.fn(() => request.promise);
    const change = vi.fn();
    const client = createSquareClient(send, change);
    await client.load("x:OpenAI", { active: false });
    expect(send).not.toHaveBeenCalled();
    const first = client.load("x:OpenAI", { active: true });
    const duplicate = client.load("x:OpenAI", { active: true, force: true });
    expect(first).toBe(duplicate);
    await Promise.resolve();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "POPUP_SQUARE_FEED", feedKey: "x:OpenAI", force: false });
    request.resolve({ ok: true, posts: [], updatedAt: Date.now() });
    await first;
    await client.load("x:OpenAI", { active: true });
    expect(send).toHaveBeenCalledTimes(1);
    await client.load("x:OpenAI", { active: true, force: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("切平台时晚到的旧响应只写原资源，完全独立于 reader 的私人状态", async () => {
    const x = deferred();
    const hot = deferred();
    let state: Record<string, SquareResource> = {};
    const client = createSquareClient((message) => message.type === "POPUP_WEIBO_HOT" ? hot.promise : x.promise, (next) => { state = next; });
    const xPending = client.load("x:OpenAI", { active: true });
    const hotPending = client.load(WEIBO_HOT_RESOURCE, { active: true });
    hot.resolve({ ok: true, items: [item], updatedAt: 200 });
    await hotPending;
    x.resolve({ ok: true, posts: [{ id: "x-post" }], updatedAt: 100 });
    await xPending;
    expect(state[WEIBO_HOT_RESOURCE].items).toEqual([item]);
    expect(state[WEIBO_HOT_RESOURCE].posts).toEqual([]);
    expect(state["x:OpenAI"].posts).toEqual([{ id: "x-post" }]);
    expect(Object.keys(state)).toEqual(["x:OpenAI", WEIBO_HOT_RESOURCE]);
  });

  it("手动刷新热搜带 force，失败保留旧结果，显示登录与限流状态并遵守冷却", async () => {
    let state: Record<string, SquareResource> = {};
    const send = vi.fn().mockResolvedValueOnce({ ok: true, items: [item], updatedAt: 123 })
      .mockResolvedValueOnce({ ok: false, items: [], error: "需要登录", needsLogin: true, retryAfterMs: 60000 });
    const client = createSquareClient(send, (next) => { state = next; });
    await client.load(WEIBO_HOT_RESOURCE, { active: true });
    expect(send).toHaveBeenNthCalledWith(1, { type: "POPUP_WEIBO_HOT", force: false });
    await client.load(WEIBO_HOT_RESOURCE, { active: true, force: true });
    expect(send).toHaveBeenNthCalledWith(2, { type: "POPUP_WEIBO_HOT", force: true });
    expect(state[WEIBO_HOT_RESOURCE]).toMatchObject({ items: [item], updatedAt: 123, stale: true, needsLogin: true, error: "需要登录", loading: false });
    await client.load(WEIBO_HOT_RESOURCE, { active: true, force: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("请求抛错后解除 loading，允许手动重试", async () => {
    let state: Record<string, SquareResource> = {};
    const send = vi.fn().mockRejectedValueOnce(new Error("网络异常")).mockResolvedValueOnce({ ok: true, posts: [], updatedAt: 123 });
    const client = createSquareClient(send, (next) => { state = next; });
    await client.load("x:OpenAI", { active: true });
    expect(state["x:OpenAI"].loading).toBe(false);
    expect(state["x:OpenAI"].error).toBeTruthy();
    await client.load("x:OpenAI", { active: true, force: true });
    expect(state["x:OpenAI"].error).toBe("");
  });
});

describe("广场缓存和安全数据", () => {
  it("初次失败可以接受后台明确标记的旧缓存，刷新成功清除错误", () => {
    const stale = applySquareResult(emptySquareResource(), { ok: false, stale: true, items: [item], updatedAt: 123, cached: true, error: "暂不可用" });
    expect(stale).toMatchObject({ items: [item], stale: true, cached: true, updatedAt: 123 });
    expect(applySquareResult(stale, { ok: false, stale: true, items: [], updatedAt: 456 })).toMatchObject({ items: [item], updatedAt: 123 });
    expect(applySquareResult(stale, { ok: true, items: [], updatedAt: 456 })).toMatchObject({ items: [], stale: false, cached: false, error: "", updatedAt: 456 });
  });

  it("只允许安全的微博 HTTPS 跳转，禁止脚本、伪域名和凭据 URL", () => {
    expect(safeWeiboHotUrl(item.url)).toBe(item.url);
    for (const url of ["javascript:alert(1)", "http://weibo.com/a", "https://weibo.com.evil.test/a", "https://evil.test/a", "https://user:developer@example.invalid/a", "//weibo.com/a"]) {
      expect(safeWeiboHotUrl(url)).toBe("");
    }
    const cleaned = applySquareResult(emptySquareResource(), { ok: true, items: [{ ...item, url: "javascript:alert(1)" }] });
    expect(cleaned.items[0].url).toBe("");
  });

  it("样例热搜逐条标注演示话题且没有伪实时链接", () => {
    expect(DEMO_WEIBO_HOT_ITEMS.length).toBeGreaterThan(0);
    expect(DEMO_WEIBO_HOT_ITEMS.every((entry) => entry.word.startsWith("演示话题：") && !entry.url)).toBe(true);
  });

  it("将底层英文网络异常转为用户可读中文说明", () => {
    expect(formatSquareError("fetch failed")).toBe("网络请求失败，无法连接平台榜单接口。");
    expect(formatSquareError("Request timed out")).toBe("请求超时，请稍后重试。");
    expect(formatSquareError("服务繁忙")).toBe("服务繁忙。");
  });
});
