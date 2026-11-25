import { useEffect, useMemo, useState } from "react";
import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { normalizeAvatarCandidates } from "@/lib/avatar-url";
import { platformShort } from "@/lib/format";
import { cn } from "@/lib/utils";

function fallbackLetter(name: string, platform: string) {
  const text = String(name || "").trim();
  if (text) {
    const ch = Array.from(text)[0] || "";
    return platform === "xueqiu" ? ch : ch.toUpperCase();
  }
  if (platform === "x") return "X";
  if (platform === "weibo") return "微";
  return "雪";
}

/** 业务头像：多候选 URL 回退，底层用 shadcn Avatar */
export function Avatar({
  name,
  avatar,
  platform = "xueqiu",
  className,
}: {
  name?: string;
  avatar?: string;
  platform?: string;
  className?: string;
}) {
  const letter = fallbackLetter(name || "", platform);
  const urls = useMemo(() => normalizeAvatarCandidates(avatar || "", platform), [avatar, platform]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(!urls.length);

  useEffect(() => {
    setIndex(0);
    setFailed(!urls.length);
  }, [urls]);

  const src = !failed && urls.length ? urls[Math.min(index, urls.length - 1)] : "";


  return (
    <AvatarRoot
      className={cn(
        "avatar-node size-full rounded-full bg-surface-subtle ring-1 ring-foreground/12",
        failed ? "is-fallback" : src ? "is-loaded" : "",
        className,
      )}
      title={(name || "") + " · " + platformShort(platform)}
      data-platform={platform}
      aria-hidden="true"
    >
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          referrerPolicy={platform === "weibo" ? "origin" : "no-referrer"}
          className="object-cover"
          onError={() => {
            setIndex((prev) => {
              const next = prev + 1;
              if (next >= urls.length) {
                setFailed(true);
                return prev;
              }
              return next;
            });
          }}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "text-[12.5px] font-bold tracking-tight",
          platform === "x"
            ? "bg-secondary text-secondary-foreground"
            : "bg-foreground/[0.08] text-foreground/85",
        )}
      >
        {letter}
      </AvatarFallback>
    </AvatarRoot>
  );
}
