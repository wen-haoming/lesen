import { describe, expect, it } from "vitest";
import {
  createSubscriptionBackup,
  formatSubscriptionShareText,
  mergeSubscriptionSources,
  parseSubscriptionBackup,
} from "./subscription-backup";

describe("subscription backup", () => {
  it("exports subscriptions without local page tokens", () => {
    const backup = createSubscriptionBackup(
      [
        {
          platform: "weibo",
          id: "1234567890",
          name: "用户一",
          avatar: "https://example.com/avatar.jpg",
          sessionToken: "secret-token",
        } as never,
      ],
      "2026-11-13T00:00:00.000Z",
    );

    expect(backup).toEqual({
      format: "owlivo-subscriptions",
      version: 1,
      exportedAt: "2026-11-13T00:00:00.000Z",
      sources: [
        {
          platform: "weibo",
          id: "1234567890",
          name: "用户一",
          avatar: "https://example.com/avatar.jpg",
        },
      ],
    });
    expect(JSON.stringify(backup)).not.toContain("secret-token");
  });

  it("rejects unrelated files and filters invalid rows", () => {
    expect(() => parseSubscriptionBackup("{}")).toThrow("不是受支持");
    const backup = parseSubscriptionBackup(
      JSON.stringify({
        format: "owlivo-subscriptions",
        version: 1,
        exportedAt: "2026-11-13T00:00:00.000Z",
        sources: [
          { platform: "x", id: "example", name: "Example" },
          { platform: "unknown", id: "bad" },
          { platform: "x", id: "" },
          { platform: "x", id: "EXAMPLE", name: "Duplicate" },
        ],
      }),
    );
    expect(backup.sources).toEqual([{ platform: "x", id: "example", name: "Example" }]);
  });

  it("merges without replacing existing subscriptions", () => {
    const result = mergeSubscriptionSources(
      [{ platform: "x", id: "existing", name: "保留原名称" }],
      [
        { platform: "x", id: "EXISTING", name: "不覆盖" },
        { platform: "xueqiu", id: "123", name: "新增" },
      ],
    );
    expect(result.added).toBe(1);
    expect(result.sources).toEqual([
      { platform: "x", id: "existing", name: "保留原名称" },
      { platform: "xueqiu", id: "123", name: "新增" },
    ]);
  });

  it("formats a clean share text grouped by platform", () => {
    expect(formatSubscriptionShareText([])).toBe("");
    const text = formatSubscriptionShareText([
      { platform: "x", id: "paulg", name: "Paul Graham" },
      { platform: "xueqiu", id: "1247347556", name: "大道无形我有型" },
      { platform: "weibo", id: "1001", name: "测试博主" },
      { platform: "x", id: "PAULG", name: "Duplicate" },
    ]);
    expect(text).toContain("共 3 个");
    expect(text).toContain("雪球：大道无形我有型");
    expect(text).toContain("微博：测试博主");
    expect(text).toContain("X：Paul Graham (@paulg)");
    expect(text).toContain("dakdgplahfkbblfpafdjeipneioajgdf");
  });
});
