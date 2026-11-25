import { describe, expect, it } from "vitest";
import { TARGET } from "./config";
import { SQUARE_PLATFORMS, SQUARE_SOURCES } from "./square-config";
import { X_SUGGESTIONS } from "./x-suggestions";
import { collectVisiblePosts } from "./visible-posts";

describe("广场精选目录", () => {
  it("只采用仓库已确认的账号，微博名单留空", () => {
    expect(SQUARE_PLATFORMS).toEqual(["xueqiu", "x", "weibo"]);
    expect(SQUARE_SOURCES.filter((source) => source.platform === "xueqiu")).toEqual([
      { platform: "xueqiu", id: TARGET.userId, name: TARGET.name, key: `xueqiu:${TARGET.userId}` },
    ]);
    const x = SQUARE_SOURCES.filter((source) => source.platform === "x");
    expect(x.map((source) => source.id)).toEqual(["OpenAI", "AnthropicAI", "GoogleDeepMind"]);
    for (const source of x) expect(X_SUGGESTIONS.some((known) => known.id === source.id && known.name === source.name)).toBe(true);
    expect(SQUARE_SOURCES.filter((source) => source.platform === "weibo")).toEqual([]);
    expect(new Set(SQUARE_SOURCES.map((source) => source.key)).size).toBe(SQUARE_SOURCES.length);
  });

  it("广场聚合过滤私人源、清理无效帖子并去重，不改变输入", () => {
    const timelines = {
      [`xueqiu:${TARGET.userId}`]: [
        { id: "900001", userId: TARGET.userId, summary: "目录内动态", timestamp: 1700000000000 },
        { id: "900001", userId: TARGET.userId, summary: "目录内动态", timestamp: 1700000000000 },
        null,
      ],
      "weibo:1234567890": [{ id: "800001", summary: "私人动态", timestamp: 1700000001000 }],
    };
    const before = JSON.stringify(timelines);
    const posts = collectVisiblePosts({ timelines, feedList: SQUARE_SOURCES });
    expect(posts.map((post) => post.id)).toEqual(["900001"]);
    expect(posts[0].feedName).toBe(TARGET.name);
    expect(JSON.stringify(timelines)).toBe(before);
  });
});
