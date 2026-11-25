import { normalizeReplyHandle as defaultNormalizeReplyHandle } from "./reply-handle.js";

function normalizeMediaUrl(value) {
  let url = String(value || "").trim();
  if (url.startsWith("//")) url = `https:${url}`;
  else if (/^http:\/\//i.test(url)) url = `https://${url.slice(7)}`;
  if (!/^https:\/\//i.test(url) || /\.m3u8(?:$|\?)/i.test(url)) return "";
  return url;
}

function pickFxMediaUrl(value) {
  if (typeof value === "string") return normalizeMediaUrl(value);
  if (!value || typeof value !== "object") return "";
  for (const key of ["url", "media_url_https", "media_url", "src", "thumbnail_url", "thumbnail"]) {
    const url = normalizeMediaUrl(value[key]);
    if (url) return url;
  }
  return "";
}

export function collectFxMedia(raw) {
  const out = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url.slice(0, 500));
  };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (typeof node === "string") { push(pickFxMediaUrl(node)); return; }
    if (typeof node !== "object") return;
    push(pickFxMediaUrl(node));
    for (const key of ["photos", "videos", "all", "images"]) if (node[key]) walk(node[key]);
  };
  for (const key of ["media", "photos", "gallery", "mediaUrls"]) walk(raw?.[key]);
  return out.slice(0, 9);
}

function parseTwitterDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function postsFromFxTwitter(json, handle, normalizeReplyHandle = defaultNormalizeReplyHandle) {
  if (!json || !Array.isArray(json.results)) return null;
  const posts = [];
  for (const item of json.results) {
    if (!item || item.type !== "status") continue;
    const id = String(item.id || "");
    if (!id) continue;
    const text = String(item.text || item.full_text || "").trim();
    const created = Number(item.created_timestamp);
    const timestamp = Number.isFinite(created) && created > 0
      ? (created < 1e12 ? created * 1000 : created)
      : parseTwitterDate(item.created_at);
    const rawQuote = item.quote || item.quoted_status || item.quoted || null;
    let quoted = null;
    if (rawQuote && typeof rawQuote === "object") {
      const q = {
        authorName: String(rawQuote.author?.name || rawQuote.author?.screen_name || rawQuote.author_name || "").slice(0, 60),
        text: String(rawQuote.text || rawQuote.full_text || ""),
        url: String(rawQuote.url || ""),
        likeCount: 0,
      };
      const media = collectFxMedia(rawQuote);
      if (media.length) q.mediaUrls = media;
      if (q.authorName || q.text) quoted = q;
    }
    const mediaUrls = collectFxMedia(item);
    const replyToHandle = [item.replying_to, item.in_reply_to_screen_name, item.reply_to].map(normalizeReplyHandle).find(Boolean) || "";
    const post = {
      id, userId: "x:" + handle, platform: "x",
      authorName: String(item.author?.name || item.reposted_by?.name || handle),
      authorAvatar: String(item.author?.avatar_url || item.author?.profile_image_url_https || ""),
      title: text.slice(0, 90) || "无标题", summary: text, timestamp, timeText: "", source: "x",
      url: String(item.url || "https://x.com/" + encodeURIComponent(handle) + "/status/" + id),
      handle, isRetweet: !!item.reposted_by, likeCount: Number(item.likes) || 0,
      replyCount: Number(item.replies) || 0, retweetCount: Number(item.reposts) || 0, quoted, quoteMissing: false,
    };
    if (mediaUrls.length) post.mediaUrls = mediaUrls;
    if (replyToHandle) post.replyToHandle = replyToHandle;
    posts.push(post);
  }
  return posts;
}
