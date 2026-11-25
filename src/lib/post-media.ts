/** 媒体 URL / 回复句柄解析（无业务类型依赖，供 sanitize 与 post-card 共用） */
import { normalizeReplyHandle } from "./reply-handle.js";

export { normalizeReplyHandle };

export function parseReplyHandle(text: string): { handle: string; rest: string } | null {
  const raw = String(text || "");
  const m = raw.match(/^\s*回复\s*@([^\s:：]+)\s*[:：]?\s*/i);
  if (m) return { handle: m[1], rest: raw.slice(m[0].length) };
  return null;
}

export function extractReplyHandleFromText(text: string): string {
  return parseReplyHandle(text)?.handle || "";
}

/** 判断是否为可直接用 <video> 播放的媒体 URL（X 视频 / GIF mp4 等） */
export function isVideoUrl(url: string): boolean {
  const value = String(url || "").trim();
  if (!value) return false;
  if (/\.(mp4|webm|mov)(?:$|\?)/i.test(value)) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "video.twimg.com" || host.endsWith(".video.twimg.com");
  } catch {
    return false;
  }
}

/** 仅保留 http(s) 图片/视频 URL 并去重；无字段则空数组（诚实降级） */
export function sanitizeMediaUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let url = "";
    if (typeof item === "string") url = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      url = String(o.url || o.src || o.pic || o.large || o.original || "").trim();
    }
    if (!url) continue;
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
    if (!/^https:\/\//i.test(url)) continue;
    try {
      if (!new URL(url).hostname) continue;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url.slice(0, 500));
  }
  return out;
}
