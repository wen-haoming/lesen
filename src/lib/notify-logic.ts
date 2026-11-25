/** 关注更新提醒：纯函数逻辑，便于单测（不读 authorReadAt） */

export type NotifySourceState = {
  seeded?: boolean
  ids?: string[]
  at?: number
}

export type NotifyCandidatePost = {
  id: string | number
  timestamp?: number
  title?: string
  summary?: string
  url?: string
}

/** 首次 seed：只记基线 ID，不弹历史 */
export function seedNotifyIds(posts: NotifyCandidatePost[]): string[] {
  const seen = new Set<string>()
  for (const post of posts) seen.add(String(post.id))
  return Array.from(seen).slice(-200)
}

/**
 * 已 seed 后筛新帖：只用帖子 ID 去重；可选按时间辅助排序。
 * 不再使用 authorReadAt / isViewing。
 */
export function pickNotifyCandidates(
  posts: NotifyCandidatePost[],
  seenIds: Iterable<string>,
  maxPerSource: number,
): NotifyCandidatePost[] {
  const seen = new Set(Array.from(seenIds).map(String))
  const sorted = [...posts].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
  const out: NotifyCandidatePost[] = []
  for (const post of sorted) {
    if (seen.has(String(post.id))) continue
    out.push(post)
    if (out.length >= maxPerSource) break
  }
  return out
}

export function mergeNotifySeenIds(prev: Iterable<string>, added: Iterable<string>): string[] {
  const next = new Set([...Array.from(prev), ...Array.from(added)].map(String))
  return Array.from(next).slice(-200)
}

/** 已取消定时自动刷新；保留常量与归一化，旧设置一律按关闭处理。 */
export const REFRESH_MINUTE_CHOICES = [0] as const

export type NotifyForm = "system" | "quiet"

export function normalizeRefreshMinutes(_value?: unknown): number {
  return 0
}

/** 未写 notifyForm 时沿用旧的 notify 开关：关 = 不弹窗。 */
export function resolveNotifyForm(
  settings: { notify?: boolean; notifyForm?: string } | null | undefined,
): NotifyForm {
  if (settings?.notifyForm === "quiet" || settings?.notifyForm === "system") return settings.notifyForm
  return settings?.notify === false ? "quiet" : "system"
}

export function shouldPollUpdates(_settings?: { refreshMinutes?: number } | null): boolean {
  return false
}

export function shouldRunNotifyCheck(
  settings: { notify?: boolean; notifyForm?: string } | null | undefined,
): boolean {
  return resolveNotifyForm(settings) === "system"
}
