import { describe, expect, it } from "vitest";
import { FEED_ALL, STORAGE_KEYS, feedKey, migrateKeyedStore, parseFeedKey } from "./config";
import { BROADCAST_MESSAGES, FORWARDED_TO_CONTENT, POPUP_MESSAGES } from "./messages";
import { peekSourceInput } from "./source-input";
import { sanitizeFeedPost } from "./sanitize";
import {
  mergeNotifySeenIds,
  normalizeRefreshMinutes,
  pickNotifyCandidates,
  seedNotifyIds,
  shouldPollUpdates,
  shouldRunNotifyCheck,
} from "./notify-logic";
import {
  buildDefaultXPickerList,
  filterXSuggestions,
  mergeXSearchResults,
  X_SUGGESTIONS,
} from "./x-suggestions";
import {
  classifyXSessionFromNames,
  classifyXueqiuSession,
  shouldShowLoginCta,
} from "./platform-session";
import { DEMO_MODES, buildPreviewStorage, parseDemoMode } from "./preview-mock";
import { detectShellMode } from "./shell-mode";

describe("storage key compatibility", () => {
  it("keeps legacy storage key names including unused authorReadAt key name", () => {
    expect(STORAGE_KEYS).toContain("timelines");
    expect(STORAGE_KEYS).toContain("sources");
    expect(STORAGE_KEYS).toContain("selectedFeedKey");
    expect(STORAGE_KEYS).toContain("authorReadAt");
    expect(STORAGE_KEYS).toContain("timelinePaging");
    expect(STORAGE_KEYS).toContain("settings");
    expect(STORAGE_KEYS).toContain("notifyState");
  });

  it("migrates numeric xueqiu keys to platform-prefixed keys", () => {
    const migrated = migrateKeyedStore({
      "1247347556": [{ id: "1" }],
      "xueqiu:99": [{ id: "2" }],
    });
    expect(migrated["xueqiu:1247347556"]).toEqual([{ id: "1" }]);
    expect(migrated["xueqiu:99"]).toEqual([{ id: "2" }]);
  });

  it("overwrites empty prefixed timeline with bare-uid data", () => {
    const migrated = migrateKeyedStore({
      "1247347556": [{ id: "1" }],
      "xueqiu:1247347556": [],
    });
    expect(migrated["xueqiu:1247347556"]).toEqual([{ id: "1" }]);
  });
});

describe("feed key protocol", () => {
  it("builds and parses feed keys", () => {
    expect(feedKey({ platform: "xueqiu", id: "123" })).toBe("xueqiu:123");
    expect(feedKey({ platform: "x", id: "elonmusk" })).toBe("x:elonmusk");
    expect(parseFeedKey("x:elonmusk")).toEqual({ platform: "x", id: "elonmusk" });
    expect(parseFeedKey("xueqiu:123")).toEqual({ platform: "xueqiu", id: "123" });
    expect(FEED_ALL).toBe("__all__");
  });
});

describe("message protocol", () => {
  it("retains popup and broadcast message names", () => {
    expect(POPUP_MESSAGES).toContain("POPUP_LOAD_MORE");
    expect(POPUP_MESSAGES).toContain("POPUP_ADD_SOURCE");
    expect(POPUP_MESSAGES).toContain("POPUP_SEARCH_X_USERS");
    expect(POPUP_MESSAGES).toContain("POPUP_SEARCH_USERS");
    expect(POPUP_MESSAGES).toContain("POPUP_OPEN_SIDEBAR");
    expect(POPUP_MESSAGES).toContain("POPUP_OPEN_POPUP");
    expect(BROADCAST_MESSAGES).toContain("USER_TIMELINE_RESULT");
    expect(BROADCAST_MESSAGES).toContain("ACCOUNT_RESULT");
    expect(FORWARDED_TO_CONTENT).toEqual([
      "POPUP_ACCOUNT_REQUEST",
      "POPUP_LOAD_USER",
      "POPUP_REFRESH",
      "POPUP_LOAD_MORE",
    ]);
  });
});

describe("shell mode", () => {
  it("detects popup, window, sidebar, and home shells", () => {
    expect(detectShellMode("", "/popup.html")).toBe("popup");
    expect(detectShellMode("?mode=window", "/popup.html")).toBe("window");
    expect(detectShellMode("?mode=sidebar", "/popup.html")).toBe("sidebar");
    expect(detectShellMode("", "/sidepanel.html")).toBe("sidebar");
    expect(detectShellMode("", "/home.html")).toBe("home");
    expect(detectShellMode("?mode=home", "/popup.html")).toBe("home");
  });
});

describe("source input parsing", () => {
  it("parses xueqiu and x inputs like legacy popup", () => {
    expect(peekSourceInput("@elonmusk")).toEqual({ platform: "x", id: "elonmusk" });
    expect(peekSourceInput("https://x.com/OpenAI")).toEqual({ platform: "x", id: "openai" });
    expect(peekSourceInput("https://xueqiu.com/u/1247347556")).toEqual({
      platform: "xueqiu",
      id: "1247347556",
    });
    expect(peekSourceInput("1247347556")).toEqual({ platform: "xueqiu", id: "1247347556" });
    expect(peekSourceInput("")).toEqual({ error: "EMPTY" });
  });
});

describe("sanitize feed posts", () => {
  it("canonicalizes Snowball links from verified author id and status id", () => {
    const ok = sanitizeFeedPost(
      {
        id: "100",
        userId: "1247347556",
        title: "hello",
        summary: "world",
        timestamp: 1_700_000_000_000,
        url: "https://xueqiu.com/1247347556/100",
      },
      "xueqiu:1247347556",
    );
    expect(ok?.id).toBe("100");
    expect(ok?.url).toBe("https://xueqiu.com/1247347556/100");

    const canonical = sanitizeFeedPost(
      {
        id: "101",
        userId: "1247347556",
        title: "hello",
        summary: "world",
        timestamp: 1_700_000_000_000,
        url: "https://evil.example/profile",
      },
      "xueqiu:1247347556",
    );
    expect(canonical?.url).toBe("https://xueqiu.com/1247347556/101");
  });

  it("accepts x posts with explicit status urls for icon-only open fixtures", () => {
    const post = sanitizeFeedPost(
      {
        id: "800001",
        summary: "Hello from X",
        timestamp: 1_700_000_000_000,
        url: "https://x.com/preview_x/status/800001",
        handle: "preview_x",
      },
      "x:preview_x",
    );
    expect(post?.platform).toBe("x");
    expect(post?.url).toBe("https://x.com/preview_x/status/800001");
  });
});

describe("notify logic without authorReadAt", () => {
  it("seeds ids without notifying and later picks only unseen ids", () => {
    const posts = [
      { id: "a", timestamp: 3, title: "A" },
      { id: "b", timestamp: 2, title: "B" },
      { id: "c", timestamp: 1, title: "C" },
    ];
    const seeded = seedNotifyIds(posts);
    expect(seeded.sort()).toEqual(["a", "b", "c"]);
    const fresh = pickNotifyCandidates(
      [...posts, { id: "d", timestamp: 4, title: "D" }],
      seeded,
      2,
    );
    expect(fresh.map((p) => String(p.id))).toEqual(["d"]);
    expect(mergeNotifySeenIds(seeded, ["d"]).includes("d")).toBe(true);
  });

  it("respects settings.notify switch", () => {
    expect(shouldRunNotifyCheck({ notify: true })).toBe(true);
    expect(shouldRunNotifyCheck({})).toBe(true);
    expect(shouldRunNotifyCheck({ notify: false })).toBe(false);
    expect(shouldRunNotifyCheck({ notifyForm: "quiet" })).toBe(false);
    expect(shouldRunNotifyCheck({ notifyForm: "system", notify: false })).toBe(true);
  });

  it("keeps auto refresh permanently off", () => {
    expect(normalizeRefreshMinutes(undefined)).toBe(0);
    expect(normalizeRefreshMinutes(7)).toBe(0);
    expect(normalizeRefreshMinutes(0)).toBe(0);
    expect(normalizeRefreshMinutes(30)).toBe(0);
    expect(shouldPollUpdates({ refreshMinutes: 0 })).toBe(false);
    expect(shouldPollUpdates({ refreshMinutes: 5 })).toBe(false);
    expect(shouldPollUpdates({})).toBe(false);
  });
});

describe("X default picker list", () => {
  it("shows subscribed plus hardcoded suggestions for empty query", () => {
    expect(X_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
    const { subscribed, suggestions } = buildDefaultXPickerList([
      { id: "elonmusk", name: "Elon Musk" },
      { id: "preview_x", name: "Demo X User" },
    ]);
    expect(subscribed.map((s) => s.id)).toEqual(["elonmusk", "preview_x"]);
    expect(suggestions.find((s) => s.id === "elonmusk")).toBeUndefined();
    expect(suggestions.find((s) => s.id === "OpenAI")).toBeTruthy();
    expect(filterXSuggestions(suggestions, "open").map((s) => s.id)).toContain("OpenAI");
    expect(filterXSuggestions(suggestions, "")).toEqual(suggestions);
  });

  it("filters local suggestions including karpathy and merges remote deduped", () => {
    const { suggestions } = buildDefaultXPickerList([]);
    const local = filterXSuggestions(suggestions, "karpathy");
    expect(local.map((s) => s.id)).toContain("karpathy");
    const merged = mergeXSearchResults(local, [
      { id: "karpathy", name: "Andrej Karpathy" },
      { id: "newuser", name: "New User" },
    ]);
    expect(merged.filter((u) => u.id.toLowerCase() === "karpathy")).toHaveLength(1);
    expect(merged.map((u) => u.id)).toContain("newuser");
  });
});

describe("platform session classification", () => {
  it("classifies xueqiu without treating network-only token as logged-out", () => {
    expect(classifyXueqiuSession({ readable: false })).toBe("unknown");
    expect(classifyXueqiuSession({ readable: true, hasToken: true })).toBe("unknown");
    expect(classifyXueqiuSession({ readable: true, uid: "1" })).toBe("logged-in");
    expect(classifyXueqiuSession({ readable: true, hasLoginFlag: true })).toBe("logged-in");
    expect(classifyXueqiuSession({ readable: true })).toBe("logged-out");
  });

  it("classifies X by cookie names only", () => {
    expect(classifyXSessionFromNames(["auth_token", "ct0"], true)).toBe("logged-in");
    expect(classifyXSessionFromNames(["guest_id"], true)).toBe("logged-out");
    expect(classifyXSessionFromNames([], false)).toBe("unknown");
  });

  it("shows login CTA only for logged-out", () => {
    expect(shouldShowLoginCta("logged-out")).toBe(true);
    expect(shouldShowLoginCta("logged-in")).toBe(false);
    expect(shouldShowLoginCta("unknown")).toBe(false);
    expect(shouldShowLoginCta("checking")).toBe(false);
  });
});

describe("preview demos without unread", () => {
  it("rejects unread demo and covers login / x-picker modes", () => {
    expect(parseDemoMode("unread")).toBe("timeline");
    expect(DEMO_MODES.map((m) => m.id)).not.toContain("unread");
    const xPicker = buildPreviewStorage("x-picker");
    expect(xPicker.openAddDialog).toBe(true);
    expect(xPicker.sources.some((s) => s.platform === "x")).toBe(true);
    const loginX = buildPreviewStorage("login-x");
    expect(loginX.platformSessions.x).toBe("logged-out");
    const loginXq = buildPreviewStorage("login-xueqiu");
    expect(loginXq.platformSessions.xueqiu).toBe("logged-out");
    const split = buildPreviewStorage("login-split");
    expect(split.platformSessions).toMatchObject({
      xueqiu: "logged-in",
      x: "logged-out",
      weibo: "logged-in",
    });
    const checking = buildPreviewStorage("login-checking");
    expect(checking.platformSessions.xueqiu).toBe("checking");
  });
});
