import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReaderApp, type SharedReader } from "@/popup/ReaderApp";
import { SharedHomeApp } from "@/popup/HomeApp";
import { FEED_ALL, feedKey, type FeedPerson, type FeedSource } from "@/lib/config";
import { getAgentReaderSources } from "@/lib/agent-reader-sources";
import { buildPreviewStorage, parseDemoMode, PREVIEW_BANNER } from "@/lib/preview-mock";
import { sanitizeFeedPost, type Post } from "@/lib/sanitize";
import { applyAppearance, clearSessionUrlOverride, mergeAppearance, normalizeAppearance } from "@/lib/appearance";
import { pickAvatarSrc } from "@/lib/avatar-url";
import { peekSourceInput } from "@/lib/source-input";
import { collectVisiblePosts } from "@/lib/visible-posts";
import { newestPostTimestamp } from "@/lib/source-update";
import { X_SUGGESTIONS, type XSuggestion } from "@/lib/x-suggestions";
import type { Settings, ReaderState, DisplayDensity } from "@/hooks/useReader";
import { applyShellMode, type ShellMode } from "@/lib/shell-mode";

type FeedResponse = { ok: true; posts: unknown[]; hasMore: boolean; cursor?: string } | { ok: false; error: string; needsLogin?: boolean };
const STORAGE_KEY = "owlivo.agent-reader";
const DEFAULT_SETTINGS: Settings = {
  sort: "desc", query: "", translateX: true, notify: true, surface: "sidebar", themeStyle: "graphite",
  colorScheme: "light", readingFont: "system", readingSize: "md", popupHeight: 600, density: "comfortable", analyticsConsent: true,
};
const emptySessions: ReaderState["platformSessions"] = { xueqiu: "unknown", x: "unknown", weibo: "unknown" };
function readPersisted(): Partial<ReaderState> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function useAgentReader(): SharedReader {
  const [persisted, setPersisted] = useState(readPersisted);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try { const incoming = JSON.parse(event.newValue) as Partial<ReaderState>; setPersisted(incoming); setState((prev) => ({ ...prev, sources: incoming.sources || prev.sources, settings: { ...prev.settings, ...(incoming.settings || {}) }, selectedFeedKey: incoming.selectedFeedKey || prev.selectedFeedKey })); } catch { /* ignore malformed cross-window data */ }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const [state, setState] = useState<ReaderState>(() => ({
    status: "unknown", account: null, session: null, platformSessions: emptySessions, following: [],
    sources: getAgentReaderSources(persisted),
    timelines: {}, timelineSync: {}, timelineAck: {}, timelineFresh: {}, timelineError: {}, timelinePaging: {},
    selectedUserId: "", selectedFeedKey: typeof persisted.selectedFeedKey === "string" ? persisted.selectedFeedKey : FEED_ALL,
    settings: { ...DEFAULT_SETTINGS, ...(persisted.settings && typeof persisted.settings === "object" ? persisted.settings as Partial<Settings> : {}) },
    diagnostics: null, pageError: "", refreshing: false, loadingMore: false, notice: "", previewMode: false,
    previewBanner: "", demoMode: "timeline", openAddDialog: false, addPickerTab: "x",
  }));
  const [activeFeedKey, setActiveFeedKey] = useState(state.selectedFeedKey);
  useEffect(() => { setActiveFeedKey(state.selectedFeedKey); }, [state.selectedFeedKey]);
  const activeFeedKeyRef = useRef(activeFeedKey);
  activeFeedKeyRef.current = activeFeedKey;
  const generation = useRef(0);
  const cursorRef = useRef<Record<string, string>>({});
  const hasMoreRef = useRef<Record<string, boolean>>({});
  const [shellMode, setShellMode] = useState<ShellMode>("sidebar");
  useEffect(() => {
    const mode = new URLSearchParams(location.search).get("mode") === "home" || /home\.html$/i.test(location.pathname) ? "home" : "sidebar";
    setShellMode(applyShellMode(mode));
  }, []);
  const demoModeActive = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  const feedList = useMemo<FeedPerson[]>(() => state.sources.map((source) => {
    const key = feedKey(source);
    const followingAvatar = source.platform === "xueqiu" ? state.following.find((person) => String(person.id) === String(source.id))?.avatar : "";
    const timelineAvatar = (state.timelines[key] as Post[] | undefined)?.find((post) => post.authorAvatar)?.authorAvatar;
    return { ...source, avatar: pickAvatarSrc(source.avatar || timelineAvatar || followingAvatar || "", source.platform), id: String(source.id), key, pinned: true };
  }), [state.following, state.sources, state.timelines]);
  const isAllFeed = activeFeedKey === FEED_ALL;
  const visiblePosts = useMemo(() => collectVisiblePosts({
    timelines: state.timelines, feedList, query: state.settings.query, sort: state.settings.sort, feedKey: activeFeedKey,
  }), [activeFeedKey, feedList, state.settings.query, state.settings.sort, state.timelines]);
  const setNotice = useCallback((notice: string) => setState((prev) => ({ ...prev, notice })), []);
  const persist = useCallback((patch: Partial<ReaderState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (!prev.previewMode && !demoModeActive) {
        const record = { sources: next.sources, selectedFeedKey: next.selectedFeedKey, settings: next.settings };
        setPersisted(record);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Storage quota/private mode */ }
      }
      return next;
    });
  }, [demoModeActive]);
  const refresh = useCallback(async (options?: { feedKey?: string; feedKeys?: string[]; maxAgeMs?: number; sources?: FeedPerson[] }) => {
    if (state.previewMode || demoModeActive) return;
    const keys = options?.feedKeys || (options?.feedKey ? [options.feedKey] : isAllFeed ? (options?.sources || feedList).map((x) => x.key) : [activeFeedKey]);
    const sources = options?.sources || feedList;
    const targets = keys.map((key) => sources.find((feed) => feed.key === key)).filter((x): x is FeedPerson => !!x);
    if (!targets.length) return;
    const task = ++generation.current;
    setState((prev) => ({ ...prev, refreshing: true, notice: "" }));
    await Promise.all(targets.map(async (source) => {
      try {
        const params = new URLSearchParams({ platform: source.platform, source: source.id });
        const response = await fetch(`/api/timeline?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        const data = await response.json() as FeedResponse;
        if (!response.ok || !data.ok) throw new Error("error" in data ? data.error : `请求失败 (${response.status})`);
        const posts = data.posts.map((raw) => sanitizeFeedPost(raw, source.key)).filter((post): post is Post => !!post);
        if (generation.current !== task) return;
        hasMoreRef.current[source.key] = data.hasMore;
        cursorRef.current[source.key] = data.cursor || "";
        setState((prev) => {
          const prior = (prev.timelines[source.key] || []) as Post[];
          const acknowledged = Number(prev.timelineAck[source.key]) || 0;
          const freshIds = posts.filter((post) => post.timestamp > acknowledged && !prior.some((old) => old.id === post.id)).map((post) => post.id);
          return {
            ...prev,
            timelines: { ...prev.timelines, [source.key]: posts },
            timelineError: { ...prev.timelineError, [source.key]: {} },
            timelinePaging: { ...prev.timelinePaging, [source.key]: { page: 1, done: !data.hasMore, cursor: data.cursor } },
            timelineFresh: { ...prev.timelineFresh, ...(freshIds.length ? { [source.key]: freshIds } : {}) },
          };
        });
      } catch (error) {
        if (generation.current === task) setState((prev) => ({ ...prev, timelineError: { ...prev.timelineError, [source.key]: { error: error instanceof Error ? error.message : "无法连接本地读取服务" } } }));
      }
    }));
    if (generation.current === task) setState((prev) => ({ ...prev, refreshing: false }));
  }, [activeFeedKey, demoModeActive, feedList, isAllFeed, state.previewMode]);
  const selectFeed = useCallback(async (key: string) => {
    activeFeedKeyRef.current = key; setActiveFeedKey(key); persist({ selectedFeedKey: key });
  }, [persist]);
  const maybeLoadMore = useCallback(async () => {
    if (state.previewMode || demoModeActive) return;
    const key = activeFeedKey;
    const source = feedList.find((feed) => feed.key === key);
    const cursor = cursorRef.current[key];
    if (!source || !hasMoreRef.current[key] || !cursor || state.loadingMore) return;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const params = new URLSearchParams({ platform: source.platform, source: source.id, cursor });
      const response = await fetch(`/api/timeline?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      const data = await response.json() as FeedResponse;
      if (!response.ok || !data.ok) throw new Error("error" in data ? data.error : `请求失败 (${response.status})`);
      const more = data.posts.map((raw) => sanitizeFeedPost(raw, source.key)).filter((post): post is Post => !!post);
      setState((prev) => { const existing = (prev.timelines[source.key] || []) as Post[]; const ids = new Set(existing.map((post) => post.id)); return { ...prev, timelines: { ...prev.timelines, [source.key]: [...existing, ...more.filter((post) => !ids.has(post.id))] }, timelinePaging: { ...prev.timelinePaging, [source.key]: { page: (prev.timelinePaging[source.key]?.page || 1) + 1, done: !data.hasMore, cursor: data.cursor } } }; });
      hasMoreRef.current[key] = data.hasMore; cursorRef.current[key] = data.cursor || "";
    } catch (error) { setState((prev) => ({ ...prev, timelineError: { ...prev.timelineError, [key]: { error: error instanceof Error ? error.message : "读取失败" } } })); }
    finally { setState((prev) => ({ ...prev, loadingMore: false })); }
  }, [activeFeedKey, demoModeActive, feedList, state.loadingMore, state.previewMode]);
  const addSource = useCallback(async (input: string, hint?: { id?: string; name?: string; avatar?: string; platform?: string }) => {
    const normalizedInput = String(input || "").trim();
    const numericId = normalizedInput.match(/^\d+$/)?.[0];
    const spec = hint?.platform === "weibo" && numericId
      ? { platform: "weibo" as const, id: numericId }
      : peekSourceInput(normalizedInput);
    if ("error" in spec) return { ok: false as const, error: spec.error };
    if (hint?.id && String(hint.id).toLowerCase() !== spec.id.toLowerCase()) return { ok: false as const, error: "HINT_MISMATCH" };
    if (hint?.platform && hint.platform !== spec.platform) return { ok: false as const, error: "HINT_MISMATCH" };
    const source: FeedSource = { platform: spec.platform, id: spec.id, name: hint?.name, avatar: hint?.avatar };
    const key = feedKey(source);
    const existing = state.sources.find((item) => feedKey(item).toLowerCase() === key.toLowerCase());
    const selectedSource = existing || source;
    const selectedKey = feedKey(selectedSource);
    const nextSources = existing ? state.sources : [...state.sources, source];
    if (!existing) persist({ sources: nextSources, selectedFeedKey: selectedKey });
    else persist({ selectedFeedKey: selectedKey });
    await selectFeed(selectedKey);
    if (!existing && !demoModeActive && !state.previewMode) {
      const person: FeedPerson = { ...selectedSource, avatar: pickAvatarSrc(selectedSource.avatar || "", selectedSource.platform), id: String(selectedSource.id), key: selectedKey, pinned: true };
      void refresh({ feedKey: selectedKey, sources: [...feedList, person] });
    }
    return { ok: true as const, source: existing || source };
  }, [demoModeActive, feedList, persist, refresh, selectFeed, state.previewMode, state.sources]);
  const removeSource = useCallback(async (key: string) => {
    const sources = state.sources.filter((source) => feedKey(source).toLowerCase() !== key.toLowerCase());
    const selectedFeedKey = activeFeedKeyRef.current.toLowerCase() === key.toLowerCase() ? FEED_ALL : activeFeedKeyRef.current;
    persist({ sources, selectedFeedKey });
    if (selectedFeedKey !== activeFeedKeyRef.current) { activeFeedKeyRef.current = selectedFeedKey; setActiveFeedKey(selectedFeedKey); }
  }, [activeFeedKey, persist, state.sources]);
  const updateReaderPrefs = useCallback((patch: Partial<Settings>) => {
    const settings = { ...state.settings, ...patch }; persist({ settings });
    if (patch.themeStyle || patch.colorScheme || patch.readingFont || patch.readingSize) {
      clearSessionUrlOverride();
      applyAppearance(normalizeAppearance(settings));
    }
  }, [persist, state.settings]);
  const hostUnavailable = useCallback(() => setNotice("当前宿主未提供扩展账户、跨设备同步或系统通知能力；本机阅读与备份仍可用。"), [setNotice]);
  const unavailable = useCallback(async () => ({ ok: false as const, users: [], reason: "unavailable" }), []);
  const unavailableAction = useCallback(async () => { hostUnavailable(); }, [hostUnavailable]);
  const searchXUsers = useCallback(async (query: string) => {
    const value = String(query || "").trim().replace(/^@/, "");
    if (!value) return { ok: true, users: [], error: "" };
    const matches: XSuggestion[] = X_SUGGESTIONS.filter((row) => row.id.toLowerCase().includes(value.toLowerCase()) || row.name.toLowerCase().includes(value.toLowerCase())).map((row) => ({ id: row.id, name: row.name }));
    const handle = value.match(/^[A-Za-z0-9_]{1,15}$/)?.[0];
    const users = [...matches];
    if (handle && !users.some((user) => user.id.toLowerCase() === handle.toLowerCase())) users.unshift({ id: handle, name: "@" + handle });
    return { ok: true, users, error: "" };
  }, []);
  const searchUsers = useCallback(async (platform: "xueqiu" | "weibo", query: string) => {
    const spec = peekSourceInput(String(query || "").trim());
    if (!("error" in spec) && spec.platform === platform) {
      return { ok: true, users: [{ id: spec.id, name: platform === "weibo" ? "微博用户 " + spec.id : "雪球用户 " + spec.id }], error: "" };
    }
    if (/^\d+$/.test(String(query || "").trim())) {
      return { ok: true, users: [{ id: String(query).trim(), name: platform === "weibo" ? "微博用户 " + String(query).trim() : "雪球用户 " + String(query).trim() }], error: "" };
    }
    return { ok: true, users: [], error: "" };
  }, []);
  const openPost = useCallback((post: Post) => { if (post.url) window.open(post.url, "_blank", "noopener,noreferrer"); }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search); const demo = query.get("demo");
    if (demo) {
      const fixture = buildPreviewStorage(parseDemoMode(demo));
      setActiveFeedKey(fixture.selectedFeedKey);
      setState((prev) => ({ ...prev, ...fixture, sources: fixture.sources || [], previewMode: true, previewBanner: PREVIEW_BANNER, demoMode: parseDemoMode(demo), settings: { ...prev.settings, ...(fixture.settings || {}) } }));
    } else {
      void refresh();
    }
  // Initial mount only: feed subscriptions are stable through localStorage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { applyAppearance(mergeAppearance(state.settings)); }, [state.settings]);
  const reader = {
    state, feedList, visiblePosts, activeFeedKey, isAllFeed, syncLabel: "", countLabel: `${visiblePosts.length} 条`, ready: true,
    showLogin: false, selectFeed, refresh, acknowledgeLatest: (keys: string[]) => {
      const acknowledgements: Record<string, number> = {};
      for (const key of new Set(keys.map((value) => String(value || "").trim()).filter(Boolean))) {
        const latestTimestamp = newestPostTimestamp(state.timelines[key]);
        if (latestTimestamp) acknowledgements[key] = Math.max(Number(state.timelineAck[key]) || 0, latestTimestamp);
      }
      if (!Object.keys(acknowledgements).length) return;
      persist({ timelineAck: { ...state.timelineAck, ...acknowledgements }, timelineFresh: Object.fromEntries(Object.entries(state.timelineFresh).filter(([key]) => !(key in acknowledgements))) });
    }, toggleSort: async () => { updateReaderPrefs({ sort: state.settings.sort === "desc" ? "asc" : "desc" }); },
    cycleDensity: () => updateReaderPrefs({ density: (state.settings.density === "compact" ? "comfortable" : state.settings.density === "comfortable" ? "spacious" : "compact") as DisplayDensity }),
    setQuery: (query: string) => updateReaderPrefs({ query }), toggleNotify: hostUnavailable, updateReaderPrefs, previewNotification: async () => ({ ok: false, error: "此宿主不支持系统通知", needsSettings: false }),
    addSource, removeSource, importSources: async (sources: FeedSource[]) => {
      const valid = sources.filter((source) => source && ["xueqiu", "x", "weibo"].includes(source.platform) && String(source.id || "").trim());
      const map = new Map(state.sources.map((source) => [feedKey(source).toLowerCase(), source]));
      for (const source of valid) map.set(feedKey(source).toLowerCase(), { ...source, id: String(source.id).trim() });
      const merged = [...map.values()]; const added = Math.max(0, merged.length - state.sources.length);
      persist({ sources: merged });
      return { ok: true as const, added, total: merged.length };
    },
    searchXUsers, searchUsers, loadXFollowing: unavailable, loadWeiboFollowing: unavailable,
    openWindow: unavailableAction, openPopup: () => hostUnavailable(), openSidebar: unavailableAction, switchSurface: unavailableAction, shellMode,
    reloadTab: unavailableAction, retryAccount: unavailableAction, maybeLoadMore, openPost, showToast: setNotice, setNotice,
    openTab: (url: string) => window.open(url, "_blank", "noopener,noreferrer"), applyDemoFixture: (mode: string) => {
      const fixture = buildPreviewStorage(parseDemoMode(mode)); setActiveFeedKey(fixture.selectedFeedKey); setState((prev) => ({ ...prev, ...fixture, previewMode: true, previewBanner: PREVIEW_BANNER, demoMode: parseDemoMode(mode) }));
    }, previewSimulateFresh: () => 0, setOpenAddDialog: (open: boolean) => setState((prev) => ({ ...prev, openAddDialog: open })),
    openXueqiuLogin: hostUnavailable, openXLogin: hostUnavailable, openWeiboLogin: hostUnavailable,
    probeSessions: unavailableAction, capabilities: {
      showSingleSourceAvatars: true,
      message: "当前宿主未提供扩展专属账户能力；通过本地读取服务访问公开内容。",
      runtimeRequest: async (message) => {
        const response = await fetch("/api/runtime", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(message), signal: AbortSignal.timeout(20_000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `本地运行请求失败 (${response.status})`);
        return data;
      },
    },
  } satisfies SharedReader;
  return reader;
}

export function AgentReader() {
  const reader = useAgentReader();
  const isHomeRoute = new URLSearchParams(location.search).get("mode") === "home" || /home\.html$/i.test(location.pathname);
  return isHomeRoute ? <SharedHomeApp reader={reader} /> : <ReaderApp reader={reader} />;
}
