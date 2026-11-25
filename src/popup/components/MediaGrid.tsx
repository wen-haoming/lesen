import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VideoPlayer } from "@/components/ui/video-player";
import { isVideoUrl } from "@/lib/post-media";
import { cn } from "@/lib/utils";

/** 列数跟常见信息流一致：4 张 2×2，其余多图 3 列。 */
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2 || count === 4) return "grid-cols-2";
  return "grid-cols-3";
}

function mediaButtonClass(count: number, compact: boolean): string {
  if (count === 1) {
    return compact
      ? "w-fit max-w-64 max-h-32"
      : "w-fit max-w-[520px] max-h-[280px]";
  }
  // 多图铺满格子成正方形，横竖间距都交给 gap，不再固定像素宽留下右侧空洞。
  return "aspect-square w-full min-w-0";
}

function mediaGridClass(count: number, compact: boolean): string {
  if (count <= 1) {
    return "w-full max-w-[520px]";
  }
  return cn("w-full", compact && "max-w-[240px]");
}

export function MediaGrid({
  urls,
  compact = false,
  caption,
  platform = "",
  mediaKeyForUrl,
  hiddenMediaKeys,
  onHideMedia,
}: {
  urls: string[];
  compact?: boolean;
  caption?: string;
  platform?: string;
  mediaKeyForUrl?: (url: string) => string;
  hiddenMediaKeys?: Set<string>;
  onHideMedia?: (key: string, url: string) => void;
}) {
  const list = Array.isArray(urls)
    ? urls.filter(Boolean).filter((url) => {
        const key = mediaKeyForUrl?.(url);
        return !key || !hiddenMediaKeys?.has(key);
      })
    : [];
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const isOpen = openIndex !== null;
  const hasNavigation = list.length > 1;

  useEffect(() => {
    if (!isOpen || !hasNavigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setOpenIndex((index) => ((index ?? 0) - 1 + list.length) % list.length);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setOpenIndex((index) => ((index ?? 0) + 1) % list.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNavigation, isOpen, list.length]);

  if (!list.length) return null;

  const activeIndex = openIndex ?? 0;
  const activeUrl = list[activeIndex];
  const activeIsVideo = activeUrl ? isVideoUrl(activeUrl) : false;
  const hasVideo = list.some((url) => isVideoUrl(url));

  return (
    <>
      <div className={cn("mt-2.5", compact && "mt-1.5")}>
        <div
          className={cn(
            "grid gap-1.5",
            gridClass(list.length),
            mediaGridClass(list.length, compact),
          )}
          data-media-platform={platform || undefined}
        >
          {list.map((url, index) => {
            const video = isVideoUrl(url);
            const mediaKey = mediaKeyForUrl?.(url);
            return (
              <div
                key={mediaKey || url + index}
                className={cn(
                  "group/media relative min-w-0",
                  list.length === 1 ? "w-full max-w-[520px]" : "w-full",
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "relative h-auto overflow-hidden rounded-[10px] p-0 ring-1 ring-black/[0.05] transition-opacity hover:opacity-95",
                    list.length === 1 ? "bg-transparent" : "bg-muted",
                    mediaButtonClass(list.length, compact),
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenIndex(index);
                  }}
                  aria-label={
                    video
                      ? `播放视频 ${index + 1}，共 ${list.length} 个`
                      : `查看图片 ${index + 1}，共 ${list.length} 张`
                  }
                >
                  {video ? (
                    <>
                      <video
                        src={url}
                        muted
                        playsInline
                        preload="metadata"
                        className="pointer-events-none size-full object-cover"
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                        <span className="flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
                          <Play className="size-4 fill-current" />
                        </span>
                      </span>
                    </>
                  ) : (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      referrerPolicy={
                        /sinaimg\.cn$/i.test(
                          (() => {
                            try {
                              return new URL(url).hostname;
                            } catch {
                              return "";
                            }
                          })(),
                        )
                          ? "origin"
                          : undefined
                      }
                      className={cn(
                        "size-full object-cover",
                      )}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </Button>
                {mediaKey && onHideMedia ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 z-10 size-6 rounded-full bg-black/65 text-white opacity-0 shadow-sm transition-opacity hover:bg-black/80 hover:text-white group-hover/media:opacity-100 group-focus-within/media:opacity-100"
                    aria-label="从首页移除此媒体"
                    title="从首页移除此媒体"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onHideMedia(mediaKey, url);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
        {caption ? <p className="mt-1 text-[10px] text-muted-foreground">{caption}</p> : null}
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => !open && setOpenIndex(null)}>
        <DialogContent
          aria-describedby={undefined}
          overlayClassName="bg-black/88"
          closeClassName="lightbox-close z-20 right-3 top-3 size-9 rounded-full border border-white/20 bg-black/55 text-white hover:bg-black/70 hover:text-white focus-visible:outline-white"
          className="inset-0 left-0 top-0 flex h-full max-h-full w-full max-w-none translate-x-0 items-center justify-center overflow-hidden rounded-none border-0 bg-transparent p-0"
        >
          <DialogTitle className="sr-only">{hasVideo ? "媒体预览" : "图片预览"}</DialogTitle>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-16 items-center bg-gradient-to-b from-black/45 to-transparent px-4 pr-14">
            <div className="flex items-center gap-2 text-white">
              <span className="text-[11px] font-medium tracking-wide">
                {activeIsVideo ? "视频预览" : "图片预览"}
              </span>
              {caption ? <span className="text-[10px] text-white/55">{caption}</span> : null}
            </div>
          </div>

          <div
            className={cn(
              "flex h-full w-full items-center justify-center py-14",
              hasNavigation ? "px-12" : "px-3",
            )}
            onClick={(event) => {
              // 全屏 DialogContent 盖住了遮罩，点边缘空白处直接关预览
              if (event.target === event.currentTarget) setOpenIndex(null);
            }}
          >
            {activeUrl ? (
              activeIsVideo ? (
                <VideoPlayer
                  src={activeUrl}
                  autoPlay
                  className="max-h-full max-w-full"
                  videoClassName="max-h-[min(88vh,820px)] w-auto"
                />
              ) : (
                <img
                  src={activeUrl}
                  alt={`帖子图片 ${activeIndex + 1}`}
                  className="max-h-full max-w-full rounded-[5px] object-contain"
                />
              )
            ) : null}
          </div>

          {hasNavigation ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="上一张"
                title="上一张"
                className="lightbox-control absolute top-1/2 left-2 z-20 size-10 -translate-y-1/2 rounded-full border border-white/25 bg-black/60 text-white hover:bg-black/80 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenIndex((index) => ((index ?? 0) - 1 + list.length) % list.length);
                }}
              >
                <ChevronLeft data-icon="inline-start" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="下一张"
                title="下一张"
                className="lightbox-control absolute top-1/2 right-2 z-20 size-10 -translate-y-1/2 rounded-full border border-white/25 bg-black/60 text-white hover:bg-black/80 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenIndex((index) => ((index ?? 0) + 1) % list.length);
                }}
              >
                <ChevronRight data-icon="inline-end" />
              </Button>
            </>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-14 items-center justify-center bg-gradient-to-t from-black/45 to-transparent">
            <span className="tnum rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[10px] tracking-[0.04em] text-white/85">
              {String(activeIndex + 1).padStart(2, "0")} / {String(list.length).padStart(2, "0")}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
