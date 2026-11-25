/** 头像红点：只跟这条时间线是不是已经刷新到最新有关。 */

export function newestPostTimestamp(posts: unknown): number {
  if (!Array.isArray(posts)) return 0;
  let newest = 0;
  for (const post of posts) {
    const timestamp = Number(
      post && typeof post === "object" ? (post as { timestamp?: number }).timestamp : 0,
    );
    if (timestamp > newest) newest = timestamp;
  }
  return newest;
}

/** 本地缓存里、这次列表更新才出现的帖子 id。按信息源分开。 */
export function normalizeTimelineFresh(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key || !Array.isArray(value)) continue;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const id = String(item || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length) out[key] = ids;
  }
  return out;
}

/**
 * 相对本地缓存记下的新帖 id，统计当前列表里更新了多少条。
 * 首次写入的历史、以及下拉加载的更早内容，都不在这批 id 里。
 */
export function countFreshPosts(
  posts: Array<{ id?: string; feedKey?: string }>,
  timelineFresh: Record<string, readonly string[]>,
  fallbackFeedKey = "",
): number {
  const sets = new Map<string, Set<string>>();
  const freshOf = (key: string) => {
    const cached = sets.get(key);
    if (cached) return cached;
    const list = timelineFresh[key];
    const set = new Set(Array.isArray(list) ? list.map((id) => String(id)) : []);
    sets.set(key, set);
    return set;
  };
  let count = 0;
  for (const post of posts) {
    const key = String(post.feedKey || fallbackFeedKey || "");
    const id = String(post.id || "");
    if (!key || !id || !freshOf(key).has(id)) continue;
    count += 1;
  }
  return count;
}

/** 已记下刷新水位，且本地最新帖比水位新，才显示红点。 */
export function sourceHasFreshUpdate(posts: unknown, ackedAt: number): boolean {
  const newest = newestPostTimestamp(posts);
  const acked = Number(ackedAt || 0);
  if (!newest || !acked) return false;
  return newest > acked;
}

export function ackRecordChanged(
  next: Record<string, number>,
  stored: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(next), ...Object.keys(stored)]);
  for (const key of keys) {
    if (Number(next[key] || 0) !== Number(stored[key] || 0)) return true;
  }
  return false;
}

export function mergeTimelineAck(
  stored: Record<string, number> | undefined,
  local: Record<string, number> | undefined,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const source of [stored, local]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const at = Number(value || 0);
      if (at > Number(next[key] || 0)) next[key] = at;
    }
  }
  return next;
}

/**
 * 已经成功同步、但还没有水位的源，把水位记成当前最新帖。
 * 这样已是最新的数据不会亮红点；之后再来更新的帖子才会亮。
 */
export function baselineTimelineAck(
  timelines: Record<string, unknown>,
  timelineSync: Record<string, number>,
  timelineAck: Record<string, number>,
): Record<string, number> | null {
  let changed = false;
  const next = { ...timelineAck };
  for (const [key, posts] of Object.entries(timelines)) {
    if (Object.prototype.hasOwnProperty.call(next, key)) continue;
    if (!Number(timelineSync[key] || 0)) continue;
    const newest = newestPostTimestamp(posts);
    if (!newest) continue;
    next[key] = newest;
    changed = true;
  }
  return changed ? next : null;
}
