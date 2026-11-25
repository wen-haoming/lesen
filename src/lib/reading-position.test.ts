import { describe, expect, it } from "vitest";
import {
  NEAR_TOP_PX,
  captureAnchorFromRects,
  fallbackAnchorKey,
  isAtTrueTop,
  isPostAnchorKey,
  normalizeReadingPositions,
  readingContextKey,
  shouldShowFreshCue,
  upsertReadingPosition,
  loadReadingPositions,
  saveReadingPosition,
  READING_POSITIONS_KEY,
  TRUE_TOP_PX,
  jumpToLatestScrollTop,
  shouldAckProgrammaticJump,
  pinnedAnchorAfterLayout,
} from "./reading-position";

describe("reading context keys", () => {
  it("separates reader all-feed, author, and home platform columns", () => {
    expect(readingContextKey({ surface: "reader", feedKey: "__all__", isAllFeed: true })).toBe(
      "reader:all",
    );
    expect(
      readingContextKey({ surface: "reader", feedKey: "xueqiu:1", isAllFeed: false }),
    ).toBe("reader:author:xueqiu:1");
    expect(
      readingContextKey({
        surface: "home",
        feedKey: "__all__",
        isAllFeed: true,
        platform: "weibo",
      }),
    ).toBe("home:weibo:all");
    expect(
      readingContextKey({
        surface: "home",
        feedKey: "x:abc",
        isAllFeed: false,
        platform: "x",
      }),
    ).toBe("home:x:author:x:abc");
  });
});

describe("reading positions", () => {
  it("ignores day headers and malformed records", () => {
    expect(isPostAnchorKey("day:2026-11-16")).toBe(false);
    expect(isPostAnchorKey("xueqiu:1:post-1")).toBe(true);
    expect(
      normalizeReadingPositions({
        "reader:all": { contextKey: "reader:all", anchorKey: "day:2026-11-16", offset: 8 },
        "reader:author:xueqiu:1": {
          contextKey: "reader:author:xueqiu:1",
          anchorKey: "xueqiu:1:a",
          offset: 12,
          savedAt: 9,
        },
      }),
    ).toEqual({
      "reader:author:xueqiu:1": {
        contextKey: "reader:author:xueqiu:1",
        anchorKey: "xueqiu:1:a",
        offset: 12,
        savedAt: 9,
      },
    });
  });

  it("upserts one context without clobbering another", () => {
    const first = upsertReadingPosition(
      {},
      { contextKey: "reader:all", anchorKey: "xueqiu:1:a", offset: 4, savedAt: 1 },
    );
    const next = upsertReadingPosition(first, {
      contextKey: "reader:author:x:1",
      anchorKey: "x:1:b",
      offset: 0,
      savedAt: 2,
    });
    expect(next["reader:all"].anchorKey).toBe("xueqiu:1:a");
    expect(next["reader:author:x:1"].anchorKey).toBe("x:1:b");
  });

  it("captures the first post that crosses the viewport edge", () => {
    const snap = captureAnchorFromRects(
      [
        { key: "day:2026-11-16", top: -20, bottom: -4 },
        { key: "xueqiu:1:old", top: -10, bottom: 40 },
        { key: "xueqiu:1:newer", top: 40, bottom: 120 },
      ],
      0,
    );
    expect(snap).toEqual({ key: "xueqiu:1:old", offset: -10 });
  });

  it("falls back to the next surviving post when the anchor was deleted", () => {
    expect(
      fallbackAnchorKey("weibo:1:b", ["weibo:1:a", "weibo:1:b", "weibo:1:c"], ["weibo:1:c"]),
    ).toBe("weibo:1:c");
    expect(fallbackAnchorKey("missing", ["weibo:1:a"], [])).toBe("");
    expect(fallbackAnchorKey("gone", [], ["xueqiu:1:z"])).toBe("xueqiu:1:z");
  });

  it("hides the fresh cue when the scroller is already at the true top", () => {
    expect(isAtTrueTop(0)).toBe(true);
    expect(isAtTrueTop(NEAR_TOP_PX)).toBe(true);
    expect(isAtTrueTop(NEAR_TOP_PX + 1)).toBe(false);
    expect(shouldShowFreshCue(2, 0)).toBe(false);
    expect(shouldShowFreshCue(2, 120)).toBe(true);
    expect(shouldShowFreshCue(0, 120)).toBe(false);
  });
});

describe("reading position chrome.storage adapter", () => {
  function memoryStore(initial: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = { ...initial };
    return {
      data,
      async get(keys: string[]) {
        const out: Record<string, unknown> = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
        }
        return out;
      },
      async set(values: Record<string, unknown>) {
        Object.assign(data, values);
      },
    };
  }

  it("persists one context and reloads it without clobbering others or unrelated keys", async () => {
    const store = memoryStore({ keep: "other-platform-data" });
    const first = {
      contextKey: "reader:all",
      anchorKey: "xueqiu:10001:900001",
      offset: 24,
      savedAt: 1,
    };
    const second = {
      contextKey: "reader:author:x:keepx",
      anchorKey: "x:keepx:1",
      offset: 8,
      savedAt: 2,
    };
    await saveReadingPosition(store, first);
    await saveReadingPosition(store, second);
    const loaded = await loadReadingPositions(store);
    expect(loaded["reader:all"]?.anchorKey).toBe("xueqiu:10001:900001");
    expect(loaded["reader:author:x:keepx"]?.anchorKey).toBe("x:keepx:1");
    expect(store.data.keep).toBe("other-platform-data");
    expect(store.data[READING_POSITIONS_KEY]).toBeTruthy();
  });

  it("treats a missing runtime (get returns null) as empty and still writes on save", async () => {
    let written: Record<string, unknown> | null = null;
    const store = {
      async get() {
        return null;
      },
      async set(values: Record<string, unknown>) {
        written = values;
      },
    };
    const empty = await loadReadingPositions(store);
    expect(empty).toEqual({});
    const saved = await saveReadingPosition(store, {
      contextKey: "home:weibo:all",
      anchorKey: "weibo:123:1",
      offset: 0,
      savedAt: 3,
    });
    expect(saved["home:weibo:all"]?.anchorKey).toBe("weibo:123:1");
    expect(written && written[READING_POSITIONS_KEY]).toBeTruthy();
  });
});

describe("capsule jump to true top", () => {
  it("aims at scrollTop 0 rather than first-post minus 8px", () => {
    expect(jumpToLatestScrollTop()).toBe(0);
    const dayHeaderHeight = 34;
    const firstPostMinusEight = dayHeaderHeight - 8;
    expect(firstPostMinusEight).toBe(26);
    expect(jumpToLatestScrollTop()).not.toBe(firstPostMinusEight);
  });

  it("acks only after a programmatic jump actually arrives, and not when the user interrupts", () => {
    expect(
      shouldAckProgrammaticJump({ scrollTop: 26, interrupted: false, flying: true }),
    ).toBe(false);
    expect(
      shouldAckProgrammaticJump({ scrollTop: 0, interrupted: false, flying: true }),
    ).toBe(true);
    expect(
      shouldAckProgrammaticJump({ scrollTop: TRUE_TOP_PX, interrupted: false, flying: true }),
    ).toBe(true);
    expect(
      shouldAckProgrammaticJump({ scrollTop: 0, interrupted: true, flying: true }),
    ).toBe(false);
    expect(
      shouldAckProgrammaticJump({ scrollTop: 0, interrupted: false, flying: false }),
    ).toBe(false);
  });
});

describe("prepend keeps the pinned post, not the post at the viewport edge", () => {
  it("recapturing at the edge after a 34px pin would pick the newer post above the original", () => {
    const edge = 100;
    const captured = captureAnchorFromRects(
      [
        { key: "day:2026-11-16", top: edge - 409, bottom: edge - 375 },
        { key: "xueqiu:10001:994901", top: edge - 375, bottom: edge + 34 },
        { key: "xueqiu:10001:910001", top: edge + 34, bottom: edge + 200 },
      ],
      edge,
    );
    expect(captured).toEqual({ key: "xueqiu:10001:994901", offset: -375 });
    const pinned = { key: "xueqiu:10001:910001", offset: 34 };
    expect(pinnedAnchorAfterLayout(pinned, captured)).toEqual(pinned);
    expect(pinnedAnchorAfterLayout(pinned, captured)?.offset).not.toBe(-10);
  });

  it("falls back to the edge capture only when nothing was pinned", () => {
    const captured = { key: "xueqiu:10001:1", offset: 12 };
    expect(pinnedAnchorAfterLayout(null, captured)).toEqual(captured);
  });
});
