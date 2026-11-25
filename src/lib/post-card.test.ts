import { describe, expect, it } from "vitest";
import { classifyPostCard, isVideoUrl, parseReplyHandle, sanitizeMediaUrls } from "./post-card";
import { sanitizeFeedPost, type Post } from "./sanitize";

function basePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "1",
    userId: "10001",
    authorName: "订阅甲",
    title: "标题",
    summary: "",
    timestamp: 1_700_000_000_000,
    timeText: "",
    source: "",
    url: "https://xueqiu.com/10001/1",
    isRetweet: false,
    likeCount: 0,
    replyCount: 0,
    retweetCount: 0,
    quoted: null,
    ...overrides,
  };
}

describe("classifyPostCard", () => {
  it("maps plain retweet to weak hint + embedded original", () => {
    const card = classifyPostCard(
      basePost({
        isRetweet: true,
        summary: "",
        title: "转发动态",
        quoted: { authorName: "原作者", text: "原帖正文", url: "", likeCount: 0 },
      }),
    );
    expect(card.kind).toBe("retweet");
    expect(card.hint).toBe("订阅甲 转发了");
    expect(card.body).toBe("");
    expect(card.embed?.text).toBe("原帖正文");
    expect(card.embed?.unavailable).toBe(false);
  });

  it("maps quote-with-comment to body + nested original", () => {
    const card = classifyPostCard(
      basePost({
        isRetweet: true,
        summary: "我的点评",
        quoted: { authorName: "原作者", text: "被引用内容", url: "", likeCount: 0 },
      }),
    );
    expect(card.kind).toBe("quote");
    expect(card.body).toBe("我的点评");
    expect(card.embed?.authorName).toBe("原作者");
    expect(card.embed?.text).toBe("被引用内容");
  });

  it("maps reply with @ and nested context", () => {
    const card = classifyPostCard(
      basePost({
        summary: "回复 @某人：同意这个判断",
        quoted: { authorName: "某人", text: "上下文原帖", url: "", likeCount: 0 },
      }),
    );
    expect(card.kind).toBe("reply");
    expect(card.replyLabel).toBe("回复 @某人");
    expect(card.body).toBe("同意这个判断");
    expect(card.embed?.text).toBe("上下文原帖");
  });

  it("shows unavailable original without inventing text", () => {
    const card = classifyPostCard(
      basePost({
        summary: "回复 @某人：先记下",
        replyToHandle: "某人",
        quoteMissing: true,
        quoted: null,
      }),
    );
    expect(card.kind).toBe("reply");
    expect(card.embed?.unavailable).toBe(true);
    expect(card.embed?.text).toBe("");
  });

  it("does not invent media when absent", () => {
    const card = classifyPostCard(basePost({ summary: "只有文字" }));
    expect(card.kind).toBe("original");
    expect(card.mediaUrls).toEqual([]);
    expect(card.embed).toBeNull();
  });

  it("keeps every main and quoted media item beyond nine", () => {
    const mediaUrls = Array.from({ length: 12 }, (_, index) => `https://cdn.example/${index}.jpg`);
    const card = classifyPostCard(
      basePost({
        summary: "带图帖子",
        mediaUrls,
        quoted: { authorName: "引用作者", text: "原帖", url: "", likeCount: 0, mediaUrls },
      }),
    );
    expect(card.mediaUrls).toHaveLength(12);
    expect(card.embed?.mediaUrls).toHaveLength(12);
  });
});

describe("sanitizeFeedPost media / reply / summary length", () => {
  it("retains quoted media even when quote text and author are unavailable", () => {
    const post = sanitizeFeedPost(
      {
        id: "900010",
        userId: "10001",
        summary: "转发一条带媒体的帖子",
        timestamp: 1_700_000_000_000,
        quoted: { mediaUrls: ["https://cdn.example/quoted.jpg"] },
      },
      "xueqiu:10001",
    );
    const card = classifyPostCard(post!);
    expect(card.embed?.unavailable).toBe(false);
    expect(card.embed?.mediaUrls).toEqual(["https://cdn.example/quoted.jpg"]);
  });

  it("passes mediaUrls and replyToHandle for xueqiu", () => {
    const post = sanitizeFeedPost(
      {
        id: "900002",
        userId: "10001",
        title: "demo",
        summary: "回复 @大道：长文" + "字".repeat(200),
        timestamp: 1_700_000_000_000,
        url: "https://xueqiu.com/10001/900002",
        mediaUrls: [
          "https://xqimg.imedao.com/a.jpg",
          "not-a-url",
          "https://xqimg.imedao.com/b.jpg",
        ],
        replyToHandle: "大道",
        quoted: { authorName: "大道", text: "原帖", url: "https://xueqiu.com/2/3" },
      },
      "xueqiu:10001",
    );
    expect(post?.mediaUrls).toEqual([
      "https://xqimg.imedao.com/a.jpg",
      "https://xqimg.imedao.com/b.jpg",
    ]);
    expect(post?.replyToHandle).toBe("大道");
    expect(post?.summary.length).toBeGreaterThan(160);
    expect(post?.quoted?.text).toBe("原帖");
  });

  it("normalizes object-shaped X reply targets and drops legacy object strings", () => {
    const normalized = sanitizeFeedPost(
      {
        id: "800010",
        summary: "A reply body",
        timestamp: 1_700_000_000_000,
        url: "https://x.com/tibo/status/800010",
        replyToHandle: { user: { screen_name: "karpathy" } },
      },
      "x:tibo",
    );
    const legacy = sanitizeFeedPost(
      {
        id: "800011",
        summary: "A reply body",
        timestamp: 1_700_000_000_000,
        url: "https://x.com/tibo/status/800011",
        replyToHandle: "[object Object]",
      },
      "x:tibo",
    );

    expect(normalized?.replyToHandle).toBe("karpathy");
    expect(legacy?.replyToHandle).toBeUndefined();
    expect(classifyPostCard(legacy!).replyLabel).toBe("");
  });

  it("marks quoteMissing when retweet has no usable original", () => {
    const post = sanitizeFeedPost(
      {
        id: "900003",
        userId: "10001",
        summary: "",
        timestamp: 1,
        url: "https://xueqiu.com/10001/900003",
        isRetweet: true,
        quoteMissing: true,
        quoted: null,
      },
      "xueqiu:10001",
    );
    expect(post?.quoteMissing).toBe(true);
    const card = classifyPostCard(post!);
    expect(card.embed?.unavailable).toBe(true);
    expect(card.embed?.text).toBe("");
  });

  it("keeps open-post url only on sanitized post (icon target)", () => {
    const post = sanitizeFeedPost(
      {
        id: "900004",
        userId: "10001",
        summary: "正文不该整卡跳转",
        timestamp: 1,
        url: "https://xueqiu.com/10001/900004",
      },
      "xueqiu:10001",
    );
    expect(post?.url).toBe("https://xueqiu.com/10001/900004");
  });
});

describe("helpers", () => {
  it("parseReplyHandle strips lead", () => {
    expect(parseReplyHandle("回复 @张三：你好")?.handle).toBe("张三");
    expect(parseReplyHandle("普通正文")).toBeNull();
  });

  it("sanitizeMediaUrls rejects non-https junk", () => {
    expect(sanitizeMediaUrls(["javascript:alert(1)", "//cdn.example/a.png"])).toEqual([
      "https://cdn.example/a.png",
    ]);
  });

  it("keeps all valid media instead of truncating after nine", () => {
    const urls = Array.from({ length: 14 }, (_, index) => `https://cdn.example/${index}.jpg`);
    expect(sanitizeMediaUrls(urls)).toEqual(urls);
  });

  it("isVideoUrl detects X progressive mp4", () => {
    expect(
      isVideoUrl("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/910x720/a.mp4?tag=12"),
    ).toBe(true);
    expect(isVideoUrl("https://pbs.twimg.com/media/abc.jpg")).toBe(false);
  });
});

describe("mixed timeline ordering contract", () => {
  it("sorts by timestamp without source grouping", () => {
    const posts = [
      sanitizeFeedPost(
        { id: "1", userId: "1", summary: "a", timestamp: 100, url: "https://xueqiu.com/1/1" },
        "xueqiu:1",
      )!,
      sanitizeFeedPost(
        {
          id: "2",
          summary: "b",
          timestamp: 300,
          url: "https://x.com/u/status/2",
          handle: "u",
          authorName: "X用户",
        },
        "x:u",
      )!,
      sanitizeFeedPost(
        { id: "3", userId: "2", summary: "c", timestamp: 200, url: "https://xueqiu.com/2/3" },
        "xueqiu:2",
      )!,
    ].map((p, i) => ({ ...p, feedKey: i === 1 ? "x:u" : "xueqiu:" + (i === 0 ? "1" : "2") }));

    const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp);
    expect(sorted.map((p) => p.id)).toEqual(["2", "3", "1"]);
    // 不按平台切块：相邻项可跨源
    expect(sorted[0].feedKey).toBe("x:u");
    expect(sorted[1].feedKey).toBe("xueqiu:2");
  });
});
