/** 顶部信息源头像：先缩小，缩到一半仍放不下再交给悬停面板。 */

export const SOURCE_AVATAR_FULL = 28
export const SOURCE_AVATAR_MIN = 18
/** 人少时把多余宽度摊进间距，但不要散到贴住两侧按钮。 */
export const SOURCE_AVATAR_GAP_MAX = 16

export type SourceStripLayout = {
  size: number
  gap: number
  visibleCount: number
  overflow: boolean
  chipWidth: number
}

export function sourceAvatarGap(size: number): number {
  if (size >= 32) return 6
  if (size >= 24) return 4
  return 3
}

/** 一排放得下时，把剩余宽度摊到头像之间，上限见 SOURCE_AVATAR_GAP_MAX。 */
export function relaxedSourceGap(count: number, size: number, available: number): number {
  const minGap = sourceAvatarGap(size)
  if (count <= 1) return minGap
  const slack = available - count * size
  if (slack <= 0) return minGap
  return Math.max(minGap, Math.min(SOURCE_AVATAR_GAP_MAX, Math.floor(slack / (count - 1))))
}

export function sourceOverflowChipWidth(hidden: number, size: number): number {
  if (hidden >= 100) return size + 16
  if (hidden >= 10) return size + 8
  return size
}

/** 一排头像（以及可选的 +N）占用的内容宽度，不含轨道内边距。 */
export function sourceRowWidth(count: number, size: number, hidden = 0): number {
  const gap = sourceAvatarGap(size)
  const avatars = count > 0 ? count * size + (count - 1) * gap : 0
  if (hidden <= 0) return avatars
  return avatars + (count > 0 ? gap : 0) + sourceOverflowChipWidth(hidden, size)
}

/**
 * available 是轨道内容区宽度。
 * 放得下就保持 28；放不下就逐像素收到 18；18 仍放不下则只显示能放下的，其余进面板。
 */
export function resolveSourceStripLayout(count: number, available: number): SourceStripLayout {
  if (count <= 0 || available <= 0) {
    return {
      size: SOURCE_AVATAR_FULL,
      gap: sourceAvatarGap(SOURCE_AVATAR_FULL),
      visibleCount: count,
      overflow: false,
      chipWidth: 0,
    }
  }

  for (let size = SOURCE_AVATAR_FULL; size >= SOURCE_AVATAR_MIN; size -= 1) {
    if (sourceRowWidth(count, size) <= available) {
      return {
        size,
        gap: relaxedSourceGap(count, size, available),
        visibleCount: count,
        overflow: false,
        chipWidth: 0,
      }
    }
  }

  let visibleCount = count - 1
  while (
    visibleCount > 0 &&
    sourceRowWidth(visibleCount, SOURCE_AVATAR_MIN, count - visibleCount) > available
  ) {
    visibleCount -= 1
  }
  const hidden = count - visibleCount
  return {
    size: SOURCE_AVATAR_MIN,
    gap: sourceAvatarGap(SOURCE_AVATAR_MIN),
    visibleCount,
    overflow: true,
    chipWidth: sourceOverflowChipWidth(hidden, SOURCE_AVATAR_MIN),
  }
}

/** 可见窗口尽量包住当前选中项，避免选中的头像被收进面板后条上失去选中态。 */
export function visibleSourceRange(
  count: number,
  visibleCount: number,
  activeIndex: number,
): { start: number; end: number } {
  if (count <= 0 || visibleCount <= 0) return { start: 0, end: 0 }
  if (visibleCount >= count) return { start: 0, end: count }
  if (activeIndex < 0 || activeIndex >= count) return { start: 0, end: visibleCount }
  const start = Math.max(
    0,
    Math.min(activeIndex - Math.floor((visibleCount - 1) / 2), count - visibleCount),
  )
  return { start, end: start + visibleCount }
}
