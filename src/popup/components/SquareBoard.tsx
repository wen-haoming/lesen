import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { useReader } from "@/hooks/useReader";
import { platformShort } from "@/lib/format";
import { SQUARE_PLATFORMS, type SquarePlatform } from "@/lib/square-config";
import { detectShellMode } from "@/lib/shell-mode";
import { isHomePagePath } from "@/lib/home-page";
import { cn } from "@/lib/utils";
import { PlatformLogo } from "./PlatformLogo";
import { WeiboTopicPanel } from "./WeiboTopicPanel";
import { XTopicPanel } from "./XTopicPanel";
import { XueqiuTopicPanel } from "./XueqiuTopicPanel";

type Reader = ReturnType<typeof useReader>;

function ScrollPanel({ visible, children }: { visible: boolean; children: ReactNode }) {
  const positions = useRef(new Map<HTMLElement, number>());
  useLayoutEffect(() => {
    if (!visible) return;
    const saved = new Map(positions.current);
    const restore = () => {
      for (const [node, top] of saved) node.scrollTop = top;
    };
    restore();
    // 隐藏期间 Timeline 的 ResizeObserver 可能调整锚点，显示后再恢复可见时的位置。
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  return (
    <div
      className={cn("min-h-0 flex-1", visible ? "block" : "hidden")}
      onScrollCapture={(event) => {
        if (visible && event.target instanceof HTMLElement)
          positions.current.set(event.target, event.target.scrollTop);
      }}
    >
      {children}
    </div>
  );
}

export function SquareBoard({ reader, active = true }: { reader: Reader; active?: boolean }) {
  const isHome =
    detectShellMode() === "home" ||
    isHomePagePath(typeof location === "undefined" ? "" : location.pathname);
  const [platform, setPlatform] = useState<SquarePlatform>("xueqiu");
  const [visited, setVisited] = useState<SquarePlatform[]>(["xueqiu"]);

  const selectPlatform = (item: SquarePlatform) => {
    setPlatform(item);
    setVisited((prev) => (prev.includes(item) ? prev : [...prev, item]));
  };

  return (
    <section
      className={cn(
        "h-full min-h-0 flex-1 overflow-hidden bg-background",
        active ? (isHome ? "grid grid-cols-3" : "flex flex-col") : "hidden",
      )}
      aria-label="广场"
    >
      {isHome ? (
        <>
          <SquareColumn platform="xueqiu" reader={reader} active={active} />
          <SquareColumn platform="weibo" reader={reader} active={active} />
          <SquareColumn platform="x" reader={reader} active={active} />
        </>
      ) : (
        <>
          <div
            className="flex h-10 shrink-0 items-center gap-1 border-b border-border/70 px-3"
            aria-label="广场平台"
          >
            {SQUARE_PLATFORMS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={platform === item}
                onClick={() => selectPlatform(item)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors",
                  platform === item
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <PlatformLogo platform={item} className="size-3.5" />
                {platformShort(item)}
              </button>
            ))}
          </div>
          {SQUARE_PLATFORMS.filter((item) => visited.includes(item)).map((item) => (
            <SquareColumn
              key={item}
              platform={item}
              reader={reader}
              active={active && platform === item}
              hidden={platform !== item}
            />
          ))}
        </>
      )}
    </section>
  );
}

function SquareColumn({
  platform,
  reader,
  active,
  hidden = false,
}: {
  platform: SquarePlatform;
  reader: Reader;
  active: boolean;
  hidden?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border-r border-border/70 last:border-r-0",
        hidden && "hidden",
      )}
    >
      {reader.state.previewMode ? (
        <p className="shrink-0 border-b border-border/60 bg-muted/35 px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
          演示数据
        </p>
      ) : null}
      <ScrollPanel visible={active && !hidden}>
        {platform === "xueqiu" ? (
          <XueqiuTopicPanel reader={reader} active={active} />
        ) : platform === "x" ? (
          <XTopicPanel reader={reader} active={active} />
        ) : (
          <WeiboTopicPanel reader={reader} active={active} />
        )}
      </ScrollPanel>
    </div>
  );
}
