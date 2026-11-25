import { SQUARE_SOURCES } from "./square-config";

export const AGENT_RUNTIME_TYPES = [
  "POPUP_XUEQIU_HOT", "POPUP_XUEQIU_TOPIC", "POPUP_WEIBO_HOT", "POPUP_WEIBO_TOPIC",
  "POPUP_X_HOT", "POPUP_X_TOPIC", "POPUP_SQUARE_FEED",
] as const;
export const AGENT_SQUARE_FEED_KEYS = SQUARE_SOURCES.map((source) => source.key);
export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];
export type AgentRuntimeMessage = { type: AgentRuntimeType; [key: string]: unknown };
const feedKeys = new Set(AGENT_SQUARE_FEED_KEYS);
const exact = (message: Record<string, unknown>, keys: string[]) => Object.keys(message).every((key) => keys.includes(key));
const pageValid = (page: unknown) => page === undefined || (typeof page === "number" && Number.isSafeInteger(page) && page >= 1 && page <= 1000);
export function validAgentRuntimeMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (!AGENT_RUNTIME_TYPES.includes(message.type as AgentRuntimeType) || (message.force !== undefined && typeof message.force !== "boolean")) return false;
  switch (message.type) {
    case "POPUP_XUEQIU_HOT": case "POPUP_WEIBO_HOT": case "POPUP_X_HOT": return exact(message, ["type", "force"]);
    case "POPUP_XUEQIU_TOPIC": return exact(message, ["type", "word", "page", "force"]) && typeof message.word === "string" && message.word.length > 0 && message.word.length <= 200 && message.word === message.word.trim() && !/[<>\p{Cc}]/u.test(message.word) && pageValid(message.page);
    case "POPUP_WEIBO_TOPIC": return exact(message, ["type", "word", "page", "force"]) && typeof message.word === "string" && message.word.length > 0 && message.word.length <= 100 && message.word === message.word.trim() && !/[<>\u0000-\u001f\u007f-\u009f]/u.test(message.word) && pageValid(message.page);
    case "POPUP_X_TOPIC": return exact(message, ["type", "word", "cursor", "force"]) && typeof message.word === "string" && /^[^\u0000-\u001f\u007f]{1,100}$/.test(message.word) && (message.cursor === undefined || (typeof message.cursor === "string" && message.cursor.length <= 512 && !/[\u0000-\u001f]/.test(message.cursor)));
    case "POPUP_SQUARE_FEED": return exact(message, ["type", "feedKey", "force"]) && typeof message.feedKey === "string" && feedKeys.has(message.feedKey);
  }
  return false;
}
