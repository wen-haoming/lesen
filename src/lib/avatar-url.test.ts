import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { sanitizeFeedPost } from './sanitize'
import { parseWeiboTopicData } from './weibo-topic'
import { describe, expect, it } from 'vitest'
import { isPackagedAssetPath, normalizeAvatarCandidates, pickAvatarSrc } from './avatar-url'
import { xueqiuAvatarUrl } from './config'
import { postsFromFxTwitter } from './fxtwitter-posts.js'

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/fixtures')
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

const avatar = 'https://pbs.twimg.com/profile_images/1/author_normal.jpg'
const avatarFeeds = [
  { key: 'x:author', post: { id: '456', userId: 'x:author' } },
  { key: 'weibo:123', post: { id: '456', userId: '123' } },
  { key: 'xueqiu:123', post: { id: '456', userId: '123' } },
]

describe('帖子作者头像链路', () => {
  it.each(avatarFeeds)('$key 清洗后保留 HTTPS 头像及二次缓存清洗结果', ({ key, post }) => {
    const clean = sanitizeFeedPost({ ...post, authorAvatar: avatar }, key)
    expect(clean?.authorAvatar).toBe(avatar)
    expect(sanitizeFeedPost(clean, key)?.authorAvatar).toBe(avatar)
  })

  it.each(avatarFeeds)('$key 拒绝非 HTTPS、畸形及带凭据头像且不丢弃帖子', ({ key, post }) => {
    for (const authorAvatar of [undefined, '', 'javascript:alert(1)', 'http://example.com/a.jpg',
      '//example.com/a.jpg', '/avatar.jpg', 'https://', 'data:image/png;base64,AA',
      'https://user:password@example.com/a.jpg', { url: avatar }]) {
      const clean = sanitizeFeedPost({ ...post, authorAvatar }, key)
      expect(clean).not.toBeNull()
      expect(clean?.authorAvatar).toBeUndefined()
    }
  })

  it('微博真实作者头像经过后台归一化与话题清洗后仍可显示', () => {
    const source = fs.readFileSync(new URL('./background-main.js', import.meta.url), 'utf8')
    const context = createContext({ URL, Date, encodeURIComponent })
    runInContext(source.slice(source.indexOf('function pickWeiboUid('), source.indexOf('async function fetchWeiboSelfUid(')), context)
    runInContext(source.slice(source.indexOf('function stripWeiboHtml('), source.indexOf('function weiboCardlistSinceId(')), context)
    runInContext(source.slice(source.indexOf('function weiboAvatarUrl('), source.indexOf('function mapWeiboFollowUser(')), context)
    context.status = { id: '456', user: { id: '12345', screen_name: '真实作者',
      avatar_hd: 'https://tvax1.sinaimg.cn/crop.0.0.100.100/avatar.jpg' }, text: '晚霞正文' }
    const normalized = runInContext('minimalWeiboPost(status)', context)
    const result = parseWeiboTopicData({ ok: 1, data: { cards: [{ mblog: normalized }] } }, 1, (post) => post)
    expect(result.posts[0].authorAvatar).toBe(context.status.user.avatar_hd)
    context.status.user.avatar_hd = 'javascript:alert(1)'
    const invalid = runInContext('minimalWeiboPost(status)', context)
    expect(parseWeiboTopicData({ ok: 1, data: { cards: [{ mblog: invalid }] } }, 1, (post) => post).posts[0].authorAvatar).toBeUndefined()
  })

  it('X 转发保留实际作者头像而非转发者头像，并通过清洗过滤非法值', () => {
    for (const value of [avatar, 'javascript:alert(1)', 'http://example.com/a.jpg']) {
      const posts = postsFromFxTwitter({ results: [{ type: 'status', id: '456', text: '真实正文', created_timestamp: 100,
        author: { name: '实际作者', avatar_url: value }, reposted_by: { name: '转发者', avatar_url: 'https://example.com/reposter.jpg' } }] }, 'feedowner')!
      expect(posts[0].authorAvatar).toBe(value)
      expect(sanitizeFeedPost(posts[0], 'x:feedowner')?.authorAvatar).toBe(value === avatar ? avatar : undefined)
    }
  })

  it('时间线优先使用帖子头像，缺失时回退订阅头像', () => {
    const source = fs.readFileSync(new URL('../popup/components/Timeline.tsx', import.meta.url), 'utf8')
    expect(source).toContain('avatar={post.authorAvatar || person?.avatar}')
  })
})

describe('avatar url mapping', () => {
  it('keeps https xueqiu and upgrades http', () => {
    expect(pickAvatarSrc('https://xavatar.imedao.com/community/foo.jpg', 'xueqiu')).toContain(
      'https://xavatar.imedao.com/community/foo.jpg',
    )
    expect(pickAvatarSrc('http://xavatar.imedao.com/a.png', 'xueqiu')).toMatch(/^https:\/\//)
  })

  it('prefixes relative xueqiu avatar paths via xavatar host', () => {
    const urls = normalizeAvatarCandidates('/community/bar.jpg', 'xueqiu')
    expect(urls[0]).toBe('https://xavatar.imedao.com/community/bar.jpg')
    expect(xueqiuAvatarUrl('/community/bar.jpg')).toBe('https://xavatar.imedao.com/community/bar.jpg')
  })

  it('splits comma-joined xueqiu avatar paths into one https src', () => {
    const dirty =
      'https://xavatar.imedao.com/community/20263/a.jpg,community/20263/a.jpg!180x180.png,community/20263/a.jpg!50x50.png'
    expect(xueqiuAvatarUrl(dirty)).toBe(
      'https://xavatar.imedao.com/community/20263/a.jpg!180x180.png',
    )
    expect(pickAvatarSrc(dirty, 'xueqiu')).toBe(
      'https://xavatar.imedao.com/community/20263/a.jpg!180x180.png',
    )
    expect(
      xueqiuAvatarUrl({
        photo_domain: '//xavatar.imedao.com',
        profile_image_url:
          'community/20264/x.png,community/20264/x.png!240x240.jpg,community/20264/x.png!50x50.jpg',
      }),
    ).toBe('https://xavatar.imedao.com/community/20264/x.png!240x240.jpg')
    expect(
      xueqiuAvatarUrl('//xavatar.imedao.com/community/20264/1778741556408-1778741556812.png!240x240.jpg'),
    ).toBe('https://xavatar.imedao.com/community/20264/1778741556408-1778741556812.png!240x240.jpg')
  })

  it('keeps packaged fixture paths local (not xavatar)', () => {
    expect(isPackagedAssetPath('fixtures/avatar-demo-xq.svg')).toBe(true)
    expect(isPackagedAssetPath('/fixtures/avatar-demo-xq.svg')).toBe(true)
    expect(pickAvatarSrc('fixtures/avatar-demo-xq.svg', 'xueqiu')).toBe('/fixtures/avatar-demo-xq.svg')
    expect(pickAvatarSrc('/fixtures/avatar-demo-xq.svg', 'xueqiu')).toBe('/fixtures/avatar-demo-xq.svg')
    expect(xueqiuAvatarUrl('fixtures/avatar-demo-xq.svg')).toBe('/fixtures/avatar-demo-xq.svg')
    expect(xueqiuAvatarUrl('/fixtures/avatar-demo-xq.svg')).toBe('/fixtures/avatar-demo-xq.svg')
    expect(pickAvatarSrc('/fixtures/avatar-demo-x.svg', 'x')).toBe('/fixtures/avatar-demo-x.svg')
  })

  it('expands X size variants without inventing hosts', () => {
    const urls = normalizeAvatarCandidates('https://pbs.twimg.com/profile_images/1/a_normal.jpg', 'x')
    expect(urls[0]).toContain('_normal')
    expect(urls.some((u) => u.includes('_bigger'))).toBe(true)
  })

  it('falls back to empty when missing or invalid for X', () => {
    expect(pickAvatarSrc('', 'x')).toBe('')
    expect(pickAvatarSrc('not-a-url', 'x')).toBe('')
  })

  it('packs well-formed fixture SVGs without XML control chars', () => {
    for (const name of ['avatar-demo-xq.svg', 'avatar-demo-x.svg', 'avatar-demo-x2.svg']) {
      const text = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
      expect(text.startsWith('<svg')).toBe(true)
      expect(CTRL.test(text)).toBe(false)
      expect(text).toContain('aria-label="Demo')
    }
  })
})
