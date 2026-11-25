/** 时间线卡片类型映射与降级（纯函数，供 Timeline / 单测） */

import type { Post, Quote } from './sanitize'
import { parseReplyHandle } from './post-media'
import { splitForwardChain, type ChainEntry } from './rich-text'

export type CardKind = 'original' | 'retweet' | 'quote' | 'reply'

export type CardModel = {
  kind: CardKind
  /** 弱提示，如「某某 转发了」 */
  hint: string
  /** 回复提示，如「回复 @某人」 */
  replyLabel: string
  /** 主正文（当前作者说的话）；纯转发时可为空，原帖走 embed */
  body: string
  /** 内嵌原帖；缺失时 unavailable=true 且不编造正文 */
  embed: { authorName: string; text: string; unavailable: boolean; mediaUrls: string[] } | null
  mediaUrls: string[]
  /** 雪球 `//@某人:` 转发链，从正文拆出，按对话层级展示 */
  chain: ChainEntry[]
}

export {
  extractReplyHandleFromText,
  isVideoUrl,
  parseReplyHandle,
  sanitizeMediaUrls,
} from './post-media'

export function quoteIsUnavailable(quoted: Quote | null | undefined): boolean {
  if (!quoted) return true
  const text = String(quoted.text || '').trim()
  const name = String(quoted.authorName || '').trim()
  const hasMedia = Array.isArray(quoted.mediaUrls) && quoted.mediaUrls.some(Boolean)
  return !text && !name && !hasMedia
}

/** 卡片正文优先用 summary；忽略「转发了 @」等合成 title，避免纯转发被误判成带评 */
function cardBodyText(post: Post): string {
  const summary = String(post.summary || '').trim()
  if (summary) return summary
  const title = String(post.title || '').trim()
  if (!title || title === '无标题') return ''
  if (/^转发(了|动态)/.test(title)) return ''
  return title
}

export function classifyPostCard(post: Post): CardModel {
  const card = classifyPostCardBase(post)
  if (!card.body) return card
  const { own, chain } = splitForwardChain(card.body, [post.authorName, post.feedName || ''])
  return chain.length ? { ...card, body: own, chain } : card
}

function classifyPostCardBase(post: Post): CardModel {
  const bodyFull = cardBodyText(post)
  const mediaUrls = Array.isArray(post.mediaUrls) ? post.mediaUrls.filter(Boolean) : []
  const quoted = post.quoted
  const unavailable = quoteIsUnavailable(quoted)
  const quoteMedia = Array.isArray(quoted?.mediaUrls) ? quoted!.mediaUrls!.filter(Boolean) : []

  const replyFromField = String(post.replyToHandle || '').trim()
  const replyParsed = parseReplyHandle(bodyFull)
  const replyHandle = replyFromField || replyParsed?.handle || ''
  const bodyAfterReply = replyParsed ? replyParsed.rest : bodyFull

  if (replyHandle) {
    const missing = unavailable || !!post.quoteMissing
    return {
      kind: 'reply',
      hint: '',
      replyLabel: '回复 @' + replyHandle,
      body: bodyAfterReply || (!replyParsed ? bodyFull : ''),
      embed:
        quoted || post.quoteMissing
          ? {
              authorName: String(quoted?.authorName || ''),
              text: missing ? '' : String(quoted?.text || ''),
              unavailable: missing,
              mediaUrls: quoteMedia,
            }
          : null,
      mediaUrls,
      chain: [],
    }
  }

  const retweetHint = (post.authorName || post.feedName || '用户') + ' 转发了'

  // 纯转发：无自身评论 → 弱提示 + 原帖作主体（嵌套或正文）
  if (post.isRetweet && !bodyFull) {
    const missing = unavailable || !!post.quoteMissing
    return {
      kind: 'retweet',
      hint: retweetHint,
      replyLabel: '',
      body: '',
      embed: {
        authorName: String(quoted?.authorName || ''),
        text: missing ? '' : String(quoted?.text || ''),
        unavailable: missing,
        mediaUrls: quoteMedia,
      },
      mediaUrls: [],
      chain: [],
    }
  }

  // X 等路径：isRetweet 但正文即原帖、无独立 quoted → 弱提示 + 正文为主体
  if (post.isRetweet && bodyFull && !quoted && !post.quoteMissing) {
    return {
      kind: 'retweet',
      hint: retweetHint,
      replyLabel: '',
      body: bodyFull,
      embed: null,
      mediaUrls,
      chain: [],
    }
  }

  // 带评引用 / 带评转发 / 标明原帖缺失
  if (quoted || post.quoteMissing) {
    const missing = unavailable || !!post.quoteMissing
    return {
      kind: missing && !bodyFull ? 'retweet' : 'quote',
      hint: missing && !bodyFull ? retweetHint : '',
      replyLabel: '',
      body: bodyFull,
      embed: {
        authorName: String(quoted?.authorName || ''),
        text: missing ? '' : String(quoted?.text || ''),
        unavailable: missing,
        mediaUrls: quoteMedia,
      },
      mediaUrls,
      chain: [],
    }
  }

  return {
    kind: 'original',
    hint: '',
    replyLabel: '',
    body: bodyFull,
    embed: null,
    mediaUrls,
    chain: [],
  }
}
