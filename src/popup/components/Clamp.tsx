import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 多行折叠：超过 lines 行才出现「展开 / 收起」。
 * 用 ResizeObserver 测量，兼容 content-visibility:auto 下的延迟布局与字号切换。
 */
export function Clamp({
  lines,
  children,
  className,
  resetKey,
  density,
}: {
  lines: number;
  children: ReactNode;
  className?: string;
  resetKey?: string;
  /** 透传给 .text-pretty-body[data-density] */
  density?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflow(el.scrollHeight - el.clientHeight > 2);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, lines, resetKey]);

  return (
    <>
      <div
        ref={ref}
        data-density={density}
        className={cn(!expanded && "clamp-lines", className)}
        style={expanded ? undefined : { WebkitLineClamp: lines }}
      >
        {children}
      </div>
      {overflow ? (
        <button
          type="button"
          className="mt-0.5 text-[11px] font-medium tracking-[0.02em] text-primary hover:text-primary/80"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </>
  );
}
