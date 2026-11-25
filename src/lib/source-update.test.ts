import { describe, expect, it } from "vitest";
import {
  baselineTimelineAck,
  countFreshPosts,
  mergeTimelineAck,
  newestPostTimestamp,
  sourceHasFreshUpdate,
} from "./source-update";

describe("source update badge", () => {
  it("reads the newest post timestamp", () => {
    expect(newestPostTimestamp([{ timestamp: 10 }, { timestamp: 40 }, { timestamp: 25 }])).toBe(40);
    expect(newestPostTimestamp(undefined)).toBe(0);
  });

  it("hides the dot when the timeline is already the latest refresh", () => {
    const posts = [{ timestamp: 100 }];
    expect(sourceHasFreshUpdate(posts, 100)).toBe(false);
    expect(sourceHasFreshUpdate(posts, 0)).toBe(false);
    expect(sourceHasFreshUpdate([], 100)).toBe(false);
  });

  it("shows the dot only after a post newer than the last refresh", () => {
    expect(sourceHasFreshUpdate([{ timestamp: 180 }, { timestamp: 90 }], 100)).toBe(true);
  });

  it("baselines synced sources once so current data does not light the dot", () => {
    const timelines = { "xueqiu:1": [{ timestamp: 50 }] };
    const sync = { "xueqiu:1": 1_000 };
    const first = baselineTimelineAck(timelines, sync, {});
    expect(first).toEqual({ "xueqiu:1": 50 });
    expect(baselineTimelineAck(timelines, sync, first || {})).toBeNull();
    expect(sourceHasFreshUpdate(timelines["xueqiu:1"], 50)).toBe(false);
    expect(sourceHasFreshUpdate([{ timestamp: 80 }], 50)).toBe(true);
  });

  it("counts only post ids recorded as new in the local cache", () => {
    const posts = [
      { id: "a", feedKey: "weibo:1" },
      { id: "b", feedKey: "weibo:1" },
      { id: "c", feedKey: "xueqiu:2" },
      { id: "d", feedKey: "x:abc" },
    ];
    expect(
      countFreshPosts(posts, {
        "weibo:1": ["a"],
        "xueqiu:2": ["c", "missing"],
      }),
    ).toBe(2);
    expect(countFreshPosts(posts, {})).toBe(0);
    expect(countFreshPosts([{ id: "a" }], { "xueqiu:1": ["a"] }, "xueqiu:1")).toBe(1);
    expect(countFreshPosts([{ id: "old" }], { "xueqiu:1": ["a"] }, "xueqiu:1")).toBe(0);
  });

  it("keeps the later acknowledgement when storage and local state merge", () => {
    expect(mergeTimelineAck({ a: 10, b: 4 }, { a: 30 })).toEqual({ a: 30, b: 4 });
  });
});
