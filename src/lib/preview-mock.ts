/**
 * 仅用于本地 `vp dev` / preview 的【演示数据 / fixture】。
 * 不写入 chrome.storage，不污染真实账号数据。
 *
 * 切换方式（仅无 Chrome runtime 的预览环境生效）：
 *   ?demo=timeline           主时间线（默认）
 *   ?demo=loading            加载中
 *   ?demo=empty              无订阅（已登录，首页内嵌添加面板）
 *   ?demo=error              错误状态
 *   ?demo=search             搜索命中态
 *   ?demo=login-x            X 未登录
 *   ?demo=login-xueqiu       雪球未登录
 *   ?demo=login-split        雪球已登录 / X 未登录
 *   ?demo=login-checking     检测中
 *   ?demo=x-picker           X 点选列表（已订阅+推荐）
 *   ?demo=media              图片查看器（本地 SVG 样本）
 *   ?demo=login-xueqiu-empty 雪球已登录但关注列表为空（登录 CTA）
 */
import { FEED_ALL, type FeedSource } from "./config";
import type { Post } from "./sanitize";
import { X_SUGGESTIONS } from "./x-suggestions";
import type { PlatformLoginStatus } from "./platform-session";

type Settings = {
  sort: "asc" | "desc";
  query: string;
  translateX: boolean;
  notify: boolean;
  surface?: "popup" | "sidebar";
  themeStyle?: "graphite" | "paper" | "noir" | "moss" | "tide" | "clay";
  colorScheme?: "light" | "dark" | "system";
  readingFont?: "system" | "sans" | "serif" | "kai" | "yuan" | "wenkai";
  readingSize?: "sm" | "md" | "lg" | "xl";
  popupHeight: number | "fill";
  density: "compact" | "comfortable" | "spacious";
};

type AccountStatus = "checking" | "logged-in" | "logged-out" | "unknown" | "timeout";

export type DemoMode =
  | "timeline"
  | "loading"
  | "empty"
  | "error"
  | "search"
  | "login-x"
  | "login-xueqiu"
  | "login-split"
  | "login-checking"
  | "x-picker"
  | "media"
  | "login-xueqiu-empty"
  | "scroll-anchor";

export const PREVIEW_BANNER =
  "演示数据 / fixture · 不是真实平台账号内容 · 不会写入 chrome.storage";

export const DEMO_MODES: Array<{ id: DemoMode; label: string }> = [
  { id: "timeline", label: "主时间线" },
  { id: "loading", label: "加载中" },
  { id: "empty", label: "无订阅" },
  { id: "error", label: "错误" },
  { id: "search", label: "搜索" },
  { id: "login-x", label: "X未登录" },
  { id: "login-xueqiu", label: "雪球未登录" },
  { id: "login-split", label: "分站登录" },
  { id: "login-checking", label: "检测中" },
  { id: "x-picker", label: "X点选" },
  { id: "media", label: "图片预览" },
  { id: "login-xueqiu-empty", label: "雪球无关注" },
  { id: "scroll-anchor", label: "滚动锚点" },
];

export function parseDemoMode(raw: string | null): DemoMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  const allowed = DEMO_MODES.map((m) => m.id);
  return (allowed as string[]).includes(v) ? (v as DemoMode) : "timeline";
}

/** 打包进仓库的公开样本头像（SVG），仅演示用，不是用户真实订阅 */
export const DEMO_AVATAR_XQ = "/fixtures/avatar-demo-xq.svg";
export const DEMO_AVATAR_X = "/fixtures/avatar-demo-x.svg";
export const DEMO_AVATAR_X2 = "/fixtures/avatar-demo-x2.svg";

export const PREVIEW_SOURCES: FeedSource[] = [
  { platform: "xueqiu", id: "10001", name: "演示雪球用户甲", avatar: DEMO_AVATAR_XQ },
  { platform: "weibo", id: "1234567890", name: "演示微博用户", avatar: "" },
  { platform: "x", id: "preview_x", name: "Demo X User", avatar: DEMO_AVATAR_X },
  { platform: "x", id: "preview_x2", name: "Demo X User 2", avatar: DEMO_AVATAR_X2 },
];

const now = Date.now();

export const PREVIEW_POSTS: Record<string, Post[]> = {
  "xueqiu:10001": [
    {
      id: "900001",
      userId: "10001",
      authorName: "演示雪球用户甲",
      title: "【演示】第一条雪球动态",
      summary: "这是本地预览用的演示正文，用于检查行高与可读性，不代表真实行情观点。",
      timestamp: now - 12 * 60 * 1000,
      timeText: "",
      source: "preview",
      url: "https://xueqiu.com/10001/900001",
      isRetweet: false,
      likeCount: 12,
      replyCount: 2,
      retweetCount: 1,
      quoted: null,
    },
    {
      id: "900002",
      userId: "10001",
      authorName: "演示雪球用户甲",
      title: "【演示】引用结构",
      summary: "回复 @某人：同意。 // @另一人: 这是被引用的演示段落，用于检查结构化排版。",
      timestamp: now - 3 * 60 * 60 * 1000,
      timeText: "",
      source: "preview",
      url: "https://xueqiu.com/10001/900002",
      isRetweet: false,
      likeCount: 3,
      replyCount: 0,
      retweetCount: 0,
      quoted: null,
    },
    {
      id: "900003",
      userId: "10001",
      authorName: "演示雪球用户甲",
      title: "",
      summary:
        "回复 @演示乙: 董事会这次面临的挑战非常大，拭目以待。// @演示乙 :回复 @演示丙 :$英伟达(NVDA)$其实和其他AI公司真有点不一样，ceo的战略眼光很重要。",
      timestamp: now - 5 * 60 * 60 * 1000,
      timeText: "",
      source: "preview",
      url: "https://xueqiu.com/10001/900003",
      isRetweet: true,
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoted: {
        authorName: "演示丙",
        text: "请问老师，您觉得这家公司是造钟人还是报时人 [:img://assets.imedao.com/ugc/images/face/emoji_53.png?v=1:] [:name:赞:] @演示雪球用户甲",
        url: "",
        likeCount: 0,
      },
    },
    {
      id: "900004",
      userId: "10001",
      authorName: "演示雪球用户甲",
      title: "",
      summary: "我不觉得这样做有意义。",
      timestamp: now - 6 * 60 * 60 * 1000,
      timeText: "",
      source: "preview",
      url: "https://xueqiu.com/10001/900004",
      isRetweet: true,
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoted: { authorName: "演示丁", text: "原帖已被作者删除", url: "", likeCount: 0 },
    },
    {
      id: "900005",
      userId: "10001",
      authorName: "演示雪球用户甲",
      title: "",
      summary: "做对的事情，把事情做对。",
      timestamp: now - 7 * 60 * 60 * 1000,
      timeText: "",
      source: "preview",
      url: "https://xueqiu.com/10001/900005",
      isRetweet: true,
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoted: {
        authorName: "演示戊",
        text: "老师您好，我今年19岁，正在面临继续求学还是出社会的选择，想听听您的看法！目前上的中专第三年，还有两年时间就毕业了。您在问答录总是提到“做对的事情把事情做对”，不对的事情往往有短期诱惑，遇到模糊时要先明辨是非、长远角度考虑。首先讲为什么要想选择出社会，家里条件一般，想早点赚钱减轻负担…",
        url: "",
        likeCount: 0,
      },
    },
  ],
  "x:preview_x": [
    {
      id: "800001",
      userId: "x:preview_x",
      platform: "x",
      authorName: "Demo X User",
      title: "Demo post",
      summary: "This is English demo text for the X timeline card. Fixture only, not a real tweet.",
      timestamp: now - 40 * 60 * 1000,
      timeText: "",
      source: "x",
      url: "https://x.com/preview_x/status/800001",
      isRetweet: false,
      likeCount: 8,
      replyCount: 1,
      retweetCount: 0,
      quoted: null,
      handle: "preview_x",
    },
  ],
  "x:preview_x2": [
    {
      id: "800002",
      userId: "x:preview_x2",
      platform: "x",
      authorName: "Demo X User 2",
      title: "Demo elon",
      summary: "Fixture post for subscribed X suggestion demo.",
      timestamp: now - 90 * 60 * 1000,
      timeText: "",
      source: "x",
      url: "https://x.com/preview_x2/status/800002",
      isRetweet: false,
      likeCount: 2,
      replyCount: 0,
      retweetCount: 0,
      quoted: null,
      handle: "preview_x2",
    },
  ],
  "weibo:1234567890": [
    {
      id: "700001",
      userId: "1234567890",
      platform: "weibo",
      authorName: "演示微博用户",
      title: "微博图文演示",
      summary: "适合快速扫读的微博正文。多张图片保持紧凑网格，不让来源样式压过内容本身。",
      timestamp: now - 26 * 60 * 1000,
      timeText: "",
      source: "weibo",
      url: "https://weibo.com/1234567890/700001",
      isRetweet: false,
      likeCount: 23,
      replyCount: 4,
      retweetCount: 2,
      quoted: null,
      mediaUrls: [
        "/fixtures/avatar-demo-x.svg",
        "/fixtures/avatar-demo-x.svg",
      ],
    },
  ],
};

export type PreviewFixture = {
  demoMode: DemoMode;
  sources: FeedSource[];
  following: Array<{ id: string; name: string; avatar?: string }>;
  selectedFeedKey: string;
  selectedUserId: string;
  timelines: Record<string, Post[]>;
  timelineSync: Record<string, number>;
  timelineError: Record<string, { error?: string; at?: number }>;
  timelinePaging: Record<string, { page: number; done: boolean }>;
  settings: Settings;
  account: { id: string; name: string } | null;
  loggedIn: boolean;
  status: AccountStatus;
  platformSessions: {
    xueqiu: PlatformLoginStatus;
    x: PlatformLoginStatus;
    weibo: PlatformLoginStatus;
  };
  refreshing: boolean;
  loadingMore: boolean;
  notice: string;
  openAddDialog?: boolean;
  addPickerTab?: "x" | "xueqiu" | "weibo";
};

export function buildPreviewStorage(demoMode: DemoMode = "timeline"): PreviewFixture {
  const baseSettings: Settings = {
    sort: "desc",
    query: "",
    translateX: false,
    notify: true,
    surface: "sidebar",
    themeStyle: "graphite",
    colorScheme: "light",
    readingFont: "system",
    readingSize: "md",
    popupHeight: 600,
    density: "comfortable",
  };

  const loggedInBoth = {
    xueqiu: "logged-in" as PlatformLoginStatus,
    x: "logged-in" as PlatformLoginStatus,
    weibo: "logged-in" as PlatformLoginStatus,
  };

  const common = {
    demoMode,
    sources: PREVIEW_SOURCES,
    following: [
      { id: "10001", name: "演示雪球用户甲", avatar: DEMO_AVATAR_XQ },
      { id: "10002", name: "演示雪球用户乙", avatar: DEMO_AVATAR_XQ },
    ],
    selectedUserId: "",
    timelineSync: {
      "xueqiu:10001": now - 60_000,
      "x:preview_x": now - 90_000,
      "x:preview_x2": now - 120_000,
    },
    timelinePaging: {
      "xueqiu:10001": { page: 1, done: true },
      "x:preview_x": { page: 1, done: true },
      "x:preview_x2": { page: 1, done: true },
    },
    account: { id: "preview", name: "演示测试账号" },
    loggedIn: true,
    status: "logged-in" as AccountStatus,
    platformSessions: loggedInBoth,
    refreshing: false,
    loadingMore: false,
    notice: "",
    openAddDialog: false,
    addPickerTab: "x" as const,
  };

  if (demoMode === "loading") {
    return {
      ...common,
      selectedFeedKey: "xueqiu:10001",
      timelines: {},
      timelineError: {},
      settings: baseSettings,
      refreshing: true,
      notice: "正在读取该用户的动态（演示）",
    };
  }

  if (demoMode === "empty") {
    return {
      ...common,
      sources: [],
      selectedFeedKey: FEED_ALL,
      timelines: {},
      timelineError: {},
      settings: baseSettings,
      notice: "已登录但还没有订阅：首页直接选择用户",
    };
  }

  if (demoMode === "error") {
    return {
      ...common,
      selectedFeedKey: "xueqiu:10001",
      timelines: { "xueqiu:10001": [] },
      timelineError: {
        "xueqiu:10001": { error: "演示错误：接口暂时不可用", at: now },
      },
      settings: baseSettings,
      notice: "读取失败：演示错误态",
    };
  }

  if (demoMode === "search") {
    return {
      ...common,
      selectedFeedKey: FEED_ALL,
      timelines: PREVIEW_POSTS,
      timelineError: {},
      settings: { ...baseSettings, query: "演示" },
    };
  }

  if (demoMode === "media") {
    const mediaPost: Post = {
      ...PREVIEW_POSTS["x:preview_x"][0],
      title: "图片预览演示",
      summary: "点击下方样本图，测试深色全屏查看器、图片切换与计数。",
      mediaUrls: [
        "/fixtures/avatar-demo-x.svg",
        "/fixtures/avatar-demo-x.svg",
      ],
    };
    return {
      ...common,
      selectedFeedKey: "x:preview_x",
      timelines: { ...PREVIEW_POSTS, "x:preview_x": [mediaPost] },
      timelineError: {},
      settings: baseSettings,
    };
  }

  if (demoMode === "login-x") {
    return {
      ...common,
      sources: PREVIEW_SOURCES.filter((s) => s.platform === "xueqiu"),
      timelines: { "xueqiu:10001": PREVIEW_POSTS["xueqiu:10001"] },
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: "xueqiu:10001",
      platformSessions: { xueqiu: "logged-in", x: "logged-out", weibo: "logged-in" },
      notice: "X 未登录：可浏览推荐列表与搜索，登录后不会拉取 Following（原通路无此能力）",
      openAddDialog: true,
      addPickerTab: "x",
    };
  }

  if (demoMode === "login-xueqiu") {
    return {
      ...common,
      sources: PREVIEW_SOURCES.filter((s) => s.platform === "x"),
      following: [],
      timelines: { "x:preview_x": PREVIEW_POSTS["x:preview_x"] },
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: "x:preview_x",
      account: null,
      loggedIn: false,
      status: "logged-out",
      platformSessions: { xueqiu: "logged-out", x: "logged-in", weibo: "logged-out" },
      notice: "雪球未登录：请先去雪球登录后再订阅雪球关注",
      openAddDialog: true,
      addPickerTab: "xueqiu",
    };
  }

  if (demoMode === "login-xueqiu-empty") {
    return {
      ...common,
      sources: PREVIEW_SOURCES.filter((source) => source.platform === "x"),
      following: [],
      timelines: { "x:preview_x": PREVIEW_POSTS["x:preview_x"] },
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: "x:preview_x",
      account: { id: "preview", name: "演示测试账号" },
      loggedIn: true,
      status: "logged-in",
      platformSessions: { xueqiu: "logged-in", x: "logged-in", weibo: "logged-in" },
      openAddDialog: true,
      addPickerTab: "xueqiu",
    };
  }

  if (demoMode === "login-split") {
    return {
      ...common,
      timelines: PREVIEW_POSTS,
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: FEED_ALL,
      platformSessions: { xueqiu: "logged-in", x: "logged-out", weibo: "logged-in" },
      notice: "雪球已登录，X 未登录（X 仍可用推荐列表+搜索）",
    };
  }

  if (demoMode === "login-checking") {
    return {
      ...common,
      sources: [],
      following: [],
      timelines: {},
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: FEED_ALL,
      account: null,
      loggedIn: false,
      status: "checking",
      platformSessions: { xueqiu: "checking", x: "checking", weibo: "checking" },
      notice: "正在检测各平台登录态…",
    };
  }

  if (demoMode === "x-picker") {
    return {
      ...common,
      sources: [
        { platform: "x", id: "preview_x2", name: "Demo X User 2", avatar: DEMO_AVATAR_X2 },
        { platform: "x", id: "preview_x", name: "Demo X User", avatar: DEMO_AVATAR_X },
      ],
      timelines: {
        "x:preview_x2": PREVIEW_POSTS["x:preview_x2"],
        "x:preview_x": PREVIEW_POSTS["x:preview_x"],
      },
      timelineError: {},
      settings: baseSettings,
      selectedFeedKey: FEED_ALL,
      openAddDialog: true,
      addPickerTab: "x",
      notice: "X 点选：已订阅 + 推荐（" + X_SUGGESTIONS.length + " 项基线）",
    };
  }


  if (demoMode === "scroll-anchor") {
    const original = {
      ...PREVIEW_POSTS["xueqiu:10001"][0],
      id: "910001",
      title: "【原顶部帖】请保持在视口",
      summary: "验收用：这条是刷新前的顶部内容。新帖插入后应仍留在视口，新帖在它上方。",
      timestamp: now - 30 * 1000,
      url: "https://xueqiu.com/10001/910001",
      feedKey: "xueqiu:10001",
      platform: "xueqiu" as const,
      mediaUrls: ["/fixtures/avatar-demo-xq.svg"],
    };
    const fillers = Array.from({ length: 12 }, (_, index) => ({
      ...PREVIEW_POSTS["xueqiu:10001"][0],
      id: String(910002 + index),
      title: "【下方帖 " + String(index + 1) + "】用于把时间线拉长",
      summary: "填充正文，保证出现滚动条。第 " + String(index + 1) + " 条。",
      timestamp: now - (index + 2) * 5 * 60 * 1000,
      url: "https://xueqiu.com/10001/" + String(910002 + index),
      feedKey: "xueqiu:10001",
      platform: "xueqiu" as const,
      mediaUrls: index % 3 === 0 ? ["/fixtures/avatar-demo-x.svg"] : [],
    }));
    return {
      ...common,
      selectedFeedKey: FEED_ALL,
      timelines: {
        ...PREVIEW_POSTS,
        "xueqiu:10001": [original, ...fillers],
      },
      timelineError: {},
      settings: baseSettings,
      notice: "滚动锚点演示：可调用预览插入以验证原帖保持与胶囊回顶",
    };
  }

  return {
    ...common,
    selectedFeedKey: FEED_ALL,
    timelines: PREVIEW_POSTS,
    timelineError: {},
    settings: baseSettings,
  };
}
