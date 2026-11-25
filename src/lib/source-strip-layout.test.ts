import { describe, expect, it } from 'vitest'
import {
  SOURCE_AVATAR_GAP_MAX,
  resolveSourceStripLayout,
  sourceAvatarGap,
  sourceRowWidth,
  visibleSourceRange,
} from './source-strip-layout'

describe('source strip layout', () => {
  it('keeps 28px avatars while the row fits', () => {
    const available = sourceRowWidth(4, 28)
    expect(resolveSourceStripLayout(4, available)).toMatchObject({
      size: 28,
      gap: sourceAvatarGap(28),
      visibleCount: 4,
      overflow: false,
      chipWidth: 0,
    })
  })

  it('spreads a short row into the spare width, up to a cap', () => {
    const open = resolveSourceStripLayout(3, sourceRowWidth(3, 28) + 80)
    expect(open.size).toBe(28)
    expect(open.overflow).toBe(false)
    expect(open.gap).toBeGreaterThan(sourceAvatarGap(28))
    expect(open.gap).toBeLessThanOrEqual(SOURCE_AVATAR_GAP_MAX)
    expect(resolveSourceStripLayout(2, 400).gap).toBe(SOURCE_AVATAR_GAP_MAX)
  })

  it('shrinks below 28 before giving up, and stops at half size', () => {
    const available = sourceRowWidth(6, 28) - 20
    const layout = resolveSourceStripLayout(6, available)
    expect(layout.overflow).toBe(false)
    expect(layout.visibleCount).toBe(6)
    expect(layout.size).toBeLessThan(28)
    expect(layout.size).toBeGreaterThanOrEqual(18)
    expect(sourceRowWidth(6, layout.size)).toBeLessThanOrEqual(available)
  })

  it('keeps half-size avatars and reports overflow once 18px still does not fit', () => {
    const available = 168
    const layout = resolveSourceStripLayout(24, available)
    expect(layout.size).toBe(18)
    expect(layout.overflow).toBe(true)
    expect(layout.visibleCount).toBeLessThan(24)
    expect(
      sourceRowWidth(layout.visibleCount, 18, 24 - layout.visibleCount),
    ).toBeLessThanOrEqual(available)
  })

  it('slides the visible window so the active source stays on the row', () => {
    expect(visibleSourceRange(20, 5, -1)).toEqual({ start: 0, end: 5 })
    expect(visibleSourceRange(20, 5, 18)).toEqual({ start: 15, end: 20 })
    const centered = visibleSourceRange(20, 5, 10)
    expect(centered.start).toBeLessThanOrEqual(10)
    expect(centered.end).toBeGreaterThan(10)
  })
})
