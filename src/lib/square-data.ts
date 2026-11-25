import type { WeiboHotItem } from "./weibo-hot";

export type SquareResult = {
  ok?: boolean;
  posts?: unknown[];
  items?: WeiboHotItem[];
  updatedAt?: number;
  cached?: boolean;
  stale?: boolean;
  error?: string;
  reason?: string;
  needsLogin?: boolean;
  retryAfterMs?: number;
};

export type SquareResource = {
  posts: unknown[];
  items: WeiboHotItem[];
  updatedAt: number;
  loading: boolean;
  attempted: boolean;
  cached: boolean;
  stale: boolean;
  error: string;
  needsLogin: boolean;
  retryAt: number;
};

export const WEIBO_HOT_RESOURCE = "weibo:hot";
export const emptySquareResource = (): SquareResource => ({
  posts: [], items: [], updatedAt: 0, loading: false, attempted: false,
  cached: false, stale: false, error: "", needsLogin: false, retryAt: 0,
});

/** 将底层英文网络异常归一化为可读中文，避免在界面直拼 `fetch failed` 等技术字串。 */
export function formatSquareError(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (/^(fetch failed|failed to fetch|networkerror.*|load failed)$/i.test(text)) {
    return "网络请求失败，无法连接平台榜单接口。";
  }
  if (/aborted|timeout|timed out/i.test(text)) {
    return "请求超时，请稍后重试。";
  }
  return /[。！？.!?]$/.test(text) ? text : text + "。";
}

export function safeWeiboHotUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.hostname !== "weibo.com" && !url.hostname.endsWith(".weibo.com")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function cleanHotItems(items: WeiboHotItem[]): WeiboHotItem[] {
  return items.filter((item) => item && typeof item.word === "string" && item.word.trim()
    && Number.isSafeInteger(item.rank) && item.rank > 0
    && Number.isSafeInteger(item.heat) && item.heat >= 0)
    .map((item) => ({
      rank: item.rank,
      word: item.word.trim(),
      heat: item.heat,
      label: typeof item.label === "string" ? item.label : "",
      url: safeWeiboHotUrl(typeof item.url === "string" ? item.url : ""),
    }));
}

export function applySquareResult(previous: SquareResource, result: SquareResult): SquareResource {
  const acceptPosts = Array.isArray(result.posts)
    && (result.ok === true || (result.stale === true && result.posts.length > 0));
  const acceptItems = Array.isArray(result.items)
    && (result.ok === true || (result.stale === true && result.items.length > 0));
  const hasData = result.ok === true || acceptPosts || acceptItems;
  const updatedAt = Math.max(0, Number(result.updatedAt) || 0);
  return {
    ...previous,
    posts: acceptPosts ? result.posts! : previous.posts,
    items: acceptItems ? cleanHotItems(result.items!) : previous.items,
    updatedAt: hasData && updatedAt ? updatedAt : previous.updatedAt,
    loading: false,
    attempted: true,
    cached: result.cached === true,
    stale: result.stale === true || (result.ok !== true && previous.updatedAt > 0),
    error: result.error || (result.ok === true ? "" : result.reason || "读取失败，请稍后重试"),
    needsLogin: result.needsLogin === true,
    retryAt:
      result.ok === true
        ? 0
        : Number(result.retryAfterMs) > 0
          ? Date.now() + Number(result.retryAfterMs)
          : 0,
  };
}

let activeSquareRefreshes = 0;
export async function trackSquareRefresh<T>(task: () => Promise<T>): Promise<T> {
  activeSquareRefreshes += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("owlivo:square-busy", { detail: true }));
  }
  try {
    return await task();
  } finally {
    activeSquareRefreshes = Math.max(0, activeSquareRefreshes - 1);
    if (typeof window !== "undefined" && activeSquareRefreshes === 0) {
      window.dispatchEvent(new CustomEvent("owlivo:square-busy", { detail: false }));
    }
  }
}

// 同一资源共用请求；响应只写原资源，切平台不会串到当前内容。
export function createSquareClient(
  send: (message: Record<string, unknown>) => Promise<SquareResult>,
  onChange?: (resources: Record<string, SquareResource>) => void,
) {
  let resources: Record<string, SquareResource> = {};
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = (key: string, resource: SquareResource) => {
    resources = { ...resources, [key]: resource };
    onChange?.(resources);
    for (const listener of listeners) listener();
  };
  const load = (key: string, options: { active: boolean; force?: boolean }): Promise<void> => {
    if (!options.active || !key) return Promise.resolve();
    const current = resources[key] || emptySquareResource();
    const running = pending.get(key);
    if (running) return running;
    if (current.retryAt > Date.now() || (!options.force && current.attempted &&
      (current.updatedAt === 0 || Date.now() - current.updatedAt < 2 * 60 * 1000))) return Promise.resolve();
    publish(key, { ...current, loading: true, attempted: true, error: "" });
    const task = Promise.resolve().then(async () => {
      try {
        const message = key === WEIBO_HOT_RESOURCE
          ? { type: "POPUP_WEIBO_HOT", force: options.force === true }
          : { type: "POPUP_SQUARE_FEED", feedKey: key, force: options.force === true };
        const result = await send(message);
        publish(key, applySquareResult(resources[key] || emptySquareResource(), result));
      } catch {
        publish(key, applySquareResult(resources[key] || emptySquareResource(), { ok: false, error: "请求失败，请稍后重试" }));
      } finally {
        pending.delete(key);
      }
    });
    pending.set(key, task);
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

export const DEMO_WEIBO_HOT_ITEMS: WeiboHotItem[] = [
  { rank: 1, word: "演示话题：今晚一起看流星雨", heat: 1280000, label: "热", url: "" },
  { rank: 2, word: "演示话题：小猫的午睡姿势", heat: 860000, label: "新", url: "" },
  { rank: 3, word: "演示话题：秋日散步记录", heat: 520000, label: "", url: "" },
];
