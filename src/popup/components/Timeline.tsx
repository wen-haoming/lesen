import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  CornerUpLeft,
  ExternalLink,
  Heart,
  List,
  MessageCircle,
  Repeat2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FEED_ALL, type FeedPerson } from "@/lib/config";
import {
  dayKey,
  dayLabel,
  formatClock,
  formatRelativeShort,
  platformShort,
  shortCount,
} from "@/lib/format";
import { classifyPostCard } from "@/lib/post-card";
import { countFreshPosts } from "@/lib/source-update";
import { storageGet, storageSet } from "@/lib/chrome-api";
import {
  NEAR_TOP_PX,
  TRUE_TOP_PX,
  captureAnchorFromRects,
  fallbackAnchorKey,
  jumpToLatestScrollTop,
  pinnedAnchorAfterLayout,
  readingContextKey,
  shouldAckProgrammaticJump,
  shouldShowFreshCue,
  upsertReadingPosition,
  loadReadingPositions,
  saveReadingPosition,
  type ReadingPosition,
  type ReadingSurface,
} from "@/lib/reading-position";
import { looksDeletedPlaceholder, type ChainEntry } from "@/lib/rich-text";
import type { Post } from "@/lib/sanitize";
import type { DisplayDensity, HomeHiddenMedia } from "@/hooks/useReader";
import { cn } from "@/lib/utils";
import { preload as preloadTranslator } from "@/lib/x-translate";
import { Avatar } from "./Avatar";
import { MediaGrid } from "./MediaGrid";
import { Clamp } from "./Clamp";
import { RichText, TranslatableText } from "./TranslatableText";

function TimelineEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="gap-2 border-0 px-8 py-20 md:p-8">
      <EmptyHeader className="gap-2">
        <EmptyMedia
          variant="icon"
          className="mb-0 size-9 rounded-[10px] border border-border/70 bg-muted/60"
        >
          <List />
        </EmptyMedia>
        <EmptyTitle className="mt-1 text-[12px] font-semibold tracking-[-0.005em]">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-[240px] text-[11px] leading-[1.6]">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** 引文：左竖线 + 弱化墨色，替代灰底方框，兼顾雪球回帖主次分层 */
function QuoteBlock({
  authorName,
  text,
  unavailable,
  mediaUrls,
  platform,
  query,
  translateEnabled,
  mediaKeyForUrl,
  hiddenMediaKeys,
  onHideMedia,
}: {
  authorName: string;
  text: string;
  unavailable: boolean;
  mediaUrls: string[];
  platform: string;
  query: string;
  translateEnabled: boolean;
  mediaKeyForUrl?: (url: string) => string;
  hiddenMediaKeys?: Set<string>;
  onHideMedia?: (key: string, url: string) => void;
}) {
  const deleted = !unavailable && !mediaUrls.length && looksDeletedPlaceholder(text);
  return (
    <div className="mt-2.5 border-l-2 border-primary/35 pl-3">
      {unavailable || deleted ? (
        <p className="text-[11px] tracking-[0.02em] text-muted-foreground/80">
          {deleted ? text : "原帖内容暂不可用"}
        </p>
      ) : (
        <>
          {authorName ? (
            <div className="text-[11.5px] font-medium tracking-[0.01em] text-foreground/85">
              {authorName}
            </div>
          ) : null}
          {text ? (
            <TranslatableText
              text={text}
              query={query}
              density="compact"
              enabled={translateEnabled}
              clampLines={3}
              className="!text-muted-foreground"
            />
          ) : null}
        </>
      )}
      <MediaGrid
        urls={mediaUrls}
        compact
        platform={platform}
        mediaKeyForUrl={mediaKeyForUrl}
        hiddenMediaKeys={hiddenMediaKeys}
        onHideMedia={onHideMedia}
      />
    </div>
  );
}

/** 雪球转发链 `//@某人:`：从正文拆出，按「谁：说了什么」浅底分层，不再糊进正文 */
function ForwardChain({ chain, query }: { chain: ChainEntry[]; query: string }) {
  return (
    <div className="mt-2 rounded-[6px] bg-foreground/[0.035] px-2.5 py-1.5">
      <Clamp
        lines={4}
        resetKey={chain.map((c) => c.name + c.text).join("|")}
        density="compact"
        className="text-pretty-body break-words whitespace-pre-wrap select-text !text-muted-foreground"
      >
        {chain.map((entry, i) => (
          <span key={i} className={cn("block", i > 0 && "mt-1")}>
            <span className="font-medium text-foreground/85">{entry.name}</span>
            {entry.replyTo ? (
              <span className="text-muted-foreground/75"> 回复 {entry.replyTo}</span>
            ) : null}
            <span className="text-foreground/85">：</span>
            <RichText text={entry.text} query={query} />
          </span>
        ))}
      </Clamp>
    </div>
  );
}

/** 互动数据：有值才出现，零值不占位，避免每行右侧出现一排 0 */
function Metrics({
  post,
  density,
  className,
}: {
  post: Post;
  density: DisplayDensity;
  className?: string;
}) {
  const items: Array<{ key: string; icon: ReactNode; value: number }> = [
    { key: "reply", icon: <MessageCircle className="size-[12px]" />, value: post.replyCount },
    { key: "repost", icon: <Repeat2 className="size-[12.5px]" />, value: post.retweetCount },
    { key: "like", icon: <Heart className="size-[12px]" />, value: post.likeCount },
  ].filter((item) => item.value > 0);

  if (!items.length) return null;
  return (
    <div
      className={cn(
        "tnum flex items-center gap-3.5 font-normal tracking-[0.02em] text-muted-foreground/80 text-[length:var(--meta-size,11px)]",
        density === "compact" ? "mt-2" : density === "spacious" ? "mt-3.5" : "mt-2.5",
        className,
      )}
    >
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground/65">{item.icon}</span>
          {shortCount(item.value)}
        </span>
      ))}
    </div>
  );
}

function PlatformBadge({ platform, label }: { platform: string; label: string }) {
  const dotClass =
    platform === "weibo"
      ? "bg-[#e74b3c]"
      : platform === "xueqiu"
        ? "bg-[#3977c3]"
        : "bg-foreground";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-1.5 py-0.5 font-medium tracking-[0.025em] text-muted-foreground text-[length:var(--badge-size,10px)]"
      title={`来源：${label}`}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden="true" />
      {label}
    </span>
  );
}

function PostRow({
  post,
  person,
  platform,
  displayName,
  query,
  density,
  showAvatar,
  translateEnabled,
  onOpen,
  anchorKey,
  hiddenMediaKeys,
  onHideMedia,
}: {
  post: Post;
  person?: FeedPerson;
  platform: string;
  displayName: string;
  query: string;
  density: DisplayDensity;
  showAvatar: boolean;
  translateEnabled: boolean;
  onOpen: (post: Post) => void;
  anchorKey: string;
  hiddenMediaKeys?: Set<string>;
  onHideMedia?: (media: HomeHiddenMedia) => void;
  surface?: ReadingSurface;
  columnPlatform?: string;
  persistPositions?: boolean;
}) {
  const card = classifyPostCard(post);
  const platformLabel = platformShort(platform);
  const mediaFeedKey = post.feedKey || person?.key || "";
  const mediaKeyFor = (context: HomeHiddenMedia["context"]) => (url: string) =>
    `${mediaFeedKey}:${post.id}:${context}:${url}`;
  const hideMedia =
    (context: HomeHiddenMedia["context"], author: string) => (key: string, url: string) => {
      if (!mediaFeedKey || !onHideMedia) return;
      onHideMedia({
        key,
        url,
        feedKey: mediaFeedKey,
        postId: post.id,
        authorName: author || displayName,
        platform,
        context,
        postText: (card.body || post.summary || post.title || "").slice(0, 180),
      });
    };
  const hasMetrics = post.replyCount + post.retweetCount + post.likeCount > 0;
  const timeTitle = new Date(post.timestamp).toLocaleString("zh-CN", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const timeNode = (
    <time
      className="tnum shrink-0 font-normal tracking-[0.02em] text-muted-foreground/80 text-[length:var(--meta-size,11px)]"
      dateTime={new Date(post.timestamp).toISOString()}
      title={timeTitle}
    >
      {formatRelativeShort(post.timestamp) || formatClock(post.timestamp)}
    </time>
  );

  const timeElement = post.url ? (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mr-0.5 inline-flex shrink-0 items-center hover:underline hover:underline-offset-2"
      onClick={(event) => {
        event.stopPropagation();
        if (typeof chrome !== "undefined" && typeof chrome.tabs?.create === "function") {
          event.preventDefault();
          onOpen(post);
        }
      }}
    >
      {timeNode}
    </a>
  ) : (
    <span className="mr-0.5 inline-flex shrink-0 items-center">{timeNode}</span>
  );

  const actionButtons = (
    <span className="flex items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      <Button
        variant="ghost"
        size="icon"
        className="size-[21px] rounded-[6px] text-muted-foreground/75 hover:bg-accent hover:text-accent-foreground"
        aria-label={`在${platformLabel}打开原帖`}
        title="在新标签打开原帖"
        data-open-post="1"
        asChild
      >
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.stopPropagation();
            if (typeof chrome !== "undefined" && typeof chrome.tabs?.create === "function") {
              event.preventDefault();
              onOpen(post);
            }
          }}
        >
          <ExternalLink className="size-[12.5px]" />
        </a>
      </Button>
    </span>
  );

  const bodyBlock = (
    <>
      <TranslatableText
        text={card.body}
        query={query}
        density={density}
        enabled={translateEnabled}
        clampLines={8}
      />
      <MediaGrid
        urls={card.mediaUrls}
        platform={platform}
        mediaKeyForUrl={onHideMedia ? mediaKeyFor("post") : undefined}
        hiddenMediaKeys={hiddenMediaKeys}
        onHideMedia={onHideMedia ? hideMedia("post", displayName) : undefined}
      />
      {card.chain.length ? <ForwardChain chain={card.chain} query={query} /> : null}
      {card.embed ? (
        <QuoteBlock
          authorName={card.embed.authorName}
          text={card.embed.text}
          unavailable={card.embed.unavailable}
          mediaUrls={card.embed.mediaUrls}
          platform={platform}
          query={query}
          translateEnabled={translateEnabled}
          mediaKeyForUrl={onHideMedia ? mediaKeyFor("quote") : undefined}
          hiddenMediaKeys={hiddenMediaKeys}
          onHideMedia={onHideMedia ? hideMedia("quote", card.embed.authorName) : undefined}
        />
      ) : null}
      {showAvatar && hasMetrics ? <Metrics post={post} density={density} /> : null}
    </>
  );

  return (
    <article
      className={cn(
        "content-auto row-hairline group relative px-4 transition-colors duration-150 hover:bg-muted/45",
        density === "compact" ? "py-3" : density === "spacious" ? "py-5" : "py-4",
      )}
      data-id={post.id}
      data-feed={post.feedKey}
      data-platform={platform}
      data-card-kind={card.kind}
      data-post-key={anchorKey}
      data-anchor={anchorKey}
    >
      {showAvatar ? (
        <div className="flex gap-2.5">
          <span className="mt-[3px] size-8 shrink-0" aria-hidden="true">
            <Avatar name={displayName} avatar={post.authorAvatar || person?.avatar} platform={platform} />
          </span>
          <div className="min-w-0 flex-1">
            {card.hint ? (
              <div className="mb-1 flex items-center gap-1 text-[10px] tracking-[0.02em] text-muted-foreground/80">
                <Repeat2 className="size-[10.5px] shrink-0" />
                <span className="truncate">{card.hint}</span>
              </div>
            ) : null}
            <div className="flex items-baseline gap-1.5">
              <span className="truncate font-semibold tracking-[0.01em] text-foreground text-[length:var(--author-size,13px)]">
                {displayName}
              </span>
              <PlatformBadge platform={platform} label={platformLabel} />
              <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
                {timeElement}
                {actionButtons}
              </span>
            </div>
            {card.replyLabel ? (
              <div className="mt-1 flex items-center gap-1 text-[11px] font-normal tracking-[0.01em] text-muted-foreground/85">
                <CornerUpLeft className="size-[11px] shrink-0 opacity-75" />
                <span className="truncate">{card.replyLabel}</span>
              </div>
            ) : null}
            {bodyBlock}
          </div>
        </div>
      ) : (
        // 单源流：无头像/用户名；正文直接起排，互动与时间统一落在底部。
        <div className="min-w-0">
          <span className="sr-only">{displayName}</span>
          {card.hint || card.replyLabel ? (
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              {card.hint ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] tracking-[0.02em] text-muted-foreground/80">
                  <Repeat2 className="size-[11px] shrink-0 opacity-75" />
                  <span className="truncate">{card.hint}</span>
                </span>
              ) : null}
              {card.replyLabel ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-normal text-muted-foreground/85">
                  <CornerUpLeft className="size-[11px] shrink-0 opacity-75" />
                  <span className="truncate">{card.replyLabel}</span>
                </span>
              ) : null}
            </div>
          ) : null}
          {bodyBlock}
          <div
            className={cn(
              "flex items-center justify-between gap-3",
              density === "compact" ? "mt-2" : density === "spacious" ? "mt-3.5" : "mt-2.5",
            )}
          >
            {hasMetrics ? (
              <Metrics post={post} density={density} className="!mt-0" />
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {timeElement}
              {actionButtons}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

type DayGroup = { key: string; label: string; posts: Post[] };

function groupByDay(posts: Post[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const post of posts) {
    const key = dayKey(post.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.posts.push(post);
    else groups.push({ key, label: dayLabel(post.timestamp), posts: [post] });
  }
  return groups;
}

function postAnchorKey(post: Post, fallbackFeed: string) {
  return (post.feedKey || fallbackFeed) + ":" + post.id;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function cssAttr(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

type FeedSlideDir = "from-left" | "from-right" | null;

function useFeedSlide(feedKey: string, feedOrder: string[]) {
  const prevKeyRef = useRef(feedKey);
  const [slide, setSlide] = useState<{ key: number; dir: FeedSlideDir }>({
    key: 0,
    dir: null,
  });

  useEffect(() => {
    const prev = prevKeyRef.current;
    if (prev === feedKey) return;
    const prevIdx = feedOrder.indexOf(prev);
    const nextIdx = feedOrder.indexOf(feedKey);
    const dir: FeedSlideDir =
      prevIdx < 0 || nextIdx < 0 ? "from-right" : nextIdx > prevIdx ? "from-right" : "from-left";
    prevKeyRef.current = feedKey;
    setSlide((s) => ({ key: s.key + 1, dir }));
  }, [feedKey, feedOrder]);

  return slide;
}

export function Timeline({
  posts,
  feedList,
  timelines,
  activeFeedKey,
  isAllFeed,
  query,
  density,
  translateEnabled = true,
  loadingMore,
  refreshing,
  loadMoreDone,
  timelineError,
  onOpen,
  onScrollNearEnd,
  scrollToTopToken = 0,
  timelineFresh,
  onAcknowledgeLatest,
  emptyCopy,
  hiddenMediaKeys,
  onHideMedia,
  surface = "reader",
  columnPlatform,
  persistPositions = true,
  scrollSyncKey,
  showSingleSourceAvatars = false,
}: {
  posts: Post[];
  feedList: FeedPerson[];
  timelines: Record<string, unknown[]>;
  activeFeedKey: string;
  isAllFeed: boolean;
  query: string;
  density: DisplayDensity;
  translateEnabled?: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  loadMoreDone: boolean;
  timelineError: Record<string, { error?: string }>;
  onOpen: (post: Post) => void;
  onScrollNearEnd: () => void;
  scrollToTopToken?: number;
  timelineFresh: Record<string, string[]>;
  onAcknowledgeLatest: (keys: string[]) => void;
  emptyCopy?: {
    notReadyDescription?: string;
    noSourceDescription?: string;
    noPostsDescription?: string;
    loadingLabel?: string;
  };
  hiddenMediaKeys?: Set<string>;
  onHideMedia?: (media: HomeHiddenMedia) => void;
  surface?: ReadingSurface;
  columnPlatform?: string;
  persistPositions?: boolean;
  scrollSyncKey?: string;
  showSingleSourceAvatars?: boolean;
}) {
  const personMap = new Map(feedList.map((p) => [p.key, p]));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const feedKey = isAllFeed ? FEED_ALL : activeFeedKey;
  const feedOrder = useMemo(() => [FEED_ALL, ...feedList.map((person) => person.key)], [feedList]);
  const slide = useFeedSlide(feedKey, feedOrder);

  const seenRef = useRef<Set<string>>(new Set());
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);
  const postOrderRef = useRef<string[]>([]);
  const contextKey = readingContextKey({
    surface,
    feedKey,
    isAllFeed,
    platform: columnPlatform,
  });
  const contextKeyRef = useRef(contextKey);
  const pinTopRef = useRef(false);
  const flyingToTopRef = useRef(false);
  const applyingAnchorRef = useRef(false);
  const holdingPinRef = useRef(false);
  const suppressJumpAckRef = useRef(false);
  const suppressJumpAckTimerRef = useRef<number>(0);
  const jumpGenRef = useRef(0);
  const jumpCleanupRef = useRef<(() => void) | null>(null);
  const lastScrollRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const restoringRef = useRef(false);
  const positionsRef = useRef<Record<string, ReadingPosition>>({});
  const positionsLoadedRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const anchorOf = useCallback((post: Post) => postAnchorKey(post, activeFeedKey), [activeFeedKey]);
  const contextPosts = useMemo(() => posts.map(anchorOf), [posts, anchorOf]);

  const bindScroller = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    setScrollerEl((prev) => (prev === node ? prev : node));
  }, []);

  const captureAnchor = useCallback((opts?: { assign?: boolean }) => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight === 0) return null;
    const edge = scroller.getBoundingClientRect().top;
    const nodes = [...scroller.querySelectorAll<HTMLElement>("[data-anchor]")];
    const snap = captureAnchorFromRects(
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { key: node.dataset.anchor || "", top: rect.top, bottom: rect.bottom };
      }),
      edge,
    );
    // assign 默认为 true，供用户滚动时更新锚点。前置插入后的 peek 必须传 assign:false，
    // 否则会把已钉住的原帖覆盖成视口边缘的新帖，随后 ResizeObserver 按错帖补偿。
    if (snap && opts?.assign !== false) anchorRef.current = snap;
    return snap;
  }, []);

  const applyAnchor = useCallback((key: string, offset: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight === 0 || !key) return false;
    const el = scroller.querySelector<HTMLElement>(`[data-anchor="${cssAttr(key)}"]`);
    if (!el) return false;
    applyingAnchorRef.current = true;
    try {
      const delta =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
      if (Math.abs(delta) > 1) scroller.scrollTop += delta;
      lastScrollRef.current = scroller.scrollTop;
      setScrollTop(scroller.scrollTop);
      anchorRef.current = { key, offset };
      return true;
    } finally {
      applyingAnchorRef.current = false;
    }
  }, []);

  const persistAnchor = useCallback(
    (snap?: { key: string; offset: number } | null) => {
      const current = snap || anchorRef.current;
      if (!current?.key) return;
      const position: ReadingPosition = {
        contextKey,
        anchorKey: current.key,
        offset: current.offset,
        savedAt: Date.now(),
      };
      positionsRef.current = upsertReadingPosition(positionsRef.current, position);
      if (!persistPositions) return;
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void (async () => {
          const merged = await saveReadingPosition(
            { get: storageGet, set: storageSet },
            position,
          );
          positionsRef.current = merged;
        })();
      }, 200);
    },
    [contextKey, persistPositions],
  );

  const restoreContextPosition = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const saved = positionsRef.current[contextKey];
    const keys = posts.map(anchorOf);
    if (saved?.anchorKey) {
      const key = keys.includes(saved.anchorKey)
        ? saved.anchorKey
        : fallbackAnchorKey(saved.anchorKey, postOrderRef.current, keys);
      if (key && applyAnchor(key, key === saved.anchorKey ? saved.offset : 0)) {
        postOrderRef.current = keys;
        return;
      }
    }
    const current = captureAnchor();
    persistAnchor(current);
    postOrderRef.current = keys;
  }, [anchorOf, applyAnchor, captureAnchor, contextKey, persistAnchor, posts]);

  const freshCount = useMemo(
    () => countFreshPosts(posts, timelineFresh, isAllFeed ? "" : activeFeedKey),
    [posts, timelineFresh, isAllFeed, activeFeedKey],
  );

  const jumpToLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    jumpCleanupRef.current?.();
    const gen = ++jumpGenRef.current;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    flyingToTopRef.current = true;
    pinTopRef.current = true;
    holdingPinRef.current = false;

    const collectFreshKeys = () => {
      const fallback = isAllFeed ? "" : activeFeedKey;
      const keys = new Set<string>();
      for (const post of posts) {
        const key = String(post.feedKey || fallback || "");
        const id = String(post.id || "");
        const fresh = timelineFresh[key];
        if (key && id && Array.isArray(fresh) && fresh.includes(id)) keys.add(key);
      }
      return [...keys];
    };

    const cleanup = () => {
      scroller.removeEventListener("wheel", onInterrupt);
      scroller.removeEventListener("touchstart", onInterrupt);
      scroller.removeEventListener("pointerdown", onInterrupt);
      scroller.removeEventListener("scrollend", onArrived);
      window.clearTimeout(safety);
      if (jumpCleanupRef.current === cleanup) jumpCleanupRef.current = null;
    };

    const onInterrupt = () => {
      if (jumpGenRef.current !== gen || !flyingToTopRef.current) return;
      flyingToTopRef.current = false;
      pinTopRef.current = false;
      // 同值 scrollTo 常常是 no-op，无法取消正在进行的 smooth；先微调再写回当前值才能停住动画。
      const top = scroller.scrollTop;
      scroller.scrollTo({ top: top + 1, behavior: "auto" });
      scroller.scrollTop = top;
      suppressJumpAckRef.current = true;
      if (suppressJumpAckTimerRef.current) window.clearTimeout(suppressJumpAckTimerRef.current);
      suppressJumpAckTimerRef.current = window.setTimeout(() => {
        suppressJumpAckRef.current = false;
        suppressJumpAckTimerRef.current = 0;
      }, 400);
      cleanup();
    };

    const onArrived = () => {
      if (
        !shouldAckProgrammaticJump({
          scrollTop: scroller.scrollTop,
          interrupted: false,
          flying: jumpGenRef.current === gen && flyingToTopRef.current,
        })
      ) {
        return;
      }
      flyingToTopRef.current = false;
      pinTopRef.current = false;
      cleanup();
      const keys = collectFreshKeys();
      if (keys.length) onAcknowledgeLatest(keys);
      seenRef.current = new Set(posts.map(anchorOf));
      persistAnchor(captureAnchor());
    };

    const safety = window.setTimeout(() => {
      if (jumpGenRef.current !== gen) return;
      if (scroller.scrollTop <= TRUE_TOP_PX) onArrived();
      else {
        flyingToTopRef.current = false;
        pinTopRef.current = false;
        cleanup();
      }
    }, 2000);

    jumpCleanupRef.current = cleanup;
    scroller.addEventListener("wheel", onInterrupt, { passive: true });
    scroller.addEventListener("touchstart", onInterrupt, { passive: true });
    scroller.addEventListener("pointerdown", onInterrupt, { passive: true });
    scroller.addEventListener("scrollend", onArrived);
    scroller.scrollTo({ top: jumpToLatestScrollTop(), behavior });
    if (behavior === "auto" || scroller.scrollTop <= TRUE_TOP_PX) {
      requestAnimationFrame(() => requestAnimationFrame(onArrived));
    }
  }, [posts, anchorOf, isAllFeed, activeFeedKey, timelineFresh, onAcknowledgeLatest, captureAnchor, persistAnchor]);

  useEffect(() => {
    if (!persistPositions) {
      positionsLoadedRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      const loaded = await loadReadingPositions({ get: storageGet, set: storageSet });
      if (cancelled) return;
      positionsRef.current = loaded;
      positionsLoadedRef.current = true;
      restoringRef.current = true;
      restoreContextPosition();
      restoringRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
    // 仅在初次挂载时读盘；之后靠内存缓存与防抖写入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistPositions]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const contextChanged = contextKeyRef.current !== contextKey;
    if (contextChanged) {
      contextKeyRef.current = contextKey;
      seenRef.current = new Set(posts.map(anchorOf));
      restoringRef.current = true;
      restoreContextPosition();
      restoringRef.current = false;
      return;
    }
    if (seenRef.current.size === 0) {
      seenRef.current = new Set(posts.map(anchorOf));
      restoringRef.current = true;
      restoreContextPosition();
      restoringRef.current = false;
      return;
    }
    if (flyingToTopRef.current) {
      postOrderRef.current = posts.map(anchorOf);
      return;
    }
    const ids = posts.map(anchorOf);
    const prevSet = seenRef.current;
    const added = ids.filter((id) => !prevSet.has(id));
    const removed = [...prevSet].filter((id) => !ids.includes(id));
    seenRef.current = new Set(ids);
    const prepended = added.filter((id) => {
      const index = ids.indexOf(id);
      return index >= 0 && index <= 2;
    });
    if (!prepended.length && !removed.length) {
      postOrderRef.current = ids;
      return;
    }
    const prevAnchor = anchorRef.current;
    if (prevAnchor?.key) {
      const key = ids.includes(prevAnchor.key)
        ? prevAnchor.key
        : fallbackAnchorKey(prevAnchor.key, postOrderRef.current, ids);
      if (key) applyAnchor(key, key === prevAnchor.key ? prevAnchor.offset : 0);
      // 钉住刚 apply 的 key+offset，不要按边缘重采。布局尚未完成时先钉住，留给 ResizeObserver 按同一锚点再补偿。
      const kept = pinnedAnchorAfterLayout(anchorRef.current, captureAnchor({ assign: false }));
      if (kept) {
        anchorRef.current = kept;
        persistAnchor(kept);
      }
      holdingPinRef.current = true;
    } else {
      persistAnchor(captureAnchor());
    }
    postOrderRef.current = ids;
  }, [
    posts,
    contextKey,
    anchorOf,
    applyAnchor,
    captureAnchor,
    persistAnchor,
    restoreContextPosition,
  ]);

  useEffect(() => {
    const scroller = scrollerEl;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const anchor = anchorRef.current;
      // 前置钉住期间必须继续按原帖补偿延迟布局；仅回顶飞行时跳过，避免和滚动动画抢控制。
      if (!anchor?.key || flyingToTopRef.current || (pinTopRef.current && !holdingPinRef.current)) return;
      applyAnchor(anchor.key, anchor.offset);
    });
    observer.observe(scroller);
    const first = scroller.firstElementChild;
    if (first instanceof HTMLElement) observer.observe(first);
    return () => observer.disconnect();
  }, [applyAnchor, scrollerEl, contextPosts]);

  useEffect(() => {
    if (!scrollerEl || !scrollToTopToken) return;
    pinTopRef.current = true;
    scrollerEl.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [scrollToTopToken, scrollerEl]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      jumpCleanupRef.current?.();
      flyingToTopRef.current = false;
      if (suppressJumpAckTimerRef.current) window.clearTimeout(suppressJumpAckTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!translateEnabled) return;
    void preloadTranslator();
  }, [translateEnabled]);

  let body: ReactNode;

  if (!isAllFeed && !activeFeedKey) {
    body = (
      <TimelineEmpty
        title="信息源尚未就绪"
        description={emptyCopy?.notReadyDescription || "正在读取订阅对象，或点订阅栏的添加按钮。"}
      />
    );
  } else if (!posts.length) {
    const failure = !isAllFeed ? timelineError[activeFeedKey] : null;
    if (failure) {
      const failedPlatform =
        personMap.get(activeFeedKey)?.platform || String(activeFeedKey).split(":")[0] || "平台";
      const rawError = failure.error || "未知错误";
      body = (
        <TimelineEmpty
          title="读取动态失败"
          description={platformShort(failedPlatform) + "返回：" + rawError + "。点刷新按钮重试。"}
        />
      );
    } else if (query) {
      body = <TimelineEmpty title="暂时没有帖子" description="没有符合搜索条件的内容。" />;
    } else if (!feedList.length) {
      body = (
        <TimelineEmpty
          title="还没有信息源"
          description={
            emptyCopy?.noSourceDescription || "点订阅栏「＋」订阅雪球、微博或 X 账号。"
          }
        />
      );
    } else {
      const loaded = isAllFeed
        ? feedList.some((p) => Array.isArray(timelines[p.key]))
        : Array.isArray(timelines[activeFeedKey]);
      if (loaded && !refreshing) {
        body = (
          <TimelineEmpty
            title="暂时没有帖子"
            description={emptyCopy?.noPostsDescription || "该对象目前没有符合条件的内容。"}
          />
        );
      } else {
        body = (
          <div className="flex flex-col gap-3 px-4 py-4" aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
            <p className="pt-1 text-center text-[11px] text-muted-foreground">
              {emptyCopy?.loadingLabel || "正在读取该用户的动态"}
            </p>
          </div>
        );
      }
    }
  } else {
    const groups = groupByDay(posts);
    body = (
      <>
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <div
              data-anchor={"day:" + group.key}
              className={cn(
                "flex items-center gap-2.5 px-4 pb-0.5",
                density === "compact" ? "pt-3" : density === "spacious" ? "pt-5" : "pt-4",
              )}
            >
              <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground/70">
                {group.label}
              </span>
              <div data-day-rule className="relative flex min-w-0 flex-1 items-center">
                <Separator className="flex-1 bg-foreground/8" />
              </div>
            </div>
            {group.posts.map((post) => {
              const feedKeyValue = post.feedKey || activeFeedKey;
              const person = personMap.get(feedKeyValue);
              const platform = post.feedPlatform || person?.platform || post.platform || "xueqiu";
              const displayName =
                person?.name ||
                post.feedName ||
                post.authorName ||
                (platform === "x"
                  ? "@" + (person?.id || "")
                  : platform === "weibo"
                    ? "微博用户"
                    : "雪球用户");
              const anchorKey = feedKeyValue + ":" + post.id;
              return (
                <PostRow
                  key={anchorKey}
                  post={{ ...post, feedKey: feedKeyValue }}
                  person={person}
                  platform={platform}
                  displayName={displayName}
                  query={query}
                  density={density}
                  showAvatar={isAllFeed || showSingleSourceAvatars}
                  translateEnabled={translateEnabled}
                  onOpen={onOpen}
                  anchorKey={anchorKey}
                  hiddenMediaKeys={hiddenMediaKeys}
                  onHideMedia={onHideMedia}
                />
              );
            })}
          </section>
        ))}

        <div className="py-4 text-center text-[10.5px] text-muted-foreground/80" aria-live="polite">
          {loadingMore
            ? "正在加载更早动态…"
            : loadMoreDone
              ? "没有更早的内容了"
              : <button type="button" className="cursor-pointer text-muted-foreground/80 hover:text-foreground transition-colors" onClick={onScrollNearEnd}>继续下滑加载更早动态</button>}
        </div>
      </>
    );
  }

  const showFreshCue = shouldShowFreshCue(freshCount, scrollTop);
  const cueLabel = showFreshCue ? "已更新 " + freshCount + " 条" : "";

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={bindScroller}
        data-scroll-sync-key={scrollSyncKey}
        className="reader-scrollbar absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain pb-3 [overflow-anchor:none]"
        onWheel={() => {
          holdingPinRef.current = false;
        }}
        onPointerDown={() => {
          holdingPinRef.current = false;
        }}
        onTouchStart={() => {
          holdingPinRef.current = false;
        }}
        onKeyDown={() => {
          holdingPinRef.current = false;
        }}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.clientHeight === 0) return;
          setScrollTop(el.scrollTop);
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) onScrollNearEnd();
          if (flyingToTopRef.current || applyingAnchorRef.current || restoringRef.current || holdingPinRef.current || suppressJumpAckRef.current) {
            lastScrollRef.current = el.scrollTop;
            return;
          }
          const snap = captureAnchor();
          if (el.scrollTop <= NEAR_TOP_PX) {
            pinTopRef.current = false;
            if (freshCount > 0) {
              const fallback = isAllFeed ? "" : activeFeedKey;
              const keys = new Set<string>();
              for (const post of posts) {
                const key = String(post.feedKey || fallback || "");
                const id = String(post.id || "");
                const fresh = timelineFresh[key];
                if (key && id && Array.isArray(fresh) && fresh.includes(id)) keys.add(key);
              }
              if (keys.size) onAcknowledgeLatest([...keys]);
            }
          } else if (el.scrollTop > lastScrollRef.current + 2) {
            pinTopRef.current = false;
          }
          lastScrollRef.current = el.scrollTop;
          persistAnchor(snap);
        }}
      >
        <div
          key={slide.key}
          className={cn(
            slide.dir === "from-right" && "feed-slide-from-right",
            slide.dir === "from-left" && "feed-slide-from-left",
          )}
        >
          {body}
        </div>
      </div>
      {showFreshCue ? (
        <button
          type="button"
          className="fresh-cue absolute top-3 left-1/2 z-20 inline-flex h-7 -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full bg-primary px-3 text-[11.5px] font-medium tracking-[0.01em] text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={cueLabel + "，滚动到最新"}
          onClick={jumpToLatest}
        >
          <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          {cueLabel}
        </button>
      ) : null}
    </div>
  );
}
