import { describe, expect, it } from 'vitest'
import {
  bindXueqiuProfileToTarget,
  pickUserFromProfilePayload,
  resolveXueqiuSourceFallback,
  shouldApplyAsyncResult,
  shouldPreserveSelectedSource,
} from './author-identity'

const VIEWER = '900001'
const TARGET = '1247347556'

describe('xueqiu author identity binding', () => {
  it('rejects profile whose id is the viewer, not the requested target', () => {
    const user = pickUserFromProfilePayload({
      user: { id: VIEWER, screen_name: '浩明啦' },
    })
    const bound = bindXueqiuProfileToTarget(TARGET, user, '')
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.error).toBe('PROFILE_MISMATCH')
  })

  it('accepts profile only when returned id equals requested uid', () => {
    const user = pickUserFromProfilePayload({
      data: { user: { id: TARGET, screen_name: '大道无形我有型' } },
    })
    const bound = bindXueqiuProfileToTarget(TARGET, user, 'https://xavatar.imedao.com/a.jpg')
    expect(bound.ok).toBe(true)
    if (bound.ok) {
      expect(bound.source.id).toBe(TARGET)
      expect(bound.source.name).toContain('大道')
      expect(bound.source.id).not.toBe(VIEWER)
    }
  })

  it('does not treat list/session wrapper as the user when nested user missing', () => {
    const user = pickUserFromProfilePayload({
      statuses: [],
      id: VIEWER,
      screen_name: '浩明啦',
      list: [1],
    })
    // has list array → should not use top-level as user
    expect(user).toBeNull()
  })

  it('fallback keeps candidate hint for target; never substitutes viewer', () => {
    const ok = resolveXueqiuSourceFallback(TARGET, {
      id: TARGET,
      name: '大道无形我有型',
      avatar: '',
    }, VIEWER)
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.source.id).toBe(TARGET)
      expect(ok.source.name).toBe('大道无形我有型')
    }
    const noHint = resolveXueqiuSourceFallback(TARGET, { id: VIEWER, name: '浩明啦' }, VIEWER)
    expect(noHint.ok).toBe(true)
    if (noHint.ok) {
      expect(noHint.source.id).toBe(TARGET)
      expect(noHint.source.name).not.toBe('浩明啦')
    }
  })

  it('login recovery preserves selected source key even when account id differs', () => {
    const sources = [{ platform: 'xueqiu', id: TARGET, name: '大道' }]
    expect(shouldPreserveSelectedSource('xueqiu:' + TARGET, sources, VIEWER)).toBe(true)
    expect(shouldPreserveSelectedSource('xueqiu:' + VIEWER, sources, VIEWER)).toBe(false)
  })

  it('ignores stale async results when a newer request is in flight', () => {
    expect(shouldApplyAsyncResult(1, 2)).toBe(false)
    expect(shouldApplyAsyncResult(3, 3)).toBe(true)
  })
})
