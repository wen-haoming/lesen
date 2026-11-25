import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { LayoutList, Plus, RefreshCw, Settings } from "lucide-react";
import { AvatarBadge } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FeedPerson } from "@/lib/config";
import { platformShort } from "@/lib/format";
import { sourceHasFreshUpdate } from "@/lib/source-update";
import {
  resolveSourceStripLayout,
  visibleSourceRange,
  type SourceStripLayout,
} from "@/lib/source-strip-layout";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";

/** 红点表示这条源还有比上次刷新更新的内容；刷新到最新后收掉。 */
function showSourceDot(
  person: FeedPerson,
  timelines: Record<string, unknown[]>,
  timelineAck: Record<string, number>,
) {
  return sourceHasFreshUpdate(timelines[person.key], timelineAck[person.key] || 0);
}

/**
 * 信息源横排。人一多先把 28px 头像收到 18px；
 * 收到一半仍放不下时，悬停用 HoverCard 展开全部来源。
 */
export function SourceStrip({
  feedList,
  activeFeedKey,
  isAllFeed,
  refreshing,
  timelines,
  timelineAck,
  syncLabel,
  onSelectAll,
  onSelectFeed,
  onRemoveFeed,
  onAdd,
  onRefresh,
  onOpenSettings,
}: {
  feedList: FeedPerson[];
  activeFeedKey: string;
  isAllFeed: boolean;
  refreshing: boolean;
  timelines: Record<string, unknown[]>;
  timelineAck: Record<string, number>;
  syncLabel: string;
  onSelectAll: () => void;
  onSelectFeed: (key: string) => void;
  onRemoveFeed: (key: string) => void;
  onAdd: () => void;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
}) {
  const [trackNode, setTrackNode] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<SourceStripLayout>(() =>
    resolveSourceStripLayout(feedList.length, 0),
  );
  const [cardOpen, setCardOpen] = useState(false);
  const setTrack = useCallback((node: HTMLDivElement | null) => {
    setTrackNode((prev) => (prev === node ? prev : node));
  }, []);

  useLayoutEffect(() => {
    if (!trackNode) return;

    const measure = () => {
      const styles = getComputedStyle(trackNode);
      const available =
        trackNode.clientWidth -
        (parseFloat(styles.paddingLeft) || 0) -
        (parseFloat(styles.paddingRight) || 0);
      const next = resolveSourceStripLayout(feedList.length, available);
      setLayout((prev) =>
        prev.size === next.size &&
        prev.gap === next.gap &&
        prev.visibleCount === next.visibleCount &&
        prev.overflow === next.overflow &&
        prev.chipWidth === next.chipWidth
          ? prev
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trackNode);
    return () => observer.disconnect();
  }, [feedList.length, trackNode]);

  useEffect(() => {
    if (!layout.overflow) setCardOpen(false);
  }, [layout.overflow]);

  const activeIndex = isAllFeed ? -1 : feedList.findIndex((person) => person.key === activeFeedKey);
  const range = visibleSourceRange(feedList.length, layout.visibleCount, activeIndex);
  const visible = feedList.slice(range.start, range.end);
  const hiddenCount = layout.overflow ? feedList.length - visible.length : 0;

  const track = (
    <div
      ref={setTrack}
      className="flex min-w-0 flex-1 items-center px-0.5"
      style={{ gap: layout.gap }}
    >
      {visible.map((person) => (
        <SourceAvatarButton
          key={person.key}
          person={person}
          active={!isAllFeed && person.key === activeFeedKey}
          size={layout.size}
          refreshing={refreshing}
          showDot={showSourceDot(person, timelines, timelineAck)}
          withTooltip
          onSelect={onSelectFeed}
          onRemove={onRemoveFeed}
        />
      ))}
      {layout.overflow ? (
        <HoverCard
          open={cardOpen}
          onOpenChange={setCardOpen}
          openDelay={80}
          closeDelay={200}
        >
          <HoverCardTrigger asChild>
            <button
              type="button"
              onClick={() => setCardOpen((v) => !v)}
              aria-label={`展开全部 ${feedList.length} 个信息源`}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground/[0.06] font-semibold tracking-tight text-muted-foreground transition-colors hover:bg-foreground/[0.11] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              style={{ width: layout.chipWidth, height: layout.size, fontSize: 9 }}
            >
              {"+" + hiddenCount}
            </button>
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border-foreground/15 p-0"
          >
            <AllSourcesCard
              feedList={feedList}
              activeFeedKey={activeFeedKey}
              isAllFeed={isAllFeed}
              refreshing={refreshing}
              timelines={timelines}
              timelineAck={timelineAck}
              onSelect={(key) => {
                onSelectFeed(key);
                setCardOpen(false);
              }}
              onRemove={onRemoveFeed}
            />
          </HoverCardContent>
        </HoverCard>
      ) : null}
    </div>
  );

  const showChromeActions = Boolean(onRefresh && onOpenSettings);

  return (
    <TooltipProvider delayDuration={280}>
      <div className="flex h-[56px] shrink-0 items-center gap-1.5 px-4">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 self-stretch"
          role="tablist"
          aria-label="信息源"
          aria-disabled={refreshing ? "true" : "false"}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                role="tab"
                aria-selected={isAllFeed}
                aria-label="聚合全部信息源"
                disabled={refreshing || !feedList.length}
                onClick={onSelectAll}
                data-active={isAllFeed ? "true" : "false"}
                style={{ width: layout.size, height: layout.size }}
                className={cn(
                  "rail-avatar shrink-0 self-center rounded-full p-0",
                  "bg-foreground/[0.05] text-muted-foreground",
                  "hover:bg-foreground/[0.08] hover:text-foreground",
                  "disabled:pointer-events-none disabled:opacity-35",
                  isAllFeed && "text-foreground",
                )}
              >
                <LayoutList className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>全部信息流</TooltipContent>
          </Tooltip>

          <div className="flex min-w-0 flex-1 self-stretch items-center">{track}</div>
        </div>

        <div className="flex shrink-0 items-center gap-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="添加信息源"
                onClick={onAdd}
                className="size-7 shrink-0 rounded-[9px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>添加雪球、微博或 X 信息源</TooltipContent>
          </Tooltip>

          {showChromeActions ? (
            <HeaderActions
              syncLabel={syncLabel}
              refreshing={refreshing}
              onRefresh={onRefresh!}
              onOpenSettings={onOpenSettings!}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** 侧栏顶栏：刷新图标和「更新于」合成一颗按钮；弹窗仍用左侧竖栏。 */
function HeaderActions({
  syncLabel,
  refreshing,
  onRefresh,
  onOpenSettings,
}: {
  syncLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const prefix = "更新于 ";
  const face = syncLabel.startsWith(prefix) ? syncLabel.slice(prefix.length) : syncLabel;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={"刷新最新帖子，" + syncLabel}
            disabled={refreshing}
            onClick={onRefresh}
            className="h-7 shrink-0 gap-1 rounded-[9px] px-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} strokeWidth={1.75} />
            <span className="tnum text-[10px] font-medium tracking-[0.01em]">{face}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          刷新最新帖子
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开设置"
            onClick={onOpenSettings}
            className="size-7 shrink-0 rounded-[9px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          设置
        </TooltipContent>
      </Tooltip>
    </>
  );
}

/** 格子按整行取高，滚动停在行边界上，避免头像被切成半圆。 */
const SOURCE_GRID_COLS = 4;
const SOURCE_GRID_ROW = 76;
const SOURCE_GRID_GAP = 6;
const SOURCE_GRID_VISIBLE_ROWS = 4;

function sourceGridMaxHeight(count: number) {
  const rows = Math.min(SOURCE_GRID_VISIBLE_ROWS, Math.ceil(count / SOURCE_GRID_COLS));
  if (rows <= 0) return 0;
  return rows * SOURCE_GRID_ROW + (rows - 1) * SOURCE_GRID_GAP;
}

function AllSourcesCard({
  feedList,
  activeFeedKey,
  isAllFeed,
  refreshing,
  timelines,
  timelineAck,
  onSelect,
  onRemove,
}: {
  feedList: FeedPerson[];
  activeFeedKey: string;
  isAllFeed: boolean;
  refreshing: boolean;
  timelines: Record<string, unknown[]>;
  timelineAck: Record<string, number>;
  onSelect: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <p className="text-[12px] font-medium tracking-[0.01em] text-foreground">全部信息源</p>
        <p className="tnum text-[11px] text-muted-foreground">{feedList.length}</p>
      </div>
      <div className="px-1.5 pb-2">
        <div
          className="reader-scrollbar grid grid-cols-4 snap-y snap-proximity overflow-y-auto overscroll-contain"
          style={{
            maxHeight: sourceGridMaxHeight(feedList.length),
            gridAutoRows: SOURCE_GRID_ROW,
            gap: SOURCE_GRID_GAP,
          }}
          role="group"
          aria-label="全部信息源"
        >
          {feedList.map((person) => {
            const active = !isAllFeed && person.key === activeFeedKey;
            const name = person.name || person.id;
            const label = name + " · " + platformShort(person.platform);
            return (
              <button
                key={person.key}
                type="button"
                aria-label={label}
                aria-current={active ? "true" : undefined}
                disabled={refreshing}
                className={cn(
                  "flex h-full min-w-0 snap-start flex-col items-center gap-0.5 rounded-[10px] px-1 py-1.5 text-muted-foreground",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  "disabled:pointer-events-none disabled:opacity-35",
                  active && "text-foreground",
                )}
                onClick={() => onSelect(person.key)}
                onContextMenu={(event) => {
                  if (!person.pinned) return;
                  event.preventDefault();
                  onRemove(person.key);
                }}
              >
                <span className="rail-avatar relative size-9" data-active={active ? "true" : "false"}>
                  <Avatar
                    name={name}
                    avatar={person.avatar}
                    platform={person.platform}
                    className="size-full"
                  />
                  {showSourceDot(person, timelines, timelineAck) ? (
                    <AvatarBadge className="size-2 bg-primary ring-2 ring-background" aria-hidden="true" />
                  ) : null}
                </span>
                <span
                  className="block h-3 w-full truncate text-center text-[10px] font-medium leading-3 text-foreground/90"
                  title={name}
                >
                  {name}
                </span>
                <span className="block h-3 text-[9px] leading-3 tracking-[0.04em] text-muted-foreground/70">
                  {platformShort(person.platform)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourceAvatarButton({
  person,
  active,
  size,
  refreshing,
  showDot,
  withTooltip,
  onSelect,
  onRemove,
}: {
  person: FeedPerson;
  active: boolean;
  size: number;
  refreshing: boolean;
  showDot: boolean;
  withTooltip: boolean;
  onSelect: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const name = person.name || person.id;
  const label = name + " · " + platformShort(person.platform);
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      role="tab"
      aria-selected={active}
      aria-label={label}
      data-active={active ? "true" : "false"}
      disabled={refreshing}
      style={{ width: size, height: size }}
      className={cn(
        "rail-avatar relative shrink-0 rounded-full p-0",
        "disabled:pointer-events-none disabled:opacity-35",
        active ? "" : "opacity-90 hover:opacity-100",
        size <= 20 && "[&_[data-slot=avatar-fallback]]:text-[8px]",
        size > 20 && size <= 28 && "[&_[data-slot=avatar-fallback]]:text-[10px]",
      )}
      onClick={() => onSelect(person.key)}
      onContextMenu={(event) => {
        if (!person.pinned) return;
        event.preventDefault();
        onRemove(person.key);
      }}
    >
      <Avatar name={name} avatar={person.avatar} platform={person.platform} />
      {showDot ? (
        <AvatarBadge
          className={cn(
            "bg-primary ring-background",
            size <= 22 ? "size-1.5 ring-1" : "size-2 ring-2",
          )}
          aria-hidden="true"
        />
      ) : null}
    </Button>
  );

  if (!withTooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
