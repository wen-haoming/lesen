import { describe, expect, it } from "vitest";
import { peekSourceInput } from "./source-input";

describe("peekSourceInput weibo", () => {
  it("parses weibo profile urls and prefixed ids", () => {
    expect(peekSourceInput("https://weibo.com/u/1234567890")).toEqual({
      platform: "weibo",
      id: "1234567890",
    });
    expect(peekSourceInput("weibo.com/u/1234567890")).toEqual({
      platform: "weibo",
      id: "1234567890",
    });
    expect(peekSourceInput("weibo:1234567890")).toEqual({
      platform: "weibo",
      id: "1234567890",
    });
    expect(peekSourceInput("https://m.weibo.cn/profile/1234567890")).toEqual({
      platform: "weibo",
      id: "1234567890",
    });
  });

  it("rejects unsupported platform urls and unknown prefixes", () => {
    expect(
      peekSourceInput("https://example.com/user/profile/6ad788d8000000000e03c800"),
    ).toEqual({
      error: "UNRECOGNIZED",
    });
    expect(peekSourceInput("unknown:123456")).toEqual({
      error: "UNRECOGNIZED",
    });
  });

  it("keeps bare digits as xueqiu for backward compatibility", () => {
    expect(peekSourceInput("1234567890")).toEqual({ platform: "xueqiu", id: "1234567890" });
  });
});
