import { describe, expect, it, vi } from "vitest";
import {
  applyXueqiuHotResult,
  collapsedXueqiuTopics,
  createXueqiuHotClient,
  createXueqiuTopicClient,
  emptyXueqiuHot,
  normalizeXueqiuTopicPosts,
  selectXueqiuTopic,
  type XueqiuHotItem,
} from "./xueqiu-topic-state";

const items: XueqiuHotItem[] = Array.from({ length: 10 }, (_, index) => ({
  rank: index + 1,
  word: `话题${index + 1}`,
  heat: `${(10 - index) * 100}万`,
  label: "",
  url: "https://xueqiu.com/",
}));
const post = (id: string, userId = "123") => ({
  id,
  userId,
  authorName: `作者${userId}`,
  authorAvatar: "https://xavatar.imedao.com/avatar.jpg",
  summary: `帖子${id}`,
  timestamp: 1700000000000,
  mediaUrls: ["https://xavatar.imedao.com/post.jpg"],
});

describe("雪球话题单选", () => {
  it("无全部项，默认第一项并保留仍有效的上次话题", () => {
    expect(selectXueqiuTopic(items, "")).toBe("话题1");
    expect(selectXueqiuTopic([...items].reverse(), "话题3")).toBe("话题3");
    expect(selectXueqiuTopic(items.slice(1), "话题1")).toBe("话题2");
    expect(selectXueqiuTopic([], "旧话题")).toBe("");
  });

  it("默认收起为六项两行，榜单外选中项仍显示", () => {
    const shown = collapsedXueqiuTopics(items, "话题10");
    expect(shown).toHaveLength(6);
    expect(shown.map((item) => item.word)).toEqual([
      "话题1",
      "话题2",
      "话题3",
      "话题4",
      "话题5",
      "话题10",
    ]);
    expect(items[5].word).toBe("话题6");
  });
});

describe("雪球热搜资源", () => {
  it("保留API热度原值及榜单说明字段，失败时保留旧榜单并冷却", () => {
    const first = applyXueqiuHotResult(emptyXueqiuHot(), {
      ok: true,
      updatedAt: 1700000000000,
      items: [
        {
          ...items[0],
          heat: "1.23万",
          statusCount: 321,
          summary: "公司公告",
          stocks: ["SH600000"],
        },
      ],
    });
    expect(first.items[0]).toMatchObject({
      heat: "1.23万",
      statusCount: 321,
      summary: "公司公告",
      stocks: ["SH600000"],
    });
    const failed = applyXueqiuHotResult(
      first,
      { ok: false, error: "请求失败", retryAfterMs: 5000 },
      1000,
    );
    expect(failed.items).toEqual(first.items);
    expect(failed.stale).toBe(true);
    expect(failed.retryAt).toBe(6000);
  });

  it("inactive时不发送热搜请求，实时加载传递代理消息类型", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, items, updatedAt: 1700000000000 });
    const client = createXueqiuHotClient(send);
    await client.load({ active: false, force: true });
    expect(send).not.toHaveBeenCalled();
    await client.load({ active: true });
    expect(send).toHaveBeenCalledWith({ type: "POPUP_XUEQIU_HOT", force: false });
    expect(client.getSnapshot().items).toHaveLength(10);
  });
});

describe("雪球话题帖子分页", () => {
  it("使用真实作者feedKey，保留头像媒体并按帖子去重", () => {
    const normalized = normalizeXueqiuTopicPosts([post("1"), post("1"), post("2", "456")]);
    expect(normalized.map((item) => item.id)).toEqual(["1", "2"]);
    expect(normalized[0]).toMatchObject({
      feedKey: "xueqiu:123",
      feedName: "作者123",
      feedPlatform: "xueqiu",
      authorAvatar: "https://xavatar.imedao.com/avatar.jpg",
      mediaUrls: ["https://xavatar.imedao.com/post.jpg"],
    });
    expect(normalized[1].feedKey).toBe("xueqiu:456");
  });

  it("按页请求并合并去重，错误保留旧帖子且阻止重复翻页", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        page: 1,
        posts: [post("1")],
        hasMore: true,
        updatedAt: 1700000000000,
      })
      .mockResolvedValueOnce({
        ok: true,
        page: 2,
        posts: [post("1"), post("2", "456")],
        hasMore: true,
      })
      .mockResolvedValueOnce({ ok: false, error: "网络失败", retryAfterMs: 5000 });
    const client = createXueqiuTopicClient(send);
    await client.load("话题甲", { active: false, force: true });
    expect(send).not.toHaveBeenCalled();
    await client.load("话题甲", { active: true });
    await client.load("话题甲", { active: true, more: true });
    const second = client.getSnapshot()["话题甲"];
    expect(second.posts.map((item) => item.id)).toEqual(["1", "2"]);
    expect(second.posts[1].feedKey).toBe("xueqiu:456");
    expect(second.page).toBe(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "POPUP_XUEQIU_TOPIC",
      word: "话题甲",
      page: 1,
      force: false,
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "POPUP_XUEQIU_TOPIC",
      word: "话题甲",
      page: 2,
      force: false,
    });

    await client.load("话题甲", { active: true, more: true });
    await client.load("话题甲", { active: true, more: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(client.getSnapshot()["话题甲"].posts).toEqual(second.posts);
    expect(client.getSnapshot()["话题甲"].page).toBe(2);
    expect(client.getSnapshot()["话题甲"].stale).toBe(true);
  });

  it("并发话题请求相互隔离，切换后迟到响应只写回原话题", async () => {
    let resolveA!: (result: { ok: boolean; posts: unknown[] }) => void;
    const send = vi.fn((message: Record<string, unknown>) =>
      message.word === "甲"
        ? new Promise<{ ok: boolean; posts: unknown[] }>((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve({ ok: true, posts: [post("2")], hasMore: true }),
    );
    const client = createXueqiuTopicClient(send);
    const first = client.load("甲", { active: true });
    expect(client.load("甲", { active: true, force: true })).toBe(first);
    await client.load("乙", { active: true });
    expect(client.getSnapshot()["乙"].posts[0].id).toBe("2");
    resolveA({ ok: true, posts: [post("1")] });
    await first;
    expect(client.getSnapshot()["甲"].posts[0].id).toBe("1");
    expect(client.getSnapshot()["乙"].posts[0].id).toBe("2");
  });
});
