import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useReader } from "@/hooks/useReader";
import {
  emptySquareResource,
  DEMO_WEIBO_HOT_ITEMS,
  WEIBO_HOT_RESOURCE,
  type SquareResource,
} from "@/lib/square-data";
import type { Post } from "@/lib/sanitize";
import type { XueqiuHotResource, XueqiuTopicResource } from "@/lib/xueqiu-topic-state";
import { SquareBoard } from "./SquareBoard";

const mocks = vi.hoisted(() => ({
  resources: {} as Record<string, SquareResource>,
  xueqiuHot: {
    items: [],
    attempted: false,
    loading: false,
    error: "",
    needsLogin: false,
    stale: false,
    cached: false,
    retryAt: 0,
    updatedAt: 0,
  } as XueqiuHotResource,
  xueqiuTopic: {
    resource: {
      posts: [],
      page: 0,
      hasMore: true,
      attempted: false,
      loading: false,
      loadingMore: false,
      error: "",
      needsLogin: false,
      stale: false,
      cached: false,
      retryAt: 0,
      updatedAt: 0,
    } as XueqiuTopicResource,
    refresh: vi.fn(),
    loadMore: vi.fn(),
  },
  hotOptions: vi.fn(),
  topicOptions: vi.fn(),
  data: vi.fn(),
  timeline: vi.fn(),
}));
vi.mock("@/hooks/useSquareData", () => ({
  useSquareData: (options: unknown) => {
    mocks.data(options);
    return { resources: mocks.resources, refresh: vi.fn() };
  },
}));
vi.mock("@/hooks/useXueqiuTopic", () => ({
  useXueqiuHot: (options: unknown) => {
    mocks.hotOptions(options);
    return { resource: mocks.xueqiuHot, refresh: vi.fn() };
  },
  useXueqiuTopic: (options: unknown) => {
    mocks.topicOptions(options);
    return mocks.xueqiuTopic;
  },
}));
vi.mock("./Timeline", () => ({
  Timeline: (props: Record<string, unknown>) => {
    mocks.timeline(props);
    return null;
  },
}));

function reader(previewMode = false) {
  return {
    state: { previewMode, settings: { density: "compact", query: "私人搜索", translateX: false } },
    openPost: vi.fn(),
    openWeiboLogin: vi.fn(),
    openXueqiuLogin: vi.fn(),
    selectFeed: vi.fn(),
    setQuery: vi.fn(),
    acknowledgeLatest: vi.fn(),
  } as unknown as ReturnType<typeof useReader>;
}

beforeEach(() => {
  mocks.resources = {};
  mocks.xueqiuHot = {
    items: [],
    attempted: false,
    loading: false,
    error: "",
    needsLogin: false,
    stale: false,
    cached: false,
    retryAt: 0,
    updatedAt: 0,
  };
  mocks.xueqiuTopic = {
    resource: {
      posts: [],
      page: 0,
      hasMore: true,
      attempted: false,
      loading: false,
      loadingMore: false,
      error: "",
      needsLogin: false,
      stale: false,
      retryAt: 0,
      updatedAt: 0,
    },
    refresh: vi.fn(),
    loadMore: vi.fn(),
  };
  mocks.hotOptions.mockClear();
  mocks.topicOptions.mockClear();
  mocks.data.mockClear();
  mocks.timeline.mockClear();
});

describe("广场 UI", () => {
  it("默认只启用雪球；各平台保留挂载且不接入私人搜索或已读回调", () => {
    const current = reader();
    const html = renderToStaticMarkup(createElement(SquareBoard, { reader: current }));
    expect(html).toContain("广场平台");
    expect(html).toContain("正在读取雪球热搜榜单");
    expect(html).not.toContain("精选账号");
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.hotOptions).toHaveBeenCalledWith({ active: true, previewMode: false });
    expect(mocks.topicOptions).toHaveBeenCalledWith({ word: "", active: true, previewMode: false });
    for (const [props] of mocks.timeline.mock.calls) {
      expect(props.query).toBe("");
      expect(props.persistPositions).toBe(false);
      expect(props.onAcknowledgeLatest).not.toBe(current.acknowledgeLatest);
      expect(props.timelineFresh).toEqual({});
    }
    expect(current.selectFeed).not.toHaveBeenCalled();
    expect(current.setQuery).not.toHaveBeenCalled();
    expect(current.acknowledgeLatest).not.toHaveBeenCalled();
  });

  it("active=false 时所有子视图禁止自动请求，仍保留组件", () => {
    const html = renderToStaticMarkup(
      createElement(SquareBoard, { reader: reader(), active: false }),
    );
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.hotOptions).toHaveBeenCalledWith({ active: false, previewMode: false });
    expect(mocks.topicOptions).toHaveBeenCalledWith({
      word: "",
      active: false,
      previewMode: false,
    });
    expect(html).toContain("hidden");
    expect(html).toContain("雪球热搜");
  });

  it("雪球热搜使用无全部项的单选 chips，并展示真实作者帖子", () => {
    const realPost = {
      id: "123456",
      userId: "98765",
      authorName: "真实作者",
      authorAvatar: "https://xavatar.imedao.com/avatar.jpg",
      title: "真实帖子",
      summary: "来自雪球的正文",
      timestamp: 1700000000000,
      timeText: "",
      source: "雪球",
      url: "https://xueqiu.com/98765/123456",
      isRetweet: false,
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoted: null,
      mediaUrls: ["https://xavatar.imedao.com/post.jpg"],
      feedKey: "xueqiu:98765",
      feedName: "真实作者",
      feedPlatform: "xueqiu",
    } satisfies Post;
    mocks.xueqiuHot = {
      items: [
        {
          rank: 1,
          word: "雪球话题",
          heat: "1.23万",
          statusCount: 345,
          summary: "话题说明",
          stocks: ["SH600000"],
          label: "",
          url: "https://xueqiu.com/",
        },
      ],
      attempted: true,
      loading: false,
      error: "",
      needsLogin: false,
      stale: false,
      cached: false,
      retryAt: 0,
      updatedAt: 1700000000000,
    };
    mocks.xueqiuTopic = {
      resource: {
        posts: [realPost],
        page: 1,
        hasMore: false,
        attempted: true,
        loading: false,
        loadingMore: false,
        error: "",
        needsLogin: false,
        stale: false,
        cached: false,
        retryAt: 0,
        updatedAt: 1700000000000,
      },
      refresh: vi.fn(),
      loadMore: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(SquareBoard, { reader: reader() }));
    expect(html).toContain("雪球话题");
    expect(html).toContain("热度 1.23万");
    expect(html).toContain("相关股票：SH600000");
    expect(html).toContain('aria-label="单选雪球热搜话题"');
    expect(html).toContain('aria-pressed="true"');
    const topicTimeline = mocks.timeline.mock.calls
      .map(([props]) => props)
      .find((props) => props.columnPlatform === "square:xueqiu:topic")!;
    expect(topicTimeline.posts[0]).toMatchObject({
      feedKey: "xueqiu:98765",
      authorName: "真实作者",
      authorAvatar: "https://xavatar.imedao.com/avatar.jpg",
    });
    expect(topicTimeline.posts[0].mediaUrls).toEqual(["https://xavatar.imedao.com/post.jpg"]);
    expect(topicTimeline.query).toBe("");
    expect(mocks.topicOptions).toHaveBeenCalledWith({
      word: "雪球话题",
      active: true,
      previewMode: false,
    });
  });

  it("热搜作为单选导航且旧榜单失败提示不丢失，不再点击即跳转", () => {
    mocks.resources = {
      [WEIBO_HOT_RESOURCE]: {
        ...emptySquareResource(),
        attempted: true,
        updatedAt: 1700000000000,
        items: [
          {
            rank: 1,
            word: "测试热搜",
            heat: 120000,
            label: "热",
            url: "https://s.weibo.com/weibo?q=test",
          },
        ],
        stale: true,
        cached: true,
        needsLogin: true,
        error: "需要登录",
      },
    };
    const html = renderToStaticMarkup(createElement(SquareBoard, { reader: reader() }));
    expect(html).toContain("正在读取雪球热搜榜单");
    expect(html).not.toContain('href="https://s.weibo.com/weibo?q=test"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("演示热搜明确标注非实时，样例不提供原站跳转", () => {
    mocks.resources = {
      [WEIBO_HOT_RESOURCE]: {
        ...emptySquareResource(),
        attempted: true,
        items: DEMO_WEIBO_HOT_ITEMS,
      },
    };
    const html = renderToStaticMarkup(createElement(SquareBoard, { reader: reader(true) }));
    expect(html).toContain("演示数据");
    expect(html).toContain("预览不提供雪球热搜数据");
    expect(html).not.toContain("href=");
  });
});
