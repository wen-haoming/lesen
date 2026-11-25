import { describe, expect, it, vi } from "vitest";
import { applyWeiboTopicResult, collapsedWeiboTopics, createWeiboTopicClient, emptyWeiboTopic, selectWeiboTopic } from "./weibo-topic-state";
import type { WeiboHotItem } from "./weibo-hot";

const items: WeiboHotItem[] = Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, word: `话题${index + 1}`, heat: 100, label: "", url: "" }));
const post = (id: string, userId = "123") => ({ id, userId, authorName: `作者${userId}`, summary: `帖子${id}`, timestamp: 1700000000000 });

describe("微博话题单选", () => {
  it("无全部项，默认第一项且刷新顺序不改变有效选中词", () => {
    expect(selectWeiboTopic(items, "")).toBe("话题1");
    expect(selectWeiboTopic([...items].reverse(), "话题3")).toBe("话题3");
    expect(selectWeiboTopic(items.slice(1), "话题1")).toBe("话题2");
    expect(selectWeiboTopic([], "旧话题")).toBe("");
  });
  it("收起最多六项，榜单外沿选中项仍可见", () => {
    const shown = collapsedWeiboTopics(items, "话题10");
    expect(shown).toHaveLength(6);
    expect(shown.map((item) => item.word)).toEqual(["话题1", "话题2", "话题3", "话题4", "话题5", "话题10"]);
    expect(items[5].word).toBe("话题6");
  });
});

describe("微博话题页状态", () => {
  it("按帖子ID合并去重，保留真实作者与媒体且重复页停止翻页", () => {
    const first = applyWeiboTopicResult(emptyWeiboTopic(), { ok: true, posts: [{ ...post("1"), mediaUrls: ["https://wx1.sinaimg.cn/large/example.jpg"] }], hasMore: true, updatedAt: 1700000000000 }, 1);
    const second = applyWeiboTopicResult(first, { ok: true, posts: [post("1"), post("2", "456")], hasMore: true }, 2);
    expect(second.posts.map((item) => item.id)).toEqual(["1", "2"]);
    expect(second.posts[1].feedName).toBe("作者456");
    expect(second.posts[0].mediaUrls).toEqual(["https://wx1.sinaimg.cn/large/example.jpg"]);
    expect(second.page).toBe(2);
    const duplicate = applyWeiboTopicResult(second, { ok: true, posts: [post("2")], hasMore: true }, 3);
    expect(duplicate.hasMore).toBe(false);
  });
  it("失败保留旧页，标记登录与冷却，不把失败页视作完成", () => {
    const first = applyWeiboTopicResult(emptyWeiboTopic(), { ok: true, posts: [post("1")], hasMore: true }, 1, 1000);
    const failed = applyWeiboTopicResult(first, { ok: false, needsLogin: true }, 2, 2000);
    expect(failed.posts).toEqual(first.posts);
    expect(failed.page).toBe(1);
    expect(failed.needsLogin).toBe(true);
    expect(failed.stale).toBe(true);
    expect(failed.retryAt).toBe(32000);
  });
});

describe("微博话题独立客户端", () => {
  it("共享同话题在途请求，切换后迟到响应只落原话题", async () => {
    let resolveA!: (result: { ok: boolean; posts: unknown[] }) => void;
    const send = vi.fn((message: Record<string, unknown>) => message.word === "甲"
      ? new Promise<{ ok: boolean; posts: unknown[] }>((resolve) => { resolveA = resolve; })
      : Promise.resolve({ ok: true, posts: [post("2")], hasMore: true }));
    const client = createWeiboTopicClient(send);
    const first = client.load("甲", { active: true });
    expect(client.load("甲", { active: true, force: true })).toBe(first);
    await client.load("乙", { active: true });
    expect(client.getSnapshot()["乙"].posts[0].id).toBe("2");
    resolveA({ ok: true, posts: [post("1")] });
    await first;
    expect(send).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()["甲"].posts[0].id).toBe("1");
    expect(client.getSnapshot()["乙"].posts[0].id).toBe("2");
    expect(send).toHaveBeenCalledWith({ type: "POPUP_WEIBO_TOPIC", word: "甲", page: 1, force: false });
  });
  it("inactive禁新请求，失败分页不因多次near-end疯狂重发，允许冷却后手动刷新", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, posts: [post("1")], hasMore: true }).mockResolvedValue({ ok: false, error: "网络失败" });
    const client = createWeiboTopicClient(send);
    await client.load("甲", { active: false, force: true });
    expect(send).not.toHaveBeenCalled();
    await client.load("甲", { active: true });
    await client.load("甲", { active: true, more: true });
    for (let index = 0; index < 5; index++) await client.load("甲", { active: true, more: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()["甲"].posts).toHaveLength(1);
    expect(client.getSnapshot()["甲"].page).toBe(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await client.load("甲", { active: true, more: true });
    expect(send).toHaveBeenCalledTimes(2);
    await client.load("甲", { active: true, force: true });
    expect(send).toHaveBeenCalledTimes(3);
    clock.mockRestore();
  });
});
