import { sanitizeFeedPost, type Post } from './sanitize'

export type XHotItem = { rank: number; word: string; heat: number; label: string; url: string }
type Status = { updatedAt: number; error?: string; needsLogin?: boolean; retryAfterMs?: number; stale?: boolean; cached?: boolean }
export type XHotResponse = Status & { ok: boolean; items: XHotItem[] }
export type XTopicResponse = Status & { ok: boolean; posts: Post[]; cursor?: string; nextCursor?: string; hasMore: boolean }
export type XTopicParams = { word: string; cursor?: string; force?: boolean }
type RawPost = { id: string; handle: string; authorName: string; authorAvatar: string; summary: string; timestamp: number; mediaUrls: string[] }
export type XDomSnapshot = { items: XHotItem[]; posts: RawPost[]; error?: string; needsLogin?: boolean; limited?: boolean; empty?: boolean }

export function validXTopicParams(value: unknown): value is XTopicParams {
  if (!value || typeof value !== 'object') return false
  const input = value as XTopicParams
  return typeof input.word === 'string' && input.word.length > 0 && input.word.length <= 100 &&
    input.word === input.word.trim() && !/[<>\u0000-\u001f\u007f-\u009f]/u.test(input.word) &&
    (input.cursor === undefined || (typeof input.cursor === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.cursor))) &&
    (input.force === undefined || typeof input.force === 'boolean')
}

export function xTopicUrl(word: string): string {
  // f=live 获取实时最新推文，避免 f=top 长期返回数天前热门旧帖。
  return 'https://x.com/search?q=' + encodeURIComponent(word) + '&src=trend_click&f=live'
}

// 可直接注入隔离世界；不引用模块闭包，不读取 cookie 或页面私有 API。
export function extractXDom(mode: 'hot' | 'topic', root: Document = document): XDomSnapshot {
  const text = root.body?.textContent || ''
  const url = root.location?.href || ''
  const items: XHotItem[] = []
  const posts: RawPost[] = []
  const limited = /rate limit exceeded|too many requests|请求过于频繁|已达到.*限制|超出.*限制/i.test(text)
  const challenge = /verify you are human|authenticate your account|验证你是人类|验证您的身份/i.test(text) || /\/account\/access/.test(url)
  const needsLogin = /\/i\/flow\/login/.test(url) || !!root.querySelector('input[autocomplete="username"],input[name="password"]')
  if (limited || challenge || needsLogin) return { items, posts, limited: limited || challenge, needsLogin,
    error: needsLogin ? '请先登录 X 后重试' : challenge ? 'X 需要手动完成验证' : 'X 暂时限制了请求，请稍后再试' }
  if (mode === 'hot') {
    for (const trend of Array.from(root.querySelectorAll('[data-testid="trend"]')).slice(0, 100)) {
      if (/Promoted by|推广/i.test(trend.textContent || '')) continue
      // 真实结构为 [排名, ·, 分类行（含“趋势”）, 话题名]；按文字顺序定位，不依赖混淆类名。
      const rows = Array.from(trend.querySelectorAll('div[dir="ltr"]')).map((node) => (node.textContent || '').trim())
      const rankIndex = rows.findIndex((row) => /^\d+$/.test(row))
      if (rankIndex < 0) continue
      const rank = Number(rows[rankIndex])
      const categoryIndex = rows.findIndex((row, index) => index > rankIndex && /趋势|Trending/i.test(row))
      const word = categoryIndex >= 0 ? rows[categoryIndex + 1] || '' : ''
      if (!word || word.length > 100 || /[<>\u0000-\u001f\u007f-\u009f]/u.test(word) || !Number.isSafeInteger(rank) || rank < 1 || items.some((item) => item.word === word)) continue
      const category = (rows[categoryIndex] || '').replace(/\s*(的)?趋势\s*$/, '').trim()
      // DOM 没有可靠热度数值时明确为 0，绝不以排名伪造热度。
      items.push({ rank, word, heat: 0, label: category === word ? '' : category, url: 'https://x.com/search?q=' + encodeURIComponent(word) + '&src=trend_click&f=live' })
    }
    items.sort((a, b) => a.rank - b.rank)
  } else {
    for (const tweet of Array.from(root.querySelectorAll('article[data-testid="tweet"]')).slice(0, 100)) {
      if (tweet.querySelector('[data-testid="placementTracking"]') || /Promoted by|推广/.test(tweet.textContent || '')) continue
      const name = tweet.querySelector('[data-testid="User-Name"]')
      const time = name?.querySelector('time') || tweet.querySelector('time')
      const statusLink = time?.closest('a')
      let match: RegExpMatchArray | null = null
      try {
        const link = new URL(statusLink?.getAttribute('href') || '', 'https://x.com')
        if (link.protocol === 'https:' && link.hostname === 'x.com' && !link.username && !link.password) match = link.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d+)$/)
      } catch { /* 忽略非正文链接。 */ }
      if (!match || posts.some((post) => post.id === match![2])) continue
      const handle = match[1]
      const authorLink = Array.from(name?.querySelectorAll('a') || []).find((link) => link.getAttribute('href')?.toLowerCase() === '/' + handle.toLowerCase())
      if (!authorLink) continue
      const authorName = authorLink.textContent?.trim() || handle
      const avatar = (
        tweet.querySelector('[data-testid^="UserAvatar-Container"] img')?.getAttribute('src') ||
        tweet.querySelector('img[src*="profile_images"]')?.getAttribute('src') ||
        ''
      )
      const summary = tweet.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || ''
      const mediaUrls = Array.from(tweet.querySelectorAll('[data-testid="tweetPhoto"] img,video[poster]')).map((node) => node.getAttribute(node.tagName === 'VIDEO' ? 'poster' : 'src') || '').filter(Boolean)
      const timestamp = Date.parse(time?.getAttribute('datetime') || '')
      if (!Number.isFinite(timestamp) || (!summary && !mediaUrls.length)) continue
      posts.push({ id: match[2], handle, authorName, authorAvatar: avatar, summary, timestamp, mediaUrls })
    }
  }
  const empty = /No results for|没有找到结果|未找到结果/i.test(text)
  return { items, posts, empty }
}

// 等待真实 DOM 数据，超时或登录/验证页面即结束；滚动只作用于自有标签页。
export function waitXDom(mode: 'hot' | 'topic', previous: string[], timeoutMs: number, scroll: boolean): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = () => { observer.disconnect(); clearTimeout(timer); resolve() }
    const check = () => {
      const text = document.body?.textContent || ''
      if (/\/i\/flow\/login|\/account\/access/.test(location.href) || /rate limit exceeded|too many requests|verify you are human|No results for|没有找到结果|请求过于频繁|验证你是人类/i.test(text) || document.querySelector('input[autocomplete="username"],input[name="password"]')) return finish()
      if (mode === 'hot' && document.querySelector('[data-testid="trend"]')) return finish()
      if (mode === 'topic' && Array.from(document.querySelectorAll('article[data-testid="tweet"] time')).some((time) => {
        const id = time.closest('a')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1]
        return id && !previous.includes(id)
      })) finish()
    }
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    timer = setTimeout(finish, Math.max(1, Math.min(timeoutMs, 18000)))
    if (scroll) window.scrollTo(0, document.documentElement.scrollHeight)
    check()
  })
}

export function normalizeXTopicPosts(raw: unknown): Post[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : []).slice(0, 100).flatMap((item) => {
    if (!item || !/^\d+$/.test(String(item.id || '')) || !/^[a-zA-Z0-9_]{1,15}$/.test(String(item.handle || ''))) return []
    const post = sanitizeFeedPost(item, 'x:' + item.handle)
    if (!post || seen.has(post.id)) return []
    seen.add(post.id)
    return [{ ...post, handle: item.handle, feedKey: 'x:' + item.handle, feedName: post.authorName, feedPlatform: 'x' }]
  })
}

type Cache = { response?: XHotResponse | XTopicResponse; attemptedAt?: number; retryAt?: number; failures?: number }
type Cursor = { word: string; page: number; seen: string[]; expires: number }
type Dependencies = {
  readHot: () => Promise<XDomSnapshot>
  readTopic: (word: string, seen: string[]) => Promise<{ posts: unknown[]; more: unknown[]; hasMoreHint?: boolean }>
  readCache: (key: string) => Promise<Cache | undefined>
  writeCache: (key: string, cache: Cache) => Promise<void>
  now?: () => number
  token?: () => string
}

const X_MIN_GAP_MS = 15_000
const X_CACHE_TTL_MS = 120_000
const X_CURSOR_TTL_MS = 10 * 60_000

export function createXTopicService(deps: Dependencies) {
  const now = deps.now || Date.now
  const snapshots = new Map<string, Cache>()
  const flights = new Map<string, Promise<any>>()
  const cursors = new Map<string, Cursor>()
  let allowed: XHotItem[] = []
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.catch(() => {}).then(task)
    queue = run
    return run
  }
  async function cached<T extends XHotResponse | XTopicResponse>(key: string, force: boolean, empty: T, task: () => Promise<T>): Promise<T> {
    if (flights.has(key)) return flights.get(key)!
    const run = (async () => {
      let cache = snapshots.get(key)
      if (!cache) { try { cache = await deps.readCache(key) } catch { /* 存储失败不阻断只读。 */ } }
      cache ||= {}
      const time = now()
      const prior = cache.response
      const retryAt = Math.max(cache.retryAt || 0, (cache.attemptedAt || 0) + X_MIN_GAP_MS)
      if (prior && (prior.updatedAt <= time) && ((!force && prior.ok && time - prior.updatedAt < X_CACHE_TTL_MS) || retryAt > time)) {
        return { ...prior, cached: true, ...(retryAt > time ? { retryAfterMs: retryAt - time } : {}) } as T
      }
      if (retryAt > time) return { ...empty, error: '请求过于频繁，请稍后再试', retryAfterMs: retryAt - time }
      const save = async (value: Cache) => { snapshots.set(key, value); try { await deps.writeCache(key, value) } catch { /* 保留读取结果。 */ } }
      try {
        const response = await serialized(task)
        await save({ response, attemptedAt: time, failures: 0 })
        return response
      } catch (error) {
        const failure = error as { message?: string; needsLogin?: boolean; retryAfterMs?: number }
        const failures = Math.min(5, (cache.failures || 0) + 1)
        const retryAfterMs = Math.max(30000 * 2 ** (failures - 1), failure.retryAfterMs || 0)
        const response = { ...(prior?.updatedAt ? prior : empty), ok: false, stale: !!prior?.updatedAt,
          cached: !!prior?.updatedAt, error: failure.message || 'X 内容暂不可用，请稍后重试', needsLogin: failure.needsLogin === true, retryAfterMs } as T
        await save({ response, attemptedAt: time, retryAt: now() + retryAfterMs, failures })
        return response
      }
    })().finally(() => { flights.delete(key) })
    flights.set(key, run)
    return run
  }
  async function hot(force = false): Promise<XHotResponse> {
    const empty: XHotResponse = { ok: false, items: [], updatedAt: 0 }
    const response = await cached<XHotResponse>('xHotCache', force, empty, async () => {
      const result = await deps.readHot()
      if (result.error || !result.items.length) throw Object.assign(new Error(result.error || 'X 趋势页尚未返回有效榜单'), { needsLogin: result.needsLogin })
      return { ok: true, items: result.items, updatedAt: now() }
    })
    allowed = response.items
    return response
  }
  async function topic(input: unknown): Promise<XTopicResponse> {
    const empty: XTopicResponse = { ok: false, posts: [], updatedAt: 0, hasMore: false }
    if (!validXTopicParams(input)) return { ...empty, error: '无效的话题请求参数' }
    const { word, cursor, force } = input
    if (!allowed.length) await hot()
    if (!allowed.some((item) => item.word === word)) return { ...empty, error: '话题不在当前 X 热搜榜单中' }
    for (const [key, state] of cursors) if (state.expires < now()) cursors.delete(key)
    const state = cursor ? cursors.get(cursor) : undefined
    if (cursor && (!state || state.word !== word || state.page > 3)) return { ...empty, error: '话题分页已失效，请重新打开话题' }
    const page = state?.page || 1
    const first: XTopicResponse = { ...empty, cursor }
    return cached<XTopicResponse>('xTopicCache:' + encodeURIComponent(word) + ':' + (cursor || 'first'), force === true, first, async () => {
      const result = await deps.readTopic(word, state?.seen || [])
      const posts = normalizeXTopicPosts(result.posts).filter((post) => !state?.seen.includes(post.id))
      if (!cursor && posts.length > 1) {
        posts.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
      }
      const seen = [...(state?.seen || []), ...posts.map((post) => post.id)]
      const more = normalizeXTopicPosts(result.more).filter((post) => !seen.includes(post.id))
      const hasMore = posts.length > 0 && (result.hasMoreHint === true || more.length > 0) && page < 3
      let nextCursor: string | undefined
      if (hasMore) {
        nextCursor = deps.token?.() || crypto.randomUUID()
        if (cursors.size >= 100) cursors.delete(cursors.keys().next().value!)
        cursors.set(nextCursor, { word, page: page + 1, seen, expires: now() + X_CURSOR_TTL_MS })
      }
      return { ok: true, posts, updatedAt: now(), cursor, nextCursor, hasMore }
    })
  }
  return { hot, topic }
}
