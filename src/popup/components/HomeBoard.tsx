import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import { GripVertical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEED_ALL, sanitizeHomeOrder, type Platform } from "@/lib/config";
import { platformShort } from "@/lib/format";
import { collectPlatformPosts, feedsForPlatform } from "@/lib/visible-posts";
import type { HomeHiddenMedia, useReader } from "@/hooks/useReader";
import { cn } from "@/lib/utils";
import { PlatformLogo } from "./PlatformLogo";
import { Timeline } from "./Timeline";
import { Avatar } from "./Avatar";

function orderedPlatforms(order?: Platform[]): Platform[] {
  return sanitizeHomeOrder(order);
}

type Reader = ReturnType<typeof useReader>;

type ResizeRequest = {
  platform: Platform;
  startWidth: number;
  delta: number;
  commit: boolean;
};

const MIN_COLUMN_WIDTH = 280;
const MAX_COLUMN_WIDTH = 820;
const DRAG_ACTIVATE_PX = 5;

function columnEmptyCopy(platformLabel: string) {
  return {
    notReadyDescription: "正在读取该平台的订阅。",
    noSourceDescription: "还没有订阅" + platformLabel + "作者，可在侧栏添加。",
    noPostsDescription: "该平台目前没有帖子。",
    loadingLabel: "正在读取" + platformLabel + "动态",
  };
}

export function HomeBoard({ reader, syncScroll = false }: { reader: Reader; syncScroll?: boolean }) {
  const savedOrder = useMemo(
    () => orderedPlatforms(reader.state.settings.homeOrder),
    [reader.state.settings.homeOrder],
  );
  const [dragged, setDragged] = useState<Platform | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Platform[] | null>(null);
  const [resizingPlatform, setResizingPlatform] = useState<Platform | null>(null);
  const [refreshingColumn, setRefreshingColumn] = useState<Platform | null>(null);
  const [selectedByPlatform, setSelectedByPlatform] = useState<Partial<Record<Platform, string>>>(
    {},
  );
  const [widths, setWidths] = useState(reader.state.settings.homeColumnWidths || {});

  const boardRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const previewOrderRef = useRef<Platform[] | null>(null);
  const savedOrderRef = useRef(savedOrder);
  savedOrderRef.current = savedOrder;
  const widthsRef = useRef(widths);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const syncPendingRef = useRef<{ host: HTMLElement; source: HTMLElement; top: number } | null>(
    null,
  );

  const activeOrder = previewOrder || savedOrder;

  const syncHomeScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!syncScroll) return;
      const source = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-scroll-sync-key="home"]',
      );
      if (!source) return;
      syncPendingRef.current = { host: event.currentTarget, source, top: source.scrollTop };
      if (syncFrameRef.current !== null) return;
      syncFrameRef.current = requestAnimationFrame(() => {
        syncFrameRef.current = null;
        const pending = syncPendingRef.current;
        syncPendingRef.current = null;
        if (!pending) return;
        const scrollers = pending.host.querySelectorAll<HTMLElement>(
          '[data-scroll-sync-key="home"]',
        );
        scrollers.forEach((scroller) => {
          if (scroller !== pending.source && Math.abs(scroller.scrollTop - pending.top) > 1) {
            scroller.scrollTop = pending.top;
          }
        });
      });
    },
    [syncScroll],
  );

  useEffect(() => {
    const nextWidths = reader.state.settings.homeColumnWidths || {};
    widthsRef.current = nextWidths;
    setWidths(nextWidths);
  }, [reader.state.settings.homeColumnWidths]);

  useEffect(() => {
    if (!reader.state.refreshing) setRefreshingColumn(null);
  }, [reader.state.refreshing]);

  useEffect(
    () => () => {
      if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current);
      dragCleanupRef.current?.();
    },
    [],
  );

  const resizePlatform = useCallback(
    ({ platform, startWidth, delta, commit }: ResizeRequest) => {
      const nextWidth = Math.round(
        Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, startWidth + delta)),
      );
      const next = { ...widthsRef.current, [platform]: nextWidth };
      widthsRef.current = next;
      const column = boardRef.current?.querySelector<HTMLElement>(
        `[data-home-column="${platform}"]`,
      );
      if (column) {
        column.style.width = `${nextWidth}px`;
        column.style.flex = "0 0 auto";
      }
      if (commit) {
        setWidths(next);
        reader.updateReaderPrefs({ homeColumnWidths: next });
      }
    },
    [reader.updateReaderPrefs],
  );

  const resetColumnWidth = useCallback(
    (platform: Platform) => {
      const next = { ...widthsRef.current };
      delete next[platform];
      widthsRef.current = next;
      const column = boardRef.current?.querySelector<HTMLElement>(
        `[data-home-column="${platform}"]`,
      );
      if (column) {
        column.style.width = "";
        column.style.flex = "1 1 0%";
      }
      setWidths(next);
      reader.updateReaderPrefs({ homeColumnWidths: next });
    },
    [reader.updateReaderPrefs],
  );

  const moveByKeyboard = useCallback(
    (platform: Platform, direction: -1 | 1) => {
      const current = orderedPlatforms(savedOrderRef.current);
      const from = current.indexOf(platform);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, platform);
      reader.updateReaderPrefs({ homeOrder: next });
    },
    [reader.updateReaderPrefs],
  );

  const startHeaderPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, platform: Platform) => {
      if (event.button !== 0) return;
      const targetEl = event.target as HTMLElement | null;
      if (targetEl?.closest('[data-no-column-drag="true"]')) return;

      dragCleanupRef.current?.();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let prevUserSelect = "";
      let prevCursor = "";

      const positionGhost = (clientX: number, clientY: number) => {
        const ghost = ghostRef.current;
        if (!ghost) return;
        ghost.style.transform = `translate3d(${Math.round(clientX + 12)}px, ${Math.round(clientY - 16)}px, 0)`;
      };

      const maybeSwapTarget = (clientX: number) => {
        const host = boardRef.current;
        if (!host) return;
        const hostRect = host.getBoundingClientRect();
        if (host.scrollWidth > host.clientWidth) {
          if (clientX - hostRect.left < 56) host.scrollLeft -= 14;
          else if (hostRect.right - clientX < 56) host.scrollLeft += 14;
        }
        const current = previewOrderRef.current || savedOrderRef.current;
        const fromIdx = current.indexOf(platform);
        if (fromIdx < 0) return;

        for (let idx = 0; idx < current.length; idx++) {
          const candidate = current[idx];
          if (candidate === platform) continue;
          const el = host.querySelector<HTMLElement>(`[data-home-column="${candidate}"]`);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (clientX < rect.left || clientX > rect.right) continue;
          const ratio = (clientX - rect.left) / Math.max(1, rect.width);
          // 向右拖过相邻列 42% 宽度、或向左拖过 58% 宽度即实时交换位置，避免边界抖动。
          const shouldSwap = (fromIdx < idx && ratio >= 0.42) || (fromIdx > idx && ratio <= 0.58);
          if (!shouldSwap) break;
          const next = [...current];
          next.splice(fromIdx, 1);
          next.splice(idx, 0, platform);
          previewOrderRef.current = next;
          setPreviewOrder(next);
          break;
        }
      };

      const cleanupStyles = () => {
        if (!active) return;
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown);
        dragCleanupRef.current = null;
      };

      const finish = (commit: boolean) => {
        const finalOrder = previewOrderRef.current;
        cleanupStyles();
        detach();
        previewOrderRef.current = null;
        setDragged(null);
        setPreviewOrder(null);
        if (commit && active && finalOrder) {
          const initial = savedOrderRef.current;
          const changed =
            finalOrder.length === initial.length &&
            finalOrder.some((item, idx) => item !== initial[idx]);
          if (changed) reader.updateReaderPrefs({ homeOrder: finalOrder });
        }
      };

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!active) {
          if (Math.hypot(dx, dy) < DRAG_ACTIVATE_PX) return;
          active = true;
          prevUserSelect = document.body.style.userSelect;
          prevCursor = document.body.style.cursor;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          const initial = orderedPlatforms(savedOrderRef.current);
          previewOrderRef.current = initial;
          setPreviewOrder(initial);
          setDragged(platform);
          requestAnimationFrame(() => positionGhost(moveEvent.clientX, moveEvent.clientY));
        }
        moveEvent.preventDefault();
        positionGhost(moveEvent.clientX, moveEvent.clientY);
        maybeSwapTarget(moveEvent.clientX);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        finish(true);
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(false);
      };

      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finish(false);
        }
      };

      dragCleanupRef.current = () => finish(false);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [reader.updateReaderPrefs],
  );

  const selectFeed = useCallback(
    (platform: Platform, feedKey?: string) => {
      setSelectedByPlatform((current) => {
        const next = { ...current };
        if (feedKey) next[platform] = feedKey;
        else delete next[platform];
        return next;
      });
      void reader.selectFeed(feedKey || FEED_ALL);
    },
    [reader.selectFeed],
  );

  const refreshSingleColumn = useCallback(
    (platform: Platform, feedKeys: string[]) => {
      if (!feedKeys.length) return;
      setRefreshingColumn(platform);
      void reader.refresh({ feedKeys });
    },
    [reader.refresh],
  );

  const hiddenMedia = Array.isArray(reader.state.settings.homeHiddenMedia)
    ? reader.state.settings.homeHiddenMedia
    : [];
  const hiddenMediaKeys = useMemo(
    () => new Set(hiddenMedia.map((media) => media.key)),
    [hiddenMedia],
  );
  const onHideMedia = useCallback(
    (media: HomeHiddenMedia) => {
      const current = Array.isArray(reader.state.settings.homeHiddenMedia)
        ? reader.state.settings.homeHiddenMedia
        : [];
      if (current.some((item) => item.key === media.key)) return;
      reader.updateReaderPrefs({ homeHiddenMedia: [...current, media] });
    },
    [reader.state.settings.homeHiddenMedia, reader.updateReaderPrefs],
  );

  return (
    <div
      ref={boardRef}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      onScrollCapture={syncHomeScroll}
    >
      {activeOrder.map((platform, index) => (
        <HomeColumn
          key={platform}
          platform={platform}
          reader={reader}
          first={index === 0}
          last={index === activeOrder.length - 1}
          width={widths[platform]}
          dragged={dragged === platform}
          resizing={resizingPlatform === platform}
          columnRefreshing={
            reader.state.refreshing &&
            (refreshingColumn === null || refreshingColumn === platform)
          }
          selectedFeedKey={selectedByPlatform[platform]}
          hiddenMediaKeys={hiddenMediaKeys}
          onHideMedia={onHideMedia}
          onSelectFeed={selectFeed}
          onRefreshColumn={refreshSingleColumn}
          onHeaderPointerDown={startHeaderPointerDrag}
          onMoveKeyboard={moveByKeyboard}
          onResize={resizePlatform}
          onResizeActiveChange={setResizingPlatform}
          onResetWidth={resetColumnWidth}
          syncScroll={syncScroll}
        />
      ))}
      {dragged ? (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-50 flex items-center gap-1.5 rounded-lg border border-primary/35 bg-popover/95 px-2.5 py-1.5 text-[12px] font-semibold text-popover-foreground shadow-lg backdrop-blur-sm"
          style={{ transform: "translate3d(-9999px, -9999px, 0)" }}
        >
          <GripVertical className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
          <PlatformLogo platform={dragged} className="size-3.5" title={platformShort(dragged)} />
          <span>{platformShort(dragged)}</span>
        </div>
      ) : null}
    </div>
  );
}

type HomeColumnProps = {
  platform: Platform;
  reader: Reader;
  first: boolean;
  last: boolean;
  width?: number;
  dragged: boolean;
  resizing: boolean;
  columnRefreshing: boolean;
  selectedFeedKey?: string;
  hiddenMediaKeys: Set<string>;
  onHideMedia: (media: HomeHiddenMedia) => void;
  onSelectFeed: (platform: Platform, feedKey?: string) => void;
  onRefreshColumn: (platform: Platform, feedKeys: string[]) => void;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>, platform: Platform) => void;
  onMoveKeyboard: (platform: Platform, direction: -1 | 1) => void;
  onResize: (request: ResizeRequest) => void;
  onResizeActiveChange: (platform: Platform | null) => void;
  onResetWidth: (platform: Platform) => void;
  syncScroll: boolean;
};

const HomeColumn = memo(function HomeColumn({
  platform,
  reader,
  first,
  last,
  width,
  dragged,
  resizing,
  columnRefreshing,
  selectedFeedKey: requestedFeedKey,
  hiddenMediaKeys,
  onHideMedia,
  onSelectFeed,
  onRefreshColumn,
  onHeaderPointerDown,
  onMoveKeyboard,
  onResize,
  onResizeActiveChange,
  onResetWidth,
  syncScroll,
}: HomeColumnProps) {
  const columnRef = useRef<HTMLElement | null>(null);
  const feeds = useMemo(
    () => feedsForPlatform(reader.feedList, platform),
    [reader.feedList, platform],
  );
  const selectedFeedKey = feeds.some((person) => person.key === requestedFeedKey)
    ? requestedFeedKey
    : undefined;
  const visibleFeeds = useMemo(
    () => (selectedFeedKey ? feeds.filter((person) => person.key === selectedFeedKey) : feeds),
    [feeds, selectedFeedKey],
  );
  const posts = useMemo(
    () =>
      collectPlatformPosts({
        timelines: reader.state.timelines,
        feedList: visibleFeeds,
        platform,
        // 首页不沿用侧栏搜索框，避免遗留关键字把整列滤空
        query: "",
        sort: reader.state.settings.sort,
      }),
    [reader.state.timelines, reader.state.settings.sort, visibleFeeds, platform],
  );
  const label = platformShort(platform);
  const loadMoreDone =
    visibleFeeds.length > 0 &&
    visibleFeeds.every((person) => reader.state.timelinePaging[person.key]?.done);
  const feedKeys = useMemo(() => visibleFeeds.map((person) => person.key), [visibleFeeds]);

  const handleKeyReorder = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" && !first) {
      event.preventDefault();
      onMoveKeyboard(platform, -1);
    } else if (event.key === "ArrowRight" && !last) {
      event.preventDefault();
      onMoveKeyboard(platform, 1);
    }
  };

  return (
    <section
      ref={columnRef}
      className={cn(
        "relative flex min-h-0 min-w-[280px] flex-col bg-background transition-[background-color,box-shadow] duration-150 ease-out",
        !last && "border-r border-border/70",
        dragged &&
          "z-20 bg-primary/[0.03] ring-1 ring-inset ring-primary/45 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.22)]",
        resizing && "z-10 select-none",
      )}
      style={width ? { width, flex: "0 0 auto" } : { flex: "1 1 0%" }}
      aria-label={label}
      data-home-column={platform}
    >
      <div
        onPointerDown={(event) => onHeaderPointerDown(event, platform)}
        className={cn(
          "flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-b border-border/70 px-3 touch-none active:cursor-grabbing",
          dragged && "bg-primary/[0.06]",
        )}
      >
        <button
          type="button"
          aria-label={`拖动${label}栏目排序（方向键可左右移动）`}
          title="按住拖动调整栏目顺序，或使用左右方向键移动"
          className="flex size-6 -ml-1 items-center justify-center rounded-md text-muted-foreground/65 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={handleKeyReorder}
        >
          <GripVertical className="size-3.5" strokeWidth={1.8} />
        </button>
        <PlatformLogo platform={platform} className="size-3.5 shrink-0" title={label} />
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-[-0.01em]">
          {label}
        </h2>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {visibleFeeds.length ? posts.length + " 条 · " + visibleFeeds.length + " 个源" : "未订阅"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-no-column-drag="true"
          className="size-7 cursor-pointer rounded-[7px] text-muted-foreground"
          aria-label={"刷新" + label}
          disabled={reader.state.refreshing || visibleFeeds.length === 0}
          onClick={() => onRefreshColumn(platform, feedKeys)}
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              columnRefreshing && visibleFeeds.length > 0 && "animate-spin",
            )}
            strokeWidth={1.75}
          />
        </Button>
      </div>
      {feeds.length ? (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-1.5">
          <button
            type="button"
            className={cn(
              "h-6 shrink-0 rounded-full px-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted",
              !selectedFeedKey && "bg-primary/10 font-medium text-primary",
            )}
            aria-label={`查看全部${label}作者`}
            aria-pressed={!selectedFeedKey}
            onClick={() => onSelectFeed(platform)}
          >
            全部
          </button>
          {feeds.map((person) => (
            <button
              key={person.key}
              type="button"
              className={cn(
                "size-6 shrink-0 rounded-full p-0.5 transition-transform hover:scale-105",
                selectedFeedKey === person.key &&
                  "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
              aria-label={`查看${person.name || person.id}`}
              aria-pressed={selectedFeedKey === person.key}
              onClick={() => onSelectFeed(platform, person.key)}
            >
              <Avatar
                name={person.name || person.id}
                avatar={person.avatar}
                platform={person.platform}
              />
            </button>
          ))}
        </div>
      ) : null}
      <Timeline
        posts={posts}
        feedList={visibleFeeds}
        timelines={reader.state.timelines}
        activeFeedKey={selectedFeedKey || FEED_ALL}
        isAllFeed={!selectedFeedKey}
        query=""
        density={reader.state.settings.density}
        translateEnabled={reader.state.settings.translateX !== false}
        loadingMore={reader.state.loadingMore}
        refreshing={columnRefreshing}
        loadMoreDone={loadMoreDone}
        timelineError={reader.state.timelineError}
        onOpen={reader.openPost}
        onScrollNearEnd={() => {
          if (feedKeys.length) void reader.maybeLoadMore({ feedKeys });
        }}
        timelineFresh={reader.state.timelineFresh}
        onAcknowledgeLatest={reader.acknowledgeLatest}
        emptyCopy={columnEmptyCopy(label)}
        surface="home"
        columnPlatform={platform}
        persistPositions={!reader.state.previewMode}
        scrollSyncKey={syncScroll ? "home" : undefined}
        hiddenMediaKeys={hiddenMediaKeys}
        onHideMedia={onHideMedia}
      />
      {!last ? (
        <div
          role="separator"
          aria-label={`调整${label}栏目宽度（双击恢复均分宽度）`}
          title="拖动调整列宽，双击恢复默认宽度"
          className="group/resize absolute inset-y-0 -right-1.5 z-20 flex w-3 cursor-col-resize touch-none items-stretch justify-center"
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResetWidth(platform);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const handleEl = event.currentTarget;
            const pointerId = event.pointerId;
            try {
              handleEl.setPointerCapture(pointerId);
            } catch {
              /* ignore synthetic events without capture */
            }
            const measuredWidth =
              columnRef.current?.getBoundingClientRect().width || width || 380;
            const startX = event.clientX;
            const startWidth = Math.round(measuredWidth);
            const prevUserSelect = document.body.style.userSelect;
            const prevCursor = document.body.style.cursor;
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
            onResizeActiveChange(platform);

            const cleanup = () => {
              document.body.style.userSelect = prevUserSelect;
              document.body.style.cursor = prevCursor;
              onResizeActiveChange(null);
              try {
                if (handleEl.hasPointerCapture(pointerId)) {
                  handleEl.releasePointerCapture(pointerId);
                }
              } catch {
                /* noop */
              }
              window.removeEventListener("pointermove", update);
              window.removeEventListener("pointerup", finish);
              window.removeEventListener("pointercancel", cancel);
            };
            const update = (moveEvent: PointerEvent) => {
              if (moveEvent.pointerId !== pointerId) return;
              onResize({
                platform,
                startWidth,
                delta: moveEvent.clientX - startX,
                commit: false,
              });
            };
            const finish = (upEvent: PointerEvent) => {
              if (upEvent.pointerId !== pointerId) return;
              onResize({
                platform,
                startWidth,
                delta: upEvent.clientX - startX,
                commit: true,
              });
              cleanup();
            };
            const cancel = (cancelEvent: PointerEvent) => {
              if (cancelEvent.pointerId !== pointerId) return;
              cleanup();
            };
            window.addEventListener("pointermove", update);
            window.addEventListener("pointerup", finish);
            window.addEventListener("pointercancel", cancel);
          }}
        >
          <span
            className={cn(
              "h-full w-[2px] rounded-full transition-colors duration-150",
              resizing ? "bg-primary" : "bg-transparent group-hover/resize:bg-primary/45",
            )}
          />
        </div>
      ) : null}
    </section>
  );
});
