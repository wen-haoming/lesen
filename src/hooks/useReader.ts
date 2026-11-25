import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SOURCES,
  FEED_ALL,
  fallbackPickerTab,
  fallbackSelectedFeedKey,
  feedKey,
  isSupportedPlatform,
  migrateKeyedStore,
  parseFeedKey,
  sanitizeHomeOrder,
  type FeedPerson,
  type FeedSource,
  type Platform,
} from "@/lib/config";
import { isPackagedAssetPath, pickAvatarSrc } from "@/lib/avatar-url";
import {
  hasChromeRuntime,
  openNotificationSettings,
  openTab,
  sendRuntime,
  storageGet,
  storageSet,
} from "@/lib/chrome-api";
import { formatSync } from "@/lib/format";
import {
  buildPreviewStorage,
  parseDemoMode,
  PREVIEW_BANNER,
  type DemoMode,
} from "@/lib/preview-mock";
import { sanitizeFeedPost, type Post } from "@/lib/sanitize";
import { peekSourceInput } from "@/lib/source-input";
import type { PlatformLoginStatus, PlatformSessions } from "@/lib/platform-session";
import { classifyXueqiuSession } from "@/lib/platform-session";
import { applyShellMode, detectShellMode, type ShellMode } from "@/lib/shell-mode";
import { collectVisiblePosts } from "@/lib/visible-posts";
import {
  applyAppearance,
  clearSessionUrlOverride,
  mergeAppearance,
  normalizeAppearance,
  type ColorScheme,
  type ReadingFont,
  type ReadingSize,
  type ThemeStyle,
} from "@/lib/appearance";
import type { NotifyForm } from "@/lib/notify-logic";
import { X_SUGGESTIONS } from "@/lib/x-suggestions";
import {
  ackRecordChanged,
  baselineTimelineAck,
  mergeTimelineAck,
  newestPostTimestamp,
  normalizeTimelineFresh,
} from "@/lib/source-update";
import { mergeSubscriptionSources } from "@/lib/subscription-backup";
import { notifyLocalSubscriptionChange } from "@/lib/subscription-sync-runtime";
import { toast } from "sonner";
import { sendRuntime as sendAnalyticsMessage } from "@/lib/chrome-api";
import { ANALYTICS_BUILD_ENABLED } from "@/lib/analytics-config";

export type DisplayDensity = "compact" | "comfortable" | "spacious";

export type HomeHiddenMedia = {
  key: string;
  url: string;
  feedKey: string;
  postId: string;
  authorName: string;
  platform: string;
  context: "post" | "quote";
  postText: string;
};

export type Settings = {
  sort: "asc" | "desc";
  query: string;
  translateX: boolean;
  notify: boolean;
  /** 自动拉取间隔（分钟）。0 为关闭。缺省按 10 分钟。 */
  refreshMinutes?: number;
  /** system = 系统通知；quiet = 只更新列表不弹窗 */
  notifyForm?: NotifyForm;
  /** 工具栏图标打开的形态：弹窗或侧栏，只保留一种 */
  surface?: "popup" | "sidebar";
  /** 配色风格：砚灰 / 宣纸 / 水墨 / 青竹 / 雾蓝 / 暖沙 */
  themeStyle?: ThemeStyle;
  /** 明暗：浅色 / 深色 / 跟随系统 */
  colorScheme?: ColorScheme;
  /** 阅读字体：系统 / 黑体 / 宋体 / 楷体 / 圆体 / 霞鹜文楷 */
  readingFont?: ReadingFont;
  /** 整体尺寸：小 / 标准 / 大 / 特大 */
  readingSize?: ReadingSize;
  popupHeight: number | "fill";
  density: DisplayDensity;
  analyticsConsent?: boolean;
  homeOrder?: Platform[];
  homeColumnWidths?: Partial<Record<Platform, number>>;
  homeHiddenMedia?: HomeHiddenMedia[];
};

export type AccountStatus = "checking" | "logged-in" | "logged-out" | "unknown" | "timeout";

export type ReaderState = {
  status: AccountStatus;
  account: { id?: string; name?: string } | null;
  session: Record<string, unknown> | null;
  platformSessions: PlatformSessions;
  following: Array<{ id: string; name: string; avatar?: string }>;
  sources: FeedSource[];
  timelines: Record<string, unknown[]>;
  timelineSync: Record<string, number>;
  /** 各源上次刷新到的最新帖时间。比它更新的帖子才亮头像红点。 */
  timelineAck: Record<string, number>;
  /** 相对本地时间线缓存，这次更新新出现的帖子 id。 */
  timelineFresh: Record<string, string[]>;
  timelineError: Record<string, { error?: string; at?: number }>;
  timelinePaging: Record<string, { page: number; done: boolean; cursor?: string }>;
  selectedUserId: string;
  selectedFeedKey: string;
  settings: Settings;
  diagnostics: Record<string, unknown> | null;
  pageError: string;
  refreshing: boolean;
  loadingMore: boolean;
  notice: string;
  previewMode: boolean;
  previewBanner: string;
  demoMode: DemoMode;
  openAddDialog: boolean;
  addPickerTab: "x" | "xueqiu" | "weibo";
};

const DEFAULT_SETTINGS: Settings = {
  sort: "desc",
  query: "",
  translateX: true,
  notify: true,
  surface: "sidebar",
  themeStyle: "graphite",
  colorScheme: "light",
  readingFont: "system",
  readingSize: "md",
  popupHeight: 600,
  density: "comfortable",
  analyticsConsent: true,
};

type RefreshOptions = { maxAgeMs?: number; feedKey?: string; feedKeys?: string[] };

const initialState = (): ReaderState => ({
  status: "checking",
  account: null,
  session: null,
  platformSessions: {
    xueqiu: "checking",
    x: "checking",
    weibo: "checking",
  },
  following: [],
  sources: [],
  timelines: {},
  timelineSync: {},
  timelineAck: {},
  timelineFresh: {},
  timelineError: {},
  timelinePaging: {},
  selectedUserId: "",
  selectedFeedKey: FEED_ALL,
  settings: { ...DEFAULT_SETTINGS },
  diagnostics: null,
  pageError: "",
  refreshing: false,
  loadingMore: false,
  notice: "",
  previewMode: false,
  previewBanner: "",
  demoMode: "timeline",
  openAddDialog: false,
  addPickerTab: "x",
});

function resolveAvatar(source: FeedSource, following: ReaderState["following"]): string {
  let avatar = String(source.avatar || "").trim();
  const platform = source.platform || "xueqiu";
  // 雪球：无头像或非包内相对路径时，可回落到 following 缓存
  if (
    platform === "xueqiu" &&
    (!avatar || (!/^https?:\/\//i.test(avatar) && !isPackagedAssetPath(avatar)))
  ) {
    const hit = following.find((p) => String(p.id) === String(source.id));
    if (hit?.avatar) avatar = String(hit.avatar).trim();
  }
  // 统一走 normalizeAvatarCandidates：fixture 保本地，雪球相对路径走 xavatar
  return pickAvatarSrc(avatar, platform).slice(0, 500);
}

export function useReader() {
  const [state, setState] = useState<ReaderState>(initialState);
  const sourcesRef = useRef(state.sources);
  sourcesRef.current = state.sources;
  const selectedFeedKeyRef = useRef(state.selectedFeedKey);
  const analyticsSentRef = useRef(false);
  const lastLoginReportRef = useRef<
    Partial<Record<"xueqiu" | "x" | "weibo", "logged-in" | "logged-out">>
  >({});
  const captureAnalytics = useCallback((event: string, properties: Record<string, unknown>) => {
    if (previewModeRef.current) return;
    void sendAnalyticsMessage({ type: "ANALYTICS_CAPTURE", event, properties });
  }, []);
  selectedFeedKeyRef.current = state.selectedFeedKey;
  const timelinesRef = useRef(state.timelines);
  timelinesRef.current = state.timelines;
  const timelinePagingRef = useRef(state.timelinePaging);
  timelinePagingRef.current = state.timelinePaging;
  const loadMorePending = useRef(new Set<string>());
  // 滚动容器在触底时会连续派发多个 scroll 事件；按“来源 + 页码 + 游标”去重，
  // 确保同一页只发一次请求，等分页状态真正前进后才允许下一页。
  const loadMoreRequested = useRef(new Set<string>());
  const refreshLockRef = useRef(false);
  const queuedRefreshRef = useRef<RefreshOptions | null>(null);
  const refreshRunnerRef = useRef<((opts?: RefreshOptions) => Promise<void>) | null>(null);
  const flushQueuedRefresh = useCallback(() => {
    const queued = queuedRefreshRef.current;
    if (!queued) return;
    queuedRefreshRef.current = null;
    window.setTimeout(() => {
      const run = refreshRunnerRef.current;
      if (run) void run(queued);
    }, 0);
  }, []);
  const noticeTimer = useRef<number | null>(null);
  const storageTimer = useRef<number | null>(null);
  const watchTimer = useRef<number | null>(null);
  /** 仅侧栏刷新 / 下拉刷新为 true；头像切换触发的 LOAD_USER 不算 */
  const refreshIntentRef = useRef(false);
  const previewModeRef = useRef(false);
  const browserWindowIdRef = useRef(0);
  const [shellReady, setShellReady] = useState(false);
  const sessionProbeRef = useRef<{ inFlight: boolean; lastAt: number }>({
    inFlight: false,
    lastAt: 0,
  });
  previewModeRef.current = state.previewMode;
  timelinesRef.current = state.timelines;

  /** 兼容 content 脚本曾用裸 uid 落盘的旧 key */
  const timelineCacheHit = (key: string) => {
    const store = timelinesRef.current;
    const primary = store[key];
    if (Array.isArray(primary) && primary.length) return true;
    if (key.startsWith("xueqiu:")) {
      const legacy = store[key.slice("xueqiu:".length)];
      if (Array.isArray(legacy) && legacy.length) return true;
    }
    return false;
  };

  const showToast = useCallback((text: string) => {
    if (!text) return;
    toast(text, { duration: 2600 });
  }, []);

  const setNotice = useCallback((text: string, autoHide = false) => {
    setState((s) => ({ ...s, notice: text }));
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (autoHide && text) {
      noticeTimer.current = window.setTimeout(() => {
        setState((s) => ({ ...s, notice: "" }));
      }, 3500);
    }
  }, []);

  const feedList = useMemo<FeedPerson[]>(() => {
    return state.sources
      .filter((s) => s && s.id && isSupportedPlatform(s.platform))
      .map((source) => ({
        platform: source.platform || "xueqiu",
        id: String(source.id),
        name: String(source.name || ""),
        avatar: resolveAvatar(source, state.following),
        key: feedKey(source),
        pinned: true,
      }));
  }, [state.sources, state.following]);

  const activeFeedKey = state.selectedFeedKey || FEED_ALL;
  const isAllFeed = activeFeedKey === FEED_ALL;

  const visiblePosts = useMemo(() => {
    return collectVisiblePosts({
      timelines: state.timelines,
      feedList,
      query: state.settings.query,
      sort: state.settings.sort,
      feedKey: activeFeedKey,
    });
  }, [
    state.timelines,
    state.settings.query,
    state.settings.sort,
    feedList,
    activeFeedKey,
    isAllFeed,
  ]);

  const applyLoaded = useCallback((data: Record<string, unknown>) => {
    setState((prev) => {
      const incomingTimelines = migrateKeyedStore(data.timelines) as Record<string, unknown[]>;
      const timelineSync = migrateKeyedStore(data.timelineSync) as Record<string, number>;
      const timelines: Record<string, unknown[]> = { ...prev.timelines };
      for (const [key, value] of Object.entries(incomingTimelines)) {
        const nextList = Array.isArray(value) ? value : [];
        const prevList = Array.isArray(prev.timelines[key]) ? prev.timelines[key] : [];
        const prevAt = Number(prev.timelineSync?.[key] || 0);
        const nextAt = Number(timelineSync[key] || 0);
        if (nextList.length === 0 && prevList.length > 0 && nextAt <= prevAt) continue;
        timelines[key] = nextList;
      }
      const timelineError = migrateKeyedStore(data.timelineError) as ReaderState["timelineError"];
      const timelinePaging = migrateKeyedStore(
        data.timelinePaging,
      ) as ReaderState["timelinePaging"];
      const rawSettings = {
        ...DEFAULT_SETTINGS,
        ...(data.settings as Settings),
        analyticsConsent: ANALYTICS_BUILD_ENABLED ? data.analyticsConsent !== false : false,
      };
      const appearance = normalizeAppearance(rawSettings);
      const settings: Settings = {
        ...rawSettings,
        themeStyle: appearance.themeStyle,
        colorScheme: appearance.colorScheme,
        readingFont: appearance.readingFont,
        readingSize: appearance.readingSize,
      };
      // 不读不写 authorReadAt：保留用户历史数据在 storage 中不动
      // 外观 DOM 由下方 useEffect 根据 settings 套用（含 URL 会话覆盖）
      let selectedFeedKey = String(data.selectedFeedKey || prev.selectedFeedKey || "");
      const selectedUserId = String(data.selectedUserId || prev.selectedUserId || "");
      if (!selectedFeedKey) {
        selectedFeedKey = selectedUserId
          ? /^\d+$/.test(selectedUserId)
            ? "xueqiu:" + selectedUserId
            : selectedUserId
          : FEED_ALL;
      }
      const sources = Array.isArray(data.sources)
        ? (data.sources as FeedSource[]).filter((s) => s && s.id && isSupportedPlatform(s.platform))
        : prev.sources.filter((s) => s && s.id && isSupportedPlatform(s.platform));
      const following = Array.isArray(data.following)
        ? (data.following as ReaderState["following"]).filter(
            (p) => p && /^\d+$/.test(String(p.id || "")) && p.name,
          )
        : prev.following;
      const storedAck = migrateKeyedStore(data.timelineAck) as Record<string, number>;
      const mergedAck = mergeTimelineAck(storedAck, prev.timelineAck);
      const baselined = baselineTimelineAck(timelines, timelineSync, mergedAck);
      const timelineAck = baselined || mergedAck;
      const timelineFresh = normalizeTimelineFresh(migrateKeyedStore(data.timelineFresh));
      if (!previewModeRef.current && ackRecordChanged(timelineAck, storedAck)) {
        const snapshot = timelineAck;
        queueMicrotask(() => {
          void storageSet({ timelineAck: snapshot });
        });
      }
      const keepSupportedMap = <T,>(record: Record<string, T>): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(record)) {
          if (isSupportedPlatform(parseFeedKey(k).platform)) out[k] = v;
        }
        return out;
      };
      const sanitizedSettings: Settings = {
        ...settings,
        ...(settings.homeOrder ? { homeOrder: sanitizeHomeOrder(settings.homeOrder) } : {}),
      };
      const nextSelected = fallbackSelectedFeedKey(
        selectedFeedKey,
        sources.map((source) => String(source.platform) + ":" + String(source.id)),
      );
      return {
        ...prev,
        timelines: keepSupportedMap(timelines),
        timelineSync: keepSupportedMap(timelineSync),
        timelineAck: keepSupportedMap(timelineAck),
        timelineFresh: normalizeTimelineFresh(keepSupportedMap(timelineFresh)),
        timelineError: keepSupportedMap(timelineError),
        timelinePaging: keepSupportedMap(timelinePaging),
        settings: sanitizedSettings,
        selectedFeedKey: nextSelected,
        selectedUserId,
        sources,
        following: following.length ? following : prev.following,
        account: (data.account as ReaderState["account"]) || prev.account,
        addPickerTab: fallbackPickerTab(prev.addPickerTab),
      };
    });
  }, []);

  const messageForFeed = (key: string) => {
    const parsed = parseFeedKey(key);
    return { feedKey: key, platform: parsed.platform, userId: parsed.id };
  };

  const applyPlatformSessions = useCallback(
    (sessions: PlatformSessions, xueqiuSession?: Record<string, unknown>) => {
      const xqStatus = classifyXueqiuSession({
        readable:
          sessions.xueqiu !== "unknown" || !!(xueqiuSession && xueqiuSession.readable !== false),
        uid: xueqiuSession && (xueqiuSession.uid as string),
        hasLoginFlag: !!(xueqiuSession && xueqiuSession.hasLoginFlag),
        hasToken: !!(xueqiuSession && xueqiuSession.hasToken),
      });
      // 若 sessions 已带明确状态则优先
      const next: PlatformSessions = {
        xueqiu: (sessions.xueqiu as PlatformLoginStatus) || xqStatus,
        x: (sessions.x as PlatformLoginStatus) || "unknown",
        weibo: (sessions.weibo as PlatformLoginStatus) || "unknown",
      };
      setState((s) => {
        const status: AccountStatus =
          next.xueqiu === "logged-in"
            ? "logged-in"
            : next.xueqiu === "logged-out"
              ? "logged-out"
              : next.xueqiu === "checking"
                ? "checking"
                : "unknown";
        return {
          ...s,
          platformSessions: next,
          session: xueqiuSession || s.session,
          status: s.previewMode ? s.status : status,
        };
      });
      const platforms = ["xueqiu", "x", "weibo"] as const;
      for (const platform of platforms) {
        const status = next[platform];
        if (status !== "logged-in" && status !== "logged-out") continue;
        if (lastLoginReportRef.current[platform] === status) continue;
        lastLoginReportRef.current[platform] = status;
        captureAnalytics("login_detected", { platform, logged_in: status === "logged-in" });
      }
    },
    [captureAnalytics],
  );

  const probeSessions = useCallback(
    async (force = false, opts?: { refreshXueqiuAccount?: boolean }) => {
      if (previewModeRef.current) return;
      const now = Date.now();
      if (sessionProbeRef.current.inFlight) return;
      if (!force && now - sessionProbeRef.current.lastAt < 1500) return;
      sessionProbeRef.current = { inFlight: true, lastAt: now };
      if (force) {
        setState((s) => ({
          ...s,
          platformSessions: {
            xueqiu: s.platformSessions.xueqiu === "logged-in" ? "logged-in" : "checking",
            x: s.platformSessions.x === "logged-in" ? "logged-in" : "checking",
            weibo: s.platformSessions.weibo === "logged-in" ? "logged-in" : "checking",
          },
        }));
      }
      try {
        const response = await sendRuntime({ type: "POPUP_SESSION" });
        type SessionBag = { status?: PlatformLoginStatus };
        const bag = response.sessions as
          | {
              xueqiu?: SessionBag | PlatformLoginStatus;
              x?: SessionBag | PlatformLoginStatus;
              weibo?: SessionBag | PlatformLoginStatus;
            }
          | undefined;
        const pick = (
          raw: SessionBag | PlatformLoginStatus | undefined,
          fallback: PlatformLoginStatus,
        ): PlatformLoginStatus => {
          if (!raw) return fallback;
          if (typeof raw === "string") return raw;
          return raw.status || fallback;
        };
        const xueqiuFallback = classifyXueqiuSession({
          readable: response.readable !== false,
          uid: response.uid as string | undefined,
          hasLoginFlag: !!response.hasLoginFlag,
          hasToken: !!response.hasToken,
        });
        const xueqiu = pick(bag?.xueqiu, xueqiuFallback);
        const x = pick(bag?.x, "unknown");
        const weibo = pick(bag?.weibo, "unknown");
        applyPlatformSessions(
          { xueqiu, x, weibo },
          response as Record<string, unknown>,
        );
        if (xueqiu === "logged-in" && opts?.refreshXueqiuAccount !== false) {
          void sendRuntime({ type: "POPUP_ACCOUNT_REQUEST", force: !!force });
        }
      } finally {
        sessionProbeRef.current.inFlight = false;
        sessionProbeRef.current.lastAt = Date.now();
      }
    },
    [applyPlatformSessions],
  );

  const selectFeed = useCallback(
    async (key: string, opts?: { skipLoad?: boolean }) => {
      const rawKey = String(key || "");
      const next =
        rawKey === FEED_ALL
          ? FEED_ALL
          : isSupportedPlatform(parseFeedKey(rawKey).platform)
            ? rawKey
            : FEED_ALL;
      if (!next || next === selectedFeedKeyRef.current) return;
      // Prevent duplicate taps while React is still committing the selection.
      selectedFeedKeyRef.current = next;
      let selectedUserId = "";
      setState((s) => {
        selectedUserId = s.selectedUserId;
        if (next !== FEED_ALL) {
          const parsed = parseFeedKey(next);
          if (parsed.platform === "xueqiu") selectedUserId = parsed.id;
        }
        return { ...s, selectedFeedKey: next, selectedUserId, notice: "" };
      });

      if (previewModeRef.current) return;
      const parsedFeed =
        next === FEED_ALL || next === "__all__" ? { platform: "all" } : parseFeedKey(next);
      if (
        parsedFeed.platform === "all" ||
        parsedFeed.platform === "x" ||
        parsedFeed.platform === "xueqiu" ||
        parsedFeed.platform === "weibo"
      ) {
        captureAnalytics("feed_selected", { platform: parsedFeed.platform });
      }

      await storageSet({ selectedFeedKey: next, selectedUserId });
      if (opts?.skipLoad) return;
      if (next === FEED_ALL) {
        for (const person of feedList) {
          if (!timelineCacheHit(person.key)) {
            void sendRuntime({ type: "POPUP_LOAD_USER", ...messageForFeed(person.key) });
          }
        }
        return;
      }
      if (timelineCacheHit(next)) return;
      setNotice("正在读取动态…");
      const response = await sendRuntime({ type: "POPUP_LOAD_USER", ...messageForFeed(next) });
      if (!response.ok && response.reason && response.reason !== "SETTLING") {
        setNotice("读取失败：" + response.reason, true);
      }
    },
    [captureAnalytics, feedList, setNotice],
  );

  const acknowledgeLatest = useCallback((keys: string[]) => {
    const pending = [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
    if (!pending.length) return;
    void (async () => {
      const bumps: Record<string, number> = {};
      let storedTimelines: Record<string, unknown[]> | null = null;
      if (!previewModeRef.current) {
        const data = await storageGet(["timelines"]);
        if (
          data &&
          data.timelines &&
          typeof data.timelines === "object" &&
          !Array.isArray(data.timelines)
        ) {
          storedTimelines = data.timelines as Record<string, unknown[]>;
        }
      }
      for (const key of pending) {
        const stored = storedTimelines ? storedTimelines[key] : undefined;
        const posts = Array.isArray(stored) && stored.length ? stored : timelinesRef.current[key];
        const newest = newestPostTimestamp(posts);
        if (newest) bumps[key] = newest;
      }
      const bumpKeys = Object.keys(bumps);
      if (!bumpKeys.length) return;
      setState((s) => {
        const timelineAck = { ...s.timelineAck };
        const timelineFresh = { ...s.timelineFresh };
        for (const key of bumpKeys) {
          timelineAck[key] = Math.max(Number(timelineAck[key] || 0), bumps[key]);
          delete timelineFresh[key];
        }
        return { ...s, timelineAck, timelineFresh };
      });
      if (previewModeRef.current) return;
      const current = await storageGet(["timelineAck", "timelineFresh"]);
      if (!current) return;
      const prevAck =
        current.timelineAck && typeof current.timelineAck === "object"
          ? (current.timelineAck as Record<string, number>)
          : {};
      const nextAck = { ...prevAck };
      let changed = false;
      for (const key of bumpKeys) {
        const next = Math.max(Number(nextAck[key] || 0), bumps[key]);
        if (next === Number(nextAck[key] || 0)) continue;
        nextAck[key] = next;
        changed = true;
      }
      const nextFresh = normalizeTimelineFresh(current.timelineFresh);
      for (const key of bumpKeys) {
        if (nextFresh[key]) {
          delete nextFresh[key];
          changed = true;
        }
      }
      if (!changed) return;
      await storageSet({ timelineAck: nextAck, timelineFresh: nextFresh });
    })();
  }, []);

  const refresh = useCallback(
    async (opts?: RefreshOptions) => {
      const key = opts?.feedKey || selectedFeedKeyRef.current || FEED_ALL;
      const all = !opts?.feedKeys && key === FEED_ALL;
      const keys = (opts?.feedKeys
        ? opts.feedKeys.filter(Boolean)
        : all
          ? feedList.map((person) => person.key)
          : [key]
      ).filter((candidate) => isSupportedPlatform(parseFeedKey(candidate).platform));
      if (refreshLockRef.current || state.refreshing) {
        if (keys.length && (opts?.feedKey || opts?.feedKeys)) {
          queuedRefreshRef.current = {
            ...opts,
            feedKeys: opts.feedKeys ? [...opts.feedKeys] : undefined,
          };
        }
        return;
      }
      if (!keys.length) return;
      const maxAgeMs = Math.max(0, Number(opts?.maxAgeMs) || 0);
      if (maxAgeMs > 0) {
        const now = Date.now();
        const staleKeys = keys.filter((candidate) => {
          const legacyKey = candidate.startsWith("xueqiu:")
            ? candidate.slice("xueqiu:".length)
            : "";
          const syncedAt = Number(
            state.timelineSync[candidate] || (legacyKey && state.timelineSync[legacyKey]) || 0,
          );
          return !timelineCacheHit(candidate) || syncedAt <= 0 || now - syncedAt > maxAgeMs;
        });
        keys.splice(0, keys.length, ...staleKeys);
        if (!keys.length) return;
      }
      refreshLockRef.current = true;
      if (previewModeRef.current) {
        refreshIntentRef.current = true;
        setState((s) => ({ ...s, refreshing: true, notice: "" }));
        window.setTimeout(() => {
          refreshIntentRef.current = false;
          refreshLockRef.current = false;
          setState((s) => ({
            ...s,
            refreshing: false,
            timelineSync: Object.fromEntries(
              Object.keys(s.timelineSync).map((k) => [k, Date.now()]),
            ),
          }));
          flushQueuedRefresh();
        }, 280);
        return;
      }
      refreshIntentRef.current = true;
      setState((s) => ({ ...s, refreshing: true, notice: "", loadingMore: false }));
      loadMorePending.current.clear();
      loadMoreRequested.current.clear();
      try {
        if (all || (opts?.feedKeys && keys.length > 1)) {
          // 按平台分组并行推进，同平台内串行配合后台令牌桶节流；仅在真实平台风控暂停（platformPause）时中止该平台。
          const grouped = new Map<string, string[]>();
          for (const candidate of keys) {
            const candidatePlatform = parseFeedKey(candidate).platform;
            const list = grouped.get(candidatePlatform) || [];
            list.push(candidate);
            grouped.set(candidatePlatform, list);
          }
          const restrictedPlatforms = new Set<string>();
          let maxRetryAfterMs = 0;
          await Promise.all(
            Array.from(grouped.entries()).map(async ([candidatePlatform, platformKeys]) => {
              for (const candidate of platformKeys) {
                if (restrictedPlatforms.has(candidatePlatform)) break;
                const response = await sendRuntime({
                  type: "POPUP_REFRESH",
                  ...messageForFeed(candidate),
                });
                if (response.platformPause) {
                  restrictedPlatforms.add(candidatePlatform);
                  maxRetryAfterMs = Math.max(maxRetryAfterMs, Number(response.retryAfterMs) || 0);
                  break;
                }
              }
            }),
          );
          refreshIntentRef.current = false;
          refreshLockRef.current = false;
          setState((s) => ({ ...s, refreshing: false }));
          if (restrictedPlatforms.size) {
            const waitMinutes = Math.max(1, Math.ceil((maxRetryAfterMs || 60000) / 60000));
            setNotice(
              `部分平台暂时限制了高频请求，已自动暂停对应队列；约 ${waitMinutes} 分钟后再试。`,
              true,
            );
          }
          return;
        }
        const response = await sendRuntime({ type: "POPUP_REFRESH", ...messageForFeed(key) });
        if (!response.ok) {
          refreshIntentRef.current = false;
          refreshLockRef.current = false;
          setState((s) => ({ ...s, refreshing: false }));
          if (response.reason === "NO_XUEQIU_TAB") {
            setNotice("请自行打开任意雪球网页（可放后台），再点刷新。", true);
          } else if (response.reason === "NOT_LOGGED_IN") {
            setState((s) => ({ ...s, status: "logged-out" }));
          } else if (response.reason === "XUEQIU_SESSION_REQUIRED") {
            setNotice("雪球仍拒绝读取，请确认已登录雪球账号后重试。", true);
          } else if (response.platformPause || Number(response.retryAfterMs) > 0) {
            const waitSeconds = Math.max(5, Math.ceil((Number(response.retryAfterMs) || 30000) / 1000));
            const waitLabel =
              waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} 分钟` : `${waitSeconds} 秒`;
            setNotice(
              (response.platformPause
                ? "平台暂时限制了请求，已暂停继续刷新；约 "
                : "请求冷却中，约 ") +
                waitLabel +
                "后再试。",
              true,
            );
          } else {
            const detail = String(response.reason || response.error || "").trim();
            setNotice(detail ? "读取失败：" + detail : "刷新失败，请稍后重试", !detail);
          }
        } else if (
          typeof response.page === "number" ||
          typeof response.hasMore === "boolean" ||
          response.cursor !== undefined
        ) {
          // 直接用回执写游标，避免只依赖广播时 X 首页 cursor 丢失。
          setState((s) => ({
            ...s,
            timelinePaging: {
              ...s.timelinePaging,
              [key]: {
                page: Number(response.page) || 1,
                done: response.hasMore === false,
                cursor: String(response.cursor || ""),
              },
            },
            refreshing: false,
          }));
          refreshLockRef.current = false;
        } else {
          refreshIntentRef.current = false;
          refreshLockRef.current = false;
          setState((s) => ({ ...s, refreshing: false }));
        }
      } catch {
        refreshIntentRef.current = false;
        refreshLockRef.current = false;
        setState((s) => ({ ...s, refreshing: false }));
        setNotice("刷新失败，请稍后重试", true);
      } finally {
        refreshLockRef.current = false;
        if (!loadMorePending.current.size) refreshIntentRef.current = false;
        flushQueuedRefresh();
      }
    },
    [feedList, flushQueuedRefresh, setNotice, state.refreshing, state.timelineSync],
  );
  refreshRunnerRef.current = refresh;

  const toggleSort = useCallback(async () => {
    setState((s) => {
      const settings = {
        ...s.settings,
        sort: (s.settings.sort === "asc" ? "desc" : "asc") as "asc" | "desc",
      };
      if (!previewModeRef.current) void storageSet({ settings });
      return { ...s, settings };
    });
  }, []);

  const cycleDensity = useCallback(() => {
    setState((s) => {
      const modes: Settings["density"][] = ["compact", "comfortable", "spacious"];
      const index = modes.indexOf(s.settings.density || "comfortable");
      const density = modes[(index + 1) % modes.length];
      const settings = { ...s.settings, density };
      if (!previewModeRef.current) void storageSet({ settings });
      return { ...s, settings };
    });
  }, []);

  const setQuery = useCallback((query: string) => {
    setState((s) => {
      const settings = { ...s.settings, query };
      if (!previewModeRef.current) void storageSet({ settings });
      return { ...s, settings };
    });
  }, []);

  useEffect(() => {
    if (!hasChromeRuntime() || !chrome.tabs?.query) return;
    // 弹窗里 getCurrent 拿到的是弹窗窗口，侧栏挂不上去。这里记所属浏览器窗口。
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      const windowId = tabs?.[0]?.windowId;
      if (windowId) browserWindowIdRef.current = windowId;
    });
  }, []);

  const requestSidebar = useCallback(() => {
    const windowId = browserWindowIdRef.current;
    return sendRuntime({
      type: "POPUP_OPEN_SIDEBAR",
      ...(windowId ? { windowId } : {}),
    });
  }, []);

  const updateReaderPrefs = useCallback(
    (patch: {
      analyticsConsent?: boolean;
      surface?: "popup" | "sidebar";
      themeStyle?: ThemeStyle;
      colorScheme?: ColorScheme;
      readingFont?: ReadingFont;
      readingSize?: ReadingSize;
      density?: DisplayDensity;
      translateX?: boolean;
      homeOrder?: Platform[];
      homeColumnWidths?: Partial<Record<Platform, number>>;
      homeHiddenMedia?: HomeHiddenMedia[];
    }) => {
      if (patch.density !== undefined || patch.translateX !== undefined) {
        setState((s) => {
          const settings: Settings = {
            ...s.settings,
            ...(patch.density !== undefined ? { density: patch.density } : {}),
            ...(patch.translateX !== undefined ? { translateX: patch.translateX } : {}),
          };
          if (!previewModeRef.current) void storageSet({ settings });
          return { ...s, settings };
        });
        return;
      }
      if (patch.homeOrder || patch.homeColumnWidths || patch.homeHiddenMedia !== undefined) {
        setState((s) => {
          const settings: Settings = {
            ...s.settings,
            ...(patch.homeOrder ? { homeOrder: sanitizeHomeOrder(patch.homeOrder) } : {}),
            ...(patch.homeColumnWidths ? { homeColumnWidths: patch.homeColumnWidths } : {}),
            ...(patch.homeHiddenMedia !== undefined ? { homeHiddenMedia: patch.homeHiddenMedia } : {}),
          };
          if (!previewModeRef.current) void storageSet({ settings });
          return { ...s, settings };
        });
        return;
      }
      if (patch.analyticsConsent !== undefined) {
        const consent = patch.analyticsConsent;
        const previousConsent = state.settings.analyticsConsent === true;
        const settings = { ...state.settings, analyticsConsent: consent };
        setState((s) => ({ ...s, settings }));
        if (!previewModeRef.current) {
          void (async () => {
            try {
              await sendRuntime({
                type: "ANALYTICS_SET_SURFACE",
                surface: settings.surface === "popup" ? "popup" : "sidebar",
              });
              const response = await sendRuntime({
                type: "ANALYTICS_SET_CONSENT",
                enabled: consent,
              });
              if (response?.ok !== true) throw new Error("analytics consent rejected");
            } catch {
              let current: Record<string, unknown> | null = null;
              try {
                current = await storageGet(["analyticsConsent"]);
              } catch {
                // Fall back to the last in-memory consent value when storage cannot be read.
              }
              const restoredConsent =
                typeof current?.analyticsConsent === "boolean"
                  ? current.analyticsConsent
                  : previousConsent;
              setState((s) => ({
                ...s,
                settings: { ...s.settings, analyticsConsent: restoredConsent },
              }));
              showToast(consent ? "无法启用统计与错误报告" : "无法更新统计同意设置");
              return;
            }
            const current = await storageGet(["analyticsConsent"]);
            if (current && typeof current.analyticsConsent === "boolean")
              setState((s) => ({
                ...s,
                settings: { ...s.settings, analyticsConsent: current.analyticsConsent as boolean },
              }));
          })();
        }
        return;
      }
      if (
        patch.surface &&
        patch.surface !== (state.settings.surface === "popup" ? "popup" : "sidebar")
      ) {
        const settings: Settings = { ...state.settings, surface: patch.surface };
        const next = patch.surface;
        captureAnalytics("settings_changed", { field: "surface", value: next });
        const opening =
          next === "sidebar" && !previewModeRef.current && detectShellMode() !== "sidebar"
            ? requestSidebar()
            : null;
        void (async () => {
          if (!previewModeRef.current) await storageSet({ settings });
          setState((s) => ({ ...s, settings }));
          if (opening) {
            const response = await opening;
            if (response.ok) {
              window.close();
              return;
            }
            setNotice("侧栏没有马上打开。请点一次工具栏上的扩展图标。", true);
            return;
          }
          showToast(
            previewModeRef.current
              ? "演示模式：形态只保存在当前预览"
              : next === "sidebar"
                ? "已改为侧栏，点击扩展图标打开或收起"
                : "已改为弹窗，点击扩展图标打开或收起",
          );
        })();
        return;
      }

      const appearancePatch =
        patch.themeStyle !== undefined ||
        patch.colorScheme !== undefined ||
        patch.readingFont !== undefined ||
        patch.readingSize !== undefined
          ? normalizeAppearance({
              themeStyle: patch.themeStyle ?? state.settings.themeStyle,
              colorScheme: patch.colorScheme ?? state.settings.colorScheme,
              readingFont: patch.readingFont ?? state.settings.readingFont,
              readingSize: patch.readingSize ?? state.settings.readingSize,
            })
          : null;

      if (appearancePatch) {
        clearSessionUrlOverride();
        applyAppearance(appearancePatch);
        const settings: Settings = {
          ...state.settings,
          themeStyle: appearancePatch.themeStyle,
          colorScheme: appearancePatch.colorScheme,
          readingFont: appearancePatch.readingFont,
          readingSize: appearancePatch.readingSize,
        };
        setState((s) => ({ ...s, settings }));
        const changedField =
          patch.themeStyle !== undefined
            ? "themeStyle"
            : patch.colorScheme !== undefined
              ? "colorScheme"
              : patch.readingFont !== undefined
                ? "readingFont"
                : "readingSize";
        captureAnalytics("settings_changed", {
          field: changedField,
          value: settings[changedField as keyof Settings],
        });
        if (previewModeRef.current) {
          showToast("演示模式：外观只保存在当前预览");
          return;
        }
        void storageSet({ settings });
        showToast("外观已更新");
      }
    },
    [captureAnalytics, requestSidebar, setNotice, showToast, state.settings],
  );

  const previewNotification = useCallback(async (): Promise<{
    ok: boolean;
    error: string;
    needsSettings?: boolean;
  }> => {
    if (previewModeRef.current) {
      return { ok: false, error: "演示模式不会弹出系统通知" };
    }
    const response = await sendRuntime({ type: "POPUP_NOTIFY_TEST" });
    if (response.ok) {
      // 本机 Chrome / Alerts 权限经常已是允许；API 成功只说明扩展侧创建了，横幅仍可能被 Chrome 通知助手吞掉。
      showToast("已创建通知，请看屏幕右上角或通知中心");
      return { ok: true, error: "", needsSettings: false };
    }
    const reason = String(response.reason || response.error || "");
    if (reason === "NO_BACKGROUND") {
      return { ok: false, error: "后台没有响应，请在 chrome://extensions 重新加载扩展后再试" };
    }
    if (reason === "NOTIFICATIONS_DENIED" || reason === "NO_NOTIFICATIONS") {
      openNotificationSettings();
      showToast("系统通知权限被关闭，已打开系统设置 › 通知");
      return {
        ok: false,
        error:
          "系统通知权限被关闭。请在「系统设置 › 通知」里找到 Google Chrome（不是 ego lite）与 Google Chrome Helper (Alerts) 并打开后重试。",
        needsSettings: true,
      };
    }
    return {
      ok: false,
      error: reason || "浏览器没有弹出系统通知",
      needsSettings: false,
    };
  }, [showToast]);

  const toggleNotify = useCallback(() => {
    let next = true;
    setState((s) => {
      next = !(s.settings.notify !== false);
      const settings = { ...s.settings, notify: next };
      if (!previewModeRef.current) void storageSet({ settings });
      return { ...s, settings };
    });
    if (previewModeRef.current) {
      showToast(next ? "演示模式：已开启提醒（不弹系统通知）" : "演示模式：已关闭提醒");
      return;
    }
    void (async () => {
      if (next && typeof chrome !== "undefined" && chrome?.notifications?.getPermissionLevel) {
        try {
          const level = await new Promise<string>((resolve) => {
            chrome.notifications.getPermissionLevel((value) => resolve(String(value || "")));
          });
          if (level === "denied") {
            openNotificationSettings();
            showToast("系统通知权限被关闭，已打开系统设置 › 通知");
            return;
          }
        } catch {
          /* ignore */
        }
      }
      void sendRuntime({ type: "POPUP_NOTIFY_SET", enabled: next });
      captureAnalytics("notification_preference_changed", { enabled: next });
      showToast(next ? "已开启关注更新提醒" : "已关闭关注更新提醒");
    })();
  }, [captureAnalytics, showToast]);

  const addSource = useCallback(
    async (
      input: string,
      hint?: {
        id?: string;
        name?: string;
        avatar?: string;
        platform?: string;
      },
    ) => {
      const raw = String(input || "").trim();
      if (!raw) return { ok: false as const, error: "EMPTY" };
      const spec = peekSourceInput(raw);
      if ("error" in spec) return { ok: false as const, error: spec.error };
      if (!isSupportedPlatform(spec.platform) || (hint?.platform && !isSupportedPlatform(hint.platform))) {
        return { ok: false as const, error: "UNSUPPORTED_PLATFORM" };
      }
      // 候选 hint 的 id 必须与解析目标一致，防止串写
      if (hint?.id) {
        const same =
          spec.platform === "x"
            ? hint.id.toLowerCase() === String(spec.id).toLowerCase()
            : String(hint.id) === String(spec.id);
        if (!same) return { ok: false as const, error: "HINT_MISMATCH" };
      }

      if (previewModeRef.current) {
        const source: FeedSource = {
          platform: spec.platform,
          id: spec.id,
          name: String(
            hint?.name ||
              (spec.platform === "x"
                ? "@" + spec.id
                : spec.platform === "weibo"
                  ? "微博用户 " + spec.id
                  : spec.id),
          ),
          avatar: String(hint?.avatar || ""),
        };
        const key = feedKey(source);
        setState((s) => ({
          ...s,
          sources: [...s.sources.filter((item) => feedKey(item) !== key), source],
          timelines: s.timelines[key] ? s.timelines : { ...s.timelines, [key]: [] },
          timelinePaging: { ...s.timelinePaging, [key]: { page: 1, done: true } },
          timelineSync: { ...s.timelineSync, [key]: Date.now() },
        }));
        showToast("演示模式：已添加「" + (source.name || source.id) + "」");
        return { ok: true as const, source };
      }

      const response = await sendRuntime({
        type: "POPUP_ADD_SOURCE",
        input: raw,
        platform: spec.platform,
        hint: hint
          ? {
              id: String(hint.id || spec.id),
              name: String(hint.name || ""),
              avatar: String(hint.avatar || ""),
            }
          : undefined,
      });
      if (response.ok && response.source) {
        const source = response.source as FeedSource;
        // 前端再拦一层：落盘身份必须是请求目标
        if (String(source.id) !== String(spec.id)) {
          return { ok: false as const, error: "PROFILE_MISMATCH" };
        }
        const key = feedKey(source);
        // 用 ref 取最新列表，避免批量添加时第二个账号覆盖第一个账号。
        const nextSources = [...sourcesRef.current.filter((item) => feedKey(item) !== key), source];
        sourcesRef.current = nextSources;
        setState((s) => ({ ...s, sources: nextSources }));
        // 新增订阅必须写回本地 storage；游客没有云同步通知，这一步不能省。
        await storageSet({ sources: nextSources });
        captureAnalytics("source_added", {
          platform: source.platform,
          count: Math.min(1000, nextSources.length),
        });
        void notifyLocalSubscriptionChange("subscribe", source, true);
        showToast("已添加「" + (source.name || source.id) + "」");
        return { ok: true as const, source };
      }
      return {
        ok: false as const,
        error: String(response.error || response.reason || "ADD_FAILED"),
      };
    },
    [
      captureAnalytics,
      showToast,
      state.platformSessions.weibo,
      state.sources.length,
      state.status,
    ],
  );

  const removeSource = useCallback(
    async (key: string) => {
      const currentSources = sourcesRef.current;
      const removed = currentSources.find((s) => feedKey(s) === key);
      const next = currentSources.filter((s) => feedKey(s) !== key);
      sourcesRef.current = next;
      setState((s) => ({ ...s, sources: next }));
      if (!previewModeRef.current) {
        await storageSet({ sources: next });
        if (removed) void notifyLocalSubscriptionChange("unsubscribe", removed, false);
      }
      if (activeFeedKey === key) await selectFeed(FEED_ALL);
      const platform = parseFeedKey(key).platform;
      if (platform === "x" || platform === "xueqiu" || platform === "weibo") {
        captureAnalytics("source_removed", {
          platform,
          count: Math.max(0, next.length),
        });
      }
      showToast("已移除信息源");
    },
    [activeFeedKey, captureAnalytics, selectFeed, showToast],
  );

  const importSources = useCallback(
    async (imported: FeedSource[]) => {
      const currentSources = sourcesRef.current;
      const merged = mergeSubscriptionSources(currentSources, imported);
      if (!merged.added) {
        showToast("备份中的订阅已全部存在");
        return { ok: true as const, added: 0, total: merged.sources.length };
      }
      sourcesRef.current = merged.sources;
      setState((s) => ({ ...s, sources: merged.sources }));
      if (!previewModeRef.current) {
        await storageSet({ sources: merged.sources });
        const existed = new Set(currentSources.map((source) => feedKey(source)));
        for (const source of merged.sources) {
          if (!existed.has(feedKey(source)))
            void notifyLocalSubscriptionChange("subscribe", source, true);
        }
      }
      showToast(`已从备份导入 ${merged.added} 个订阅`);
      return { ok: true as const, added: merged.added, total: merged.sources.length };
    },
    [showToast],
  );


  type PickerCandidate = { id: string; name?: string; avatar?: string; followers?: number };
  const asPickerCandidates = (value: unknown): PickerCandidate[] => {
    if (!Array.isArray(value)) return [];
    const out: PickerCandidate[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = String(rec.id || "").trim();
      if (!id) continue;
      const next: PickerCandidate = { id };
      if (typeof rec.name === "string" && rec.name) next.name = rec.name;
      if (typeof rec.avatar === "string" && rec.avatar) next.avatar = rec.avatar;
      if (typeof rec.followers === "number") next.followers = rec.followers;
      out.push(next);
    }
    return out;
  };

  const searchXUsers = useCallback(async (query: string) => {
    if (previewModeRef.current) {
      // 演示远端池：含完整推荐基线，便于与本地过滤合并（如 karpathy）
      const q = String(query || "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");
      if (!q) return { ok: true, users: [], error: "" };
      const pool = [
        ...X_SUGGESTIONS.map((s) => ({ id: s.id, name: s.name, followers: 0 })),
        { id: "preview_x", name: "Demo X User", followers: 0 },
      ];
      const users = pool.filter(
        (u) => u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
      );
      return { ok: true, users, error: "" };
    }
    const response = await sendRuntime({ type: "POPUP_SEARCH_X_USERS", query });
    return {
      ok: response.ok !== false,
      users: asPickerCandidates(response.users),
      error: response.error ? String(response.error) : "",
    };
  }, []);

  const searchUsers = useCallback(
    async (platform: "xueqiu" | "weibo", query: string) => {
      if (!isSupportedPlatform(platform)) {
        return { ok: false, users: [], error: "UNSUPPORTED_PLATFORM" };
      }
      if (previewModeRef.current) return { ok: true, users: [], error: "" };
      const response = await sendRuntime({ type: "POPUP_SEARCH_USERS", platform, query });
      return {
        ok: response.ok !== false,
        users: asPickerCandidates(response.users),
        error:
          String(response.error || "") === "NO_RESULTS"
            ? ""
            : response.error
              ? String(response.error)
              : "",
      };
    },
    [],
  );

  const loadXFollowing = useCallback(async (force = false) => {
    if (previewModeRef.current) return { ok: true, users: [], reason: "preview" };
    const response = await sendRuntime({ type: "POPUP_X_FOLLOWING", force: !!force });
    return {
      ok: response.ok === true,
      users: asPickerCandidates(response.users),
      reason: response.reason ? String(response.reason) : "",
    };
  }, []);

  const loadWeiboFollowing = useCallback(async (force = false) => {
    if (previewModeRef.current) {
      return {
        ok: true,
        users: [
          { id: "20001", name: "演示微博用户甲", avatar: "", followers: 1200 },
          { id: "20002", name: "演示微博用户乙", avatar: "", followers: 860 },
        ],
        reason: "preview",
      };
    }
    const response = await sendRuntime({ type: "POPUP_WEIBO_FOLLOWING", force: !!force });
    return {
      ok: response.ok === true,
      users: asPickerCandidates(response.users),
      reason: response.reason ? String(response.reason) : "",
    };
  }, []);

  const openWindow = useCallback(async () => {
    if (previewModeRef.current) {
      showToast("演示模式不支持独立窗口");
      return;
    }
    const response = await sendRuntime({ type: "POPUP_OPEN_WINDOW" });
    if (response.ok) window.close();
    else setNotice("独立窗口没有打开成功，可在浏览器窗口里重试。", true);
  }, [setNotice, showToast]);

  /** 侧栏切回工具栏普通弹窗（popup），不是独立窗口 */
  const openPopup = useCallback(() => {
    if (previewModeRef.current) {
      showToast("演示模式：当前即为弹窗布局");
      return;
    }
    if (detectShellMode() !== "sidebar") {
      showToast("已在弹窗中");
      return;
    }

    // 先在用户手势里打开弹窗（勿先 await，否则可能丢掉 gesture）
    let openAttempt: Promise<void> | null = null;
    try {
      if (hasChromeRuntime() && chrome.action?.openPopup) {
        openAttempt = Promise.resolve(chrome.action.openPopup()).then(() => undefined);
      }
    } catch {
      openAttempt = null;
    }

    // 并行关闭侧栏（Chrome 141+）；失败可忽略
    try {
      if (hasChromeRuntime() && chrome.windows?.getCurrent) {
        chrome.windows.getCurrent((win) => {
          void chrome.runtime.lastError;
          const windowId = win?.id;
          const closer = (
            chrome.sidePanel as
              | { close?: (opts: { windowId: number }) => Promise<void> }
              | undefined
          )?.close;
          if (windowId && typeof closer === "function") {
            void closer.call(chrome.sidePanel, { windowId }).catch(() => {});
          }
        });
      }
    } catch {
      /* noop */
    }

    void (async () => {
      if (openAttempt) {
        try {
          await openAttempt;
          return;
        } catch {
          /* 回退到后台 */
        }
      }
      const response = await sendRuntime({ type: "POPUP_OPEN_POPUP" });
      if (!response.ok) {
        showToast("请点击工具栏扩展图标打开弹窗");
      }
    })();
  }, [showToast]);

  const switchSurface = useCallback(async () => {
    if (previewModeRef.current) {
      showToast("演示模式不支持切换打开形态");
      return;
    }
    const mode = detectShellMode();
    const next = mode === "sidebar" ? "popup" : "sidebar";
    const settings: Settings = { ...state.settings, surface: next };

    if (next === "sidebar") {
      // 点击当帧就发消息，后台同步 open。先 await 查窗口会丢掉用户手势。
      const opening = requestSidebar();
      await storageSet({ settings });
      setState((s) => ({ ...s, settings }));
      const response = await opening;
      if (response.ok) {
        window.close();
        return;
      }
      setNotice("侧栏没有马上打开。请再点一次工具栏上的扩展图标。", true);
      return;
    }

    try {
      if (hasChromeRuntime() && chrome.action?.setPopup) {
        await chrome.action.setPopup({ popup: "popup.html" });
      }
    } catch {
      /* 后台会按设置再写一次 */
    }
    let opened = false;
    try {
      if (hasChromeRuntime() && chrome.action?.openPopup) {
        await chrome.action.openPopup();
        opened = true;
      }
    } catch {
      opened = false;
    }
    await storageSet({ settings });
    setState((s) => ({ ...s, settings }));
    if (!opened) showToast("已改为弹窗，点击扩展图标打开");
  }, [requestSidebar, setNotice, showToast, state.settings]);

  const openSidebar = useCallback(async () => {
    if (previewModeRef.current) {
      showToast("演示模式不支持侧栏");
      return;
    }
    if (detectShellMode() === "sidebar") {
      showToast("已在侧栏中");
      return;
    }
    const response = await requestSidebar();
    if (response.ok) window.close();
    else setNotice("侧栏没有打开。请点一次工具栏上的扩展图标。", true);
  }, [requestSidebar, setNotice, showToast]);

  const reloadTab = useCallback(async () => {
    if (previewModeRef.current) {
      showToast("演示模式：无需刷新雪球页面");
      return;
    }
    const response = await sendRuntime({ type: "POPUP_RELOAD_TAB" });
    if (!response.ok) {
      setNotice("无法打开雪球页面，请检查网络后重试。", true);
      return;
    }
    setNotice("已刷新雪球页面，等待插件重新接管…");
    window.setTimeout(() => {
      void sendRuntime({ type: "POPUP_ACCOUNT_REQUEST", force: true });
    }, 2600);
  }, [setNotice, showToast]);

  const retryAccount = useCallback(async () => {
    if (previewModeRef.current) {
      showToast("演示模式：账号状态来自 fixture");
      return;
    }
    setState((s) => ({ ...s, status: "checking", pageError: "" }));
    const session = await sendRuntime({ type: "POPUP_SESSION" });
    if (session.status === "logged-in") {
      setState((s) => ({ ...s, status: "logged-in", session }));
      void sendRuntime({ type: "POPUP_ACCOUNT_REQUEST", force: true });
    } else if (session.status === "logged-out") {
      setState((s) => ({ ...s, status: "logged-out", session, account: null, following: [] }));
    } else {
      setState((s) => ({ ...s, status: "unknown", session }));
    }
  }, [showToast]);

  const maybeLoadMore = useCallback(
    async (opts?: { feedKeys?: string[] }) => {
      const scopedKeys = (
        opts?.feedKeys ?? (isAllFeed ? feedList.map((p) => p.key) : [activeFeedKey])
      ).filter((candidate) => Boolean(candidate) && isSupportedPlatform(parseFeedKey(candidate).platform));
      if (previewModeRef.current) {
        setState((s) => {
          const keys = scopedKeys;
          const timelinePaging = { ...s.timelinePaging };
          for (const key of keys) {
            timelinePaging[key] = { page: timelinePaging[key]?.page || 1, done: true };
          }
          timelinePagingRef.current = timelinePaging;
          return { ...s, timelinePaging, loadingMore: false };
        });
        return;
      }
      const commitPaging = (key: string, nextPaging: { page: number; done: boolean; cursor?: string }) => {
        const merged = { ...timelinePagingRef.current, [key]: nextPaging };
        timelinePagingRef.current = merged;
        setState((s) => ({
          ...s,
          timelinePaging: { ...s.timelinePaging, [key]: nextPaging },
        }));
        void storageSet({ timelinePaging: merged });
      };
      const targets = scopedKeys.filter((key) => {
        const paging = timelinePagingRef.current[key];
        const page = (paging?.page || 1) + 1;
        const cursor = String(paging?.cursor || "");
        const requestKey = `${key}:${page}:${cursor}`;
        return (
          !(paging && paging.done) &&
          !loadMorePending.current.has(key) &&
          !loadMoreRequested.current.has(requestKey)
        );
      });
      if (!targets.length) return;
      setState((s) => ({ ...s, loadingMore: true }));
      for (const key of targets) loadMorePending.current.add(key);
      const restrictedPlatforms = new Set<string>();
      let restrictedRetryAfterMs = 0;
      for (const key of targets) {
        const parsed = parseFeedKey(key);
        if (restrictedPlatforms.has(parsed.platform)) {
          loadMorePending.current.delete(key);
          continue;
        }
        const paging = timelinePagingRef.current[key];
        const page = (paging?.page || 1) + 1;
        const requestKey = `${key}:${page}:${String(paging?.cursor || "")}`;
        loadMoreRequested.current.add(requestKey);
        let response: Record<string, unknown>;
        try {
          response = await sendRuntime({
            type: "POPUP_LOAD_MORE",
            feedKey: key,
            platform: parsed.platform,
            userId: parsed.id,
            page,
            cursor: String(paging?.cursor || ""),
            loadMore: true,
          });
          if (response.limited) {
            const nextPaging = {
              page: paging?.page || 1,
              done: true,
              cursor: String(paging?.cursor || ""),
            };
            commitPaging(key, nextPaging);
            setNotice("微博限制了继续加载，未登录只能看最近一页。", true);
            loadMorePending.current.delete(key);
            continue;
          }
          if (response.platformPause) {
            restrictedPlatforms.add(parsed.platform);
            restrictedRetryAfterMs = Math.max(
              restrictedRetryAfterMs,
              Number(response.retryAfterMs) || 0,
            );
          }
          if (
            response.ok &&
            (typeof response.page === "number" || typeof response.hasMore === "boolean")
          ) {
            const pageNo = Math.max(Number(response.page) || page, paging?.page || 1);
            const nextPaging = {
              page: pageNo,
              done: response.hasMore === false,
              cursor: String(response.cursor || ""),
            };
            commitPaging(key, nextPaging);
            loadMorePending.current.delete(key);
          } else {
            loadMorePending.current.delete(key);
            loadMoreRequested.current.delete(requestKey);
          }
        } catch {
          loadMorePending.current.delete(key);
          loadMoreRequested.current.delete(requestKey);
        }
      }
      if (!loadMorePending.current.size) {
        setState((s) => ({ ...s, loadingMore: false }));
      }
      if (restrictedPlatforms.size) {
        const retryAfterMs = restrictedRetryAfterMs;
        setNotice(
          retryAfterMs > 0
            ? `请求受限，已停止继续加载该平台内容；约 ${Math.max(1, Math.ceil(retryAfterMs / 60000))} 分钟后再试。`
            : "平台暂时限制了请求，已停止继续加载该平台内容；请等待冷却后再试。",
          true,
        );
      }
    },
    [
      activeFeedKey,
      feedList,
      isAllFeed,
      state.loadingMore,
      state.refreshing,
      state.timelinePaging,
      visiblePosts.length,
      setNotice,
    ],
  );

  const openPost = useCallback(
    (post: Post) => {
      if (!post.url && !(post.handle && post.id)) return;
      const platform = String(post.platform || post.feedPlatform || "");
      // 发现页帖子来自 X DOM，统一按作者 handle + status id 组装原帖地址，
      // 避免带着搜索页或重定向地址打开到错误 tab。
      const targetUrl =
        platform === "x" && post.handle && /^\d+$/.test(String(post.id))
          ? `https://x.com/${encodeURIComponent(String(post.handle).replace(/^@/, ""))}/status/${encodeURIComponent(String(post.id))}`
          : post.url;
      if (!targetUrl) return;
      openTab(targetUrl);
      if (platform === "x" || platform === "xueqiu" || platform === "weibo") {
        captureAnalytics("original_opened", { platform });
      }
    },
    [captureAnalytics],
  );

  const applyDemoFixture = useCallback((mode: DemoMode) => {
    const mock = buildPreviewStorage(mode);
    const url = new URL(location.href);
    url.searchParams.set("demo", mode);
    window.history.replaceState({}, "", url.toString());
    setState((s) => ({
      ...s,
      sources: mock.sources,
      following: mock.following,
      selectedFeedKey: mock.selectedFeedKey,
      selectedUserId: mock.selectedUserId,
      timelines: mock.timelines,
      timelineSync: mock.timelineSync,
      timelineAck: baselineTimelineAck(mock.timelines, mock.timelineSync, {}) || {},
      timelineFresh: {},
      timelineError: mock.timelineError,
      timelinePaging: mock.timelinePaging,
      settings: { ...DEFAULT_SETTINGS, ...mock.settings },
      account: mock.account,
      status: mock.status,
      platformSessions: mock.platformSessions,
      refreshing: mock.refreshing,
      loadingMore: mock.loadingMore,
      notice: mock.notice,
      previewMode: true,
      previewBanner: PREVIEW_BANNER,
      demoMode: mode,
      openAddDialog: !!mock.openAddDialog,
      addPickerTab: fallbackPickerTab(mock.addPickerTab || "x"),
      diagnostics: null,
      pageError: "",
    }));
  }, []);

  const setOpenAddDialog = useCallback((open: boolean) => {
    setState((s) => ({ ...s, openAddDialog: open }));
  }, []);

  // 外观：跟随系统时监听 prefers-color-scheme；设置变化时重新套用（URL 会话覆盖优先）
  useEffect(() => {
    const appearance = mergeAppearance(state.settings);
    applyAppearance(appearance);
    if (appearance.colorScheme !== "system" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(appearance, mq.matches);
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [
    state.settings.colorScheme,
    state.settings.themeStyle,
    state.settings.readingFont,
    state.settings.readingSize,
  ]);

  // 设置里的形态与当前页面不一致时关掉当前页，保证 popup 与 sidebar 不同时存在
  useEffect(() => {
    if (!shellReady || !hasChromeRuntime() || previewModeRef.current) return;
    const surface = state.settings.surface === "popup" ? "popup" : "sidebar";
    const mode = detectShellMode();
    if (mode === "window" || mode === "home") return;
    if (mode === "popup" && surface === "sidebar") {
      window.close();
      return;
    }
    if (mode === "sidebar" && surface === "popup") {
      chrome.windows.getCurrent((win) => {
        void chrome.runtime.lastError;
        const windowId = win?.id;
        const close = (
          chrome.sidePanel as { close?: (opts: { windowId: number }) => Promise<void> } | undefined
        )?.close;
        if (windowId && typeof close === "function") {
          void close.call(chrome.sidePanel, { windowId }).catch(() => {});
        }
      });
    }
  }, [shellReady, state.settings.surface]);

  // boot
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    applyShellMode();

    let cancelled = false;
    (async () => {
      if (!hasChromeRuntime()) {
        const mode = parseDemoMode(params.get("demo"));
        if (cancelled) return;
        applyDemoFixture(mode);
        setShellReady(true);
        return;
      }

      const data = await storageGet(null);
      if (cancelled || !data) {
        if (!cancelled) setShellReady(true);
        return;
      }
      // 只在存储里还没有 sources 键时初始化。升级或读失败都不能把已订阅用户写成空。
      if (!Object.prototype.hasOwnProperty.call(data, "sources")) {
        const seeds = DEFAULT_SOURCES.map((s) => ({
          platform: s.platform,
          id: String(s.id),
          name: String(s.name || ""),
          avatar: String(s.avatar || ""),
        }));
        await storageSet({ sources: seeds });
        data.sources = seeds as unknown as never;
      }
      if (data.loggedIn === true && Array.isArray(data.following) && data.following.length) {
        setState((s) => ({ ...s, status: "logged-in" }));
      }
      applyLoaded(data);
      await sendRuntime({
        type: "ANALYTICS_SET_SURFACE",
        surface:
          data.settings && (data.settings as Settings).surface === "popup" ? "popup" : "sidebar",
      });
      if (
        data.settings &&
        typeof data.settings === "object" &&
        ANALYTICS_BUILD_ENABLED &&
        (data.settings as Settings).analyticsConsent !== false &&
        !analyticsSentRef.current
      ) {
        analyticsSentRef.current = true;
        captureAnalytics("reader_opened", {
          count: Array.isArray(data.sources) ? Math.min(1000, data.sources.length) : 0,
        });
      }
      setShellReady(true);
      await probeSessions(false);
    })();

    return () => {
      cancelled = true;
      if (watchTimer.current) window.clearTimeout(watchTimer.current);
    };
  }, [applyDemoFixture, applyLoaded, captureAnalytics, probeSessions]);

  // runtime messages + storage（正式扩展）
  useEffect(() => {
    if (!hasChromeRuntime()) return;

    const onMessage = (message: { type?: string; [key: string]: unknown }) => {
      if (!message?.type) return;
      if (message.type === "SESSION_CHANGED") {
        type SessionBag = { status?: PlatformLoginStatus };
        const bag = message.sessions as
          | {
              xueqiu?: SessionBag | PlatformLoginStatus;
              x?: SessionBag | PlatformLoginStatus;
              weibo?: SessionBag | PlatformLoginStatus;
            }
          | undefined;
        const pick = (
          raw: SessionBag | PlatformLoginStatus | undefined,
          fallback: PlatformLoginStatus,
        ) => {
          if (!raw) return fallback;
          if (typeof raw === "string") return raw;
          return raw.status || fallback;
        };
        if (bag) {
          applyPlatformSessions(
            {
              xueqiu: pick(bag.xueqiu, "unknown"),
              x: pick(bag.x, "unknown"),
              weibo: pick(bag.weibo, "unknown"),
            },
            message.session as Record<string, unknown> | undefined,
          );
        } else if (message.session) {
          const session = message.session as Record<string, unknown>;
          applyPlatformSessions(
            {
              xueqiu: classifyXueqiuSession({
                readable: session.readable !== false,
                uid: session.uid as string | undefined,
                hasLoginFlag: !!session.hasLoginFlag,
                hasToken: !!session.hasToken,
              }),
              x: state.platformSessions.x,
              weibo: state.platformSessions.weibo,
            },
            session,
          );
        }
        return;
      }
      if (message.type === "ACCOUNT_RESULT") {
        if (watchTimer.current) window.clearTimeout(watchTimer.current);
        setState((s) => {
          const status = String(
            message.status ||
              (message.loggedIn === true
                ? "logged-in"
                : message.loggedIn === false
                  ? "logged-out"
                  : "unknown"),
          ) as AccountStatus;
          const sessionSaysLoggedIn = s.session && s.session.status === "logged-in";
          const nextStatus = status === "logged-out" && sessionSaysLoggedIn ? "logged-in" : status;
          // 登录恢复可更新账号/关注；若当前已有选中 source，不要被 ACCOUNT_RESULT 的默认选中键覆盖
          const incomingFeed = String(message.selectedFeedKey || "");
          const keepFeed =
            s.selectedFeedKey && s.sources.some((src) => feedKey(src) === s.selectedFeedKey);
          return {
            ...s,
            status: nextStatus,
            platformSessions: {
              ...s.platformSessions,
              xueqiu:
                nextStatus === "logged-in"
                  ? "logged-in"
                  : nextStatus === "logged-out"
                    ? "logged-out"
                    : s.platformSessions.xueqiu,
            },
            account: (message.account as ReaderState["account"]) || s.account,
            following: (() => {
              if (!Array.isArray(message.following)) return s.following;
              const incoming = message.following as ReaderState["following"];
              if (!incoming.length && s.following.length && nextStatus !== "logged-out") {
                return s.following;
              }
              return incoming;
            })(),
            selectedUserId: keepFeed
              ? s.selectedUserId
              : String(message.selectedUserId || s.selectedUserId),
            selectedFeedKey: keepFeed ? s.selectedFeedKey : incomingFeed || s.selectedFeedKey,
            diagnostics: (message.diagnostics as Record<string, unknown>) || s.diagnostics,
            pageError: "",
          };
        });
        return;
      }
      if (message.type === "USER_LOADING") {
        // POPUP_LOAD_USER（点头像切换）与 POPUP_REFRESH 都会广播 USER_LOADING。
        // refreshing 只由 refresh()/下拉刷新置位，这里不要误开侧栏转圈与下拉「正在更新」。
        return;
      }
      if (message.type === "USER_TIMELINE_RESULT") {
        const resultKey = String(message.feedKey || message.userId || "");
        const resultLegacy = /^\d+$/.test(resultKey) ? "xueqiu:" + resultKey : resultKey;
        const hasPagingFields =
          typeof message.page === "number" || typeof message.hasMore === "boolean";
        setState((s) => {
          const next: typeof s = {
            ...s,
            refreshing: message.loadMore ? s.refreshing : false,
            // 头像切换时的「正在读取动态…」在结果回来后收掉
            notice: s.notice === "正在读取动态…" ? "" : s.notice,
          };
          if (message.ok && hasPagingFields && resultLegacy) {
            const prev = s.timelinePaging[resultLegacy] || { page: 1, done: false, cursor: "" };
            const pageNo = Math.max(
              Number(message.page) || prev.page || 1,
              message.loadMore ? prev.page || 1 : 1,
            );
            next.timelinePaging = {
              ...s.timelinePaging,
              [resultLegacy]: {
                page: message.loadMore ? pageNo : Number(message.page) || 1,
                done: message.hasMore === false,
                cursor:
                  message.cursor !== undefined
                    ? String(message.cursor || "")
                    : String(prev.cursor || ""),
              },
            };
          }
          return next;
        });
        if (message.loadMore) {
          loadMorePending.current.delete(resultLegacy);
          if (!loadMorePending.current.size) setState((s) => ({ ...s, loadingMore: false }));
          if (message.limited)
            setNotice("微博限制了继续加载，未登录只能看最近一页。", true);
          else if (message.platformPause)
            setNotice("平台暂时限制了请求，已停止继续翻页；请等待冷却后再试。", true);
          return;
        }
        if (!message.ok) {
          if (message.platformPause)
            setNotice(
              "平台暂时限制了请求，已暂停继续刷新；约 " +
                Math.max(1, Math.ceil((Number(message.retryAfterMs) || 300000) / 60000)) +
                " 分钟后再试。",
              true,
            );
          else setNotice("读取失败：" + (message.error || "接口暂不可用"));
        }
        return;
      }
      if (message.type === "TIMELINE_UPDATED") {
        if (storageTimer.current) window.clearTimeout(storageTimer.current);
        storageTimer.current = window.setTimeout(() => {
          void storageGet(null).then((stored) => {
            if (stored) applyLoaded(stored);
          });
        }, 80);
      }
    };

    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (
        changes.timelines ||
        changes.timelineSync ||
        changes.timelineAck ||
        changes.timelineFresh ||
        changes.selectedUserId ||
        changes.selectedFeedKey ||
        changes.sources ||
        changes.settings
      ) {
        // 故意不监听 authorReadAt 变更来驱动 UI
        if (storageTimer.current) window.clearTimeout(storageTimer.current);
        storageTimer.current = window.setTimeout(() => {
          void storageGet(null).then((stored) => {
            if (stored) applyLoaded(stored);
          });
        }, 80);
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") void probeSessions(false);
    };
    const onFocus = () => {
      void probeSessions(false);
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.onChanged.addListener(onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [applyLoaded, applyPlatformSessions, probeSessions, showToast, state.platformSessions.x]);

  const syncLabel = useMemo(() => {
    if (isAllFeed) {
      let max = 0;
      for (const person of feedList) {
        const t = Number(state.timelineSync[person.key] || 0);
        if (t > max) max = t;
      }
      return formatSync(max);
    }
    return formatSync(Number(state.timelineSync[activeFeedKey] || 0));
  }, [activeFeedKey, feedList, isAllFeed, state.timelineSync]);

  const countLabel = useMemo(() => {
    const shown = visiblePosts.length;
    const query = String(state.settings.query || "").trim();
    if (!feedList.length) return "正在读取信息源…";
    if (isAllFeed) {
      let rawTotal = 0;
      for (const person of feedList) {
        const rawList = Array.isArray(state.timelines[person.key])
          ? state.timelines[person.key]
          : [];
        rawTotal += rawList.map((p) => sanitizeFeedPost(p, person.key)).filter(Boolean).length;
      }
      const amount = query && shown !== rawTotal ? "命中 " + shown + "/" + rawTotal : String(shown);
      return "全部 · " + amount + " 条 · " + feedList.length + " 个源";
    }
    const selected = feedList.find((p) => p.key === activeFeedKey);
    const rawList = Array.isArray(state.timelines[activeFeedKey])
      ? state.timelines[activeFeedKey]
      : [];
    const visibleTotal = rawList
      .map((p) => sanitizeFeedPost(p, activeFeedKey))
      .filter(Boolean).length;
    if (!selected) return "正在读取信息源…";
    if (!visibleTotal && state.timelineError[activeFeedKey]) {
      return (selected.name || selected.id) + " · 读取失败";
    }
    const amount =
      query && shown !== visibleTotal ? "命中 " + shown + "/" + visibleTotal : String(visibleTotal);
    return (selected.name || selected.id) + " · " + amount + " 条";
  }, [
    activeFeedKey,
    feedList,
    isAllFeed,
    state.settings.query,
    state.timelineError,
    state.timelines,
    visiblePosts.length,
  ]);

  const ready =
    state.status === "logged-in" ||
    state.sources.length > 0 ||
    feedList.length > 0 ||
    state.previewMode;
  const showLogin = false;

  const openXueqiuLogin = useCallback(() => {
    if (previewModeRef.current) {
      showToast("演示模式：请在真实扩展中打开雪球登录页");
      return;
    }
    // 雪球登录入口：打开官网，未登录会进入登录流程
    openTab("https://xueqiu.com/");
  }, [showToast]);

  const openXLogin = useCallback(() => {
    if (previewModeRef.current) {
      showToast("演示模式：请在真实扩展中打开 X 登录页");
      return;
    }
    openTab("https://x.com/i/flow/login");
  }, [showToast]);

  const openWeiboLogin = useCallback(() => {
    if (previewModeRef.current) {
      showToast("演示模式：请在真实扩展中打开微博登录页");
      return;
    }
    openTab("https://weibo.com/login.php");
  }, [showToast]);


  const previewSimulateFresh = useCallback((count = 2) => {
    if (!previewModeRef.current) return 0;
    const add = Math.max(1, Math.min(10, Number(count) || 2));
    const stamp = Date.now();
    setState((s) => {
      const target =
        Object.keys(s.timelines).find((key) => key.startsWith("xueqiu:")) || Object.keys(s.timelines)[0];
      if (!target) return s;
      const existing = Array.isArray(s.timelines[target]) ? s.timelines[target] : [];
      const fresh = Array.from({ length: add }, (_, index) => {
        const id = String(950000 + (stamp % 10000) * 10 + index + 1);
        return {
          id,
          userId: "10001",
          authorName: "演示雪球用户甲",
          title: "【新帖 " + String(index + 1) + "】不应把原顶部顶走",
          summary: "新插入的验收帖。应出现在原顶部帖上方，且不把视口钉到新顶部。",
          timestamp: stamp + (add - index) * 1000,
          timeText: "",
          source: "preview",
          url: "https://xueqiu.com/10001/" + id,
          feedKey: target,
          platform: "xueqiu" as const,
          isRetweet: false,
          likeCount: 0,
          replyCount: 0,
          retweetCount: 0,
          quoted: null,
          mediaUrls:
            index === 0
              ? [
                  "/fixtures/avatar-demo-x.svg",
                ]
              : ["/fixtures/avatar-demo-x2.svg"],
        };
      });
      const timelineFresh = { ...s.timelineFresh, [target]: fresh.map((post) => post.id) };
      return {
        ...s,
        timelines: { ...s.timelines, [target]: [...fresh, ...existing] },
        timelineFresh,
      };
    });
    return add;
  }, []);

  useEffect(() => {
    if (!state.previewMode) return;
    const host = window as Window & { __owlivoPreviewSimulateFresh?: (count?: number) => number };
    host.__owlivoPreviewSimulateFresh = (count?: number) => previewSimulateFresh(count);
    return () => {
      delete host.__owlivoPreviewSimulateFresh;
    };
  }, [previewSimulateFresh, state.previewMode]);

  return {
    state,
    feedList,
    visiblePosts,
    activeFeedKey,
    isAllFeed,
    syncLabel,
    countLabel,
    ready,
    showLogin,
    selectFeed,
    refresh,
    acknowledgeLatest,
    toggleSort,
    cycleDensity,
    setQuery,
    toggleNotify,
    updateReaderPrefs,
    previewNotification,
    addSource,
    removeSource,
    importSources,
    searchXUsers,
    searchUsers,
    loadXFollowing,
    loadWeiboFollowing,
    openWindow,
    openPopup,
    openSidebar,
    switchSurface,
    shellMode: detectShellMode() as ShellMode,
    reloadTab,
    retryAccount,
    maybeLoadMore,
    openPost,
    showToast,
    setNotice,
    openTab,
    applyDemoFixture,
    previewSimulateFresh,
    setOpenAddDialog,
    openXueqiuLogin,
    openXLogin,
    openWeiboLogin,
    probeSessions,
  };
}
