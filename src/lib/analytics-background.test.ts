import { describe, expect, it } from "vitest";
import { isTrustedAnalyticsSender } from "./analytics-sender";

describe("analytics background sender authentication", () => {
  const id = "a".repeat(32);
  it("accepts only local popup, sidepanel, and home extension pages", () => {
    for (const page of ["popup.html", "sidepanel.html", "home.html"]) {
      expect(isTrustedAnalyticsSender({ id, url: `chrome-extension://${id}/${page}` } as chrome.runtime.MessageSender, id)).toBe(true);
    }
    for (const sender of [
      { id: "b".repeat(32), url: `chrome-extension://${id}/popup.html` },
      { id, url: `https://example.test/popup.html` },
      { id, url: `chrome-extension://${id}/options.html` },
      { id, url: `chrome-extension://${id}/home.html.evil` },
    ]) {
      expect(isTrustedAnalyticsSender(sender as chrome.runtime.MessageSender, id)).toBe(false);
    }
  });
});
