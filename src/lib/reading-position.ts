/** 阅读位置：按上下文记住上次刷新/阅读所在的内容锚点，而不是像素滚动条。 */

export const READING_POSITIONS_KEY = "readingPositions";
export const NEAR_TOP_PX = 64;
/** 胶囊回顶与“真正到达顶部”用的紧阈值，不能用 NEAR_TOP_PX，否则会在日期头下方约 26px 处提前结束。 */
export const TRUE_TOP_PX = 2;

export type ReadingSurface = "reader" | "home";

export type ReadingPosition = {
  contextKey: string;
  anchorKey: string;
  offset: number;
  savedAt: number;
};

export function readingContextKey(input: {
  surface: ReadingSurface;
  feedKey: string;
  isAllFeed: boolean;
  platform?: string;
}): string {
  const feedKey = String(input.feedKey || "");
  if (input.surface === "home") {
    const platform = String(input.platform || "unknown");
    if (input.isAllFeed) return "home:" + platform + ":all";
    return "home:" + platform + ":author:" + feedKey;
  }
  if (input.isAllFeed) return "reader:all";
  return "reader:author:" + feedKey;
}

export function isPostAnchorKey(key: string): boolean {
  const value = String(key || "");
  return Boolean(value) && !value.startsWith("day:");
}

export function normalizeReadingPositions(raw: unknown): Record<string, ReadingPosition> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ReadingPosition> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const contextKey = String(rec.contextKey || key || "");
    const anchorKey = String(rec.anchorKey || "");
    if (!contextKey || !isPostAnchorKey(anchorKey)) continue;
    out[contextKey] = {
      contextKey,
      anchorKey,
      offset: Number(rec.offset || 0) || 0,
      savedAt: Number(rec.savedAt || 0) || 0,
    };
  }
  return out;
}

export function upsertReadingPosition(
  current: Record<string, ReadingPosition>,
  position: ReadingPosition,
): Record<string, ReadingPosition> {
  if (!position?.contextKey || !isPostAnchorKey(position.anchorKey)) return current;
  return { ...current, [position.contextKey]: position };
}

export function isAtTrueTop(scrollTop: number, threshold = NEAR_TOP_PX): boolean {
  return Number(scrollTop || 0) <= threshold;
}

/** 点击「已更新」胶囊的目标是列表真正顶部，而不是把最新帖对准视口再减 8px。日期头约 34px 时，后者会停在 scrollTop≈26。 */
export function jumpToLatestScrollTop(): number {
  return 0;
}

export function shouldAckProgrammaticJump(input: {
  scrollTop: number;
  interrupted: boolean;
  flying: boolean;
}): boolean {
  if (!input.flying || input.interrupted) return false;
  return Number(input.scrollTop || 0) <= TRUE_TOP_PX;
}

/**
 * 前置插入并按 pinned 帖校正之后，不要再按视口边缘重采锚点。
 * 边缘处往往是新帖的下沿，重采后 ResizeObserver 会按错帖补偿，实测把原帖 34px offset 推到约 -10px。
 */
export function pinnedAnchorAfterLayout(
  pinned: AnchorSnapshot | null | undefined,
  capturedAtEdge: AnchorSnapshot | null | undefined,
): AnchorSnapshot | null {
  if (pinned?.key) return pinned;
  return capturedAtEdge || null;
}

/** 有新增且当前并不在列表真正顶部时，才显示「已更新 N 条」胶囊。 */
export function shouldShowFreshCue(freshCount: number, scrollTop: number, threshold = NEAR_TOP_PX): boolean {
  return Number(freshCount || 0) > 0 && !isAtTrueTop(scrollTop, threshold);
}

export type AnchorSnapshot = { key: string; offset: number };

/**
 * 在现有帖子 id 顺序里，为已删除的锚点找下一篇仍在场的帖。
 * 找不到则回退到列表第一篇；列表为空则返回空。
 */
export function fallbackAnchorKey(
  missingKey: string,
  previousOrder: readonly string[],
  currentKeys: readonly string[],
): string {
  const present = new Set(currentKeys.filter(isPostAnchorKey));
  if (!present.size) return "";
  const start = previousOrder.indexOf(missingKey);
  if (start >= 0) {
    for (let i = start; i < previousOrder.length; i += 1) {
      if (present.has(previousOrder[i])) return previousOrder[i];
    }
  }
  for (const key of previousOrder) {
    if (present.has(key)) return key;
  }
  return currentKeys.find(isPostAnchorKey) || "";
}

export function captureAnchorFromRects(
  items: Array<{ key: string; top: number; bottom: number }>,
  edge: number,
): AnchorSnapshot | null {
  for (const item of items) {
    if (!isPostAnchorKey(item.key)) continue;
    if (item.bottom > edge) {
      return { key: item.key, offset: item.top - edge };
    }
  }
  return null;
}

export type ReadingPositionStore = {
  get: (keys: string[]) => Promise<Record<string, unknown> | null>;
  set: (values: Record<string, unknown>) => Promise<void>;
};

/** 通过与 Timeline 相同的 chrome.storage.local 适配器读写阅读位置。无运行时时 get 可为 null。 */
export async function loadReadingPositions(
  store: ReadingPositionStore,
): Promise<Record<string, ReadingPosition>> {
  const data = await store.get([READING_POSITIONS_KEY]);
  return normalizeReadingPositions(data?.[READING_POSITIONS_KEY]);
}

export async function saveReadingPosition(
  store: ReadingPositionStore,
  position: ReadingPosition,
): Promise<Record<string, ReadingPosition>> {
  const current = await loadReadingPositions(store);
  const merged = upsertReadingPosition(current, position);
  await store.set({ [READING_POSITIONS_KEY]: merged });
  return merged;
}
