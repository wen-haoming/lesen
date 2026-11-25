import { describe, expect, it, vi } from "vitest";
import { sanitizeFeedPost } from "./sanitize";

describe("feed timestamp sanitizing", () => {
  it("preserves millisecond timestamps in internal cache records", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const posts = [
      sanitizeFeedPost({ id: "123456", userId: "42", timestamp: 1_700_000_000_000 }, "xueqiu:42"),
      sanitizeFeedPost({ id: "123456", userId: "42", timestamp: 1_700_000_000 }, "xueqiu:42"),
      sanitizeFeedPost({ id: "123456", userId: "42", timestamp: "2023-11-14T22:13:20.000Z" }, "xueqiu:42"),
    ];
    expect(posts.map((post) => post?.timestamp)).toEqual([
      1_700_000_000_000,
      1_700_000_000,
      1_800_000_000_000,
    ]);
    now.mockRestore();
  });
});
