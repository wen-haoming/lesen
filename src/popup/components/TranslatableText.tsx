import { useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DisplayDensity } from "@/hooks/useReader";
import { getCached, looksEnglish, translateText } from "@/lib/x-translate";
import { cn } from "@/lib/utils";
import { tokenizeRich } from "@/lib/rich-text";
import { Clamp } from "./Clamp";

function highlightText(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  let key = 0;
  while (index !== -1) {
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(
      <mark key={key++} className="rounded-[2px] bg-foreground/[0.08] text-foreground">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function Face({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-muted-foreground">{name ? "[" + name + "]" : "[表情]"}</span>;
  return (
    <img
      className="rt-face"
      src={url}
      alt={name ? "[" + name + "]" : "[表情]"}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** 正文富文本：表情 token → 行内图，@提及 / $股票$ → 弱链接色，URL → 可点击短链，#话题# → 弱化，其余保留搜索高亮 */
export function RichText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {tokenizeRich(text).map((seg, i) => {
        if (seg.type === "face") return <Face key={i} url={seg.url} name={seg.name} />;
        if (seg.type === "mention" || seg.type === "stock")
          return (
            <span key={i} className="rt-link">
              {highlightText(seg.value, query)}
            </span>
          );
        if (seg.type === "url")
          return (
            <a key={i} href={seg.url} target="_blank" rel="noopener noreferrer" className="rt-url">
              {seg.label}
            </a>
          );
        if (seg.type === "hashtag")
          return (
            <span key={i} className="rt-tag">
              {highlightText(seg.value, query)}
            </span>
          );
        return <span key={i}>{highlightText(seg.value, query)}</span>;
      })}
    </>
  );
}

/**
 * 外文正文：默认机翻为中文，并提供「显示原文 / 显示译文」切换（样式对齐 X）。
 */
export function TranslatableText({
  text,
  query,
  density = "comfortable",
  enabled = true,
  className,
  clampLines,
}: {
  text: string;
  query: string;
  density?: DisplayDensity;
  enabled?: boolean;
  className?: string;
  /** 超过该行数折叠，提供「展开」 */
  clampLines?: number;
}) {
  const original = String(text || "");
  const eligible = enabled && looksEnglish(original);
  const [translated, setTranslated] = useState(() =>
    eligible ? getCached(original) : "",
  );
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (!eligible) {
      setTranslated("");
      setLoading(false);
      setShowOriginal(false);
      return;
    }
    const cached = getCached(original);
    if (cached) {
      setTranslated(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void translateText(original).then((zh) => {
      if (cancelled) return;
      setTranslated(zh || "");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [eligible, original]);

  if (!original) return null;

  const hasTranslation = !!translated;
  const display = hasTranslation && !showOriginal ? translated : original;
  const showMeta = eligible && (loading || hasTranslation);

  return (
    <div className={cn("min-w-0", density === "compact" ? "mt-1" : density === "spacious" ? "mt-2.5" : "mt-1.5")}>
      {showMeta ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] tracking-[0.02em] text-muted-foreground/80">
          <span className="inline-flex items-center gap-1">
            <Languages className="size-[11px] shrink-0 opacity-70" aria-hidden />
            {loading && !hasTranslation ? "正在翻译…" : "翻译自 英语"}
          </span>
          {hasTranslation ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-[10.5px] font-medium text-primary hover:bg-transparent hover:text-primary/85"
              onClick={(event) => {
                event.stopPropagation();
                setShowOriginal((v) => !v);
              }}
            >
              {showOriginal ? "显示译文" : "显示原文"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {clampLines ? (
        <Clamp
          lines={clampLines}
          resetKey={display}
          density={density}
          className={cn("text-pretty-body break-words whitespace-pre-wrap select-text", className)}
        >
          <RichText text={display} query={query} />
        </Clamp>
      ) : (
        <div
          data-density={density}
          className={cn("text-pretty-body break-words whitespace-pre-wrap select-text", className)}
        >
          <RichText text={display} query={query} />
        </div>
      )}
    </div>
  );
}
