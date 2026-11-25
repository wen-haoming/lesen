import type { Platform } from './config'

export type SourceSpec =
  | { platform: Platform; id: string; handle?: string }
  | { error: 'EMPTY' | 'BAD_X_HANDLE' | 'UNRECOGNIZED' }

/** 与旧 popup.js peekSourceInput 行为对齐，并支持微博主页链接 / weibo:uid */
export function peekSourceInput(raw: string): SourceSpec {
  const text = String(raw || '').trim()
  if (!text) return { error: 'EMPTY' }

  const weiboPrefixed = text.match(/^weibo[:/](\d{5,})$/i)
  if (weiboPrefixed) return { platform: 'weibo', id: weiboPrefixed[1] }
  const xueqiuPrefixed = text.match(/^xueqiu[:/](\d{5,})$/i)
  if (xueqiuPrefixed) return { platform: 'xueqiu', id: xueqiuPrefixed[1] }
  const xPrefixed = text.match(/^x[:/]([A-Za-z0-9_]{1,15})$/i)
  if (xPrefixed) return { platform: 'x', id: xPrefixed[1].toLowerCase() }
  if (/^[a-z0-9_-]+:/i.test(text) && !/^https?:/i.test(text)) {
    return { error: 'UNRECOGNIZED' }
  }

  if (
    /^x\.com\//i.test(text) ||
    /^twitter\.com\//i.test(text) ||
    /^weibo\.com\//i.test(text) ||
    /^m\.weibo\.cn\//i.test(text) ||
    /^https?:\/\//i.test(text)
  ) {
    try {
      const url = new URL(text.includes('://') ? text : 'https://' + text)
      const host = url.hostname.replace(/^www\./, '')
      if (host === 'x.com' || host === 'twitter.com') {
        const handle = url.pathname.split('/').filter(Boolean)[0]
        if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== 'i') {
          return { platform: 'x', id: handle.toLowerCase() }
        }
      }
      if (host === 'weibo.com' || host.endsWith('.weibo.com') || host === 'm.weibo.cn') {
        const parts = url.pathname.split('/').filter(Boolean)
        // /u/123456 /n/昵称 忽略昵称路径；优先数字 uid
        if (parts[0] === 'u' && /^\d{5,}$/.test(parts[1] || '')) {
          return { platform: 'weibo', id: parts[1] }
        }
        if (parts[0] === 'profile' && /^\d{5,}$/.test(parts[1] || '')) {
          return { platform: 'weibo', id: parts[1] }
        }
        if (/^\d{5,}$/.test(parts[0] || '')) {
          return { platform: 'weibo', id: parts[0] }
        }
      }
      const m = url.pathname.match(/(?:\/u)?\/(\d+)/)
      if ((host === 'xueqiu.com' || host.endsWith('.xueqiu.com')) && m) {
        return { platform: 'xueqiu', id: m[1] }
      }
      return { error: 'UNRECOGNIZED' }
    } catch {
      /* fall through */
    }
  }
  if (text.startsWith('@')) {
    const handle = text.slice(1).trim().toLowerCase()
    if (/^[a-z0-9_]{1,15}$/.test(handle)) return { platform: 'x', id: handle }
    return { error: 'BAD_X_HANDLE' }
  }
  if (/^[a-z0-9_]{1,15}$/i.test(text) && /[a-z_]/i.test(text)) {
    return { platform: 'x', id: text.toLowerCase() }
  }
  const digits = text.match(/(\d{5,})/)
  if (digits) return { platform: 'xueqiu', id: digits[1] }
  return { error: 'UNRECOGNIZED' }
}
