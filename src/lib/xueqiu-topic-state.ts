import { sanitizeFeedPost, type Post } from "./sanitize";

export type XueqiuHotItem = {
  rank: number;
  word: string;
  heat?: number | string;
  heatLabel?: string;
  label: string;
  url: string;
  statusCount?: number | string;
  summary?: string;
  stocks?: string[];
};
type XueqiuResultStatus = {
  ok?: boolean;
  updatedAt?: number;
  error?: string;
  needsLogin?: boolean;
  retryAfterMs?: number;
  stale?: boolean;
  cached?: boolean;
};
export type XueqiuHotResult = XueqiuResultStatus & { items?: XueqiuHotItem[] };
export type XueqiuTopicResult = XueqiuResultStatus & {
  posts?: unknown[];
  page?: number;
  hasMore?: boolean;
};
type XueqiuResourceStatus = {
  updatedAt: number;
  attempted: boolean;
  loading: boolean;
  error: string;
  needsLogin: boolean;
  retryAt: number;
  stale: boolean;
  cached: boolean;
};
export type XueqiuHotResource = XueqiuResourceStatus & { items: XueqiuHotItem[] };
export type XueqiuTopicResource = XueqiuResourceStatus & {
  posts: Post[];
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
};

const emptyStatus = (): XueqiuResourceStatus => ({
  updatedAt: 0,
  attempted: false,
  loading: false,
  error: "",
  needsLogin: false,
  retryAt: 0,
  stale: false,
  cached: false,
});
export const emptyXueqiuHot = (): XueqiuHotResource => ({ ...emptyStatus(), items: [] });
export const emptyXueqiuTopic = (): XueqiuTopicResource => ({
  ...emptyStatus(),
  posts: [],
  page: 0,
  hasMore: true,
  loadingMore: false,
});

export function selectXueqiuTopic(items: XueqiuHotItem[], previous: string): string {
  return items.some((item) => item.word === previous) ? previous : items[0]?.word || "";
}

export function collapsedXueqiuTopics(
  items: XueqiuHotItem[],
  selected: string,
  limit = 6,
): XueqiuHotItem[] {
  const shown = items.slice(0, Math.max(0, limit));
  const current = items.find((item) => item.word === selected);
  if (current && shown.length && !shown.some((item) => item.word === selected))
    shown[shown.length - 1] = current;
  return shown;
}

function cleanHotItems(items: XueqiuHotItem[]): XueqiuHotItem[] {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (
      !item ||
      typeof item.word !== "string" ||
      !item.word.trim() ||
      !Number.isSafeInteger(item.rank) ||
      item.rank <= 0
    )
      return [];
    const word = item.word.trim();
    if (seen.has(word)) return [];
    seen.add(word);
    const heat =
      typeof item.heat === "number"
        ? Number.isFinite(item.heat) && item.heat >= 0
          ? item.heat
          : undefined
        : typeof item.heat === "string"
          ? item.heat
          : undefined;
    const statusCount =
      typeof item.statusCount === "number" || typeof item.statusCount === "string"
        ? item.statusCount
        : undefined;
    return [
      {
        rank: item.rank,
        word,
        ...(heat !== undefined ? { heat } : {}),
        ...(typeof item.heatLabel === "string" ? { heatLabel: item.heatLabel } : {}),
        label: typeof item.label === "string" ? item.label : "",
        url: typeof item.url === "string" ? item.url : "",
        ...(statusCount !== undefined ? { statusCount } : {}),
        ...(typeof item.summary === "string" ? { summary: item.summary } : {}),
        ...(Array.isArray(item.stocks)
          ? { stocks: item.stocks.filter((stock): stock is string => typeof stock === "string") }
          : {}),
      },
    ];
  });
}

function resultStatus(
  previous: XueqiuResourceStatus,
  result: XueqiuResultStatus,
  accepted: boolean,
  now: number,
): XueqiuResourceStatus {
  return {
    updatedAt:
      accepted && Number.isFinite(result.updatedAt) && Number(result.updatedAt) > 0
        ? Number(result.updatedAt)
        : previous.updatedAt,
    attempted: true,
    loading: false,
    error: result.error || (result.ok === true ? "" : "读取失败，请稍后重试"),
    needsLogin: result.needsLogin === true,
    cached: result.cached === true,
    stale: result.stale === true || (result.ok !== true && previous.updatedAt > 0),
    retryAt:
      result.ok === true
        ? 0
        : Number.isFinite(result.retryAfterMs) && Number(result.retryAfterMs) > 0
          ? now + Number(result.retryAfterMs)
          : now + 30_000,
  };
}

export function applyXueqiuHotResult(
  previous: XueqiuHotResource,
  result: XueqiuHotResult,
  now = Date.now(),
): XueqiuHotResource {
  const accepted =
    Array.isArray(result.items) &&
    (result.ok === true || (result.stale === true && result.items.length > 0));
  return {
    ...resultStatus(previous, result, accepted, now),
    items: accepted ? cleanHotItems(result.items!) : previous.items,
    stale: result.stale === true || (result.ok !== true && previous.items.length > 0),
  };
}

export function normalizeXueqiuTopicPosts(raw: unknown[]): Post[] {
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const obj = item as Record<string, unknown>;
    const userId = String(obj.userId || obj.user_id || "");
    if (!/^\d+$/.test(userId)) return [];
    const feedKey = `xueqiu:${userId}`;
    const post = sanitizeFeedPost(item, feedKey);
    const key = post ? `${feedKey}:${post.id}` : "";
    if (!post || seen.has(key)) return [];
    seen.add(key);
    return [{ ...post, feedKey, feedName: post.authorName, feedPlatform: "xueqiu" }];
  });
}

function mergeTopicPage(previous: Post[], next: Post[]): Post[] {
  const seen = new Set(
    previous.map((post) => `${post.feedKey || `xueqiu:${post.userId}`}:${post.id}`),
  );
  return [
    ...previous,
    ...next.filter((post) => {
      const key = `${post.feedKey || `xueqiu:${post.userId}`}:${post.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

export function applyXueqiuTopicResult(
  previous: XueqiuTopicResource,
  result: XueqiuTopicResult,
  requestedPage: number,
  now = Date.now(),
): XueqiuTopicResource {
  const accepted =
    Array.isArray(result.posts) &&
    (result.ok === true || (result.stale === true && result.posts.length > 0));
  const next = accepted ? normalizeXueqiuTopicPosts(result.posts!) : [];
  const posts = accepted
    ? requestedPage === 1
      ? next
      : mergeTopicPage(previous.posts, next)
    : previous.posts;
  const progressed =
    result.ok === true && (requestedPage === 1 || posts.length > previous.posts.length);
  const responsePage =
    Number.isSafeInteger(result.page) && Number(result.page) > 0
      ? Number(result.page)
      : requestedPage;
  return {
    ...previous,
    ...resultStatus(previous, result, accepted, now),
    posts,
    page: result.ok === true ? responsePage : previous.page,
    hasMore: result.ok === true ? result.hasMore === true && progressed : previous.hasMore,
    loadingMore: false,
    stale: result.stale === true || (result.ok !== true && previous.posts.length > 0),
  };
}

export function createXueqiuHotClient(
  send: (message: Record<string, unknown>) => Promise<XueqiuHotResult>,
) {
  let resource = emptyXueqiuHot();
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: XueqiuHotResource) => {
    resource = next;
    for (const listener of listeners) listener();
  };
  const load = (options: { active: boolean; force?: boolean }): Promise<void> => {
    if (!options.active || pending) return pending || Promise.resolve();
    if (
      resource.retryAt > Date.now() ||
      (!options.force &&
        resource.attempted &&
        !resource.error &&
        !resource.needsLogin &&
        resource.updatedAt > 0 &&
        Date.now() - resource.updatedAt < 2 * 60_000)
    )
      return Promise.resolve();
    publish({ ...resource, attempted: true, loading: true, error: "" });
    pending = Promise.resolve().then(async () => {
      try {
        publish(
          applyXueqiuHotResult(
            resource,
            await send({ type: "POPUP_XUEQIU_HOT", force: options.force === true }),
          ),
        );
      } catch {
        publish(applyXueqiuHotResult(resource, { ok: false, error: "请求失败，请稍后重试" }));
      } finally {
        pending = undefined;
      }
    });
    return pending;
  };
  return {
    load,
    getSnapshot: () => resource,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createXueqiuTopicClient(
  send: (message: Record<string, unknown>) => Promise<XueqiuTopicResult>,
) {
  let resources: Record<string, XueqiuTopicResource> = {};
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = (word: string, resource: XueqiuTopicResource) => {
    resources = { ...resources, [word]: resource };
    for (const listener of listeners) listener();
  };
  const load = (
    word: string,
    options: { active: boolean; force?: boolean; more?: boolean },
  ): Promise<void> => {
    if (!options.active || !word) return Promise.resolve();
    const running = pending.get(word);
    if (running) return running;
    const current = resources[word] || emptyXueqiuTopic();
    if (current.retryAt > Date.now()) return Promise.resolve();
    if (options.more && (!current.page || !current.hasMore || current.error || current.needsLogin))
      return Promise.resolve();
    if (
      !options.more &&
      !options.force &&
      current.attempted &&
      !current.error &&
      !current.needsLogin &&
      current.updatedAt > 0 &&
      Date.now() - current.updatedAt < 2 * 60_000
    )
      return Promise.resolve();
    const page = options.more ? current.page + 1 : 1;
    publish(word, {
      ...current,
      attempted: true,
      loading: page === 1,
      loadingMore: page > 1,
      error: "",
    });
    const task = Promise.resolve().then(async () => {
      try {
        const result = await send({
          type: "POPUP_XUEQIU_TOPIC",
          word,
          page,
          force: options.force === true,
        });
        publish(word, applyXueqiuTopicResult(resources[word], result, page));
      } catch {
        publish(
          word,
          applyXueqiuTopicResult(
            resources[word],
            { ok: false, error: "请求失败，请稍后重试" },
            page,
          ),
        );
      } finally {
        pending.delete(word);
      }
    });
    pending.set(word, task);
    return task;
  };
  return {
    load,
    getSnapshot: () => resources,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
