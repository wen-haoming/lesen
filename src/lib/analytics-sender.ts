export function isTrustedAnalyticsSender(sender: { id?: string; url?: string }, runtimeId: string): boolean {
  if (sender.id !== runtimeId || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.hostname === runtimeId && ["/popup.html", "/sidepanel.html", "/home.html"].includes(url.pathname);
  } catch {
    return false;
  }
}
