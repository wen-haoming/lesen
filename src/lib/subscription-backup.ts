import { PRODUCT_DISPLAY_NAME, PRODUCT_STORE_URL } from "./product-brand";
import { feedKey, type FeedSource, type Platform } from "./config";

export const SUBSCRIPTION_BACKUP_FORMAT = "owlivo-subscriptions";
export const SUBSCRIPTION_BACKUP_VERSION = 1;

const PLATFORMS = new Set<Platform>(["xueqiu", "x", "weibo"]);

export type SubscriptionBackup = {
  format: typeof SUBSCRIPTION_BACKUP_FORMAT;
  version: typeof SUBSCRIPTION_BACKUP_VERSION;
  exportedAt: string;
  sources: FeedSource[];
};

function cleanSource(value: unknown): FeedSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const platform = String(input.platform || "") as Platform;
  const id = String(input.id || "").trim().slice(0, 200);
  if (!PLATFORMS.has(platform) || !id) return null;

  const source: FeedSource = { platform, id };
  const name = String(input.name || "").trim().slice(0, 200);
  if (name) source.name = name;

  const avatar = String(input.avatar || "").trim().slice(0, 1000);
  if (/^https:\/\//i.test(avatar) || /^\/?(?:fixtures|icons)\//i.test(avatar)) {
    source.avatar = avatar;
  }
  return source;
}

function uniqueSources(values: unknown[]): FeedSource[] {
  const seen = new Set<string>();
  const sources: FeedSource[] = [];
  for (const value of values.slice(0, 1000)) {
    const source = cleanSource(value);
    if (!source) continue;
    const key = feedKey(source).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export function createSubscriptionBackup(
  sources: FeedSource[],
  exportedAt = new Date().toISOString(),
): SubscriptionBackup {
  return {
    format: SUBSCRIPTION_BACKUP_FORMAT,
    version: SUBSCRIPTION_BACKUP_VERSION,
    exportedAt,
    sources: uniqueSources(sources),
  };
}

export function parseSubscriptionBackup(text: string): SubscriptionBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("备份文件格式不正确");
  }
  const input = value as Record<string, unknown>;
  if (
    input.format !== SUBSCRIPTION_BACKUP_FORMAT ||
    input.version !== SUBSCRIPTION_BACKUP_VERSION
  ) {
    throw new Error(`不是受支持的 ${PRODUCT_DISPLAY_NAME} 订阅备份`);
  }
  if (!Array.isArray(input.sources)) {
    throw new Error("备份文件缺少订阅列表");
  }
  return {
    format: SUBSCRIPTION_BACKUP_FORMAT,
    version: SUBSCRIPTION_BACKUP_VERSION,
    exportedAt: typeof input.exportedAt === "string" ? input.exportedAt : "",
    sources: uniqueSources(input.sources),
  };
}

export function mergeSubscriptionSources(
  current: FeedSource[],
  imported: FeedSource[],
): { sources: FeedSource[]; added: number } {
  const sources = [...current];
  const seen = new Set(current.map((source) => feedKey(source).toLowerCase()));
  let added = 0;
  for (const source of imported) {
    const clean = cleanSource(source);
    if (!clean) continue;
    const key = feedKey(clean).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(clean);
    added += 1;
  }
  return { sources, added };
}

const SHARE_PLATFORM_ORDER: Platform[] = ["xueqiu", "weibo", "x"];
const SHARE_PLATFORM_LABEL: Record<Platform, string> = {
  xueqiu: "雪球",
  weibo: "微博",
  x: "X",
};

function formatShareItem(source: FeedSource): string {
  const name = source.name?.trim();
  if (source.platform === "x") {
    const handle = source.id.startsWith("@") ? source.id : `@${source.id}`;
    if (name && name.toLowerCase() !== source.id.toLowerCase() && name !== handle) {
      return `${name} (${handle})`;
    }
    return handle;
  }
  return name || source.id;
}

export function formatSubscriptionShareText(
  sources: FeedSource[],
  storeUrl = PRODUCT_STORE_URL,
): string {
  const cleaned = uniqueSources(sources);
  if (!cleaned.length) return "";

  const lines: string[] = [`我的 ${PRODUCT_DISPLAY_NAME} 信息源清单（共 ${cleaned.length} 个）：`];
  for (const platform of SHARE_PLATFORM_ORDER) {
    const group = cleaned.filter((item) => item.platform === platform);
    if (!group.length) continue;
    lines.push(`${SHARE_PLATFORM_LABEL[platform]}：${group.map(formatShareItem).join("、")}`);
  }
  lines.push("");
  lines.push(`用 ${PRODUCT_DISPLAY_NAME} Chrome 扩展可免登录聚合阅读雪球、微博与 X 公开动态，支持侧边栏阅读与 JSON 清单导入：`);
  lines.push(storeUrl);
  return lines.join("\n");
}
