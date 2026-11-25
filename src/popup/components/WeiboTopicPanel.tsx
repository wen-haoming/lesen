import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useReader } from "@/hooks/useReader";
import { useSquareData } from "@/hooks/useSquareData";
import { useWeiboTopic } from "@/hooks/useWeiboTopic";
import type { FeedPerson } from "@/lib/config";
import { emptySquareResource, trackSquareRefresh, formatSquareError, WEIBO_HOT_RESOURCE } from "@/lib/square-data";
import { collapsedWeiboTopics, selectWeiboTopic } from "@/lib/weibo-topic-state";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Timeline } from "./Timeline";

const HOT_KEYS = [WEIBO_HOT_RESOURCE];
const EMPTY_FRESH = {};
const noop = () => {};
const SELECTION_KEY = "square.weibo.topic.selection";
function previousSelection() {
  try { return localStorage.getItem(SELECTION_KEY) || ""; } catch { return ""; }
}

export function WeiboTopicPanel({ reader, active }: { reader: ReturnType<typeof useReader>; active: boolean }) {
  const preview = reader.state.previewMode;
  const squareData = useSquareData({ resourceKeys: HOT_KEYS, active, previewMode: preview });
  const { resources, refresh: refreshRank } = squareData;
  const rank = resources[WEIBO_HOT_RESOURCE] || emptySquareResource();
  const [selection, setSelection] = useState(previousSelection);
  const [topicRequested, setTopicRequested] = useState(() => typeof document === "undefined" || (document.documentElement.dataset.mode !== "home" && typeof location !== "undefined" && !location.pathname.endsWith("home.html")));
  const [expanded, setExpanded] = useState(false);
  const selected = selectWeiboTopic(rank.items, selection);
  useEffect(() => {
    if (!selected) return;
    setSelection(selected);
    setTopicRequested(true);
    if (!preview) {
      try { localStorage.setItem(SELECTION_KEY, selected); } catch { /* 本机存储不可用时仍可切换话题。 */ }
    }
  }, [selected, preview]);
  const { resource, refresh, loadMore } = useWeiboTopic({ word: selected, active: active && topicRequested, previewMode: preview });

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const rankItemsRef = useRef(rank.items);
  rankItemsRef.current = rank.items;
  const refreshTopicRef = useRef(refresh);
  refreshTopicRef.current = refresh;

  useEffect(() => {
    if (!active || preview) return;
    const onRefreshSquare = () => {
      void trackSquareRefresh(async () => {
        const previousWord = selectedRef.current;
        await refreshRank();
        const latestItems = squareData.getSnapshot?.()[WEIBO_HOT_RESOURCE]?.items || rankItemsRef.current;
        const nextWord = selectWeiboTopic(latestItems, selectionRef.current);
        if (nextWord && nextWord === previousWord) {
          await refreshTopicRef.current();
        }
      });
    };
    window.addEventListener("owlivo-refresh-square-hot", onRefreshSquare);
    return () => window.removeEventListener("owlivo-refresh-square-hot", onRefreshSquare);
  }, [active, preview, refreshRank, squareData]);

  const visibleItems = expanded ? rank.items : collapsedWeiboTopics(rank.items, selected, 5);
  const topicKey = `weibo:topic:${selected}`;
  const feedList = useMemo<FeedPerson[]>(() => selected ? [{ key: topicKey, id: selected, name: selected, platform: "weibo" }] : [], [selected, topicKey]);
  const timelines = useMemo(() => resource.attempted ? { [topicKey]: resource.posts } : {}, [topicKey, resource.posts, resource.attempted]);
  const restricted = resource.retryAt > Date.now();
  const rankRestricted = rank.retryAt > Date.now();

  return <div className="flex h-full min-h-0 flex-col">
    {rank.error || rank.stale || rank.needsLogin ? <div role="status" className="shrink-0 border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
      {rank.needsLogin ? "热搜榜需登录微博后重试。" : formatSquareError(rank.error)}
      {rank.stale ? " 当前保留上次榜单，并非最新数据。" : ""}
      {rankRestricted ? " 请求受限，请稍后刷新榜单。" : ""}
      {rank.needsLogin ? <Button variant="outline" size="sm" className="ml-2 h-6 text-[11px]" onClick={reader.openWeiboLogin}>登录微博</Button> : null}
    </div> : null}
    {visibleItems.length ? <div id="weibo-topic-chips" role="group" aria-label="单选热搜话题"
      className={cn("reader-scrollbar grid shrink-0 grid-cols-2 gap-1 border-b border-border/60 px-3 py-1.5 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5", expanded && "max-h-40 overflow-y-auto overscroll-contain")}>
      <TooltipProvider delayDuration={220}>
        {visibleItems.map((item) => {
          const fullTitle = `${item.rank}. ${item.word} · 热度 ${item.heat}`;
          return <Tooltip key={item.word}>
            <TooltipTrigger asChild>
              <button type="button" title={fullTitle}
                aria-pressed={selected === item.word} onClick={() => { setSelection(item.word); setTopicRequested(true); }}
                className={cn("flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10.5px] leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-primary", selected === item.word ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}>
                <span className="tnum shrink-0 text-[10px] opacity-70">{item.rank}</span><span className="truncate">{item.word}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-[min(420px,calc(100vw-24px))] whitespace-normal leading-relaxed">{fullTitle}</TooltipContent>
          </Tooltip>;
        })}
      </TooltipProvider>
      {rank.items.length > 6 ? <button type="button" aria-expanded={expanded} aria-controls="weibo-topic-chips" onClick={() => setExpanded((value) => !value)} className="flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] leading-5 text-muted-foreground hover:bg-muted">
        {expanded ? "收起" : "更多"}{expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button> : null}
    </div> : null}
    {!selected ? <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      <h3 className="text-[12px] font-semibold">{rank.loading || !rank.attempted ? "正在读取热搜榜单" : "暂无可用热搜话题"}</h3>
      <p className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">{preview ? "话题帖子仅能在真实扩展中读取，预览不会编造帖子。" : "榜单加载后将默认选中第一个话题，可刷新榜单重试。"}</p>
    </div> : <>
      {resource.error || resource.needsLogin || resource.stale ? <div role="status" className="shrink-0 border-b border-border/60 bg-muted/35 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {resource.needsLogin ? "请登录微博后重试。" : formatSquareError(resource.error)}
        {resource.stale ? " 当前保留上次帖子，并非最新数据。" : ""}
        {restricted ? " 请求冷却中，请稍后重试。" : ""}
        {resource.needsLogin ? <Button variant="outline" size="sm" className="ml-2 h-6 text-[11px]" onClick={reader.openWeiboLogin}>登录微博</Button> : null}
        {resource.error && !restricted ? <Button variant="ghost" size="sm" className="ml-1 h-6 text-[11px]" disabled={!active || preview || resource.loading || resource.loadingMore} onClick={() => void refresh()}>重试</Button> : null}
      </div> : null}
      {preview ? <div className="flex flex-1 items-center justify-center px-8 py-12 text-center text-[11px] leading-relaxed text-muted-foreground">话题帖子仅能在真实扩展中读取，预览不会编造帖子。</div> : <Timeline
        key={selected} posts={resource.posts} feedList={feedList} timelines={timelines}
        activeFeedKey={topicKey} isAllFeed query="" density={reader.state.settings.density}
        translateEnabled={false} loadingMore={resource.loadingMore} refreshing={resource.loading}
        loadMoreDone={!resource.hasMore} timelineError={{}}
        onOpen={reader.openPost} onScrollNearEnd={() => void loadMore()}
        timelineFresh={EMPTY_FRESH} onAcknowledgeLatest={noop} persistPositions={false}
        surface="home" columnPlatform="square:weibo:topic"
        emptyCopy={{ noPostsDescription: "该话题暂时没有可展示的帖子，可点击上方刷新重试。", loadingLabel: "正在读取微博话题帖子" }}
      />}
    </>}
  </div>;
}
