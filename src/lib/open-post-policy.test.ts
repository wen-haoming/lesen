import { describe, expect, it } from "vitest";
import { sanitizeFeedPost } from "./sanitize";

/**
 * 卡片打开策略：只有专用外链控件应导航；整卡 / 正文不可隐式跳转。
 * 本文件用 fixture URL 约束「icon 打开的目标」正确，不模拟 DOM 点击。
 */
describe("open-post policy fixtures", () => {
  it("keeps explicit official post urls for icon-only open", () => {
    const xq = sanitizeFeedPost(
      {
        id: "900001",
        userId: "10001",
        title: "demo",
        summary: "body",
        timestamp: 1_700_000_000_000,
        url: "https://xueqiu.com/10001/900001",
      },
      "xueqiu:10001",
    );
    const x = sanitizeFeedPost(
      {
        id: "800001",
        summary: "body",
        timestamp: 1_700_000_000_000,
        url: "https://x.com/preview_x/status/800001",
        handle: "preview_x",
      },
      "x:preview_x",
    );
    expect(xq?.url).toBe("https://xueqiu.com/10001/900001");
    expect(x?.url).toBe("https://x.com/preview_x/status/800001");
  });

  it("rebuilds canonical post links from feed owner and status id", () => {
    const xq = sanitizeFeedPost(
      {
        id: "900002",
        user_id: "10002",
        summary: "Snowball post",
        timestamp: 1_700_000_000_000,
        url: "https://xueqiu.com/10002",
      },
      "xueqiu:10002",
    );
    const x = sanitizeFeedPost(
      {
        id: "800002",
        summary: "X post",
        timestamp: 1_700_000_000_000,
        url: "https://x.com/someone-else/status/123",
        handle: "another-account",
      },
      "x:elonmusk",
    );

    expect(xq?.url).toBe("https://xueqiu.com/10002/900002");
    expect(x?.url).toBe("https://x.com/elonmusk/status/800002");
  });

  it("rebuilds weibo post links from feed owner and mid", () => {
    const weibo = sanitizeFeedPost(
      {
        id: "Abc123Mid",
        mid: "Abc123Mid",
        userId: "20001",
        summary: "微博演示",
        timestamp: 1_700_000_000_000,
        url: "https://weibo.com/someone/else",
      },
      "weibo:20001",
    );
    expect(weibo?.url).toBe("https://weibo.com/20001/Abc123Mid");
    expect(weibo?.platform).toBe("weibo");
  });
});
