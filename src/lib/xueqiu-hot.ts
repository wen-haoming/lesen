import { sanitizeFeedPost, type Post } from "./sanitize";

export type XueqiuHotItem = {
  rank: number;
  word: string;
  heat: number;
  heatLabel?: string;
  label: string;
  url: string;
  statusCount: number;
  summary: string;
  stocks: string[];
};

export type XueqiuHotResponse = {
  ok: boolean;
  items: XueqiuHotItem[];
  updatedAt: number;
  error?: string;
  retryAfterMs?: number;
  stale?: boolean;
  cached?: boolean;
  needsLogin?: boolean;
};

export type XueqiuTopicResponse = {
  ok: boolean;
  posts: Post[];
  updatedAt: number;
  page: number;
  hasMore: boolean;
  error?: string;
  retryAfterMs?: number;
  stale?: boolean;
  cached?: boolean;
  needsLogin?: boolean;
};

export type XueqiuTopicParams = { word: string; page?: number; force?: boolean };

type Obj = Record<string, unknown>;
type Cache = {
  items?: unknown[];
  posts?: unknown[];
  updatedAt?: number;
  attemptedAt?: number;
  retryAt?: number;
  failure?: boolean;
  needsLogin?: boolean;
  platformPause?: boolean;
  hasMore?: boolean;
  error?: string;
};

type Dependencies = {
  request: (url: string, opts?: { force?: boolean; page?: number; word?: string }) => Promise<unknown>;
  readCache: (key: string) => Promise<Cache | undefined>;
  writeCache: (key: string, value: Cache) => Promise<void>;
  now?: () => number;
};

const HOT_CACHE_KEY = "xueqiuHotCache";
// 热搜榜变化比话题帖子更快；保留短缓存避免每次组件重挂载都打接口。
// 手动刷新绕过缓存，且仅受 10 秒防连点间隔限制。
const HOT_CACHE_MS = 60 * 1000;
const TOPIC_CACHE_MS = 2 * 60 * 1000;
const MIN_GAP_MS = 10 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const object = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function apiFailure(value: unknown): never | void {
  const root = object(value);
  const code = String(root.error_code ?? root.code ?? "");
  const message = String(
    root.error_description ?? root.error_msg ?? root.message ?? root.msg ?? "",
  );
  if (code === "400016" || /请先登录|需要登录|未登录|login required/i.test(message))
    throw Object.assign(new Error("请先登录雪球后重试"), { needsLogin: true });
  if (
    code === "300011" ||
    /RATE_LIMIT|too many requests|请求过于频繁|验证码|访问验证|安全验证|风控/i.test(message)
  )
    throw Object.assign(new Error("平台暂时限制了请求，请稍后再试"), { platformPause: true });
  if (
    root.success === false ||
    (root.code != null && code !== "200") ||
    (root.error_code != null && !["0", "200"].includes(String(root.error_code)))
  )
    throw new Error("雪球接口返回失败");
}

function heatValue(row: Obj): number {
  const direct = numberValue(row.heat);
  if (direct != null) return direct;
  const reason = String(row.reason ?? "");
  const match = reason.match(/([0-9]+(?:\.[0-9]+)?)(?:\s*(万|亿))?/);
  if (!match) return 0;
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  return Number(match[1]) * multiplier;
}

function statusCount(value: unknown): number {
  const count = numberValue(value);
  return count != null && Number.isSafeInteger(count) ? count : 0;
}

function safeWord(value: unknown): string {
  if (typeof value !== "string") return "";
  const word = value.trim();
  return word.length > 0 && word.length <= 200 && !/[<>]|\p{Cc}/u.test(word) ? word : "";
}

export function xueqiuHotUrl(): string {
  // rich_tag 是雪球客户端当前使用的实时热门话题榜；网页 tag 接口会返回较旧快照。
  return "https://api.xueqiu.com/query/v1/hot_event/rich_tag.json?size=10";
}

export function xueqiuTopicUrl(word: string, page: number): string {
  // sort=time 拉取实时最新帖子；sort=hot 会返回几天前的历史高赞旧帖导致刷新后内容不变。
  return (
    "https://www.xueqiu.com/query/v1/hot_event/search.json?count=10&sort=time&page=" +
    page +
    "&q=" +
    encodeURIComponent(word)
  );
}

export function validXueqiuTopicParams(value: unknown): value is XueqiuTopicParams {
  const input = object(value);
  return (
    !!safeWord(input.word) &&
    input.word === safeWord(input.word) &&
    (input.page === undefined ||
      (typeof input.page === "number" &&
        Number.isSafeInteger(input.page) &&
        input.page >= 1 &&
        input.page <= 1000)) &&
    (input.force === undefined || typeof input.force === "boolean")
  );
}

export function parseXueqiuHotData(value: unknown): XueqiuHotItem[] {
  const root = object(value);
  if (Number(root.code) !== 200 || root.success !== true || !Array.isArray(root.data)) {
    apiFailure(value);
    throw new Error("雪球热搜返回格式异常");
  }
  const seen = new Set<string>();
  const items: XueqiuHotItem[] = [];
  for (const [index, value] of root.data.slice(0, 100).entries()) {
    const row = object(value);
    const id = String(row.id ?? "").trim();
    const word = safeWord(row.show_title ?? row.title);
    if (!id || id.length > 200 || /\p{Cc}/u.test(id) || !word) continue;
    const identity = word.normalize("NFKC").toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    const reason = cleanText(row.reason, 100);
    const stocks = Array.isArray(row.stocks)
      ? row.stocks.slice(0, 30).flatMap((stock) => {
          const item = object(stock);
          const name = cleanText(item.name, 80);
          const code = cleanText(item.code, 30);
          const value = name || code;
          return value ? [value] : [];
        })
      : [];
    items.push({
      rank: index + 1,
      word,
      heat: heatValue(row),
      label: reason,
      heatLabel: reason.match(/热度值\s*([0-9]+(?:\.[0-9]+)?\s*(?:万|亿)?)/)?.[1] || "",
      url: "https://www.xueqiu.com/hashtag/" + encodeURIComponent(id),
      statusCount: statusCount(row.statusCount),
      summary: cleanText(row.content, 500),
      stocks: [...new Set(stocks)],
    });
  }
  if (root.data.length && !items.length) throw new Error("雪球热搜未返回有效话题");
  return items;
}

function timestampValue(value: unknown): number {
  const raw =
    typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value) ? Date.parse(value) : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
}

function safeAvatar(value: unknown, domain?: unknown): string {
  let raw = typeof value === "string" ? value.trim().split(",")[0].trim() : "";
  if (!raw) return "";
  if (raw.startsWith("//")) raw = "https:" + raw;
  if (/^http:\/\//i.test(raw)) raw = "https://" + raw.slice(7);
  if (!/^https:\/\//i.test(raw)) {
    const host = typeof domain === "string" ? domain.trim().replace(/^http:\/\//i, "https://") : "";
    try {
      const base = new URL(host);
      if (!/(^|\.)(?:imedao\.com|xueqiu\.com)$/i.test(base.hostname)) return "";
      raw = new URL(raw.replace(/^\/+/, ""), base.origin + "/").href;
    } catch {
      return "";
    }
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      /(^|\.)(?:imedao\.com|xueqiu\.com)$/i.test(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href.slice(0, 500)
      : "";
  } catch {
    return "";
  }
}

export function normalizeXueqiuTopicPost(value: unknown): Post | null {
  const raw = object(value);
  const user = object(raw.user ?? raw.author);
  const profile = object(user.user);
  const id = String(raw.id ?? raw.status_id ?? "").trim();
  const uid = String(raw.user_id ?? raw.userId ?? user.id ?? "").trim();
  if (!/^\d+$/.test(id) || !/^\d+$/.test(uid)) return null;
  const summary = cleanText(raw.description ?? raw.text ?? raw.content, 1600);
  const pics = raw.pic == null ? [] : Array.isArray(raw.pic) ? raw.pic : [raw.pic];
  const normalized = {
    id,
    userId: uid,
    authorName: cleanText(user.screen_name ?? user.name, 80),
    authorAvatar: safeAvatar(
      raw.authorAvatar ?? user.profile_image_url ?? user.avatar,
      user.photo_domain ?? profile.photo_domain,
    ),
    title: cleanText(raw.title, 90) || summary.slice(0, 90) || "无标题",
    summary,
    timestamp: timestampValue(raw.created_at),
    timeText: "",
    source: cleanText(raw.source, 30),
    isRetweet: false,
    likeCount: numberValue(raw.like_count ?? raw.likeCount) ?? 0,
    replyCount: numberValue(raw.reply_count ?? raw.replyCount) ?? 0,
    retweetCount: numberValue(raw.retweet_count ?? raw.retweetCount) ?? 0,
    quoted: null,
    mediaUrls: pics,
  };
  return sanitizeFeedPost(normalized, "xueqiu:" + uid);
}

export function parseXueqiuTopicData(
  value: unknown,
  requestedPage: number,
): { posts: Post[]; hasMore: boolean } {
  const root = object(value);
  if (!Array.isArray(root.list)) {
    apiFailure(value);
    throw new Error("雪球话题返回格式异常");
  }
  const seen = new Set<string>();
  const posts = root.list.slice(0, 100).flatMap((raw) => {
    const post = normalizeXueqiuTopicPost(raw);
    if (!post || seen.has(post.id)) return [];
    seen.add(post.id);
    return [post];
  });
  if (root.list.length && !posts.length) throw new Error("雪球话题未返回有效帖子");
  if (requestedPage === 1 && posts.length > 1) {
    posts.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  }
  const maxPage = Number(root.maxPage);
  const hasMore =
    Number.isSafeInteger(maxPage) && maxPage >= requestedPage && maxPage > requestedPage;
  return { posts, hasMore };
}

function cachedHotItems(value: unknown): XueqiuHotItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 100).flatMap((raw) => {
    const item = object(raw);
    const word = safeWord(item.word);
    let url: URL;
    try {
      url = new URL(String(item.url || ""));
    } catch {
      return [];
    }
    if (
      !word ||
      seen.has(word) ||
      url.protocol !== "https:" ||
      url.hostname !== "www.xueqiu.com" ||
      !/^\/hashtag\/[^/]+$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return [];
    const rank = numberValue(item.rank);
    const heat = numberValue(item.heat);
    if (rank == null || !Number.isSafeInteger(rank) || heat == null) return [];
    seen.add(word);
    return [
      {
        rank,
        word,
        heat,
        heatLabel: cleanText(item.heatLabel, 40),
        label: cleanText(item.label, 100),
        url: url.href,
        statusCount: statusCount(item.statusCount),
        summary: cleanText(item.summary, 500),
        stocks: Array.isArray(item.stocks)
          ? item.stocks
              .slice(0, 30)
              .filter((stock): stock is string => typeof stock === "string")
              .map((stock) => cleanText(stock, 80))
              .filter(Boolean)
          : [],
      },
    ];
  });
}

function cachedPosts(value: unknown): Post[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).slice(0, 100).flatMap((raw) => {
    const item = object(raw);
    const uid = String(item.userId ?? "");
    if (!/^\d+$/.test(uid)) return [];
    const post = sanitizeFeedPost(item, "xueqiu:" + uid);
    if (!post || seen.has(post.id)) return [];
    seen.add(post.id);
    return [post];
  });
}

function retryMessage(cache: Cache, fallback: string): string {
  if (cache.needsLogin) return "请先登录雪球后重试";
  if (cache.platformPause) return "平台暂时限制了请求，请稍后再试";
  return fallback;
}

export function createXueqiuHotService(deps: Dependencies) {
  const now = deps.now || Date.now;
  const inFlight = new Map<string, Promise<XueqiuHotResponse | XueqiuTopicResponse>>();
  let hotSnapshot: Cache | undefined;
  let hotPending: Promise<XueqiuHotResponse> | undefined;

  const readCache = async (key: string): Promise<Cache> => {
    try {
      return (await deps.readCache(key)) || {};
    } catch {
      return {};
    }
  };
  const writeCache = async (key: string, cache: Cache) => {
    try {
      await deps.writeCache(key, cache);
    } catch {
      /* 存储异常不覆盖网络结果。 */
    }
  };

  const hot = (force = false): Promise<XueqiuHotResponse> => {
    if (hotPending) return hotPending;
    hotPending = (async () => {
      const stored = hotSnapshot || (await readCache(HOT_CACHE_KEY));
      const items = cachedHotItems(stored.items);
      const time = now();
      const updatedAt =
        Number(stored.updatedAt) > 0 && Number(stored.updatedAt) <= time
          ? Number(stored.updatedAt)
          : 0;
      const previousItems = updatedAt ? items : [];
      const retryAt = Math.max(
        Number(stored.retryAt) || 0,
        (Number(stored.attemptedAt) || 0) + MIN_GAP_MS,
      );
      if (stored.failure && retryAt > time)
        return {
          ok: false,
          items: previousItems,
          updatedAt,
          stale: !!updatedAt,
          cached: !!updatedAt,
          error: retryMessage(stored, "雪球热搜暂不可用，请稍后重试"),
          needsLogin: stored.needsLogin === true,
          retryAfterMs: retryAt - time,
        };
      if (updatedAt && ((!force && time - updatedAt < HOT_CACHE_MS) || retryAt > time))
        return {
          ok: true,
          items: previousItems,
          updatedAt,
          cached: true,
          ...(retryAt > time ? { retryAfterMs: retryAt - time } : {}),
        };
      if (retryAt > time)
        return {
          ok: false,
          items: [],
          updatedAt: 0,
          error: "请求过于频繁，请稍后再试",
          retryAfterMs: retryAt - time,
        };
      const attemptedAt = time;
      try {
        const result = force
          ? await deps.request(xueqiuHotUrl(), { force: true })
          : await deps.request(xueqiuHotUrl());
        apiFailure(result);
        const nextItems = parseXueqiuHotData(result);
        const next = { items: nextItems, updatedAt: now(), attemptedAt };
        hotSnapshot = next;
        await writeCache(HOT_CACHE_KEY, next);
        return { ok: true, items: nextItems, updatedAt: next.updatedAt };
      } catch (error) {
        const failure = error as {
          needsLogin?: boolean;
          platformPause?: boolean;
          retryAfterMs?: number;
        };
        const retryAfterMs = Math.max(FAILURE_COOLDOWN_MS, Number(failure.retryAfterMs) || 0);
        const next = {
          items: previousItems,
          updatedAt,
          attemptedAt,
          failure: true,
          needsLogin: failure.needsLogin === true,
          platformPause: failure.platformPause === true,
          retryAt: now() + retryAfterMs,
        };
        hotSnapshot = next;
        await writeCache(HOT_CACHE_KEY, next);
        return {
          ok: false,
          items: previousItems,
          updatedAt,
          stale: !!updatedAt,
          cached: !!updatedAt,
          error: failure.needsLogin
            ? "请先登录雪球后重试"
            : failure.platformPause
              ? "平台暂时限制了请求，请稍后再试"
              : "雪球热搜暂不可用，请稍后重试",
          needsLogin: failure.needsLogin === true,
          retryAfterMs,
        };
      }
    })().finally(() => {
      hotPending = undefined;
    });
    return hotPending;
  };

  const topic = (input: unknown): Promise<XueqiuTopicResponse> => {
    if (!validXueqiuTopicParams(input))
      return Promise.resolve({
        ok: false,
        posts: [],
        updatedAt: 0,
        page: 1,
        hasMore: false,
        error: "无效的雪球话题请求参数",
      });
    const { word, force } = input;
    const page = input.page ?? 1;
    const key = "xueqiuTopicCache:" + encodeURIComponent(word) + ":" + page;
    if (inFlight.has(key)) return inFlight.get(key) as Promise<XueqiuTopicResponse>;
    const task = (async (): Promise<XueqiuTopicResponse> => {
      const empty = { posts: [], updatedAt: 0, page, hasMore: false };
      const snapshot = hotSnapshot || (await readCache(HOT_CACHE_KEY));
      const allowed = cachedHotItems(snapshot.items).some((item) => item.word === word);
      if (!allowed) return { ok: false, ...empty, error: "话题不在当前雪球热搜榜单中" };
      const cached = await readCache(key);
      const time = now();
      const updatedAt =
        Number(cached.updatedAt) > 0 && Number(cached.updatedAt) <= time
          ? Number(cached.updatedAt)
          : 0;
      const posts = updatedAt ? cachedPosts(cached.posts) : [];
      const hasMore = Boolean(updatedAt && cached.hasMore === true);
      const base: { posts: Post[]; updatedAt: number; page: number; hasMore: boolean } = {
        posts,
        updatedAt,
        page,
        hasMore,
      };
      const retryAt = Math.max(
        Number(cached.retryAt) || 0,
        (Number(cached.attemptedAt) || 0) + MIN_GAP_MS,
      );
      if (cached.failure && retryAt > time)
        return {
          ok: false,
          ...base,
          stale: !!updatedAt,
          cached: !!updatedAt,
          error: retryMessage(cached, "雪球话题暂不可用，请稍后重试"),
          needsLogin: cached.needsLogin === true,
          retryAfterMs: retryAt - time,
        };
      if (updatedAt && ((!force && time - updatedAt < TOPIC_CACHE_MS) || retryAt > time))
        return {
          ok: true,
          ...base,
          cached: true,
          ...(retryAt > time ? { retryAfterMs: retryAt - time } : {}),
        };
      if (retryAt > time)
        return {
          ok: false,
          ...empty,
          error: "请求过于频繁，请稍后再试",
          retryAfterMs: retryAt - time,
        };
      const attemptedAt = time;
      try {
        const result = force
          ? await deps.request(xueqiuTopicUrl(word, page), { force: true, page, word })
          : await deps.request(xueqiuTopicUrl(word, page));
        apiFailure(result);
        const parsed = parseXueqiuTopicData(result, page);
        const next = { ...parsed, updatedAt: now(), attemptedAt };
        await writeCache(key, next);
        return {
          ok: true,
          posts: parsed.posts,
          updatedAt: next.updatedAt,
          page,
          hasMore: parsed.hasMore,
        };
      } catch (error) {
        const failure = error as {
          needsLogin?: boolean;
          platformPause?: boolean;
          retryAfterMs?: number;
        };
        const retryAfterMs = Math.max(FAILURE_COOLDOWN_MS, Number(failure.retryAfterMs) || 0);
        await writeCache(key, {
          ...base,
          attemptedAt,
          failure: true,
          needsLogin: failure.needsLogin === true,
          platformPause: failure.platformPause === true,
          retryAt: now() + retryAfterMs,
        });
        return {
          ok: false,
          ...base,
          stale: !!updatedAt,
          error: failure.needsLogin
            ? "请先登录雪球后重试"
            : failure.platformPause
              ? "平台暂时限制了请求，请稍后再试"
              : "雪球话题暂不可用，请稍后重试",
          needsLogin: failure.needsLogin === true,
          retryAfterMs,
        };
      }
    })()
      .catch((): XueqiuTopicResponse => ({
        ok: false,
        posts: [],
        updatedAt: 0,
        page,
        hasMore: false,
        error: "雪球话题暂不可用，请稍后重试",
      }))
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, task);
    return task;
  };

  return { hot, topic };
}
