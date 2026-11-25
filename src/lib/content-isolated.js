/*
 * ISOLATED world 数据层：通过 MAIN world 复用雪球当前页面会话，读取当前账号关注列表及所选关注人的帖子。
 * 只写本地扩展存储；不注入页面 UI，不采集非所选用户的数据。
 */
(function () {
  "use strict";
  const CFG = globalThis.XQ_DADAO_CONFIG;
  if (!CFG || globalThis.__xqDadaoDataLayerReady) return;
  Object.defineProperty(globalThis, "__xqDadaoDataLayerReady", {
    value: true,
    writable: false,
    configurable: false,
  });

  const { TARGET, MSG_TAG, LIMIT } = CFG;
  let account = null;
  let loggedIn = null;
  let following = [];
  let sources = [];
  let timelines = {};
  let timelineSync = {};
  let timelineError = {};
  const clearedErrorKeys = new Set();
  let selectedUserId = "";
  let accountCheckedAt = 0;
  let saveTimer = null;
  let probing = false;
  let hydrated = false;
  // 后台用 chrome.cookies 读到的登录态（含 HttpOnly 的 u），页面脚本读不到这些 cookie。
  let session = { status: "", uid: "" };

  const storageGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  const storageSet = (data) => new Promise((resolve) => chrome.storage.local.set(data, resolve));

  function isFilteredSource(source, userId) {
    if (!/\bipad\b|\biphone\b/i.test(String(source || ""))) return false;
    return String(userId || "") !== String(TARGET.userId);
  }

  function safeCount(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  }

  function sanitizeMediaUrls(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      let url = "";
      if (typeof item === "string") url = item.trim();
      else if (item && typeof item === "object")
        url = String(item.url || item.src || item.pic || "").trim();
      if (!url) continue;
      if (url.indexOf("//") === 0) url = "https:" + url;
      if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
      if (!/^https:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url.slice(0, 500));
      if (out.length >= 9) break;
    }
    return out;
  }

  function safeQuote(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = String(raw.text || "").slice(0, 800);
    const authorName = String(raw.authorName || "").slice(0, 60);
    if (!text && !authorName) return null;
    let url = "";
    try {
      if (raw.url) {
        const parsed = new URL(String(raw.url), "https://xueqiu.com");
        if (parsed.hostname === "xueqiu.com" || parsed.hostname.endsWith(".xueqiu.com"))
          url = parsed.href;
      }
    } catch (e) {
      url = "";
    }
    const mediaUrls = sanitizeMediaUrls(raw.mediaUrls);
    const out = { authorName, text, url, likeCount: safeCount(raw.likeCount) };
    if (mediaUrls.length) out.mediaUrls = mediaUrls;
    return out;
  }

  function sanitize(raw, expectedUid) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || "");
    const userId = String(raw.userId || raw.user_id || expectedUid || "");
    if (
      !/^\d+$/.test(id) ||
      !/^\d+$/.test(userId) ||
      (expectedUid && userId !== String(expectedUid))
    )
      return null;
    if (isFilteredSource(raw.source, expectedUid)) return null;
    let url;
    try {
      url = new URL(String(raw.url || ""), "https://xueqiu.com");
      if (url.hostname !== "xueqiu.com" && !url.hostname.endsWith(".xueqiu.com")) return null;
    } catch (e) {
      return null;
    }
    const ts = Number(raw.timestamp);
    const quoted = safeQuote(raw.quoted);
    const isRetweet = !!raw.isRetweet;
    const mediaUrls = sanitizeMediaUrls(raw.mediaUrls);
    const replyToHandle = String(raw.replyToHandle || "")
      .trim()
      .replace(/^@/, "")
      .slice(0, 60);
    const out = {
      id,
      userId,
      authorName: String(raw.authorName || ""),
      title: String(raw.title || "无标题").slice(0, LIMIT.titleChars),
      summary: String(raw.summary || "").slice(0, LIMIT.summaryChars),
      timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      timeText: String(raw.timeText || "").slice(0, 30),
      source: String(raw.source || "").slice(0, 30),
      url: url.href,
      isRetweet,
      likeCount: safeCount(raw.likeCount),
      replyCount: safeCount(raw.replyCount),
      retweetCount: safeCount(raw.retweetCount),
      quoted,
      quoteMissing: !!(raw.quoteMissing || (isRetweet && !quoted)),
    };
    if (mediaUrls.length) out.mediaUrls = mediaUrls;
    if (replyToHandle) out.replyToHandle = replyToHandle;
    return out;
  }

  function safeAccount(raw) {
    if (!raw || typeof raw !== "object" || !/^\d+$/.test(String(raw.id || "")) || !raw.name)
      return null;
    return { id: String(raw.id), name: String(raw.name).slice(0, 80) };
  }

  function safeFollowing(raw) {
    if (!raw || typeof raw !== "object" || !/^\d+$/.test(String(raw.id || "")) || !raw.name)
      return null;
    const avFn = globalThis.XQ_DADAO_CONFIG && globalThis.XQ_DADAO_CONFIG.xueqiuAvatarUrl;
    const avatar = typeof avFn === "function" ? avFn(raw) : String(raw.avatar || "").slice(0, 500);
    return {
      id: String(raw.id),
      name: String(raw.name).slice(0, 80),
      avatar: String(avatar || "").slice(0, 500),
    };
  }

  function normalizeXueqiuKey(rawKey) {
    return /^\d+$/.test(String(rawKey || "")) ? "xueqiu:" + rawKey : String(rawKey || "");
  }

  function saveSoon() {
    if (!hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      storageGet(["timelines", "timelineSync", "timelineError", "following"])
        .then((disk) => {
          if (!disk || typeof disk !== "object") return;
          const diskTimelines =
            disk.timelines && typeof disk.timelines === "object" ? disk.timelines : {};
          const mergedTimelines = { ...diskTimelines };
          for (const [rawKey, value] of Object.entries(timelines)) {
            const key = normalizeXueqiuKey(rawKey);
            const mem = Array.isArray(value) ? value : [];
            const prev = Array.isArray(mergedTimelines[key]) ? mergedTimelines[key] : [];
            if (mem.length > prev.length) mergedTimelines[key] = mem;
          }
          const diskSync =
            disk.timelineSync && typeof disk.timelineSync === "object" ? disk.timelineSync : {};
          const mergedSync = { ...diskSync };
          for (const [rawKey, value] of Object.entries(timelineSync)) {
            const key = normalizeXueqiuKey(rawKey);
            const nextAt = Number(value) || 0;
            const prevAt = Number(mergedSync[key]) || 0;
            if (nextAt > prevAt) mergedSync[key] = nextAt;
          }
          const diskError =
            disk.timelineError && typeof disk.timelineError === "object" ? disk.timelineError : {};
          const mergedError = { ...diskError };
          for (const clearedKey of clearedErrorKeys) {
            delete mergedError[clearedKey];
          }
          for (const [rawKey, value] of Object.entries(timelineError)) {
            if (!value || typeof value !== "object") continue;
            const key = normalizeXueqiuKey(rawKey);
            const prevAt = Number(mergedError[key] && mergedError[key].at) || 0;
            const nextAt = Number(value.at) || 0;
            if (nextAt >= prevAt) mergedError[key] = value;
          }
          const diskFollowing = Array.isArray(disk.following) ? disk.following : [];
          const nextFollowing =
            following.length || loggedIn === false
              ? following
              : diskFollowing.length
                ? diskFollowing
                : following;
          return storageSet({
            account,
            loggedIn,
            following: nextFollowing,
            timelines: mergedTimelines,
            timelineSync: mergedSync,
            timelineError: mergedError,
            selectedUserId,
            accountCheckedAt,
          });
        })
        .catch(() => {});
    }, 100);
  }

  function broadcast(type, data) {
    try {
      chrome.runtime.sendMessage({ type, ...data }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* popup may already be closed */
    }
  }

  function postToMain(payload) {
    try {
      window.postMessage({ [MSG_TAG]: 1, payload }, location.origin);
    } catch (e) {
      /* noop */
    }
  }

  function mergePosts(userId, incoming) {
    const uid = String(userId || "");
    if (!/^\d+$/.test(uid) || !Array.isArray(incoming)) return 0;
    const old = Array.isArray(timelines[uid]) ? timelines[uid] : [];
    const map = new Map(old.map((post) => [post.id, post]));
    let changed = 0;
    for (const raw of incoming) {
      const post = sanitize(raw, uid);
      if (!post) continue;
      const prev = map.get(post.id);
      if (
        !prev ||
        post.summary.length > prev.summary.length ||
        post.timestamp !== prev.timestamp ||
        post.likeCount !== prev.likeCount ||
        post.replyCount !== prev.replyCount ||
        !prev.quoted !== !post.quoted
      ) {
        map.set(post.id, { ...prev, ...post });
        changed++;
      }
    }
    if (changed) {
      timelines = {
        ...timelines,
        [uid]: Array.from(map.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, LIMIT.posts),
      };
      saveSoon();
      broadcast("TIMELINE_UPDATED", { userId: uid, posts: timelines[uid].length });
    }
    return changed;
  }

  function chooseDefault() {
    if (selectedUserId && following.some((person) => person.id === selectedUserId))
      return selectedUserId;
    if (following.some((person) => person.id === TARGET.userId)) return TARGET.userId;
    return following[0] ? following[0].id : "";
  }

  let probingTimer = null;
  function requestAccount(force) {
    const age = Date.now() - accountCheckedAt;
    // 只有“确定已登录且已拿到关注列表”才复用缓存；未登录 / 未知状态必须重新探测。
    const reusable =
      loggedIn === true && following.length > 0 && accountCheckedAt && age < 2 * 60 * 1000;
    if (!force && reusable) {
      broadcast("ACCOUNT_RESULT", {
        ok: true,
        status: "logged-in",
        loggedIn,
        account,
        following,
        selectedUserId,
        cached: true,
      });
      return;
    }
    // force 必须能穿透探测锁：否则用户登录后回来点重试会被旧的 15 秒锁吃掉，
    // 请求发不出去、popup 只能退回到上一次的“未登录”快照。
    if (probing && !force) return;
    probing = true;
    if (probingTimer) clearTimeout(probingTimer);
    probingTimer = setTimeout(() => {
      probing = false;
      probingTimer = null;
    }, 15000);
    // 把后台 cookie 的 uid / 状态一并交给页面，避免页面因读不到 HttpOnly cookie 而误判未登录。
    postToMain({ type: "ACCOUNT_REQUEST", uid: session.uid || "", status: session.status || "" });
  }

  function setUser(userId, sendResponse, opts) {
    const uid = String(userId || "");
    let user = following.find((person) => person.id === uid);
    if (!user) {
      const pinned = sources.find((item) => item.platform === "xueqiu" && String(item.id) === uid);
      if (pinned)
        user = {
          id: uid,
          name: String(pinned.name || "用户 " + uid),
          avatar: String(pinned.avatar || ""),
        };
    }
    if (!user) {
      if (sendResponse) sendResponse({ ok: false, reason: "NOT_FOLLOWING" });
      return;
    }
    selectedUserId = uid;
    saveSoon();
    const info = opts && typeof opts === "object" ? opts : {};
    postToMain({
      type: "LOAD_USER",
      user,
      page: Number(info.page) || 1,
      loadMore: !!info.loadMore,
    });
    if (sendResponse) sendResponse({ ok: true });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window) return;
    const message = event.data;
    if (!message || message[MSG_TAG] !== 1 || !message.payload) return;
    const payload = message.payload;

    if (payload.type === "ACCOUNT_LOADING") {
      broadcast("ACCOUNT_LOADING", {});
    } else if (payload.type === "ACCOUNT_RESULT") {
      accountCheckedAt = Date.now();
      probing = false;
      // 三态：true=已登录 / false=确定未登录 / null=有登录痕迹但读不到（不能断言未登录）
      loggedIn = payload.loggedIn === true ? true : payload.loggedIn === false ? false : null;
      account = loggedIn ? safeAccount(payload.account) : null;
      following =
        loggedIn && Array.isArray(payload.following)
          ? payload.following.map(safeFollowing).filter(Boolean)
          : [];
      if (loggedIn !== true) selectedUserId = "";
      else selectedUserId = chooseDefault();
      saveSoon();
      broadcast("ACCOUNT_RESULT", {
        ok: !!payload.ok,
        status:
          payload.status ||
          (loggedIn === true ? "logged-in" : loggedIn === false ? "logged-out" : "unknown"),
        loggedIn,
        account,
        following,
        selectedUserId,
        partial: !!payload.partial,
        degraded: !!payload.degraded,
        error: payload.error || "",
        reason: payload.reason || "",
        diagnostics: payload.diagnostics || null,
      });
      if (loggedIn && selectedUserId) {
        const selected = following.find((person) => person.id === selectedUserId);
        if (selected) postToMain({ type: "LOAD_USER", user: selected });
      }
    } else if (payload.type === "API_REQUEST") {
      const finishApi = (ok, data, error, meta) => {
        postToMain({
          type: "API_RESPONSE",
          requestId: payload.requestId,
          ok: !!ok,
          data: data,
          error: String(error || ""),
          retryAfterMs: Number(meta && meta.retryAfterMs) || 0,
          platformPause: !!(meta && meta.platformPause),
        });
      };
      (async () => {
        const targetUrl = String(payload.url || "");
        let parsed;
        try {
          parsed = new URL(targetUrl, location.href);
        } catch (e) {
          finishApi(false, null, "BAD_URL");
          return;
        }
        if (
          (parsed.hostname !== "xueqiu.com" && !parsed.hostname.endsWith(".xueqiu.com")) ||
          parsed.protocol !== "https:"
        ) {
          finishApi(false, null, "XUEQIU_URL_NOT_ALLOWED");
          return;
        }
        try {
          chrome.runtime.sendMessage(
            { type: "XUEQIU_FETCH_JSON", url: parsed.href },
            (response) => {
              const runtimeError = chrome.runtime.lastError;
              const body = response || {};
              if (body.ok) finishApi(true, body.data, "");
              else
                finishApi(
                  false,
                  null,
                  body.error || runtimeError?.message || "BACKGROUND_FETCH_FAILED",
                  body,
                );
            },
          );
        } catch (e) {
          finishApi(false, null, "NO_EXTENSION");
        }
      })();
    } else if (payload.type === "USER_LOADING") {
      broadcast("USER_LOADING", { userId: payload.userId, user: payload.user });
    } else if (payload.type === "USER_POSTS") {
      mergePosts(payload.userId, payload.posts);
    } else if (payload.type === "USER_TIMELINE_RESULT") {
      const uid = String(payload.userId || "");
      const normKey = normalizeXueqiuKey(uid);
      if (payload.ok) {
        // 空数组同样是一次成功同步，避免旧内容被误认为仍是最新结果。
        if (!Array.isArray(timelines[uid])) timelines = { ...timelines, [uid]: [] };
        timelineSync = { ...timelineSync, [normKey]: Number(payload.at) || Date.now() };
        clearedErrorKeys.add(normKey);
        clearedErrorKeys.add(uid);
        if (timelineError[uid] || timelineError[normKey]) {
          const next = { ...timelineError };
          delete next[uid];
          delete next[normKey];
          timelineError = next;
        }
        saveSoon();
      } else if (uid) {
        clearedErrorKeys.delete(normKey);
        // 记下失败原因，popup 才能把“正在读取”换成可重试的失败提示
        timelineError = {
          ...timelineError,
          [normKey]: { error: String(payload.error || "").slice(0, 80), at: Date.now() },
        };
        saveSoon();
      }
      broadcast("USER_TIMELINE_RESULT", {
        ...payload,
        feedKey: payload.feedKey || (/^\d+$/.test(uid) ? "xueqiu:" + uid : uid),
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    // 后台每次转发都会带上 cookie 读到的登录态，这里始终以最新值覆盖。
    if (message.session && typeof message.session === "object" && message.session.status) {
      session = { status: String(message.session.status), uid: String(message.session.uid || "") };
    }
    // 用户在别处登录 / 退出后，cookie 变化会广播到这里，数据层跟着重新探测。
    if (message.type === "SESSION_CHANGED" && message.session) {
      session = {
        status: String(message.session.status || ""),
        uid: String(message.session.uid || ""),
      };
      accountCheckedAt = 0;
      requestAccount(true);
      return false;
    }
    if (message.type === "POPUP_ACCOUNT_REQUEST") {
      requestAccount(!!message.force);
      sendResponse({ ok: true });
      return false;
    }
    if (
      message.type === "POPUP_LOAD_USER" ||
      message.type === "POPUP_REFRESH" ||
      message.type === "POPUP_LOAD_MORE"
    ) {
      if (loggedIn !== true) {
        // 后台已确认登录、只是页面态还在探测：不要回退成“未登录”，让 popup 保持等待。
        if (session.status === "logged-in") {
          requestAccount(true);
          sendResponse({ ok: false, reason: "SETTLING" });
          return false;
        }
        sendResponse({
          ok: false,
          reason: loggedIn === false ? "NOT_LOGGED_IN" : "ACCOUNT_UNKNOWN",
        });
        if (loggedIn === null) requestAccount(true);
        return false;
      }
      const platform = String(message.platform || "xueqiu");
      if (platform !== "xueqiu") {
        sendResponse({ ok: false, reason: "USE_BACKGROUND_X" });
        return false;
      }
      const uid = String(
        message.userId || (message.type === "POPUP_REFRESH" ? selectedUserId : "") || "",
      );
      setUser(uid, sendResponse, {
        page: message.page,
        loadMore: !!message.loadMore || message.type === "POPUP_LOAD_MORE",
      });
      return true;
    }
    return false;
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.sources && Array.isArray(changes.sources.newValue)) {
        sources = changes.sources.newValue.filter((s) => s && s.id && s.platform);
      }
    });
  }

  function askSession() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "POPUP_SESSION" }, (response) => {
          void chrome.runtime.lastError;
          resolve(response && response.status ? response : null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  async function init() {
    const saved =
      (await storageGet([
        "account",
        "loggedIn",
        "following",
        "sources",
        "timelines",
        "timelineSync",
        "timelineError",
        "selectedUserId",
        "accountCheckedAt",
      ])) || {};
    sources = Array.isArray(saved.sources)
      ? saved.sources.filter((s) => s && s.id && s.platform)
      : [];
    account = safeAccount(saved.account);
    loggedIn = typeof saved.loggedIn === "boolean" ? saved.loggedIn : null;
    following = Array.isArray(saved.following)
      ? saved.following.map(safeFollowing).filter(Boolean)
      : [];
    timelines = saved.timelines && typeof saved.timelines === "object" ? saved.timelines : {};
    timelineSync =
      saved.timelineSync && typeof saved.timelineSync === "object" ? saved.timelineSync : {};
    timelineError =
      saved.timelineError && typeof saved.timelineError === "object" ? saved.timelineError : {};
    selectedUserId = String(saved.selectedUserId || "");
    accountCheckedAt = Number(saved.accountCheckedAt) || 0;
    hydrated = true;
    // 先问后台要 cookie 登录态，再把它带进页面请求，避免因读不到 HttpOnly cookie 而误判。
    const fromBackground = await askSession();
    if (fromBackground)
      session = { status: String(fromBackground.status), uid: String(fromBackground.uid || "") };
    requestAccount(true);
  }

  init().catch(() => {});
})();
