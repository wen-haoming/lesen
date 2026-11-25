/*
 * MAIN world 桥接层：使用当前雪球标签页已有登录态读取当前用户、其关注列表及所选关注人的时间线。
 * 只请求雪球站内接口，不读取页面上无关内容，不向任何第三方发送数据。
 */
(function () {
  "use strict";

  const CFG = globalThis.XQ_DADAO_CONFIG;
  if (!CFG || globalThis.__xqDadaoBridgeReady) return;
  Object.defineProperty(globalThis, "__xqDadaoBridgeReady", {
    value: true,
    writable: false,
    configurable: false,
  });

  const { MSG_TAG, LIMIT, TARGET } = CFG;
  const emitted = new Set();
  let activeUser = null;
  let followingIds = new Set();
  let requestSerial = 0;
  let apiRequestSerial = 0;
  const pendingApiRequests = new Map();

  function emit(payload) {
    try {
      window.postMessage({ [MSG_TAG]: 1, payload }, location.origin);
    } catch (e) {
      /* noop */
    }
  }

  function isXueqiu(url) {
    try {
      const host = new URL(url, location.href).hostname;
      return host === "xueqiu.com" || host.endsWith(".xueqiu.com");
    } catch (e) {
      return false;
    }
  }

  function stripHtml(input) {
    const strip = globalThis.XQ_EMOJI && globalThis.XQ_EMOJI.stripXueqiuHtml;
    if (strip) return strip(input);
    if (!input) return "";
    let text = "";
    try {
      text = new DOMParser().parseFromString(String(input), "text/html").body.textContent || "";
    } catch (e) {
      text = String(input).replace(/<[^>]*>/g, " ");
    }
    return text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toTimestamp(s) {
    const raw = Number(s.created_at ?? s.createdAt ?? s.time ?? s.publish_time ?? 0);
    if (raw && Number.isFinite(raw)) return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    return Date.now();
  }

  function safePostUrl(s, uid, id) {
    try {
      const target = typeof s.target === "string" ? s.target : "";
      const parsed = new URL(target || "/" + uid + "/" + id, "https://xueqiu.com");
      if (parsed.hostname !== "xueqiu.com" && !parsed.hostname.endsWith(".xueqiu.com"))
        throw new Error("host");
      if (!/\/\d+\/\d+/.test(parsed.pathname)) throw new Error("path");
      return parsed.href;
    } catch (e) {
      return "https://xueqiu.com/" + uid + "/" + id;
    }
  }

  function readCount(source, keys) {
    if (!source || typeof source !== "object") return 0;
    for (const key of keys) {
      const raw = source[key];
      if (raw === undefined || raw === null || raw === "") continue;
      const num = Number(raw);
      if (Number.isFinite(num)) return num > 0 ? Math.round(num) : 0;
    }
    return 0;
  }

  function forceHttpsUrl(value) {
    var s = String(value || "").trim();
    if (!s) return "";
    if (s.indexOf("//") === 0) s = "https:" + s;
    if (/^http:\/\//i.test(s)) s = "https://" + s.slice(7);
    if (!/^https:\/\//i.test(s)) return "";
    return s.slice(0, 500);
  }

  /** 从雪球 status 已知图片字段提取；无字段则空数组，不造假图 */
  function extractMediaUrls(status) {
    if (!status || typeof status !== "object") return [];
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      const url = forceHttpsUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };
    const domainRaw = String(status.photo_domain || status.pic_domain || "")
      .trim()
      .replace(/\/$/, "");
    const domain =
      forceHttpsUrl(domainRaw) ||
      (domainRaw ? forceHttpsUrl("https://" + domainRaw.replace(/^\/+/, "")) : "");

    const fromList = (list) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (typeof item === "string") push(item);
        else if (item && typeof item === "object") {
          push(
            item.url || item.src || item.pic || item.large || item.original || item.original_pic,
          );
        }
      }
    };
    fromList(status.pics);
    fromList(status.images);
    fromList(status.pic_sizes);

    const pic = status.pic ?? status.cover_pic ?? status.imgUrl ?? "";
    if (typeof pic === "string" && pic.trim()) {
      const parts = pic
        .split(/[,，\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        if (/^https?:\/\//i.test(part) || part.indexOf("//") === 0) push(part);
        else if (domain && part) push(domain + (part.indexOf("/") === 0 ? part : "/" + part));
      }
    }
    return out.slice(0, 9);
  }

  function replyHandleFrom(status, body) {
    const field = String(
      status.reply_screen_name ||
        status.reply_to_screenname ||
        status.in_reply_to_screen_name ||
        "",
    )
      .trim()
      .replace(/^@/, "");
    if (field) return field.slice(0, 60);
    const m = String(body || "").match(/^\s*回复\s*@([^\s:：]+)\s*[:：]?/i);
    return m ? m[1].slice(0, 60) : "";
  }

  function normalizeQuote(retweet) {
    if (!retweet || typeof retweet !== "object") return null;
    const user = retweet.user || retweet.author || {};
    const uid = String(retweet.user_id ?? retweet.userId ?? user.id ?? "");
    const id = String(retweet.id ?? retweet.status_id ?? "");
    const text = stripHtml(retweet.description ?? retweet.text ?? retweet.content ?? "");
    const authorName = String(user.screen_name ?? user.name ?? user.screenName ?? "").trim();
    if (!text && !authorName) return null;
    const mediaUrls = extractMediaUrls(retweet);
    const out = {
      authorName: authorName.slice(0, 60),
      // 引用按原文完整保留，不做摘要截断
      text: text.slice(0, 800),
      url: /^\d+$/.test(uid) && /^\d+$/.test(id) ? safePostUrl(retweet, uid, id) : "",
      likeCount: readCount(retweet, ["like_count", "likeCount", "likes_count", "fav_count"]),
    };
    if (mediaUrls.length) out.mediaUrls = mediaUrls;
    return out;
  }

  function normalize(s, expectedUid) {
    if (!s || typeof s !== "object") return null;
    const user = s.user || s.author || {};
    const uid = String(s.user_id ?? s.userId ?? s.uid ?? user.id ?? user.uid ?? user.user_id ?? "");
    if (!expectedUid || uid !== String(expectedUid)) return null;
    const id = String(s.id ?? s.status_id ?? s.statusId ?? "");
    if (!/^\d+$/.test(id)) return null;
    const retweet = s.retweet_status || s.retweeted_status || null;
    const hasRetweetFlag = !!(retweet && typeof retweet === "object");
    const source = stripHtml(s.source || s.source_name || s.device || "");
    // 默认隐藏 iPad/iPhone 来源；固定阅读对象（大道）常仅用客户端发帖，需保留。
    if (/\bipad\b|\biphone\b/i.test(source) && String(expectedUid) !== String(TARGET.userId))
      return null;
    // 正文只取帖子自身内容；引用原文单独放进 quoted，避免两者混在一起。
    const body = stripHtml(s.description ?? s.text ?? s.content ?? s.content_text ?? "");
    const quoted = normalizeQuote(retweet);
    const quoteMissing = hasRetweetFlag && !quoted;
    const mediaUrls = extractMediaUrls(s);
    const replyToHandle = replyHandleFrom(s, body);
    const title =
      stripHtml(s.title || "") ||
      (body.split(/[。！？!?\n]/)[0] || "").trim() ||
      (quoted ? (quoted.authorName ? "转发了 @" + quoted.authorName : "转发动态") : "无标题");
    const out = {
      id,
      userId: uid,
      authorName: String(
        user.screen_name ?? user.name ?? user.screenName ?? s.user_name ?? activeUser?.name ?? "",
      ),
      title: title.slice(0, LIMIT.titleChars),
      summary: body.slice(0, LIMIT.summaryChars),
      timestamp: toTimestamp(s),
      timeText: String(s.timeBefore || s.time_before || "").slice(0, 30),
      source,
      url: safePostUrl(s, uid, id),
      isRetweet: hasRetweetFlag || !!quoted,
      likeCount: readCount(s, ["like_count", "likeCount", "likes_count", "fav_count", "like"]),
      replyCount: readCount(s, ["reply_count", "replyCount", "comment_count", "comments_count"]),
      retweetCount: readCount(s, ["retweet_count", "retweetCount", "share_count"]),
      quoted,
      quoteMissing,
    };
    if (mediaUrls.length) out.mediaUrls = mediaUrls;
    if (replyToHandle) out.replyToHandle = replyToHandle;
    return out;
  }

  function collectArray(data) {
    if (!data || typeof data !== "object") return [];
    const out = [];
    const push = (v) => {
      if (Array.isArray(v)) out.push(...v);
    };
    push(data.statuses);
    push(data.list);
    push(data.items);
    push(data.friends);
    push(data.users);
    const d = data.data;
    if (d && typeof d === "object") {
      push(d.statuses);
      push(d.list);
      push(d.items);
      push(d.friends);
      push(d.users);
      if (d.friends && Array.isArray(d.friends.list)) push(d.friends.list);
    }
    if (data.statuses && !Array.isArray(data.statuses) && typeof data.statuses === "object")
      push(data.statuses.statuses);
    return out;
  }

  function payloadData(data) {
    return (data && (data.data || data.result || data)) || {};
  }

  function xqAvatar(raw) {
    const fn = globalThis.XQ_DADAO_CONFIG && globalThis.XQ_DADAO_CONFIG.xueqiuAvatarUrl;
    return typeof fn === "function" ? fn(raw) : "";
  }

  function normalizeUser(raw) {
    if (!raw || typeof raw !== "object") return null;
    const profile = String(raw.profile || raw.url || "");
    const fromProfile = profile.match(/(?:\/u)?\/(\d+)(?:[/?#]|$)/);
    const id = String(
      raw.id ?? raw.user_id ?? raw.uid ?? raw.userId ?? (fromProfile && fromProfile[1]) ?? "",
    );
    if (!/^\d+$/.test(id)) return null;
    const name = String(raw.screen_name ?? raw.name ?? raw.nickname ?? raw.user_name ?? "").trim();
    if (!name) return null;
    return { id, name, avatar: xqAvatar(raw) };
  }

  function requestJsonViaBackground(url, timeoutMs) {
    const requestId = "bg" + ++apiRequestSerial;
    const ms = timeoutMs || 8000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingApiRequests.delete(requestId);
        reject(new Error("TIMEOUT"));
      }, ms);
      pendingApiRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      emit({ type: "API_REQUEST", requestId, url });
    });
  }

  async function requestJson(url, timeoutMs) {
    const parsed = new URL(url, location.href);
    if (
      parsed.protocol !== "https:" ||
      (parsed.hostname !== "xueqiu.com" && !parsed.hostname.endsWith(".xueqiu.com"))
    ) {
      throw new Error("XUEQIU_URL_NOT_ALLOWED");
    }
    return requestJsonViaBackground(parsed.href, timeoutMs || 8000);
  }

  function extractCurrent(data) {
    if (!data || typeof data !== "object") return null;
    const candidates = [
      data.user,
      data.data?.user,
      data.data,
      data.result?.user,
      data.result,
      data,
    ];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const id = String(candidate.id ?? candidate.user_id ?? candidate.uid ?? "");
      const name = String(
        candidate.screen_name ?? candidate.name ?? candidate.nickname ?? "",
      ).trim();
      if (/^\d+$/.test(id) && name && candidate.error_code === undefined) {
        return { id, name, avatar: xqAvatar(candidate) };
      }
    }
    return null;
  }

  function readCookie(name) {
    try {
      const raw = String(document.cookie || "");
      for (const pair of raw.split(";")) {
        const at = pair.indexOf("=");
        if (at < 0) continue;
        if (pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
      }
    } catch (error) {
      /* noop */
    }
    return "";
  }

  // 只上报“存在与否 + 长度”，凭据本身不进入消息、不落盘。
  function cookieSnapshot() {
    const snapshot = { readable: true };
    try {
      snapshot.readable = String(document.cookie || "").length > 0;
    } catch (error) {
      snapshot.readable = false;
    }
    for (const key of ["u", "xq_is_login", "xq_a_token", "xqat", "xq_r_token", "s"]) {
      snapshot[key] = readCookie(key) ? readCookie(key).length : 0;
    }
    return snapshot;
  }

  function parseUid(text) {
    if (!text) return "";
    const direct = String(text).trim();
    if (/^\d{3,}$/.test(direct)) return direct;
    const attempts = [direct];
    try {
      attempts.push(decodeURIComponent(direct));
    } catch (error) {
      /* noop */
    }
    try {
      attempts.push(atob(direct.replace(/-/g, "+").replace(/_/g, "/")));
    } catch (error) {
      /* noop */
    }
    for (const attempt of attempts) {
      if (!attempt) continue;
      if (/^\d{3,}$/.test(attempt)) return attempt;
      try {
        const obj = JSON.parse(attempt);
        const id = String((obj && (obj.user_id ?? obj.id ?? obj.uid)) ?? "");
        if (/^\d{3,}$/.test(id)) return id;
      } catch (error) {
        /* noop */
      }
    }
    const loose = direct.match(/(\d{5,})/);
    return loose ? loose[1] : "";
  }

  function userFromGlobals() {
    const pools = [];
    const grab = (getter) => {
      try {
        pools.push(getter());
      } catch (error) {
        /* noop */
      }
    };
    grab(() => globalThis.SNB && globalThis.SNB.user);
    grab(() => globalThis.__INITIAL_STATE__ && globalThis.__INITIAL_STATE__.user);
    grab(() => globalThis.$snb && globalThis.$snb.user);
    for (const raw of pools) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id ?? raw.user_id ?? raw.uid ?? "");
      const name = String(raw.screen_name ?? raw.name ?? raw.nickname ?? "").trim();
      if (/^\d{3,}$/.test(id)) return { id, name, avatar: xqAvatar(raw) };
    }
    return null;
  }

  function userFromDom() {
    // 兜底：只认“指向纯数字主页 + 内含头像图”且位于页面顶部的链接，避免取到他人工号。
    try {
      let best = null;
      for (const node of document.querySelectorAll("a[href]")) {
        const match = String(node.getAttribute("href") || "").match(/^\/(\d{5,})(?:[/?#]|$)/);
        if (!match) continue;
        const img = node.querySelector("img");
        if (!img) continue;
        const rect = node.getBoundingClientRect();
        if (!rect || rect.top < 0 || rect.top > 260) continue;
        if (!best || rect.top < best.top) {
          best = {
            id: match[1],
            name: String(node.getAttribute("title") || img.getAttribute("alt") || "").trim(),
            top: rect.top,
          };
        }
      }
      if (best) return { id: best.id, name: best.name, avatar: "" };
    } catch (error) {
      /* noop */
    }
    return null;
  }

  /*
   * knownUid 来自后台 chrome.cookies（能读到 HttpOnly 的 u），是本插件最可靠的登录身份来源。
   * 页面内 document.cookie 通常读不到 u / xq_a_token，因此这里不再把“读不到 cookie”当作未登录。
   */
  async function getCurrentUser(knownUid) {
    const tried = [];
    let apiUser = null;
    const known = /^\d{3,}$/.test(String(knownUid || "")) ? String(knownUid) : "";

    const paths = known
      ? ["/user/current.json"]
      : ["/user/current.json", "/v4/user/info.json", "/v4/user/self.json"];
    for (const path of paths) {
      const label = path.slice(1);
      try {
        const data = await requestJson("https://xueqiu.com" + path + "?_=" + Date.now());
        const user = extractCurrent(data);
        if (user) {
          tried.push(label + " → " + user.id);
          apiUser = user;
          break;
        }
        const note =
          data && (data.error_description || data.error_code)
            ? String(data.error_description || data.error_code).slice(0, 60)
            : "no-user";
        tried.push(label + " → " + note);
      } catch (error) {
        tried.push(label + " → " + String(error.message || error).slice(0, 60));
      }
    }

    // 已知 uid 但没拿到昵称时，单独补一次用户资料，避免顶部只显示数字 ID。
    if (known && (!apiUser || String(apiUser.id) !== known)) {
      try {
        const data = await requestJson(
          "https://xueqiu.com/v4/users/show.json?user_id=" + known + "&_=" + Date.now(),
        );
        const user = extractCurrent(data);
        if (user && String(user.id) === known) {
          apiUser = user;
          tried.push("v4/users/show.json → " + user.id);
        } else {
          tried.push("v4/users/show.json → no-user");
        }
      } catch (error) {
        tried.push("v4/users/show.json → " + String(error.message || error).slice(0, 40));
      }
    }

    const fromGlobals = userFromGlobals();
    const cookieUid = parseUid(readCookie("u"));
    const fromDom = known || cookieUid || apiUser || fromGlobals ? null : userFromDom();

    // 身份来源优先级：后台 cookie（HttpOnly，最可靠）→ 接口 → 页面全局 → 页面 cookie → DOM。
    const sources = [];
    if (known)
      sources.push({ user: { id: known, name: "", avatar: "" }, source: "chrome-cookies" });
    if (apiUser) sources.push({ user: apiUser, source: "user-api" });
    if (fromGlobals) sources.push({ user: fromGlobals, source: "page-global" });
    if (cookieUid)
      sources.push({ user: { id: cookieUid, name: "", avatar: "" }, source: "cookie-u" });
    if (fromDom) sources.push({ user: fromDom, source: "dom" });

    const primary = sources[0] || null;
    let user = null;
    if (primary) {
      // 昵称可从任一来源补齐，id 以主来源为准。
      const name = sources.map((item) => item.user.name).find(Boolean) || "";
      user = {
        id: primary.user.id,
        name: name || "用户 " + primary.user.id,
        avatar: primary.user.avatar || "",
      };
    }

    return {
      user,
      source: primary ? primary.source : "",
      tried,
      hasLoginFlag: readCookie("xq_is_login") === "1",
      hasToken: !!readCookie("xq_a_token"),
      diagnostics: {
        href: location.href.slice(0, 200),
        cookies: cookieSnapshot(),
        endpoints: tried,
      },
    };
  }

  function followArray(data) {
    const d = payloadData(data);
    const list = collectArray(data);
    if (list.length) return list;
    for (const key of ["friends", "users", "list", "items", "following"]) {
      if (Array.isArray(d[key])) return d[key];
      if (d[key] && Array.isArray(d[key].list)) return d[key].list;
      if (d[key] && Array.isArray(d[key].users)) return d[key].users;
    }
    return [];
  }

  /*
   * 雪球关注列表路由几经变动，单一路由经常返回空数组（而不是报错），
   * 旧实现会把“空”当“成功”，导致上层以为在读取中从而永久等待。
   * 这里逐条路由尝试，只有真的拿到人才返回；全空则抛 FOLLOWING_EMPTY 并带上每条路由的回执。
   */
  const FOLLOW_ROUTES = [
    {
      name: "friendships/following",
      build: (uid, page) =>
        "https://xueqiu.com/friendships/following.json?user_id=" +
        uid +
        "&page=" +
        page +
        "&count=100",
    },
    {
      name: "groups/members",
      build: (uid, page) =>
        "https://xueqiu.com/friendships/groups/members.json?uid=" +
        uid +
        "&gid=0&page=" +
        page +
        "&count=100",
    },
    {
      name: "v4/friends",
      build: (uid, page) =>
        "https://xueqiu.com/v4/friendships/friends.json?uid=" +
        uid +
        "&page=" +
        page +
        "&count=100",
    },
  ];

  async function fetchFollowingRoute(route, uid, notes) {
    const all = new Map();
    for (let page = 1; page <= 12; page++) {
      const url = route.build(encodeURIComponent(uid), page) + "&_=" + Date.now();
      let data;
      try {
        data = await requestJson(url, 9000);
      } catch (error) {
        if (error && error.platformPause) throw error;
        notes.push(route.name + " p" + page + " → " + String(error.message || error).slice(0, 40));
        return all;
      }
      if (!data || typeof data !== "object") {
        notes.push(route.name + " p" + page + " → 空响应");
        return all;
      }
      if (data.error_code || data.error_description) {
        notes.push(
          route.name + " → " + String(data.error_description || data.error_code).slice(0, 42),
        );
        return all;
      }
      const rawList = followArray(data);
      for (const raw of rawList) {
        const person = normalizeUser(raw);
        if (person && person.id !== String(uid)) all.set(person.id, person);
      }
      if (rawList.length < 20) break;
    }
    notes.push(route.name + " → " + all.size + " 人");
    return all;
  }

  async function getFollowing(uid) {
    const notes = [];
    for (const route of FOLLOW_ROUTES) {
      let all;
      try {
        all = await fetchFollowingRoute(route, uid, notes);
      } catch (error) {
        if (error && error.platformPause) {
          const paused = new Error("PLATFORM_PAUSED");
          paused.retryAfterMs = Number(error.retryAfterMs) || 0;
          paused.platformPause = true;
          throw paused;
        }
        throw error;
      }
      if (all.size) return { list: Array.from(all.values()).slice(0, 2000), notes };
    }
    const error = new Error("FOLLOWING_EMPTY");
    error.detail = notes;
    throw error;
  }

  // 关注时间线不依赖 user_id，可直接验证登录态，并在拿不到自身 uid 时给出关注对象。
  async function probeHomeTimeline() {
    for (const path of [
      "/v6/statuses/home/timeline.json?since_id=-1&max_id=-1&count=20&type=0",
      "/v4/statuses/home/timeline.json?since_id=-1&max_id=-1&count=20&type=0",
    ]) {
      try {
        const data = await requestJson("https://xueqiu.com" + path + "&_=" + Date.now());
        const list = collectArray(data);
        if (list.length) return list;
      } catch (error) {
        /* 尝试下一个路由 */
      }
    }
    return [];
  }

  async function loadAccount(knownUid, externalStatus) {
    if (!isXueqiu(location.href)) {
      emit({ type: "ACCOUNT_RESULT", ok: false, reason: "NOT_XUEQIU" });
      return;
    }
    const serial = ++requestSerial;
    emit({ type: "ACCOUNT_LOADING" });
    const probe = await getCurrentUser(knownUid);
    if (serial !== requestSerial) return;

    if (probe.user) {
      activeUser = probe.user;
      let following = [];
      let followError = "";
      let followNotes = [];
      try {
        const result = await getFollowing(probe.user.id);
        following = result.list;
        followNotes = result.notes;
      } catch (error) {
        followError = error.message === "FOLLOWING_EMPTY" ? "FOLLOWING_EMPTY" : "FOLLOWING_FAILED";
        followNotes = Array.isArray(error.detail)
          ? error.detail
          : [String(error.message || error).slice(0, 42)];
      }
      if (serial !== requestSerial) return;

      // 关注列表为空时不再塞入固定作者「大道」；由弹窗引导用户登录或重试。
      const candidates = new Map();
      for (const person of following) candidates.set(person.id, person);
      if (!followError && !candidates.has(probe.user.id)) {
        candidates.set(probe.user.id, {
          id: probe.user.id,
          name: probe.user.name || "用户 " + probe.user.id,
        });
      }
      const list = Array.from(candidates.values());
      followingIds = new Set(list.map((user) => user.id));
      emit({
        type: "ACCOUNT_RESULT",
        ok: true,
        status: "logged-in",
        loggedIn: true,
        account: probe.user,
        following: list,
        degraded: !!followError,
        error: followError,
        diagnostics: {
          ...probe.diagnostics,
          uidSource: probe.source,
          followingCount: following.length,
          followingFrom: followError ? "关注列表接口无数据" : "关注列表接口",
          followNotes: followNotes.slice(-6),
          loginSource: externalStatus === "logged-in" ? "chrome.cookies + 页面会话" : "页面会话",
        },
      });
      return;
    }

    // 拿不到自身 uid：用关注时间线独立确认登录态，并用其中出现的作者兜底可切换对象。
    const homeList = await probeHomeTimeline();
    if (serial !== requestSerial) return;
    const authors = new Map();
    for (const raw of homeList) {
      const person = normalizeUser(raw && (raw.user || raw.author));
      if (person) authors.set(person.id, person);
    }
    const fallbackFollowing = Array.from(authors.values());

    if (fallbackFollowing.length) {
      activeUser = null;
      followingIds = new Set(fallbackFollowing.map((user) => user.id));
      emit({
        type: "ACCOUNT_RESULT",
        ok: true,
        status: "logged-in",
        loggedIn: true,
        account: null,
        following: fallbackFollowing,
        partial: true,
        diagnostics: {
          ...probe.diagnostics,
          uidSource: "home-timeline",
          followingCount: fallbackFollowing.length,
        },
      });
      return;
    }

    // 后台 cookie 已确认登录、或页面存在匿名 token 时，都不能断言“未登录”，交回可重试的未知状态。
    const externallyLoggedIn = externalStatus === "logged-in";
    const status =
      externallyLoggedIn || probe.hasLoginFlag || probe.hasToken ? "unknown" : "logged-out";
    emit({
      type: "ACCOUNT_RESULT",
      ok: true,
      status,
      loggedIn: status === "logged-in" ? true : status === "logged-out" ? false : null,
      account: null,
      following: [],
      reason: status === "logged-out" ? "NOT_LOGGED_IN" : "ACCOUNT_UNKNOWN",
      diagnostics: {
        ...probe.diagnostics,
        uidSource: probe.source || "none",
        followingCount: 0,
        loginFlag: probe.hasLoginFlag,
        token: probe.hasToken,
        external: externalStatus || "none",
      },
    });
  }

  function harvest(data, url, source, uid) {
    const expectedUid = String(uid || activeUser?.id || "");
    // 只采集关注列表中确认过的对象；关注列表接口未拿到时按明确 uid 放行，避免整条链路空转。
    if (!expectedUid) return [];
    if (followingIds.size && !followingIds.has(expectedUid)) return [];
    const fresh = [];
    for (const raw of collectArray(data)) {
      const post = normalize(raw, expectedUid);
      if (!post) continue;
      const key = post.userId + ":" + post.id + ":" + post.timestamp + ":" + post.title;
      if (!emitted.has(key)) {
        emitted.add(key);
        fresh.push(post);
      }
    }
    if (fresh.length) emit({ type: "USER_POSTS", userId: expectedUid, posts: fresh, source, url });
    return fresh;
  }

  // 单页明显少于该条数即视为翻到末页
  const PAGE_MORE_MIN = 10;

  async function loadUserTimeline(user, opts) {
    const uid = String((user && user.id) || "");
    const name = String((user && user.name) || "");
    const info = opts && typeof opts === "object" ? opts : {};
    const page = Math.max(1, Number(info.page) || 1);
    const loadMore = !!info.loadMore;
    if (!/^\d+$/.test(uid) || (followingIds.size && !followingIds.has(uid))) {
      emit({
        type: "USER_TIMELINE_RESULT",
        ok: false,
        userId: uid,
        error: "NOT_FOLLOWING",
        loadMore,
      });
      return;
    }
    activeUser = { id: uid, name };
    const serial = ++requestSerial;
    if (!loadMore) emit({ type: "USER_LOADING", userId: uid, user: activeUser });
    const templates = [
      "https://xueqiu.com/statuses/user_timeline.json?user_id={uid}&page=" +
        page +
        "&count=20&_={ts}",
    ];
    let lastError = "暂无数据";
    for (const template of templates) {
      const url = template
        .replace("{uid}", encodeURIComponent(uid))
        .replace("{ts}", String(Date.now()));
      try {
        const data = await requestJson(url);
        if (serial !== requestSerial) return;
        if (data.error_code || data.error_description) {
          lastError = String(data.error_description || data.error_msg || "接口暂不可用");
          if (/RATE_LIMIT|300011|过于频繁|验证码|风控|安全验证/i.test(lastError)) {
            emit({
              type: "USER_TIMELINE_RESULT",
              ok: false,
              userId: uid,
              error: lastError,
              platformPause: true,
              retryAfterMs: 5 * 60 * 1000,
              loadMore,
            });
            return;
          }
          continue;
        }
        const rawCount = collectArray(data).length;
        const hasMore = rawCount >= PAGE_MORE_MIN;
        const posts = harvest(data, url, "manual", uid);
        if (posts.length) {
          emit({
            type: "USER_TIMELINE_RESULT",
            ok: true,
            userId: uid,
            count: posts.length,
            at: Date.now(),
            page,
            hasMore,
            loadMore,
          });
          return;
        }
        // 成功的空列表也属有效结果；若 API 有 statuses 字段，不必再重复打后备接口。
        if (Array.isArray(data.statuses) || Array.isArray(data.data?.statuses)) {
          emit({
            type: "USER_TIMELINE_RESULT",
            ok: true,
            userId: uid,
            count: 0,
            at: Date.now(),
            page,
            hasMore,
            loadMore,
          });
          return;
        }
        lastError = "时间线接口未返回帖子";
      } catch (error) {
        lastError = error.message === "NON_JSON" ? "雪球返回了非 JSON 内容" : error.message;
        if (error && error.platformPause) {
          emit({
            type: "USER_TIMELINE_RESULT",
            ok: false,
            userId: uid,
            error: lastError,
            retryAfterMs: Number(error.retryAfterMs) || 0,
            platformPause: true,
            loadMore,
          });
          return;
        }
      }
    }
    emit({ type: "USER_TIMELINE_RESULT", ok: false, userId: uid, error: lastError, loadMore });
  }

  // 页面自身请求只被动读取当前选择对象的动态；不会抓取其他人。
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      const result = originalFetch.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (
          isXueqiu(url) &&
          /\/statuses\/(?:original\/)?(?:user_)?timeline\.json|\/v\d+\/statuses\/user_timeline\.json/i.test(
            url,
          ) &&
          result?.then
        ) {
          result
            .then((response) =>
              response
                .clone()
                .json()
                .then((data) => {
                  const parsed = new URL(url, location.href);
                  harvest(data, url, "capture", parsed.searchParams.get("user_id"));
                })
                .catch(() => {}),
            )
            .catch(() => {});
        }
      } catch (error) {
        /* 观察失败不影响雪球原请求 */
      }
      return result;
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    XHR.open = function (method, url) {
      try {
        this.__xqDadaoUrl = String(url || "");
      } catch (e) {}
      return originalOpen.apply(this, arguments);
    };
    XHR.send = function () {
      try {
        const xhr = this;
        const url = xhr.__xqDadaoUrl || "";
        if (
          isXueqiu(url) &&
          /\/statuses\/(?:original\/)?(?:user_)?timeline\.json|\/v\d+\/statuses\/user_timeline\.json/i.test(
            url,
          )
        ) {
          xhr.addEventListener(
            "load",
            function () {
              try {
                const data = JSON.parse(xhr.responseText);
                const parsed = new URL(url, location.href);
                harvest(data, url, "capture", parsed.searchParams.get("user_id"));
              } catch (e) {
                /* noop */
              }
            },
            false,
          );
        }
      } catch (e) {
        /* noop */
      }
      return originalSend.apply(this, arguments);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window) return;
    const message = event.data;
    if (!message || message[MSG_TAG] !== 1 || !message.payload) return;
    const payload = message.payload;
    if (payload.type === "API_RESPONSE") {
      const pending = pendingApiRequests.get(payload.requestId);
      if (!pending) return;
      pendingApiRequests.delete(payload.requestId);
      if (payload.ok) pending.resolve(payload.data);
      else {
        const error = new Error(payload.error || "BACKGROUND_FETCH_FAILED");
        error.retryAfterMs = Number(payload.retryAfterMs) || 0;
        error.platformPause = !!payload.platformPause;
        pending.reject(error);
      }
      return;
    }
    if (payload.type === "ACCOUNT_REQUEST") loadAccount(payload.uid, payload.status);
    else if (payload.type === "LOAD_USER")
      loadUserTimeline(payload.user, { page: payload.page, loadMore: payload.loadMore });
  });
})();
