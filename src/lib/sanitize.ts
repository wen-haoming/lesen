import { parseFeedKey, type Platform } from "./config";
import { extractReplyHandleFromText, normalizeReplyHandle, sanitizeMediaUrls } from "./post-media";

export type Quote = {
  authorName: string;
  text: string;
  url: string;
  likeCount: number;
  mediaUrls?: string[];
};

export type Post = {
  id: string;
  userId: string;
  platform?: Platform | string;
  authorName: string;
  authorAvatar?: string;
  title: string;
  summary: string;
  timestamp: number;
  timeText: string;
  source: string;
  url: string;
  isRetweet: boolean;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoted: Quote | null;
  /** 接口标明有原帖但内容缺失（不编造） */
  quoteMissing?: boolean;
  mediaUrls?: string[];
  replyToHandle?: string;
  feedKey?: string;
  feedName?: string;
  feedPlatform?: string;
  handle?: string;
};

function safeAuthorAvatar(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

function safeCount(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function safeQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const text = String(obj.text || "");
  const authorName = String(obj.authorName || "").slice(0, 60);
  const mediaUrls = sanitizeMediaUrls(obj.mediaUrls ?? obj.pics ?? obj.images);
  if (!text && !authorName && !mediaUrls.length) return null;
  let url = "";
  try {
    if (obj.url) {
      const parsed = new URL(String(obj.url), "https://xueqiu.com");
      const host = parsed.hostname;
      const isXueqiu = host === "xueqiu.com" || host.endsWith(".xueqiu.com");
      const isX = /(^|\.)x\.com$/i.test(host) || /(^|\.)twitter\.com$/i.test(host);
      const isWeibo = /(^|\.)weibo\.com$/i.test(host) || host === "m.weibo.cn";
      if (isXueqiu || isX || isWeibo) url = parsed.href;
    }
  } catch {
    url = "";
  }
  return {
    authorName,
    text,
    url,
    likeCount: safeCount(obj.likeCount),
    ...(mediaUrls.length ? { mediaUrls } : {}),
  };
}

function replyHandleOf(obj: Record<string, unknown>, body: string): string {
  const fromField = [
    obj.replyToHandle,
    obj.reply_to_screenname,
    obj.reply_to_screen_name,
    obj.in_reply_to_screen_name,
  ]
    .map(normalizeReplyHandle)
    .find(Boolean);
  if (fromField) return fromField;
  return normalizeReplyHandle(extractReplyHandleFromText(body));
}

function sanitizeX(raw: unknown, expectedKey: string): Post | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id || "");
  if (!id) return null;
  const text = String(obj.summary || obj.text || obj.title || "").trim();
  // X API / proxy may return a URL pointing at a quoted or redirected post.
  // Build the opened URL from the current feed owner + this post's id instead.
  const sourceHandle = parseFeedKey(expectedKey).id.replace(/^@/, "");
  const handle = sourceHandle || normalizeReplyHandle(obj.handle);
  if (!handle) return null;
  const url = "https://x.com/" + encodeURIComponent(handle) + "/status/" + encodeURIComponent(id);
  const timestamp = Number(obj.timestamp);
  const quoted = safeQuote(obj.quoted);
  const isRetweet = !!obj.isRetweet;
  const quoteMissing = !!obj.quoteMissing;
  const mediaUrls = sanitizeMediaUrls(obj.mediaUrls ?? obj.pics ?? obj.images ?? obj.media);
  const replyToHandle = replyHandleOf(obj, text);
  return {
    id,
    userId: String(expectedKey || obj.userId || ""),
    platform: "x",
    authorName: String(obj.authorName || obj.name || "").slice(0, 80),
    authorAvatar: safeAuthorAvatar(obj.authorAvatar),
    title: String(obj.title || text.slice(0, 90) || "无标题"),
    summary: text.slice(0, 1600),
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    timeText: String(obj.timeText || ""),
    source: "x",
    url,
    isRetweet,
    likeCount: safeCount(obj.likeCount),
    replyCount: safeCount(obj.replyCount),
    retweetCount: safeCount(obj.retweetCount),
    quoted,
    quoteMissing,
    ...(mediaUrls.length ? { mediaUrls } : {}),
    ...(replyToHandle ? { replyToHandle } : {}),
  };
}

function sanitizeXueqiu(raw: unknown, expectedUid: string): Post | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id || "");
  const userId = String(obj.userId || obj.user_id || expectedUid || "");
  if (!/^\d+$/.test(id) || !/^\d+$/.test(userId) || (expectedUid && userId !== String(expectedUid)))
    return null;
  const source = String(obj.source || "");
  // The official Snowball status route is /{authorUid}/{statusId}; never trust
  // an API's profile/redirect URL for an external-link button.
  const url = new URL("/" + userId + "/" + id, "https://xueqiu.com");
  const timestamp = Number(obj.timestamp);
  const summary = String(obj.summary || "").slice(0, 1600);
  const quoted = safeQuote(obj.quoted);
  const isRetweet = !!obj.isRetweet;
  const quoteMissing = !!(obj.quoteMissing || (isRetweet && !quoted));
  const mediaUrls = sanitizeMediaUrls(obj.mediaUrls ?? obj.pics ?? obj.images);
  const replyToHandle = replyHandleOf(obj, summary);
  return {
    id,
    userId,
    authorName: String(obj.authorName || ""),
    authorAvatar: safeAuthorAvatar(obj.authorAvatar),
    title: String(obj.title || "无标题").slice(0, 90),
    summary,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    timeText: String(obj.timeText || ""),
    source,
    url: url.href,
    isRetweet,
    likeCount: safeCount(obj.likeCount),
    replyCount: safeCount(obj.replyCount),
    retweetCount: safeCount(obj.retweetCount),
    quoted,
    quoteMissing,
    ...(mediaUrls.length ? { mediaUrls } : {}),
    ...(replyToHandle ? { replyToHandle } : {}),
  };
}

function sanitizeWeibo(raw: unknown, expectedUid: string): Post | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id || obj.mid || obj.idstr || "");
  const userId = String(obj.userId || obj.user_id || expectedUid || "");
  if (!id || !/^\d+$/.test(userId) || (expectedUid && userId !== String(expectedUid))) return null;
  const mid = String(obj.mid || obj.id || id);
  // 微博正文页：/{uid}/{mid}；不信任接口带回的跳转 URL。
  const url = new URL("/" + userId + "/" + encodeURIComponent(mid), "https://weibo.com");
  const timestamp = Number(obj.timestamp);
  const summary = String(obj.summary || obj.text_raw || obj.text || "").slice(0, 1600);
  const quoted = safeQuote(obj.quoted);
  const isRetweet = !!obj.isRetweet;
  const quoteMissing = !!(obj.quoteMissing || (isRetweet && !quoted));
  const mediaUrls = sanitizeMediaUrls(obj.mediaUrls ?? obj.pics ?? obj.images);
  const replyToHandle = replyHandleOf(obj, summary);
  return {
    id,
    userId,
    platform: "weibo",
    authorName: String(obj.authorName || obj.name || "").slice(0, 80),
    authorAvatar: safeAuthorAvatar(obj.authorAvatar),
    title: String(obj.title || summary.slice(0, 90) || "无标题").slice(0, 90),
    summary,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    timeText: String(obj.timeText || ""),
    source: "weibo",
    url: url.href,
    isRetweet,
    likeCount: safeCount(obj.likeCount),
    replyCount: safeCount(obj.replyCount),
    retweetCount: safeCount(obj.retweetCount),
    quoted,
    quoteMissing,
    ...(mediaUrls.length ? { mediaUrls } : {}),
    ...(replyToHandle ? { replyToHandle } : {}),
  };
}

export function sanitizeFeedPost(raw: unknown, feedKeyValue: string): Post | null {
  const meta = parseFeedKey(feedKeyValue);
  if (meta.platform === "x") return sanitizeX(raw, feedKeyValue);
  if (meta.platform === "weibo") return sanitizeWeibo(raw, meta.id);
  if (meta.platform === "xueqiu") return sanitizeXueqiu(raw, meta.id);
  return null;
}

export function primaryPostText(post: Post): string {
  const summary = String(post.summary || "").trim();
  const title = String(post.title || "").trim();
  if (title && summary && (summary.startsWith(title) || title.startsWith(summary.slice(0, 40))))
    return summary;
  return summary.length >= title.length ? summary || title : title || summary;
}
