import { sanitizeFeedPost, type Post } from './sanitize'

export type WeiboTopicResponse = {
  ok: boolean
  posts: Post[]
  updatedAt: number
  page: number
  hasMore: boolean
  error?: string
  needsLogin?: boolean
  retryAfterMs?: number
  stale?: boolean
  cached?: boolean
}
export type WeiboTopicParams = { word: string; page?: number; force?: boolean }
type Obj = Record<string, unknown>
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}

export function validWeiboTopicParams(value: unknown): value is WeiboTopicParams {
  const input = object(value)
  return typeof input.word === 'string' && input.word.length > 0 && input.word.length <= 100 &&
    input.word === input.word.trim() && !/[<>\u0000-\u001f\u007f-\u009f]/u.test(input.word) &&
    (input.page === undefined || (typeof input.page === 'number' && Number.isSafeInteger(input.page) && input.page >= 1 && input.page <= 1000)) &&
    (input.force === undefined || typeof input.force === 'boolean')
}

const TOPIC_CACHE_MS = 2 * 60_000
const TOPIC_MIN_GAP_MS = 10_000
const TOPIC_FAILURE_COOLDOWN_MS = 30_000

export function weiboTopicUrl(word: string, page: number): string {
  // 100103type=61 为微博话题「实时」流，避免默认综合流（type=1）置顶数天前旧帖导致刷新仍是老内容。
  return 'https://m.weibo.cn/api/container/getIndex?containerid=' + encodeURIComponent('100103type=61&q=' + word) + '&page=' + page
}

function safeTopicPosts(raw: unknown): Post[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : []).slice(0, 100).flatMap((value) => {
    const item = object(value)
    if (!/^[a-zA-Z0-9]+$/.test(String(item.id || '')) || !/^\d+$/.test(String(item.userId || ''))) return []
    const post = sanitizeFeedPost(item, 'weibo:' + item.userId)
    if (!post || seen.has(post.id)) return []
    if (post.quoted?.url) {
      try {
        const url = new URL(post.quoted.url)
        if (url.protocol !== 'https:' || url.username || url.password) post.quoted.url = ''
      } catch { post.quoted.url = '' }
    }
    seen.add(post.id)
    return [post]
  })
}

export function parseWeiboTopicData(value: unknown, page: number, normalizePost: (mblog: Obj) => unknown): { posts: Post[]; hasMore: boolean } {
  const root = object(value)
  if (Number(root.ok) !== 1) {
    throw Object.assign(new Error('微博话题接口返回失败'), { needsLogin: Number(root.ok) === -100 })
  }
  const data = object(root.data)
  if (!Array.isArray(data.cards)) throw new Error('微博话题返回格式异常')
  const raw: unknown[] = []
  const walk = (cards: unknown[], depth: number) => {
    if (depth > 10) throw new Error('微博话题卡片嵌套异常')
    for (const value of cards.slice(0, 200)) {
      const card = object(value)
      if (card.mblog && typeof card.mblog === 'object') raw.push(normalizePost(object(card.mblog)))
      if (Array.isArray(card.card_group)) walk(card.card_group, depth + 1)
    }
  }
  walk(data.cards, 0)
  const posts = safeTopicPosts(raw)
  if (page === 1 && posts.length > 1) {
    posts.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
  }
  // 非微博卡片或无效微博不能被误报为成功的空页。
  if (data.cards.length && !posts.length) throw new Error('微博话题未返回有效帖子')
  if (!posts.length) return { posts, hasMore: false }
  for (const info of [object(data.cardlistInfo), object(data.pageInfo)]) {
    const more = info.has_more ?? info.hasMore
    if (more === false || more === 0 || more === '0') return { posts, hasMore: false }
    if (more === true || more === 1 || more === '1') return { posts, hasMore: true }
    const pages = Number(info.total_pages ?? info.totalPages)
    if (Number.isSafeInteger(pages) && pages > 0) return { posts, hasMore: page < pages }
  }
  // 搜索接口可能不提供总页数；允许显式请求下一页，以真实空页结束，不按卡片数量猜页数。
  return { posts, hasMore: page < 1000 }
}

type Cache = {
  posts?: unknown[]; updatedAt?: number; attemptedAt?: number; retryAt?: number
  hasMore?: boolean; failure?: boolean; needsLogin?: boolean; error?: string
}
type Dependencies = {
  getHotItems: () => Promise<unknown[]>
  request: (url: string, opts?: { force?: boolean; page?: number; word?: string }) => Promise<unknown>
  normalizePost: (mblog: Obj) => unknown
  readCache: (key: string) => Promise<Cache | undefined>
  writeCache: (key: string, value: Cache) => Promise<void>
  now?: () => number
}

export function createWeiboTopicFetcher(deps: Dependencies) {
  const inFlight = new Map<string, Promise<WeiboTopicResponse>>()
  const snapshots = new Map<string, Cache>()
  const now = deps.now || Date.now
  return function fetchWeiboTopic(input: unknown): Promise<WeiboTopicResponse> {
    if (!validWeiboTopicParams(input)) return Promise.resolve({ ok: false, posts: [], updatedAt: 0, page: 1, hasMore: false, error: '无效的话题请求参数' })
    const { word, force } = input
    const page = input.page ?? 1
    const key = 'weiboTopicCache:' + encodeURIComponent(word) + ':' + page
    if (inFlight.has(key)) return inFlight.get(key)!
    const task = (async (): Promise<WeiboTopicResponse> => {
      const empty = { posts: [], updatedAt: 0, page, hasMore: false }
      // 每次请求都检查当前真实榜单，不为过期或任意搜索词开放缓存和网络。
      const items = await deps.getHotItems()
      if (!items.some((item) => object(item).word === word)) return { ok: false, ...empty, error: '话题不在当前微博热搜榜单中' }
      let cached = snapshots.get(key) || {}
      if (!snapshots.has(key)) {
        try { cached = await deps.readCache(key) || {} } catch { /* 存储失败不阻断只读请求。 */ }
      }
      const time = now()
      const updatedAt = Number(cached.updatedAt) > 0 && Number(cached.updatedAt) <= time ? Number(cached.updatedAt) : 0
      const posts = updatedAt ? safeTopicPosts(cached.posts) : []
      const base = { posts, updatedAt, page, hasMore: posts.length > 0 && cached.hasMore === true }
      const retryAt = Math.max(Number(cached.retryAt) || 0, (Number(cached.attemptedAt) || 0) + TOPIC_MIN_GAP_MS)
      if (cached.failure && retryAt > time) return { ok: false, ...base, stale: !!updatedAt, cached: !!updatedAt,
        error: cached.error || '微博话题暂不可用，请稍后重试', needsLogin: cached.needsLogin === true, retryAfterMs: retryAt - time }
      if (updatedAt && ((!force && time - updatedAt < TOPIC_CACHE_MS) || retryAt > time)) return { ok: true, ...base, cached: true,
        ...(retryAt > time ? { retryAfterMs: retryAt - time } : {}) }
      if (retryAt > time) return { ok: false, ...empty, error: '请求过于频繁，请稍后再试', retryAfterMs: retryAt - time }
      const attemptedAt = time
      const save = async (value: Cache) => {
        snapshots.set(key, value)
        try { await deps.writeCache(key, value) } catch { /* 存储失败不覆盖网络结果。 */ }
      }
      try {
        const rawResponse = force
          ? await deps.request(weiboTopicUrl(word, page), { force: true, page, word })
          : await deps.request(weiboTopicUrl(word, page))
        const parsed = parseWeiboTopicData(rawResponse, page, deps.normalizePost)
        const next = { ...parsed, updatedAt: now(), attemptedAt }
        await save(next)
        return { ok: true, posts: parsed.posts, updatedAt: next.updatedAt, page, hasMore: parsed.hasMore }
      } catch (error) {
        const failure = error as { retryAfterMs?: number; needsLogin?: boolean; platformPause?: boolean }
        const retryAfterMs = Math.max(TOPIC_FAILURE_COOLDOWN_MS, Number(failure?.retryAfterMs) || 0)
        const message = failure?.platformPause ? '平台暂时限制了请求，请稍后再试' : failure?.needsLogin ? '请先登录微博后重试' : '微博话题暂不可用，请稍后重试'
        await save({ ...base, attemptedAt, failure: true, needsLogin: failure?.needsLogin === true, error: message, retryAt: now() + retryAfterMs })
        return { ok: false, ...base, stale: !!updatedAt, error: message, needsLogin: failure?.needsLogin === true, retryAfterMs }
      }
    })().catch((): WeiboTopicResponse => ({ ok: false, posts: [], updatedAt: 0, page, hasMore: false, error: '微博话题暂不可用，请稍后重试' }))
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, task)
    return task
  }
}
