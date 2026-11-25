export type WeiboHotItem = {
  rank: number;
  word: string;
  heat: number;
  label: string;
  url: string;
};

export type WeiboHotResponse = {
  ok: boolean;
  items: WeiboHotItem[];
  updatedAt: number;
  cached?: boolean;
  stale?: boolean;
  error?: string;
  needsLogin?: boolean;
  retryAfterMs?: number;
};

const LABELS = new Set(["新", "热", "沸", "爆", "荐"]);

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** 只接受真实榜单字段；排名、热度缺失时不以数组下标或默认值补造。 */
export function normalizeWeiboHotItems(data: unknown): WeiboHotItem[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const root = data as Record<string, unknown>;
  if (root.ok !== 1 && root.ok !== "1") return [];
  if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) return [];
  const body = root.data as Record<string, unknown>;
  // side/hotSearch 可能同时返回 band_list（榜单快照）和 realtime（实时榜）。
  // 热搜面板必须优先使用 realtime，否则刷新成功也会继续展示旧榜单。
  const list = Array.isArray(body.realtime) ? body.realtime : body.band_list;
  if (!Array.isArray(list)) return [];
  const words = new Set<string>();
  const ranks = new Set<number>();
  const items: WeiboHotItem[] = [];
  for (const raw of list.slice(0, 200)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if ([row.is_ad, row.isAd, row.ad_type, row.ad_id].some((flag) =>
      flag != null && flag !== false && flag !== 0 && flag !== "0" && flag !== "")) continue;
    if (row.label_name === "广告" || row.label === "广告") continue;
    if (typeof row.word !== "string") continue;
    const word = row.word.trim();
    if (!word || word.length > 200 || /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(word)) continue;
    const rank = numeric(row.realpos ?? row.rank);
    const heat = numeric(row.num ?? row.raw_hot ?? row.heat);
    if (rank == null || rank < 1 || rank > 100 || heat == null) continue;
    const identity = word.normalize("NFKC").toLocaleLowerCase();
    if (words.has(identity) || ranks.has(rank)) continue;
    words.add(identity);
    ranks.add(rank);
    const rawLabel = row.label_name ?? row.label;
    const label = typeof rawLabel === "string" && LABELS.has(rawLabel) ? rawLabel : "";
    items.push({ rank, word, heat, label,
      url: "https://s.weibo.com/weibo?q=" + encodeURIComponent(word),
    });
  }
  return items.sort((a, b) => a.rank - b.rank).slice(0, 50);
}
