import { describe, expect, it } from "vitest";
import type { FeedPerson } from "./config";
import {
  HOME_PLATFORMS,
  collectPlatformPosts,
  collectVisiblePosts,
  feedsForPlatform,
} from "./visible-posts";

function person(platform: FeedPerson["platform"], id: string, name: string): FeedPerson {
  return { platform, id, name, key: platform + ":" + id, pinned: true };
}

const feedList: FeedPerson[] = [
  person("xueqiu", "1001", "雪球作者甲"),
  person("xueqiu", "1002", "雪球作者乙"),
  person("x", "preview_x", "X 作者"),
  person("weibo", "2002", "微博作者"),
];

const timelines = {
  "xueqiu:1001": [
    {
      id: "900002",
      userId: "1001",
      title: "雪球帖子",
      summary: "雪球帖子",
      timestamp: 1_700_000_002_000,
    },
    {
      id: "900001",
      userId: "1001",
      title: "更早的雪球帖",
      summary: "更早的雪球帖",
      timestamp: 1_700_000_000_000,
    },
  ],
  "xueqiu:1002": [
    {
      id: "910001",
      userId: "1002",
      title: "另一位作者的帖子",
      summary: "不应混入被选中的头像时间线",
      timestamp: 1_700_000_004_000,
    },
  ],
  "x:preview_x": [
    {
      id: "800001",
      handle: "preview_x",
      summary: "一条推文",
      timestamp: 1_700_000_003_000,
    },
  ],
  "weibo:2002": [
    {
      id: "700001",
      userId: "2002",
      summary: "一条微博",
      timestamp: 1_700_000_001_000,
    },
  ],
};

describe("home platform columns", () => {
  it("keeps the confirmed column order", () => {
    expect([...HOME_PLATFORMS]).toEqual(["xueqiu", "x", "weibo"]);
  });

  it("groups existing subscription posts by platform and does not invent content", () => {
    const xueqiu = collectPlatformPosts({ timelines, feedList, platform: "xueqiu", sort: "desc" });
    const x = collectPlatformPosts({ timelines, feedList, platform: "x", sort: "desc" });
    const weibo = collectPlatformPosts({ timelines, feedList, platform: "weibo", sort: "desc" });

    expect(xueqiu.map((post) => post.id)).toEqual(["910001", "900002", "900001"]);
    expect(xueqiu.every((post) => post.feedPlatform === "xueqiu")).toBe(true);
    const selectedAvatar = collectPlatformPosts({
      timelines,
      feedList: feedList.filter((person) => person.key === "xueqiu:1001"),
      platform: "xueqiu",
      sort: "desc",
    });
    expect(selectedAvatar.map((post) => post.id)).toEqual(["900002", "900001"]);
    expect(selectedAvatar.every((post) => post.feedKey === "xueqiu:1001")).toBe(true);
    expect(x.map((post) => post.id)).toEqual(["800001"]);
    expect(weibo.map((post) => post.id)).toEqual(["700001"]);
  });

  it("returns an empty column when the platform has no subscriptions", () => {
    const onlyX = feedsForPlatform(feedList, "x");
    expect(collectPlatformPosts({ timelines, feedList: onlyX, platform: "xueqiu" })).toEqual([]);
    expect(collectVisiblePosts({ timelines, feedList: [], feedKey: "__all__" })).toEqual([]);
  });

  it("keeps the same all-feed merge used by the sidebar", () => {
    const all = collectVisiblePosts({ timelines, feedList, sort: "desc", feedKey: "__all__" });
    expect(all.map((post) => post.id)).toEqual(["910001", "800001", "900002", "700001", "900001"]);
  });
});
