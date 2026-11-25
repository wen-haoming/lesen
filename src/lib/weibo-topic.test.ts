import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { normalizeWeiboHotItems } from './weibo-hot'
import { sanitizeFeedPost } from './sanitize'
import { inspectRisk } from './platform-request-risk'
import { createWeiboTopicFetcher, parseWeiboTopicData, validWeiboTopicParams, weiboTopicUrl } from './weibo-topic'

const word = '今天的晚霞'
const post = (id = '456') => ({
  id, userId: '123', authorName: '作者', summary: '真实正文', timestamp: 100,
  url: 'javascript:alert(1)', quoted: { authorName: '原作者', text: '原文', url: 'http://weibo.com/123/789', likeCount: 1 },
  mediaUrls: ['javascript:alert(1)', 'https://wx1.sinaimg.cn/large/example.jpg']
})
const response = (cards: unknown[] = [{ card_type: 11, card_group: [{ card_type: 9, mblog: post() }] }], extra = {}) => ({ ok: 1, data: { cards, ...extra } })
const normalize = (value: unknown) => value

function harness() {
  let now = 1_000_000
  let items = [{ word }]
  const store: Record<string, any> = {}
  const request = vi.fn(async (_url: string): Promise<unknown> => response())
  const writeCache = vi.fn(async (key: string, value: unknown) => { store[key] = structuredClone(value) })
  const deps = {
    getHotItems: async () => items, request, normalizePost: normalize,
    readCache: async (key: string) => store[key], writeCache, now: () => now
  }
  return {
    fetch: createWeiboTopicFetcher(deps), restart: () => createWeiboTopicFetcher(deps), request, store, writeCache,
    advance: (ms: number) => { now += ms }, removeWord: () => { items = [] }
  }
}

describe('微博话题后台接线', () => {
  it('复用真实微博归一化、移动端请求及独立持久化，不请求个人数据或广播', async () => {
    const source = readFileSync(new URL('./background-main.js', import.meta.url), 'utf8')
    const store: Record<string, any> = { weiboHotCache: { items: [{ rank: 1, word, heat: 10 }], updatedAt: Date.now() } }
    const request = vi.fn(async () => response([{
      card_type: 11, card_group: [{
        mblog: {
          id: '456', mid: '456', user: { id: '12345', screen_name: '真实作者' }, text: '<b>晚霞正文</b>',
          created_at: '2026-11-16T12:00:00Z', attitudes_count: 42,
          pics: [{ large: { url: 'https://wx1.sinaimg.cn/large/example.jpg' } }],
          retweeted_status: { id: '789', user: { id: '67890', screen_name: '原作者' }, text: '转发原文' },
        }
      }]
    }]))
    const broadcast = vi.fn()
    const personal = vi.fn()
    const viaTab = vi.fn()
    const context = createContext({
      Date, URL, encodeURIComponent, createWeiboTopicFetcher,
      normalizeWeiboHotItems, sanitizeFeedPost, fetchWeiboJson: request, fetchWeiboJsonViaTab: viaTab,
      guardedRequestBackoff: new Map(), riskDetails: inspectRisk, registerPlatformRisk: vi.fn(),
      broadcast, fetchWeiboTimeline: personal,
      chrome: {
        storage: {
          local: {
            get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, store[key]])),
            set: async (values: any) => { Object.assign(store, values) },
          }
        }
      },
    })
    runInContext(source.slice(source.indexOf('function pickWeiboUid('), source.indexOf('async function fetchWeiboSelfUid(')), context)
    runInContext(source.slice(source.indexOf('function weiboAvatarUrl('), source.indexOf('function mapWeiboFollowUser(')), context)
    runInContext(source.slice(source.indexOf('function stripWeiboHtml('), source.indexOf('function weiboCardlistSinceId(')), context)
    runInContext(source.slice(source.indexOf('const WEIBO_HOT_CACHE_KEY ='), source.indexOf('function isTrustedExtensionPageSender')), context)
    context.input = { word, page: 2 }
    const result = await runInContext('fetchWeiboTopic(input)', context)
    expect(result).toMatchObject({
      ok: true, page: 2, posts: [{
        userId: '12345', authorName: '真实作者', summary: '晚霞正文',
        likeCount: 42, quoted: { authorName: '原作者', text: '转发原文' }
      }]
    })
    expect(request).toHaveBeenCalledWith(weiboTopicUrl(word, 2), 'https://m.weibo.cn/')
    expect(Object.keys(store)).toEqual(['weiboHotCache', `weiboTopicCache:${encodeURIComponent(word)}:2`])
    expect(personal).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(viaTab).not.toHaveBeenCalled()
    expect(source).toContain('if (message.type === "POPUP_WEIBO_TOPIC")')
  })
})

describe('微博话题解析和安全', () => {
  it('递归提取微博并去重，保留正文媒体及原帖但拒绝危险链接', () => {
    const result = parseWeiboTopicData(response([
      { card_type: 11, card_group: [{ card_group: [{ mblog: post() }, { mblog: post() }] }] },
      { card_type: 8, title: '非微博卡片' }, { mblog: post('789') }, { mblog: post('../evil') },
    ]), 1, normalize)
    expect(result.posts.map((item) => item.id)).toEqual(['456', '789'])
    expect(result.posts[0]).toMatchObject({ platform: 'weibo', summary: '真实正文', url: 'https://weibo.com/123/456', quoted: { url: '' } })
    expect(result.posts[0].mediaUrls).toEqual(['https://wx1.sinaimg.cn/large/example.jpg'])
    expect(result.hasMore).toBe(true)
  })
  it('真实空页终止分页，非微博卡片及错误响应不能当空成功', () => {
    expect(parseWeiboTopicData(response([]), 3, normalize)).toEqual({ posts: [], hasMore: false })
    for (const value of [response([{ card_type: 8 }]), { ok: 1, data: {} }, { ok: 0 }, response([{ mblog: post('../evil') }])]) {
      expect(() => parseWeiboTopicData(value, 1, normalize)).toThrow()
    }
    expect(() => parseWeiboTopicData({ ok: -100 }, 2, normalize)).toThrow()
  })
  it('遵守明确的分页元数据，不以卡片数量猜测最后一页', () => {
    expect(parseWeiboTopicData(response(undefined, { cardlistInfo: { has_more: 0 } }), 1, normalize).hasMore).toBe(false)
    expect(parseWeiboTopicData(response(undefined, { pageInfo: { total_pages: 2 } }), 2, normalize).hasMore).toBe(false)
    expect(parseWeiboTopicData(response(undefined, { pageInfo: { total_pages: 2 } }), 1, normalize).hasMore).toBe(true)
  })
  it('校验长度、控制字符、页码和刷新参数，完整编码搜索词', () => {
    for (const input of [{ word: '' }, { word: 'a'.repeat(101) }, { word: '<script>' }, { word: '控制\u0001字符' },
    { word, page: 0 }, { word, page: 1.1 }, { word, page: '2' }, { word, page: Infinity }, { word, force: 1 }, { word: ' 晚霞' }]) {
      expect(validWeiboTopicParams(input)).toBe(false)
    }
    expect(validWeiboTopicParams({ word, page: 2, force: true })).toBe(true)
    const url = new URL(weiboTopicUrl('晚霞 & #内容', 2))
    expect(url.hostname).toBe('m.weibo.cn')
    expect(url.searchParams.get('containerid')).toBe('100103type=61&q=晚霞 & #内容')
    expect(url.searchParams.get('page')).toBe('2')
    expect([...url.searchParams.keys()]).toEqual(['containerid', 'page'])
  })
})

describe('微博话题白名单与独立缓存', () => {
  it('只允许当前真实榜单词，拒绝非法输入且不发请求', async () => {
    const h = harness()
    for (const input of [{ word: '任意词' }, { word, page: -1 }, { word, force: 'yes' }]) expect((await h.fetch(input)).ok).toBe(false)
    expect(h.request).not.toHaveBeenCalled()
    await h.fetch({ word })
    h.removeWord()
    expect(await h.fetch({ word })).toMatchObject({ ok: false, posts: [], error: '话题不在当前微博热搜榜单中' })
    expect(h.request).toHaveBeenCalledTimes(1)
  })
  it('合并同页并发，按话题页独立缓存，普通两分钟强刷十秒', async () => {
    const h = harness()
    const a = h.fetch({ word })
    const b = h.fetch({ word, force: true })
    expect(a).toBe(b)
    expect(await a).toMatchObject({ ok: true, page: 1, hasMore: true })
    expect(h.request).toHaveBeenCalledTimes(1)
    h.advance(9_000)
    expect(await h.fetch({ word, force: true })).toMatchObject({ cached: true, retryAfterMs: 1000 })
    h.advance(1000)
    await h.fetch({ word })
    expect(h.request).toHaveBeenCalledTimes(1)
    await h.fetch({ word, force: true })
    await h.fetch({ word, page: 2 })
    expect(h.request).toHaveBeenCalledTimes(3)
    expect(h.request.mock.calls[2][0]).toBe(weiboTopicUrl(word, 2))
    expect(Object.keys(h.store)).toEqual([`weiboTopicCache:${encodeURIComponent(word)}:1`, `weiboTopicCache:${encodeURIComponent(word)}:2`])
    h.advance(120_000)
    await h.fetch({ word })
    expect(h.request).toHaveBeenCalledTimes(4)
  })
  it('失败保留旧帖子和时间戳，持久化登录及冷却，强刷不绕过', async () => {
    const h = harness()
    const first = await h.fetch({ word })
    h.advance(120_000)
    h.request.mockRejectedValueOnce(Object.assign(new Error('需要登录'), { needsLogin: true, retryAfterMs: 300_000 }))
    const failed = await h.fetch({ word, force: true })
    expect(failed).toMatchObject({ ok: false, posts: first.posts, updatedAt: first.updatedAt, stale: true, needsLogin: true, retryAfterMs: 300_000 })
    const restart = h.restart()
    expect(await restart({ word, force: true })).toMatchObject({ ok: false, stale: true, cached: true, needsLogin: true, retryAfterMs: 300_000 })
    expect(h.request).toHaveBeenCalledTimes(2)
  })
  it('冷启动失败也冷却，验证码不伪装为登录或成功', async () => {
    const h = harness()
    h.request.mockRejectedValueOnce(Object.assign(new Error('验证码'), { platformPause: true, retryAfterMs: 300_000 }))
    expect(await h.fetch({ word })).toMatchObject({ ok: false, posts: [], updatedAt: 0, needsLogin: false, error: '平台暂时限制了请求，请稍后再试' })
    expect(await h.restart()({ word, force: true })).toMatchObject({ ok: false, retryAfterMs: 300_000 })
    expect(h.request).toHaveBeenCalledTimes(1)
  })
  it('真实空页可缓存，后续读取仍终止分页', async () => {
    const h = harness()
    h.request.mockResolvedValueOnce(response([]))
    expect(await h.fetch({ word, page: 3 })).toMatchObject({ ok: true, posts: [], page: 3, hasMore: false })
    expect(await h.fetch({ word, page: 3 })).toMatchObject({ ok: true, cached: true, hasMore: false })
    expect(h.request).toHaveBeenCalledTimes(1)
  })
})
