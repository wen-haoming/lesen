import { sanitizeFeedPost, type Post } from "./sanitize";
import type { WeiboHotItem } from "./weibo-hot";

export type WeiboTopicResult = {
  ok?: boolean; posts?: unknown[]; updatedAt?: number; page?: number; hasMore?: boolean;
  error?: string; needsLogin?: boolean; retryAfterMs?: number; stale?: boolean; cached?: boolean;
};
export type WeiboTopicResource = {
  posts: Post[]; page: number; hasMore: boolean; updatedAt: number; attempted: boolean;
  loading: boolean; loadingMore: boolean; error: string; needsLogin: boolean;
  retryAt: number; stale: boolean; cached: boolean;
};
export const emptyWeiboTopic = (): WeiboTopicResource => ({
  posts: [], page: 0, hasMore: true, updatedAt: 0, attempted: false,
  loading: false, loadingMore: false, error: "", needsLogin: false, retryAt: 0,
  stale: false, cached: false,
});

export function selectWeiboTopic(items: WeiboHotItem[], previous: string): string {
  return items.some((item) => item.word === previous) ? previous : items[0]?.word || "";
}

export function collapsedWeiboTopics(items: WeiboHotItem[], selected: string, limit = 6): WeiboHotItem[] {
  const shown = items.slice(0, limit);
  const current = items.find((item) => item.word === selected);
  if (current && !shown.some((item) => item.word === selected)) shown[shown.length - 1] = current;
  return shown;
}

export function normalizeWeiboTopicPosts(raw: unknown[]): Post[] {
  const posts: Post[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const uid = String(obj.userId || obj.user_id || "");
    const post = sanitizeFeedPost(item, `weibo:${uid}`);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push({ ...post, feedKey: `weibo:${post.userId}`, feedName: post.authorName, feedPlatform: "weibo" });
  }
  return posts;
}

export function mergeWeiboTopicPage(previous: Post[], next: Post[]): Post[] {
  const seen = new Set(previous.map((post) => post.id));
  return [...previous, ...next.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  })];
}

export function applyWeiboTopicResult(previous: WeiboTopicResource, result: WeiboTopicResult, page: number, now = Date.now()): WeiboTopicResource {
  const accepted = Array.isArray(result.posts) && (result.ok === true || (result.stale === true && result.posts.length > 0));
  const next = accepted ? normalizeWeiboTopicPosts(result.posts!) : [];
  const posts = accepted ? (page === 1 ? next : mergeWeiboTopicPage(previous.posts, next)) : previous.posts;
  const progressed = result.ok === true && (page === 1 || posts.length > previous.posts.length);
  return {
    ...previous, posts, page: result.ok === true ? page : previous.page,
    hasMore: result.ok === true ? result.hasMore === true && progressed : previous.hasMore,
    updatedAt: accepted && Number(result.updatedAt) > 0 ? Number(result.updatedAt) : previous.updatedAt,
    attempted: true, loading: false, loadingMore: false,
    error: result.error || (result.ok === true ? "" : "读取话题失败，请稍后重试"),
    needsLogin: result.needsLogin === true, cached: result.cached === true,
    stale: result.stale === true || (result.ok !== true && previous.posts.length > 0),
    retryAt:
      result.ok === true
        ? 0
        : Number(result.retryAfterMs) > 0
          ? now + Number(result.retryAfterMs)
          : now + 30_000,
  };
}

export function createWeiboTopicClient(send: (message: Record<string, unknown>) => Promise<WeiboTopicResult>) {
  let resources: Record<string, WeiboTopicResource> = {};
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = (word: string, resource: WeiboTopicResource) => {
    resources = { ...resources, [word]: resource };
    for (const listener of listeners) listener();
  };
  const load = (word: string, options: { active: boolean; force?: boolean; more?: boolean }): Promise<void> => {
    if (!options.active || !word) return Promise.resolve();
    const running = pending.get(word);
    if (running) return running;
    const current = resources[word] || emptyWeiboTopic();
    if (current.retryAt > Date.now()) return Promise.resolve();
    if (options.more && (!current.page || !current.hasMore || current.error || current.needsLogin)) return Promise.resolve();
    if (!options.more && !options.force && current.attempted &&
      (!current.updatedAt || Date.now() - current.updatedAt < 2 * 60_000)) return Promise.resolve();
    const page = options.more ? current.page + 1 : 1;
    publish(word, { ...current, attempted: true, loading: page === 1, loadingMore: page > 1, error: "" });
    const task = Promise.resolve().then(async () => {
      try {
        const result = await send({ type: "POPUP_WEIBO_TOPIC", word, page, force: options.force === true });
        publish(word, applyWeiboTopicResult(resources[word], result, page));
      } catch {
        publish(word, applyWeiboTopicResult(resources[word], { ok: false, error: "请求失败，请稍后重试" }, page));
      } finally {
        pending.delete(word);
      }
    });
    pending.set(word, task);
    return task;
  };
  return {
    load, getSnapshot: () => resources,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
