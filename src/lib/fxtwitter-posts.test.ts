import { describe, expect, it } from "vitest";
import { collectFxMedia, postsFromFxTwitter } from "./fxtwitter-posts.js";

describe("fxTwitter post normalization", () => {
  it("preserves full post text and supports the original author and nested reply semantics", () => {
    const text = "body".repeat(500);
    const posts = postsFromFxTwitter({ results: [{
      type: "status", id: "123", text, author: { name: "Author", avatar_url: "https://img.example/a.jpg" },
      replying_to: { user: { screen_name: "@reply_to" } },
    }] }, "owner");
    expect(posts?.[0].summary).toBe(text);
    expect(posts?.[0].authorAvatar).toBe("https://img.example/a.jpg");
    expect(posts?.[0].replyToHandle).toBe("reply_to");
  });

  it("upgrades protocol-relative and http media while excluding HLS playlists and bounding count", () => {
    expect(collectFxMedia({ media: ["//img.example/a.jpg", "http://img.example/b.jpg", "https://vid.example/a.m3u8"] }))
      .toEqual(["https://img.example/a.jpg", "https://img.example/b.jpg"]);
    expect(collectFxMedia({ media: Array.from({ length: 12 }, (_, i) => `https://img.example/${i}.jpg`) })).toHaveLength(9);
  });

  it("returns null only for malformed result payloads and preserves valid empty feeds", () => {
    expect(postsFromFxTwitter({}, "owner")).toBeNull();
    expect(postsFromFxTwitter({ results: [] }, "owner")).toEqual([]);
  });
});
