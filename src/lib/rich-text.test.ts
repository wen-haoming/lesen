import { describe, expect, it } from "vitest";
import { looksDeletedPlaceholder, splitForwardChain, tokenizeRich } from "./rich-text";
import { classifyPostCard } from "./post-card";
import type { Post } from "./sanitize";

describe("splitForwardChain", () => {
  it("splits xueqiu //@ chain and drops reply-to-self", () => {
    const { own, chain } = splitForwardChain(
      "从来没有过。// @老李很无聊 :回复 @大道无形我有型 :可以问一下，您父母小时候会经常教您规矩吗？",
      ["大道无形我有型"],
    );
    expect(own).toBe("从来没有过。");
    expect(chain).toEqual([
      { name: "老李很无聊", replyTo: "", text: "可以问一下，您父母小时候会经常教您规矩吗？" },
    ]);
  });

  it("keeps reply target when it is someone else, supports multi-level", () => {
    const { own, chain } = splitForwardChain(
      "拭目以待。//@小段小巴:回复 @笃道:Nvda其实不一样//@笃道: 造钟人还是报时人",
    );
    expect(own).toBe("拭目以待。");
    expect(chain.map((c) => [c.name, c.replyTo, c.text])).toEqual([
      ["小段小巴", "笃道", "Nvda其实不一样"],
      ["笃道", "", "造钟人还是报时人"],
    ]);
  });

  it("does not split urls or emoji tokens", () => {
    const text = "看这里 https://x.com/@abc: 链接 [:img://assets.imedao.com/a.png:]";
    expect(splitForwardChain(text)).toEqual({ own: text, chain: [] });
  });
});

describe("tokenizeRich", () => {
  it("renders protocol-relative face token, mention and stock", () => {
    const segs = tokenizeRich(
      "报时人 [:img://assets.imedao.com/ugc/images/face/emoji_53.png?v=1:] @大道无形我有型 看 $英伟达(NVDA)$",
    );
    expect(segs).toEqual([
      { type: "text", value: "报时人 " },
      { type: "face", url: "https://assets.imedao.com/ugc/images/face/emoji_53.png?v=1", name: "" },
      { type: "text", value: " " },
      { type: "mention", value: "@大道无形我有型" },
      { type: "text", value: " 看 " },
      { type: "stock", value: "英伟达(NVDA)" },
    ]);
  });

  it("maps named faces, ignores emails and plain dollar amounts", () => {
    expect(tokenizeRich("[:name:赞:]")[0]).toMatchObject({ type: "face", name: "赞" });
    expect(tokenizeRich("[:name:未知:]")).toEqual([{ type: "text", value: "[未知]" }]);
    expect(tokenizeRich("developer@example.invalid costs $100 and $200")).toEqual([
      { type: "text", value: "developer@example.invalid costs $100 and $200" },
    ]);
  });

  it("tokenizes URLs with shortened labels and strips trailing punctuation, and tokenizes hashtags", () => {
    expect(tokenizeRich("访问 https://www.xueqiu.com/u/1234567890/status/abcdef，#今日看盘# 很好")).toEqual([
      { type: "text", value: "访问 " },
      {
        type: "url",
        url: "https://www.xueqiu.com/u/1234567890/status/abcdef",
        label: "xueqiu.com/u/1234567890/status/abc…",
      },
      { type: "text", value: "，" },
      { type: "hashtag", value: "#今日看盘#" },
      { type: "text", value: " 很好" },
    ]);
  });
});

describe("chain in card model", () => {
  it("reply card body keeps only own words", () => {
    const post = {
      id: "1",
      userId: "1",
      authorName: "大道无形我有型",
      title: "",
      summary: "回复 @老李很无聊: 从来没有过。// @老李很无聊 :回复 @大道无形我有型 :可以问一下",
      timestamp: 0,
      timeText: "",
      source: "",
      url: "",
      isRetweet: false,
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoted: null,
    } as Post;
    const card = classifyPostCard(post);
    expect(card.body).toBe("从来没有过。");
    expect(card.chain).toEqual([{ name: "老李很无聊", replyTo: "", text: "可以问一下" }]);
  });
});

it("detects deleted placeholder", () => {
  expect(looksDeletedPlaceholder("原帖已被作者删除")).toBe(true);
  expect(looksDeletedPlaceholder("我觉得这件事被删除了也没关系，主要看长期的经营质量")).toBe(false);
});
