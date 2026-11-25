/** 平台登录痕迹检测（不记录、不展示 cookie 值） */

export type PlatformLoginStatus = 'checking' | 'logged-in' | 'logged-out' | 'unknown' | 'error'

export type PlatformSessions = {
  xueqiu: PlatformLoginStatus
  x: PlatformLoginStatus
  weibo: PlatformLoginStatus
}

const X_SESSION_COOKIE_NAMES = ['auth_token', 'ct0', 'twid'] as const
const XUEQIU_SESSION_COOKIE_NAMES = ['u', 'xq_is_login', 'xq_a_token'] as const
/** 微博登录痕迹：SUB 为会话主体；XSRF-TOKEN 用于 ajax 头，单独不足以判定登录 */
const WEIBO_SESSION_COOKIE_NAMES = ['SUB', 'XSRF-TOKEN', 'SUBP', 'WBPSESS'] as const
export function classifyXueqiuSession(input: {
  readable: boolean
  uid?: string
  hasLoginFlag?: boolean
  hasToken?: boolean
}): PlatformLoginStatus {
  if (!input.readable) return 'unknown'
  if (input.uid || input.hasLoginFlag) return 'logged-in'
  if (input.hasToken) return 'unknown'
  return 'logged-out'
}

/** 仅根据 cookie 名是否存在判定，不接收/不返回 cookie 值 */
export function classifyXSessionFromNames(names: string[], readable: boolean): PlatformLoginStatus {
  if (!readable) return 'unknown'
  const set = new Set(names.map((n) => String(n || '')))
  const hasAuth = X_SESSION_COOKIE_NAMES.some((n) => set.has(n))
  return hasAuth ? 'logged-in' : 'logged-out'
}

/** 有 SUB 视为已登录；仅有 XSRF 等附属 cookie 视为未知/未登录 */
export function classifyWeiboSessionFromNames(
  names: string[],
  readable: boolean,
): PlatformLoginStatus {
  if (!readable) return 'unknown'
  const set = new Set(names.map((n) => String(n || '')))
  if (set.has('SUB')) return 'logged-in'
  if (WEIBO_SESSION_COOKIE_NAMES.some((n) => n !== 'SUB' && set.has(n))) return 'unknown'
  return 'logged-out'
}

export function shouldShowLoginCta(status: PlatformLoginStatus): boolean {
  return status === 'logged-out'
}

export {
  X_SESSION_COOKIE_NAMES,
  XUEQIU_SESSION_COOKIE_NAMES,
  WEIBO_SESSION_COOKIE_NAMES,
}
