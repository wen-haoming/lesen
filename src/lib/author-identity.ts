/**
 * 雪球目标作者身份绑定：鉴权用户（viewer）与订阅目标（target）必须分离。
 * 纯函数，供单测与 background 逻辑对齐。
 */

export type XueqiuProfileUser = {
  id?: string | number
  user_id?: string | number
  screen_name?: string
  name?: string
  nickname?: string
  [key: string]: unknown
}

export type BoundXueqiuSource = {
  platform: 'xueqiu'
  id: string
  name: string
  avatar: string
}

export type CandidateHint = {
  id?: string
  name?: string
  avatar?: string
}

/** 从 show.json 类响应里取出「用户对象」，避免把整包 session/列表当作用户 */
export function pickUserFromProfilePayload(data: unknown): XueqiuProfileUser | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  if (root.user && typeof root.user === 'object') return root.user as XueqiuProfileUser
  const nested = root.data
  if (nested && typeof nested === 'object') {
    const d = nested as Record<string, unknown>
    if (d.user && typeof d.user === 'object') return d.user as XueqiuProfileUser
    if (d.id != null || d.user_id != null || d.screen_name || d.name) {
      return d as XueqiuProfileUser
    }
  }
  // 顶层仅在有身份字段且不像列表包装时采用
  if (
    (root.id != null || root.user_id != null) &&
    (root.screen_name || root.name || root.nickname) &&
    !Array.isArray(root.statuses) &&
    !Array.isArray(root.list) &&
    !Array.isArray(root.users)
  ) {
    return root as XueqiuProfileUser
  }
  return null
}

export function readProfileUserId(user: XueqiuProfileUser | null | undefined): string {
  if (!user) return ''
  const id = user.id ?? user.user_id
  return id == null ? '' : String(id).trim()
}

/**
 * 将 profile 用户绑定到「请求的目标 uid」。
 * 返回 id 必须严格等于 requestedUid；不匹配则拒绝（禁止写成 viewer）。
 */
export function bindXueqiuProfileToTarget(
  requestedUid: string,
  user: XueqiuProfileUser | null,
  avatarFromUser: string = '',
): { ok: true; source: BoundXueqiuSource } | { ok: false; error: 'PROFILE_MISMATCH' | 'PROFILE_EMPTY' | 'BAD_TARGET' } {
  const want = String(requestedUid || '').trim()
  if (!/^\d+$/.test(want)) return { ok: false, error: 'BAD_TARGET' }
  if (!user) return { ok: false, error: 'PROFILE_EMPTY' }
  const got = readProfileUserId(user)
  if (!got || got !== want) return { ok: false, error: 'PROFILE_MISMATCH' }
  const name = String(user.screen_name ?? user.name ?? user.nickname ?? '').trim()
  if (!name) return { ok: false, error: 'PROFILE_EMPTY' }
  return {
    ok: true,
    source: {
      platform: 'xueqiu',
      id: want,
      name,
      avatar: String(avatarFromUser || '').slice(0, 500),
    },
  }
}

/**
 * profile 不可用时：仅当 hint.id === 目标 uid 时保留候选元数据；
 * 绝不使用 viewerAccount 顶替。
 */
export function resolveXueqiuSourceFallback(
  requestedUid: string,
  hint?: CandidateHint | null,
  viewerAccountId?: string | null,
): { ok: true; source: BoundXueqiuSource } | { ok: false; error: string } {
  const want = String(requestedUid || '').trim()
  if (!/^\d+$/.test(want)) return { ok: false, error: 'BAD_TARGET' }
  const viewer = String(viewerAccountId || '').trim()
  if (viewer && viewer === want) {
    // 允许订阅自己，但必须来自明确的目标 id，不是静默替换
  }
  const hintId = String(hint?.id || '').trim()
  if (hintId && hintId === want && String(hint?.name || '').trim()) {
    return {
      ok: true,
      source: {
        platform: 'xueqiu',
        id: want,
        name: String(hint?.name).trim(),
        avatar: String(hint?.avatar || '').slice(0, 500),
      },
    }
  }
  // 无可靠昵称时仍锁定目标 id，禁止换成 viewer
  return {
    ok: true,
    source: {
      platform: 'xueqiu',
      id: want,
      name: '用户 ' + want,
      avatar: '',
    },
  }
}

/** 登录恢复不得用 account.id 覆盖已选 source 的 id */
export function shouldPreserveSelectedSource(
  selectedFeedKey: string,
  sources: Array<{ platform?: string; id?: string }>,
  accountId: string,
): boolean {
  const key = String(selectedFeedKey || '')
  if (!key || key === '__all__') return true
  const mine = sources.some((s) => {
    const sk = String(s.platform || 'xueqiu') + ':' + String(s.id || '')
    return sk === key
  })
  if (!mine) return false
  // 即使 accountId 与某个关注相同，已持久化的 source 键仍应保留
  void accountId
  return true
}

/** 乱序响应：仅当请求 token 仍是最新时才应用结果 */
export function shouldApplyAsyncResult(requestToken: number, latestToken: number): boolean {
  return requestToken === latestToken
}
