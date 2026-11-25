import { TARGET, feedKey, type FeedPerson } from "./config";
import { X_SUGGESTIONS } from "./x-suggestions";

export const SQUARE_PLATFORMS = ["xueqiu", "x", "weibo"] as const;
export type SquarePlatform = (typeof SQUARE_PLATFORMS)[number];

// 广场精选目录独立维护；微博名单尚未指定，不从私人订阅补齐。
const selectedXAccounts = new Set<string>(["OpenAI", "AnthropicAI", "GoogleDeepMind"]);
export const SQUARE_SOURCES: FeedPerson[] = [
  {
    platform: "xueqiu",
    id: TARGET.userId,
    name: TARGET.name,
    key: feedKey({ platform: "xueqiu", id: TARGET.userId }),
  },
  ...X_SUGGESTIONS.filter((source) => selectedXAccounts.has(source.id)).map((source) => ({
    platform: "x" as const,
    id: source.id,
    name: source.name,
    key: feedKey({ platform: "x", id: source.id }),
  })),
];
