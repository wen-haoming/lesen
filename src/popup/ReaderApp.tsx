import { createContext, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { mergeAppearance, resolveColorScheme } from "@/lib/appearance";
import { FEED_ALL, feedKey } from "@/lib/config";
import { useOwlivoAccount } from "@/hooks/useOwlivoAccount";
import { useReader } from "@/hooks/useReader";
import {
  createSubscriptionBackup,
  formatSubscriptionShareText,
  parseSubscriptionBackup,
} from "@/lib/subscription-backup";
import { cn } from "@/lib/utils";
import { AddSourceDialog, AddSourcePanel, type PickerPlatform } from "./components/AddSourceDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { openHomePage } from "@/lib/home-page";
import { ReaderHeader, initialReaderMode, type ReaderMode } from "./components/ReaderHeader";
import { SquareBoard } from "./components/SquareBoard";
import { SourceStrip } from "./components/SourceStrip";
import { Timeline } from "./components/Timeline";

type Reader = ReturnType<typeof useReader>;
export type RuntimeRequest = (message: Record<string, unknown>) => Promise<any>;
export type SharedReader = Reader & {
  shellMode: Reader["shellMode"];
  /** Host integrations may provide honest, actionable limitations instead of Chrome-only behavior. */
  capabilities?: { message?: string; runtimeRequest?: RuntimeRequest; showSingleSourceAvatars?: boolean };
};

export const RuntimeRequestContext = createContext<RuntimeRequest | undefined>(undefined);

const DevPreviewChrome = import.meta.env.DEV
  ? lazy(() => import("./components/DevPreviewChrome").then((m) => ({ default: m.DevPreviewChrome })))
  : null;

function isDevPreviewTools(): boolean {
  if (!import.meta.env.DEV) return false;
  try { return new URLSearchParams(location.search).get("demoTools") === "1"; } catch { return false; }
}

export function ReaderApp({ reader }: { reader: SharedReader }) {
  const [readerMode, setReaderMode] = useState<ReaderMode>(initialReaderMode);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "account" | "data">("appearance");
  const [scrollToTopToken, setScrollToTopToken] = useState(0);
  const [squareRefreshing, setSquareRefreshing] = useState(false);
  const owlivoAuth = useOwlivoAccount(!reader.state.previewMode);
  const hasSources = reader.feedList.length > 0;
  const canPickSources = true;
  const showHomeAddPanel = !hasSources && canPickSources;

  useEffect(() => {
    if (reader.state.openAddDialog && hasSources) setAddOpen(true);
  }, [reader.state.openAddDialog, reader.state.demoMode, hasSources]);
  useEffect(() => {
    if (!showHomeAddPanel) return;
    void reader.probeSessions(true);
  }, [showHomeAddPanel, reader.probeSessions]);
  useEffect(() => {
    const onBusy = (event: Event) => {
      const detail = (event as CustomEvent<{ busy?: boolean }>).detail;
      setSquareRefreshing(Boolean(detail?.busy));
    };
    window.addEventListener("owlivo:square-busy", onBusy);
    return () => window.removeEventListener("owlivo:square-busy", onBusy);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (readerMode !== "subscriptions" || !hasSources) return;
        event.preventDefault();
        setSearchOpen((prev) => {
          const next = !prev;
          if (!next && reader.state.settings.query) reader.setQuery("");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSources, reader.setQuery, reader.state.settings.query, readerMode]);
  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  const activateFeed = useCallback(async (key: string) => {
    const currentKey = reader.isAllFeed ? FEED_ALL : reader.activeFeedKey;
    if (key !== currentKey) await reader.selectFeed(key);
    else setScrollToTopToken((token) => token + 1);
    void reader.refresh({ maxAgeMs: 2 * 60 * 1000, feedKey: key });
  }, [reader.activeFeedKey, reader.isAllFeed, reader.refresh, reader.selectFeed]);
  const loadMoreDone = useMemo(() => {
    const keys = reader.isAllFeed ? reader.feedList.map((p) => p.key) : [reader.activeFeedKey];
    return keys.length > 0 && keys.every((key) => reader.state.timelinePaging[key]?.done);
  }, [reader.activeFeedKey, reader.feedList, reader.isAllFeed, reader.state.timelinePaging]);
  const showSearch = searchOpen || !!reader.state.settings.query;
  const statusLine = [reader.countLabel, reader.syncLabel].filter(Boolean).join(" · ");
  const showDevChrome = Boolean(import.meta.env.DEV && reader.state.previewMode && DevPreviewChrome);

  const adoptSource = useCallback(async (candidate: {
    platform: PickerPlatform; id: string; name?: string; avatar?: string;
  }) => {
    const input = candidate.platform === "x" ? "@" + candidate.id
      : candidate.platform === "weibo" ? "https://weibo.com/u/" + candidate.id
        : String(candidate.id);
    const result = await reader.addSource(input, {
      id: String(candidate.id), name: candidate.name, avatar: candidate.avatar,
      platform: candidate.platform,
    });
    if (result.ok && result.source) await activateFeed(feedKey(result.source));
    if (!result.ok) {
      const map: Record<string, string> = {
        PROFILE_MISMATCH: "无法确认该用户身份（返回资料与所选不一致），未添加",
        HINT_MISMATCH: "候选信息与目标不一致，未添加",
        NOT_LOGGED_IN: candidate.platform === "weibo" ? "添加微博信息源需要先登录微博" : "添加雪球信息源需要先登录雪球",
      };
      reader.setNotice(map[result.error || ""] || result.error || "添加失败", true);
    }
    return result;
  }, [activateFeed, reader.addSource, reader.setNotice]);
  const refreshPickerPlatform = useCallback((platform: PickerPlatform) => {
    if (platform === "xueqiu") { void reader.retryAccount(); void reader.probeSessions(true); return; }
    void reader.probeSessions(true, { refreshXueqiuAccount: false });
  }, [reader.probeSessions, reader.retryAccount]);
  const exportSubscriptions = useCallback(() => {
    try {
      const backup = createSubscriptionBackup(reader.state.sources);
      const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `lesen-subscriptions-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true as const, count: backup.sources.length };
    } catch { return { ok: false as const, count: 0, error: "无法生成订阅备份文件" }; }
  }, [reader.state.sources]);
  const importSubscriptions = useCallback(async (file: File) => {
    if (file.size > 1024 * 1024) return { ok: false as const, added: 0, total: 0, error: "备份文件不能超过 1 MB" };
    try {
      const backup = parseSubscriptionBackup(await file.text());
      const result = await reader.importSources(backup.sources);
      return { ...result, imported: backup.sources.length };
    } catch (error) {
      return { ok: false as const, added: 0, total: reader.state.sources.length, error: error instanceof Error ? error.message : "无法读取订阅备份" };
    }
  }, [reader.importSources, reader.state.sources.length]);
  const copyShareText = useCallback(async () => {
    const text = formatSubscriptionShareText(reader.state.sources);
    if (!text) return { ok: false as const, count: 0, error: "当前还没有可分享的订阅" };
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true as const, count: reader.state.sources.length };
    } catch {
      return { ok: false as const, count: 0, error: "无法写入剪贴板，请手动导出订阅文件" };
    }
  }, [reader.state.sources]);
  const toastTheme = resolveColorScheme(mergeAppearance(reader.state.settings).colorScheme);
  const loginNotices = { onLoginXueqiu: reader.openXueqiuLogin, onLoginX: reader.openXLogin, onLoginWeibo: reader.openWeiboLogin };
  const pickerProps = {
    sources: reader.state.sources, following: reader.state.following, status: reader.state.status,
    platformSessions: reader.state.platformSessions, initialTab: reader.state.addPickerTab,
    onAdopt: adoptSource, onRemoveSubscribed: (key: string) => reader.removeSource(key),
    onSearchX: reader.searchXUsers, onSearchUsers: reader.searchUsers,
    onLoadXFollowing: reader.loadXFollowing, onLoadWeiboFollowing: reader.loadWeiboFollowing,
    ...loginNotices,
    onRetry: () => { void reader.retryAccount(); void reader.probeSessions(true); }, onRefreshPlatform: refreshPickerPlatform,
  };
  return (
    <RuntimeRequestContext.Provider value={reader.capabilities?.runtimeRequest}>
    <div className="app relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div id="reader-portal" className="pointer-events-none absolute inset-0 z-[60]" />
      <Toaster position="bottom-center" theme={toastTheme} richColors={false} closeButton={false} />
      {reader.capabilities?.message ? <div className="sr-only" role="status">{reader.capabilities.message}</div> : null}
      {showDevChrome && DevPreviewChrome ? <Suspense fallback={null}><DevPreviewChrome demoMode={reader.state.demoMode} showTools={isDevPreviewTools()} onChange={reader.applyDemoFixture} /></Suspense> : null}
      <ReaderHeader mode={readerMode} onModeChange={setReaderMode}
        account={owlivoAuth.account}
        onOpenSettings={() => { setSettingsSection("appearance"); setSettingsOpen(true); }}
        onOpenAccount={() => { setSettingsSection("account"); setSettingsOpen(true); }} onOpenHome={openHomePage}
        onRefresh={readerMode === "subscriptions" ? () => void reader.refresh() : () => window.dispatchEvent(new Event("owlivo-refresh-square-hot"))}
        refreshing={readerMode === "subscriptions" ? reader.state.refreshing : squareRefreshing} shellMode={reader.shellMode} onSwitchSurface={() => void reader.switchSurface()}
        searchActive={showSearch}
        onToggleSearch={hasSources ? () => setSearchOpen((prev) => { const next = !prev; if (!next && reader.state.settings.query) reader.setQuery(""); return next; }) : undefined} />
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", readerMode === "subscriptions" ? "flex" : "hidden")} aria-hidden={readerMode !== "subscriptions"}>
        <div className="relative z-10 shrink-0 bg-background">
          <SourceStrip feedList={reader.feedList} activeFeedKey={reader.activeFeedKey} isAllFeed={reader.isAllFeed}
            refreshing={reader.state.refreshing} timelines={reader.state.timelines} timelineAck={reader.state.timelineAck}
            syncLabel={reader.syncLabel} onSelectAll={() => void activateFeed(FEED_ALL)} onSelectFeed={(key) => void activateFeed(key)}
            onRemoveFeed={(key) => void reader.removeSource(key)} onAdd={() => { if (showHomeAddPanel) return; setAddOpen(true); void reader.probeSessions(true); }} />
          {showSearch ? <div className="shrink-0 px-4 pb-2"><Input ref={searchInputRef} id="q" type="search" placeholder="搜索正文或引用" autoComplete="off" spellCheck={false} aria-label="搜索帖子" value={reader.state.settings.query} onChange={(event) => reader.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); if (reader.state.settings.query) reader.setQuery(""); setSearchOpen(false); } }} className="h-7 rounded-[7px] border-border/70 bg-muted/40 text-[11.5px] focus-visible:bg-background" /></div> : null}
          <div className="sr-only" aria-live="polite">{reader.state.notice ? "" : statusLine}</div>
          {reader.state.notice ? <Alert className="mx-4 mb-1 shrink-0 border-0 bg-muted/60 px-2.5 py-1 text-[10.5px] leading-[1.5] [&>svg]:hidden" role="status" aria-live="polite"><AlertDescription className="text-[10.5px] text-muted-foreground">{reader.state.notice}</AlertDescription></Alert> : null}
          <div aria-hidden="true" className="reader-chrome-fade pointer-events-none absolute inset-x-0 bottom-0 h-3 translate-y-full" />
        </div>
        {showHomeAddPanel ? <AddSourcePanel active variant="page" {...pickerProps} onImportSubscriptions={importSubscriptions} onSelectSubscribed={(key) => void reader.selectFeed(key)} /> :
          <Timeline posts={reader.visiblePosts} feedList={reader.feedList} timelines={reader.state.timelines} activeFeedKey={reader.activeFeedKey} isAllFeed={reader.isAllFeed}
            query={reader.state.settings.query} density={reader.state.settings.density} translateEnabled={reader.state.settings.translateX !== false}
            showSingleSourceAvatars={reader.capabilities?.showSingleSourceAvatars === true}
            loadingMore={reader.state.loadingMore} refreshing={reader.state.refreshing} loadMoreDone={loadMoreDone} timelineError={reader.state.timelineError}
            onOpen={reader.openPost} onScrollNearEnd={() => void reader.maybeLoadMore()} scrollToTopToken={scrollToTopToken}
            timelineFresh={reader.state.timelineFresh} onAcknowledgeLatest={reader.acknowledgeLatest} surface="reader" persistPositions={!reader.state.previewMode} />}
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", readerMode === "square" ? "flex" : "hidden")} aria-hidden={readerMode !== "square"}><SquareBoard reader={reader} active={readerMode === "square"} /></div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={reader.state.settings} onChange={reader.updateReaderPrefs}
        onExportSubscriptions={exportSubscriptions} onImportSubscriptions={importSubscriptions} onCopyShareText={copyShareText} initialSection={settingsSection} onOpenHome={openHomePage} />
      {hasSources ? <AddSourceDialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (open) void reader.probeSessions(true); }}
        {...pickerProps} onSelectSubscribed={(key) => { setAddOpen(false); void reader.selectFeed(key); }} /> : null}
    </div>
    </RuntimeRequestContext.Provider>
  );
}

export function App() { return <ReaderApp reader={useReader()} />; }
