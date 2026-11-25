import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useReader } from "@/hooks/useReader";
import { emptySquareResource, WEIBO_HOT_RESOURCE, type SquareResource } from "@/lib/square-data";
import { applyWeiboTopicResult, emptyWeiboTopic } from "@/lib/weibo-topic-state";
import { WeiboTopicPanel } from "./WeiboTopicPanel";

const mocks = vi.hoisted(() => ({ rank: {} as SquareResource, topic: vi.fn(), timeline: vi.fn() }));
vi.mock("@/hooks/useSquareData", () => ({ useSquareData: () => ({ resources: { [WEIBO_HOT_RESOURCE]: mocks.rank }, refresh: vi.fn() }) }));
vi.mock("@/hooks/useWeiboTopic", () => ({ useWeiboTopic: (options: unknown) => {
  mocks.topic(options);
  return { resource: applyWeiboTopicResult(emptyWeiboTopic(), { ok: true, posts: [{ id: "1", userId: "123", authorName: "真实作者", summary: "真实帖子" }] }, 1), refresh: vi.fn(), loadMore: vi.fn() };
} }));
vi.mock("./Timeline", () => ({ Timeline: (props: unknown) => { mocks.timeline(props); return null; } }));
function reader(previewMode = false) {
  return { state: { previewMode, settings: { density: "compact", query: "私人查询" } }, openPost: vi.fn(), openWeiboLogin: vi.fn() } as unknown as ReturnType<typeof useReader>;
}
beforeEach(() => {
  mocks.rank = { ...emptySquareResource(), attempted: true, items: Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, word: `话题${index + 1}`, heat: 100, url: "https://s.weibo.com/weibo?q=test", label: "" })) };
  mocks.topic.mockClear();
  mocks.timeline.mockClear();
});
describe("微博话题面板", () => {
  it("同一组单选chips收起最多两行，默认第一话题，榜单和帖子刷新分开", () => {
    const html = renderToStaticMarkup(createElement(WeiboTopicPanel, { reader: reader(), active: true }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed=/g)).toHaveLength(5);
    expect(html).toContain("grid-cols-3");
    expect(html).toContain("单选热搜话题");
    expect(html).toContain("更多");
    expect(html).not.toContain("全部");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<select");
    expect(mocks.topic).toHaveBeenCalledWith({ word: "话题1", active: true, previewMode: false });
    const props = mocks.timeline.mock.calls[0][0];
    expect(props.query).toBe("");
    expect(props.persistPositions).toBe(false);
    expect(props.posts[0].authorName).toBe("真实作者");
  });
  it("预览明确空态，不渲染伪造帖子", () => {
    const html = renderToStaticMarkup(createElement(WeiboTopicPanel, { reader: reader(true), active: true }));
    expect(html).toContain("话题帖子仅能在真实扩展中读取，预览不会编造帖子");
    expect(mocks.timeline).not.toHaveBeenCalled();
    expect(mocks.topic).toHaveBeenCalledWith({ word: "话题1", active: true, previewMode: true });
  });
  it("面板隐藏时hook不发起新请求", () => {
    renderToStaticMarkup(createElement(WeiboTopicPanel, { reader: reader(), active: false }));
    expect(mocks.topic).toHaveBeenCalledWith({ word: "话题1", active: false, previewMode: false });
  });
});
