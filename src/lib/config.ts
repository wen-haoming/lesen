export const TARGET = Object.freeze({
  userId: '1247347556',
  name: '大道无形我有型',
})

export const DEFAULT_SOURCES: ReadonlyArray<FeedSource> = Object.freeze([])

export const MSG_TAG = '__XQ_DADAO_V1__'

export const LIMIT = Object.freeze({
  posts: 1000,
  titleChars: 90,
  // 与 X 路径对齐：保留引用/回复上下文，避免 160 字截断破坏嵌套展示
  summaryChars: 1600,
})

export const FEED_ALL = '__all__'

export const STORAGE_KEYS = [
  'timelines',
  'timelineSync',
  'timelineError',
  'timelinePaging',
  'following',
  'selectedUserId',
  'selectedFeedKey',
  'sources',
  'settings',
  'authorReadAt',
  'notifyState',
  'account',
  'loggedIn',
  'windowBounds',
  'resizeHintShown',
] as const

export const VISIBLE_PLATFORMS = ['xueqiu', 'x', 'weibo'] as const

export type Platform = (typeof VISIBLE_PLATFORMS)[number]

export type FeedSource = {
  platform: Platform
  id: string
  name?: string
  avatar?: string
}

export function isSupportedPlatform(value: string | undefined | null): value is Platform {
  return (VISIBLE_PLATFORMS as readonly string[]).includes(String(value || ''))
}

export function sanitizeHomeOrder(order: unknown): Platform[] {
  const seen = new Set<Platform>()
  const result: Platform[] = []
  const incoming = Array.isArray(order) ? order : []
  for (const item of [...incoming, ...VISIBLE_PLATFORMS]) {
    const platform = String(item || '')
    if (!isSupportedPlatform(platform) || seen.has(platform)) continue
    seen.add(platform)
    result.push(platform)
  }
  return result
}

export function fallbackPickerTab(tab: string | undefined | null): Platform {
  return isSupportedPlatform(tab) ? tab : 'x'
}

export function fallbackSelectedFeedKey(
  selectedFeedKey: string | undefined | null,
  availableKeys: readonly string[] = [],
): string {
  const key = String(selectedFeedKey || '') || FEED_ALL
  if (key === FEED_ALL) return FEED_ALL
  const parsed = parseFeedKey(key)
  if (!isSupportedPlatform(parsed.platform)) return FEED_ALL
  if (availableKeys.length && !availableKeys.includes(key)) return FEED_ALL
  return key
}

export type FeedPerson = FeedSource & {
  key: string
  pinned?: boolean
}

const XQ_AVATAR_DEFAULT = 'https://xavatar.imedao.com'

export function feedKey(entry: { platform?: string; id?: string }): string {
  const platform = String(entry?.platform || 'xueqiu')
  const id = String(entry?.id || '')
  return platform + ':' + id
}

export function parseFeedKey(key: string): { platform: Platform | string; id: string } {
  const raw = String(key || '')
  const i = raw.indexOf(':')
  if (i <= 0) return { platform: 'xueqiu', id: raw }
  return { platform: raw.slice(0, i), id: raw.slice(i + 1) }
}

export function forceHttps(value: string): string {
  const s = String(value || '').trim()
  if (/^http:\/\//i.test(s)) return 'https://' + s.slice(7)
  if (s.indexOf('//') === 0) return 'https:' + s
  if (!/^https:\/\//i.test(s)) return 'https://' + s.replace(/^\/+/, '')
  return s
}

function isPackagedAssetPath(path: string): boolean {
  return /^(?:\.\.?\/|\/)?(?:fixtures|icons)\//i.test(String(path || '').trim())
}

/**
 * 雪球 profile_image_url 常为逗号拼接多档路径，例如：
 * `community/a.jpg,community/a.jpg!180x180.png,community/a.jpg!50x50.png`
 * 或已拼域名的：`https://xavatar.../a.jpg,community/a.jpg!180x180.png,...`
 * 整串不能直接当 img src，需拆出单条。
 */
export function pickXueqiuAvatarPart(raw: string): string {
  const parts = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  const sized = parts.find((part) => /!\d+x\d+\.[a-z0-9]+$/i.test(part))
  return sized || parts[0]
}

function absoluteAvatarHost(raw: string): string {
  const hit = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .find((part) => /^(?:https?:)?\/\//i.test(part))
  if (!hit) return XQ_AVATAR_DEFAULT
  try {
    const url = new URL(forceHttps(hit))
    return url.origin
  } catch {
    return XQ_AVATAR_DEFAULT
  }
}

function resolveXueqiuAvatarPath(pathRaw: string, domainRaw?: string): string {
  let path = pickXueqiuAvatarPart(pathRaw)
  if (!path) return ''
  if (/^(data|blob):/i.test(path)) return path.slice(0, 500)
  if (isPackagedAssetPath(path)) {
    return ('/' + path.replace(/^(?:\.\.?\/)+/, '').replace(/^\//, '')).slice(0, 500)
  }
  if (/^https?:\/\//i.test(path) || path.indexOf('//') === 0) return forceHttps(path).slice(0, 500)
  const domain = forceHttps(
    String(domainRaw || absoluteAvatarHost(pathRaw) || XQ_AVATAR_DEFAULT)
      .trim()
      .replace(/\/$/, ''),
  )
  if (path.indexOf('/') !== 0) path = '/' + path
  return (domain + path).slice(0, 500)
}

export function xueqiuAvatarUrl(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return resolveXueqiuAvatarPath(raw)
  if (typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  const path = String(obj.profile_image_url || obj.profile_image || obj.avatar || '').trim()
  if (!path) return ''
  return resolveXueqiuAvatarPath(path, String(obj.photo_domain || '').trim() || undefined)
}

export function migrateKeyedStore(raw: unknown): Record<string, unknown> {
  const out = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  for (const key of Object.keys(out)) {
    if (/^\d+$/.test(key)) {
      const next = 'xueqiu:' + key
      const existing = out[next]
      // 空数组也视为未迁移：content 脚本曾用裸 uid 落盘，避免 [] 挡住真实数据
      const empty =
        existing == null || (Array.isArray(existing) && existing.length === 0)
      if (empty) out[next] = out[key]
    }
  }
  return out
}
