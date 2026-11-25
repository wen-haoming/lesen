export function normalizeReplyHandle(value) {
  if (typeof value === "string") {
    const handle = value.trim().replace(/^@/, "");
    if (!handle || /^\[object(?:\s+.*)?\]$/i.test(handle) || /^(?:undefined|null)$/i.test(handle)) {
      return "";
    }
    return handle.slice(0, 60);
  }
  if (!value || typeof value !== "object") return "";

  for (const key of [
    "screen_name",
    "screenName",
    "username",
    "user_name",
    "handle",
    "reply_to_screen_name",
  ]) {
    const normalized = normalizeReplyHandle(value[key]);
    if (normalized) return normalized;
  }
  for (const key of ["user", "author", "account"]) {
    const normalized = normalizeReplyHandle(value[key]);
    if (normalized) return normalized;
  }
  return "";
}
