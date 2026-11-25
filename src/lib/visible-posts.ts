import { FEED_ALL, VISIBLE_PLATFORMS, type FeedPerson, type Platform } from "./config";
import { sanitizeFeedPost, type Post } from "./sanitize";

/** 首页分列顺序：仅展示雪球 / X / 微博 */
export const HOME_PLATFORMS: readonly Platform[] = [...VISIBLE_PLATFORMS];

export function feedsForPlatform(feedList: FeedPerson[], platform: Platform): FeedPerson[] {
  return feedList.filter((person) => person.platform === platform);
}

/**
 * 与侧栏时间线同一套聚合：按订阅源取已缓存帖子、去重、搜索、排序。
 * 不发明帖子；没有源或没有缓存时返回空数组。
 */
export function collectVisiblePosts(input: {
  timelines: Record<string, unknown[]>;
  feedList: FeedPerson[];
  query?: string;
  sort?: "asc" | "desc";
  feedKey?: string;
}): Post[] {
  const query = String(input.query || "")
    .trim()
    .toLowerCase();
  const activeFeedKey = input.feedKey || FEED_ALL;
  const isAllFeed = activeFeedKey === FEED_ALL;
  let posts: Post[] = [];
  if (isAllFeed) {
    const seen = new Set<string>();
    for (const person of input.feedList) {
      const list = Array.isArray(input.timelines[person.key]) ? input.timelines[person.key] : [];
      for (const raw of list) {
        const post = sanitizeFeedPost(raw, person.key);
        if (!post) continue;
        const dedupe = person.key + ":" + post.id;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        posts.push({
          ...post,
          feedKey: person.key,
          feedName: person.name || person.id,
          feedPlatform: person.platform,
        });
      }
    }
  } else {
    const list = Array.isArray(input.timelines[activeFeedKey])
      ? input.timelines[activeFeedKey]
      : [];
    posts = list.map((item) => sanitizeFeedPost(item, activeFeedKey)).filter(Boolean) as Post[];
  }
  if (query) {
    posts = posts.filter((post) => {
      const haystack =
        post.title +
        " " +
        post.summary +
        " " +
        (post.quoted ? post.quoted.text + " " + post.quoted.authorName : "");
      return haystack.toLowerCase().includes(query);
    });
  }
  const direction = input.sort === "asc" ? 1 : -1;
  posts.sort((a, b) => (a.timestamp - b.timestamp) * direction);
  return posts;
}

export function collectPlatformPosts(input: {
  timelines: Record<string, unknown[]>;
  feedList: FeedPerson[];
  platform: Platform;
  query?: string;
  sort?: "asc" | "desc";
}): Post[] {
  return collectVisiblePosts({
    timelines: input.timelines,
    feedList: feedsForPlatform(input.feedList, input.platform),
    query: input.query,
    sort: input.sort,
    feedKey: FEED_ALL,
  });
}
