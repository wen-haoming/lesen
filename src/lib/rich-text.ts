/**
 * 正文富文本解析（纯函数，供 TranslatableText / post-card / 单测）：
 * - 雪球转发链 `我的话 //@某人: 他的话 //@另一人: …` 拆成对话层级
 * - 表情 token `[:img:URL:]` / `[:name:赞:]` 渲染为行内图
 * - `@某人`、`$贵州茅台(SH600519)$` 识别为弱链接样式
 */

export type ChainEntry = {
  /** 转发链中发言人 */
  name: string;
  /** 该发言人回复的对象（来自「回复 @x：」前缀）；与订阅作者相同时置空 */
  replyTo: string;
  text: string;
};

// `//@名字:`；前面不能是 `:` 或字母数字，避免误伤 https:// 与表情 token
const CHAIN_RE = /(?<![:A-Za-z0-9])\/\/\s*@([^\s:：]{1,40})\s*[:：]\s*/g;
const REPLY_PREFIX_RE = /^\s*回复\s*@([^\s:：]{1,40})\s*[:：]\s*/;

export function splitForwardChain(
  text: string,
  selfNames: string[] = [],
): { own: string; chain: ChainEntry[] } {
  const raw = String(text || "");
  const matches = Array.from(raw.matchAll(CHAIN_RE));
  if (!matches.length) return { own: raw, chain: [] };

  const self = new Set(selfNames.map((n) => String(n || "").trim()).filter(Boolean));
  const own = raw.slice(0, matches[0].index).trim();
  const chain: ChainEntry[] = [];
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
    let body = raw.slice(start, end).trim();
    let replyTo = "";
    const reply = body.match(REPLY_PREFIX_RE);
    if (reply) {
      replyTo = reply[1];
      body = body.slice(reply[0].length).trim();
    }
    if (!body) return;
    chain.push({ name: m[1], replyTo: self.has(replyTo) ? "" : replyTo, text: body });
  });
  return { own, chain };
}

export type RichSegment =
  | { type: "text"; value: string }
  | { type: "face"; url: string; name: string }
  | { type: "mention"; value: string }
  | { type: "stock"; value: string }
  | { type: "url"; url: string; label: string }
  | { type: "hashtag"; value: string };

// 与 xq-emoji-shared.js 保持一致的常用表情映射（Twemoji）
const TW_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/";
const NAME_TO_CP: Record<string, string> = {
  赞: "1f44d",
  很赞: "1f44d",
  微笑: "1f642",
  呵呵: "1f604",
  汗: "1f605",
  哭: "1f622",
  生气: "1f620",
  怒: "1f620",
  偷笑: "1f60f",
  鄙视: "1f612",
  鼓掌: "1f44f",
  得意: "1f60e",
  问号: "2753",
  鬼脸: "1f61c",
  献花: "1f49a",
  拜神: "1f64f",
};

function faceUrl(raw: string): string {
  let url = String(raw || "").trim();
  if (url.startsWith("//")) url = "https:" + url;
  if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
  return /^https:\/\//i.test(url) ? url : "";
}

function shortenUrlLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const tail = (parsed.pathname === "/" ? "" : parsed.pathname) + parsed.search;
    if (!tail) return host;
    const decoded = decodeURIComponent(tail);
    return decoded.length > 26 ? host + decoded.slice(0, 24) + "…" : host + decoded;
  } catch {
    return rawUrl.length > 36 ? rawUrl.slice(0, 34) + "…" : rawUrl;
  }
}

const TRAILING_URL_PUNCT_RE = /[.,;:!?，。；：！？、）》」』\]}]+$/;

const TOKEN_RE =
  /\[:img:([^\]]+?):\]|\[:name:([^\]]+?):\]|\$([^$\s][^$\n]{0,30}?\([A-Za-z0-9.]{1,12}\))\$|(?<![A-Za-z0-9_.])@([\p{Script=Han}A-Za-z0-9_-]{1,30})|(https?:\/\/[^\s<>"'，。；：！？、（）【】《》「」『』\p{Script=Han}]+)|(#[^#\s\n][^#\n]{0,38}#)/gu;

export function tokenizeRich(text: string): RichSegment[] {
  const value = String(text || "");
  const out: RichSegment[] = [];
  let last = 0;
  const push = (seg: RichSegment) => {
    const prev = out[out.length - 1];
    if (seg.type === "text" && prev?.type === "text") prev.value += seg.value;
    else out.push(seg);
  };
  for (const m of value.matchAll(TOKEN_RE)) {
    const index = m.index ?? 0;
    if (index > last) push({ type: "text", value: value.slice(last, index) });
    if (m[1] !== undefined) {
      const url = faceUrl(m[1]);
      if (url) push({ type: "face", url, name: "" });
    } else if (m[2] !== undefined) {
      const name = m[2].trim();
      const cp = NAME_TO_CP[name];
      if (cp) push({ type: "face", url: TW_BASE + cp + ".png", name });
      else push({ type: "text", value: "[" + name + "]" });
    } else if (m[3] !== undefined) {
      push({ type: "stock", value: m[3].trim() });
    } else if (m[4] !== undefined) {
      push({ type: "mention", value: "@" + m[4] });
    } else if (m[5] !== undefined) {
      const rawUrl = m[5];
      const punct = rawUrl.match(TRAILING_URL_PUNCT_RE)?.[0] || "";
      const cleanUrl = punct ? rawUrl.slice(0, -punct.length) : rawUrl;
      if (/^https?:\/\/[^/]+\.[^/]+/i.test(cleanUrl)) {
        push({ type: "url", url: cleanUrl, label: shortenUrlLabel(cleanUrl) });
        if (punct) push({ type: "text", value: punct });
      } else {
        push({ type: "text", value: rawUrl });
      }
    } else if (m[6] !== undefined) {
      push({ type: "hashtag", value: m[6] });
    }
    last = index + m[0].length;
  }
  if (last < value.length) push({ type: "text", value: value.slice(last) });
  return out;
}

/** 「原帖已被作者删除」这类占位文本，按不可用引文弱化展示 */
export function looksDeletedPlaceholder(text: string): boolean {
  const t = String(text || "").trim();
  return t.length > 0 && t.length <= 24 && /(已被.{0,6}删除|已删除|不存在|无法查看)/.test(t);
}
