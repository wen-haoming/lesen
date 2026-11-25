import { sanitizeFeedPost, type Post } from "./sanitize";

export type XHotItem = { rank: number; word: string; heat: number; label: string; url: string };
type XResultStatus = {
  ok?: boolean; updatedAt?: number; error?: string; needsLogin?: boolean;
  retryAfterMs?: number; stale?: boolean; cached?: boolean;
};
export type XHotResult = XResultStatus & { items?: XHotItem[] };
export type XTopicResult = XResultStatus & { posts?: unknown[]; nextCursor?: string; hasMore?: boolean };
type XResourceStatus = {
  updatedAt: number; attempted: boolean; loading: boolean; error: string;
  needsLogin: boolean; retryAt: number; stale: boolean; cached: boolean;
};
export type XHotResource = XResourceStatus & { items: XHotItem[] };
export type XTopicResource = XResourceStatus & {
  posts: Post[]; nextCursor?: string; hasMore: boolean; loadingMore: boolean;
};
const emptyStatus = (): XResourceStatus => ({
  updatedAt: 0, attempted: false, loading: false, error: "", needsLogin: false,
  retryAt: 0, stale: false, cached: false,
});
export const emptyXHot = (): XHotResource => ({ ...emptyStatus(), items: [] });
export const emptyXTopic = (): XTopicResource => ({ ...emptyStatus(), posts: [], hasMore: true, loadingMore: false });

export function selectXTopic(items: XHotItem[], previous: string): string {
  return items.some((item) => item.word === previous) ? previous : items[0]?.word || "";
}
export function collapsedXTopics(items: XHotItem[], selected: string, limit = 6): XHotItem[] {
  const shown = items.slice(0, Math.max(0, limit));
  const current = items.find((item) => item.word === selected);
  if (current && shown.length && !shown.some((item) => item.word === selected)) shown[shown.length - 1] = current;
  return shown;
}
function cleanXHotItems(items: XHotItem[]): XHotItem[] {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (!item || typeof item.word !== "string" || !item.word.trim() ||
      !Number.isSafeInteger(item.rank) || item.rank <= 0 ||
      !Number.isFinite(item.heat) || item.heat < 0) return [];
    const word = item.word.trim();
    if (seen.has(word)) return [];
    seen.add(word);
    let url = "";
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password &&
        /(^|\.)(x\.com|twitter\.com)$/i.test(parsed.hostname)) url = parsed.href;
    } catch { /* 无效话题链接不提供跳转。 */ }
    return [{ rank: item.rank, word, heat: item.heat, label: typeof item.label === "string" ? item.label : "", url }];
  });
}
function resultStatus(previous: XResourceStatus, result: XResultStatus, accepted: boolean, now: number): XResourceStatus {
  return {
    updatedAt: accepted && Number.isFinite(result.updatedAt) && Number(result.updatedAt) > 0 ? Number(result.updatedAt) : previous.updatedAt,
    attempted: true, loading: false,
    error: result.error || (result.ok === true ? "" : "读取失败，请稍后重试"),
    needsLogin: result.needsLogin === true, cached: result.cached === true,
    stale: result.stale === true || (result.ok !== true && previous.updatedAt > 0),
    retryAt:
      result.ok === true
        ? 0
        : Number.isFinite(result.retryAfterMs) && Number(result.retryAfterMs) > 0
          ? now + Number(result.retryAfterMs)
          : now + 30_000,
  };
}
export function applyXHotResult(previous: XHotResource, result: XHotResult, now = Date.now()): XHotResource {
  const accepted = Array.isArray(result.items) && (result.ok === true || (result.stale === true && result.items.length > 0));
  return { ...resultStatus(previous, result, accepted, now), items: accepted ? cleanXHotItems(result.items!) : previous.items,
    stale: result.stale === true || (result.ok !== true && previous.items.length > 0) };
}
export function normalizeXTopicPosts(raw: unknown[]): Post[] {
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const obj = item as Record<string, unknown>;
    const handle = String(obj.handle || obj.screen_name || "").replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return [];
    const key = `x:${handle}`;
    const post = sanitizeFeedPost(item, key);
    if (!post || seen.has(post.id)) return [];
    seen.add(post.id);
    return [{ ...post, handle, feedKey: key, feedName: post.authorName, feedPlatform: "x" }];
  });
}
export function applyXTopicResult(previous: XTopicResource, result: XTopicResult, cursor?: string, now = Date.now()): XTopicResource {
  const accepted = Array.isArray(result.posts) && (result.ok === true || (result.stale === true && result.posts.length > 0));
  const next = accepted ? normalizeXTopicPosts(result.posts!) : [];
  const seen = new Set(previous.posts.map((post) => post.id));
  const posts = accepted ? (cursor ? [...previous.posts, ...next.filter((post) => !seen.has(post.id))] : next) : previous.posts;
  const nextCursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
  return {
    ...previous, ...resultStatus(previous, result, accepted, now), posts, loadingMore: false,
    nextCursor: result.ok === true ? nextCursor : previous.nextCursor,
    hasMore: result.ok === true ? result.hasMore === true && !!nextCursor && nextCursor !== cursor : previous.hasMore,
    stale: result.stale === true || (result.ok !== true && previous.posts.length > 0),
  };
}

export function createXTopicClient(send: (message: Record<string, unknown>) => Promise<XTopicResult>) {
  let resources: Record<string, XTopicResource> = {};
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = (word: string, resource: XTopicResource) => {
    resources = { ...resources, [word]: resource };
    for (const listener of listeners) listener();
  };
  const load = (word: string, options: { active: boolean; force?: boolean; more?: boolean }): Promise<void> => {
    if (!options.active || !word) return Promise.resolve();
    const running = pending.get(word);
    if (running) return running;
    const current = resources[word] || emptyXTopic();
    if (current.retryAt > Date.now()) return Promise.resolve();
    if (options.more && (!current.nextCursor || !current.hasMore || current.error || current.needsLogin)) return Promise.resolve();
    if (!options.more && !options.force && current.attempted && !current.error && !current.needsLogin &&
      Date.now() - current.updatedAt < 2 * 60_000) return Promise.resolve();
    const cursor = options.more ? current.nextCursor : undefined;
    publish(word, { ...current, attempted: true, loading: !cursor, loadingMore: !!cursor, error: "" });
    const task = Promise.resolve().then(async () => {
      try {
        const result = await send({ type: "POPUP_X_TOPIC", word, ...(cursor ? { cursor } : {}), force: options.force === true });
        publish(word, applyXTopicResult(resources[word], result, cursor));
      } catch {
        publish(word, applyXTopicResult(resources[word], { ok: false, error: "请求失败，请稍后重试" }, cursor));
      } finally { pending.delete(word); }
    });
    pending.set(word, task);
    return task;
  };
  return { load, getSnapshot: () => resources,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

export function createXHotClient(send: (message: Record<string, unknown>) => Promise<XHotResult>) {
  let resource = emptyXHot();
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: XHotResource) => {
    resource = next;
    for (const listener of listeners) listener();
  };
  const load = (options: { active: boolean; force?: boolean }): Promise<void> => {
    if (!options.active) return Promise.resolve();
    if (pending) return pending;
    if (resource.retryAt > Date.now() || (!options.force && resource.attempted && !resource.error && !resource.needsLogin &&
      Date.now() - resource.updatedAt < 2 * 60_000)) return Promise.resolve();
    publish({ ...resource, attempted: true, loading: true, error: "" });
    pending = Promise.resolve().then(async () => {
      try { publish(applyXHotResult(resource, await send({ type: "POPUP_X_HOT", force: options.force === true }))); }
      catch { publish(applyXHotResult(resource, { ok: false, error: "请求失败，请稍后重试" })); }
      finally { pending = undefined; }
    });
    return pending;
  };
  return { load, getSnapshot: () => resource,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
