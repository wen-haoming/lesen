/*
 * 后台：
 * 1) 用 chrome.cookies 直读雪球登录态（含 HttpOnly 的 u / xq_a_token，页面脚本读不到）；
 * 2) 点击图标按 settings.surface 只打开一种形态：popup 或 sidebar，再点一次收起；
 *    两种不同时存在。独立窗口仍由面板内入口单独打开。
 * 3) 关注列表请求使用后台共享的持久化限频；优先复用已有平台页面能力。
 * 只读取雪球域内与登录相关的 cookie，不上传、不落盘任何凭据值。
 */
"use strict";

// WXT 迁移：background 是 ES module service worker，直接 import 共享 config（挂 globalThis）。
// 原 importScripts('src/config.js') 已废弃。
import "@/lib/config-shared";
import { normalizeReplyHandle } from "@/lib/post-media";
import { normalizeWeiboHotItems } from "@/lib/weibo-hot";
import { createWeiboTopicFetcher } from "@/lib/weibo-topic";
import { createXueqiuHotService } from "@/lib/xueqiu-hot";
import { createXTopicService, extractXDom, waitXDom, xTopicUrl } from "@/lib/x-topic";
import { sanitizeFeedPost } from "@/lib/sanitize";
import { postsFromFxTwitter } from "@/lib/fxtwitter-posts";
import { SQUARE_SOURCES } from "@/lib/square-config";
import {
  canonicalRequestUrl,
  clearExpiredRiskPause,
  createPlatformPolicyState,
  hydratePlatformPolicy,
  inspectRisk,
  notePolicyDispatch,
} from "@/lib/platform-request-risk";

function xueqiuAvatarUrl(raw) {
  const fn = globalThis.XQ_DADAO_CONFIG && globalThis.XQ_DADAO_CONFIG.xueqiuAvatarUrl;
  return typeof fn === "function" ? fn(raw) : "";
}

const FORWARDED = new Set([
  "POPUP_ACCOUNT_REQUEST",
  "POPUP_LOAD_USER",
  "POPUP_REFRESH",
  "POPUP_LOAD_MORE",
]);
const XUEQIU_TAB = /^https?:\/\/(?:[^/]*\.)?xueqiu\.com\//i;
const XUEQIU_HOME = "https://xueqiu.com/";
const TARGET_AUTHOR = { userId: "1247347556", name: "大道无形我有型" };
// WXT 迁移：content script 由 manifest 静态注册，打包产物路径固定。
// 动态注入（补救未注入的已打开标签页）指向打包后的单文件 bundle。
const INJECT_MAIN = ["content-scripts/page-bridge.js"];
const INJECT_ISOLATED = ["content-scripts/content.js"];
const WINDOW_KEY = "windowBounds";
const WINDOW_PAGE = "popup.html";
const SIDEBAR_PAGE = "sidepanel.html";
const DEFAULT_BOUNDS = { width: 560, height: 960 };
const LIMITS = { minWidth: 360, minHeight: 480, maxWidth: 1240, maxHeight: 1600 };
// 合并同一时刻到达的打开请求。连续点击或 popup 重复触发时，避免多个请求
// 在 findReaderWindow 完成前同时通过 windows.create 创建重复窗口。
let readerWindowOpenPromise = null;
// 只有这三个 cookie 能反映雪球登录态；xq_a_token 匿名访问也会下发，不能单独作为登录依据。
const SESSION_COOKIES = ["u", "xq_is_login", "xq_a_token"];
// X 登录痕迹：只检查 cookie 名是否存在，绝不读取/记录/外传 cookie 值
const X_SESSION_COOKIE_NAMES = ["auth_token", "ct0", "twid"];
// 微博：SUB 判定登录；读取 XSRF-TOKEN 值仅用于同域 ajax 头，不落盘不外传
const WEIBO_SESSION_COOKIE_NAMES = ["SUB", "XSRF-TOKEN", "SUBP", "WBPSESS"];
const WEIBO_HOME = "https://weibo.com/";
const WEIBO_TAB = /^https?:\/\/(?:[^/]*\.)?weibo\.com\//i;
let weiboFollowingCache = { at: 0, users: [] };
let weiboSelfUidCache = { at: 0, uid: "" };
const FOLLOWING_CACHE_MS = 10 * 60 * 1000;
let xueqiuFollowingCache = { at: 0, uid: "", result: null };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WEIBO_IMAGE_RULE_ID = 91001;

/** 微博图床拒绝非 weibo.com Referer。扩展页发出的图片请求改写成微博来源。 */
function installWeiboImageRefererRule() {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr || typeof dnr.updateDynamicRules !== "function") return;
  dnr
    .updateDynamicRules({
      removeRuleIds: [WEIBO_IMAGE_RULE_ID, 91002, 91003, 91004, 91005, 91006],
      addRules: [
        {
          id: WEIBO_IMAGE_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "Referer", operation: "set", value: "https://weibo.com/" }],
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["sinaimg.cn"],
            resourceTypes: ["image", "media"],
          },
        },
        {
          id: 91003,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://weibo.com" },
              { header: "Referer", operation: "set", value: "https://weibo.com/" },
            ],
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["weibo.com"],
            resourceTypes: ["xmlhttprequest"],
          },
        },
        {
          id: 91004,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://m.weibo.cn" },
              { header: "Referer", operation: "set", value: "https://m.weibo.cn/" },
            ],
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["weibo.cn"],
            resourceTypes: ["xmlhttprequest"],
          },
        },
        {
          id: 91006,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://weibo.com" },
              { header: "Referer", operation: "set", value: "https://weibo.com/" },
            ],
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ["weibocdn.com", "video.weibo.com"],
            resourceTypes: ["image", "media", "xmlhttprequest"],
          },
        },
      ],
    })
    .catch(() => {});
}

const DEFAULT_SOURCE_SEEDS = [];

function feedKeyFrom(entry) {
  const platform = String((entry && entry.platform) || "xueqiu");
  const id = String((entry && entry.id) || "");
  return platform + ":" + id;
}

function parseFeedKey(key) {
  const raw = String(key || "");
  const i = raw.indexOf(":");
  if (i <= 0) return { platform: "xueqiu", id: raw };
  return { platform: raw.slice(0, i), id: raw.slice(i + 1) };
}

function registerOnInstalledListener() {
  chrome.runtime.onInstalled.addListener(async (details) => {
    let current;
    try {
      current = await chrome.storage.local.get([
        "timelines",
        "following",
        "selectedUserId",
        "selectedFeedKey",
        "sources",
        "settings",
        "authorReadAt",
      ]);
    } catch (error) {
      return;
    }
    if (!current || typeof current !== "object") return;
    const patch = {};
    if (!Object.prototype.hasOwnProperty.call(current, "timelines")) patch.timelines = {};
    if (!Object.prototype.hasOwnProperty.call(current, "following")) patch.following = [];
    if (!Object.prototype.hasOwnProperty.call(current, "selectedUserId")) patch.selectedUserId = "";
    if (!Object.prototype.hasOwnProperty.call(current, "selectedFeedKey"))
      patch.selectedFeedKey = "__all__";
    // 升级时只补缺失的键。已有订阅（含用户清空后的空数组）一律保留，过滤已下线平台。
    if (!Object.prototype.hasOwnProperty.call(current, "sources")) {
      patch.sources = DEFAULT_SOURCE_SEEDS;
    } else if (Array.isArray(current.sources)) {
      const supported = current.sources.filter(
        (item) => item && ["xueqiu", "x", "weibo"].includes(String(item.platform || "")),
      );
      if (supported.length !== current.sources.length) patch.sources = supported;
    }
    if (!Object.prototype.hasOwnProperty.call(current, "authorReadAt")) patch.authorReadAt = {};
    if (current.settings)
      patch.settings = {
        ...current.settings,
        sort: current.settings.sort || "desc",
        query: current.settings.query || "",
        density: current.settings.density || "comfortable",
        readingFont: current.settings.readingFont || "system",
        readingSize: current.settings.readingSize || "md",
        surface: current.settings.surface === "popup" ? "popup" : "sidebar",
      };
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    await chrome.storage.local.remove(["read", "star", "posts", "lastSync"]);
    if (details && details.reason === "update") await chrome.storage.local.remove("platformRequestState");
    void ensureSidePanel();
  });
}

/* ---------------- 后台轮询：按间隔拉动态；系统通知仅在所选形式下弹出 ---------------- */
const NOTIFY_ALARM = "xq-notify-check";
const NOTIFY_MAX_PER_CYCLE = 8; // 单次轮询最多弹几条，避免刷屏
const NOTIFY_MAX_PER_SOURCE = 2; // 同一作者单次最多弹几条
const NOTIFY_GAP_MS = 600; // 源之间错峰，降低雪球风控概率
const NOTIFY_CLICK_KEY = "xqNotifyClick";
const PRIVATE_API_REPEAT_GAP_MS = 15 * 1000;
const PRIVATE_API_FORCE_GAP_MS = 4 * 1000;
const PRIVATE_API_BACKOFF_BASE_MS = 2 * 60 * 1000;
const PRIVATE_API_BACKOFF_MAX_MS = 30 * 60 * 1000;
const PLATFORM_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const RECENT_RESPONSE_DEDUPE_MS = 3500;
const platformPolicyStates = new Map();
const guardedRequestLastAt = new Map();
const guardedRequestBackoff = new Map();
const guardedRequestHistory = new Map();
const platformRequestQueue = new Map();
const platformRequestInflight = new Map();
const platformRecentResponses = new Map();
const platformBurstTokens = new Map();
const platformRiskRegistrations = new Map();
let guardedRequestPersistence = Promise.resolve();

function persistGuardedRequests() {
  guardedRequestPersistence = guardedRequestPersistence
    .then(async () => {
      try {
        const latest = await chrome.storage.local.get(["platformRequestState"]);
        const stored =
          latest.platformRequestState && typeof latest.platformRequestState === "object"
            ? latest.platformRequestState
            : {};
        const requests = {};
        for (const [key, at] of guardedRequestLastAt) requests[key] = at;
        const history = {};
        for (const [platform, entries] of guardedRequestHistory) history[platform] = entries;
        for (const [platform, state] of platformPolicyStates) history[platform] = state.history;
        const pauses = {};
        for (const [platform, penalty] of guardedRequestBackoff) pauses[platform] = penalty;
        for (const [platform, state] of platformPolicyStates)
          if (state.pause) pauses[platform] = state.pause;
        const platforms = {};
        for (const [platform, state] of platformPolicyStates)
          platforms[platform] = {
            requests: state.requests,
            history: state.history,
            pause: state.pause,
            lastAt: state.lastAt,
          };
        await chrome.storage.local.set({
          platformRequestState: { ...stored, requests, history, pauses, platforms },
        });
      } catch {
        /* Storage failures must not prevent limiting within this worker lifetime. */
      }
    })
    .catch(() => {});
  return guardedRequestPersistence;
}

async function hydrateGuardedRequests() {
  try {
    const stored = await chrome.storage.local.get(["platformRequestState"]);
    const state =
      stored.platformRequestState && typeof stored.platformRequestState === "object"
        ? stored.platformRequestState
        : {};
    const now = Date.now();
    for (const [platform, rawState] of Object.entries(state.platforms || {})) {
      const policy = hydratePlatformPolicy(rawState, now);
      platformPolicyStates.set(platform, policy);
      guardedRequestHistory.set(platform, policy.history);
      if (policy.pause) guardedRequestBackoff.set(platform, policy.pause);
      for (const [url, at] of Object.entries(policy.requests))
        guardedRequestLastAt.set(platform + ":" + url, Number(at));
    }
    for (const [key, at] of Object.entries(state.requests || {})) {
      if (Number(at) > now - PLATFORM_REQUEST_WINDOW_MS) guardedRequestLastAt.set(key, Number(at));
    }
    for (const [platform, timestamps] of Object.entries(state.history || {})) {
      const history = Array.isArray(timestamps)
        ? timestamps.map(Number).filter((at) => at > now - PLATFORM_REQUEST_WINDOW_MS)
        : [];
      if (history.length) guardedRequestHistory.set(platform, history);
      else guardedRequestHistory.delete(platform);
      const policy = platformPolicyStates.get(platform) || createPlatformPolicyState();
      policy.history = [...new Set([...(policy.history || []), ...history])].sort((a, b) => a - b);
      if (policy.history.length) policy.lastAt = Math.max(policy.lastAt || 0, ...policy.history);
      platformPolicyStates.set(platform, policy);
    }
    for (const [platform, penalty] of Object.entries(state.pauses || {})) {
      if (penalty && Number(penalty.failures) > 0) {
        if (Number(penalty.until) > now) guardedRequestBackoff.set(platform, penalty);
        else guardedRequestBackoff.set(platform, { ...penalty, until: 0 });
        const policy = platformPolicyStates.get(platform) || createPlatformPolicyState();
        policy.pause = { failures: Number(penalty.failures), until: Number(penalty.until) || 0 };
        const hydrated = hydratePlatformPolicy(state.platforms && state.platforms[platform], now);
        policy.requests = { ...policy.requests, ...hydrated.requests };
        policy.history = [...new Set([...policy.history, ...hydrated.history])].sort(
          (a, b) => a - b,
        );
        policy.lastAt = Math.max(policy.lastAt || 0, hydrated.lastAt || 0);
        platformPolicyStates.set(platform, policy);
      }
    }
  } catch {
    /* Storage may be unavailable in tests or during extension shutdown. */
  }
}

let guardedRequestReady = null;
function ensureGuardedRequestReady() {
  if (!guardedRequestReady) guardedRequestReady = hydrateGuardedRequests();
  return guardedRequestReady;
}

function riskDetails(responseStatus, text, headers) {
  return inspectRisk(responseStatus, text, headers);
}

const ANALYTICS_REPORT_WINDOW_MS = 10_000;
const ANALYTICS_REPORT_MAX_KEYS = 500;
const analyticsRequestReports = new Map();

function analyticsPlatformName(platform) {
  const value = String(platform || "");
  return value === "x-account" ? "x" : ["x", "xueqiu", "weibo"].includes(value) ? value : "";
}

function analyticsOperationFromUrl(rawUrl) {
  try {
    const path = new URL(String(rawUrl), "https://analytics.invalid").pathname.toLowerCase();
    if (path.includes("timeline") || path.includes("statuses")) return "timeline";
    if (path.includes("following") || path.includes("friends") || path.includes("graphql")) return "following";
    if (path.includes("profile") || path.includes("user") || path.includes("account")) return "profile";
    if (path.includes("hot")) return "hot";
    if (path.includes("topic") || path.includes("search")) return "search";
    if (path.includes("session") || path.includes("config")) return "session";
  } catch {
    /* Keep telemetry to a safe generic operation. */
  }
  return "platform_request";
}

function analyticsStatusFromError(error) {
  const explicit = Number(error && error.status);
  if (Number.isFinite(explicit) && explicit >= 0 && explicit <= 599) return explicit;
  const match = String((error && error.message) || error || "").match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function reportBackgroundRequestFailure(platform, fingerprint, error, extra = {}) {
  const safePlatform = analyticsPlatformName(platform);
  if (!safePlatform) return;
  const operation = analyticsOperationFromUrl(fingerprint);
  const status = analyticsStatusFromError(error);
  const retryAfter = Number(extra.retryAfterMs ?? error?.retryAfterMs);
  const rawProviderCode = String(extra.providerCode ?? error?.code ?? "").trim();
  const providerCode = /^[A-Za-z0-9_.:-]{1,64}$/.test(rawProviderCode) ? rawProviderCode : "";
  const safeStage = /^[A-Za-z0-9_.:-]{1,32}$/.test(String(extra.stage || "")) ? String(extra.stage) : "request";
  const message = String(error?.message || error || "").slice(0, 160);
  const context = [safePlatform, operation, status || 0, providerCode, safeStage, message].join(":");
  const signature = `${safePlatform}:${operation}:${status || 0}:${providerCode}:${safeStage}:${hashString(context)}`;
  const now = Date.now();
  for (const [key, at] of analyticsRequestReports) if (now - at >= ANALYTICS_REPORT_WINDOW_MS) analyticsRequestReports.delete(key);
  if (now - Number(analyticsRequestReports.get(signature) || 0) < ANALYTICS_REPORT_WINDOW_MS) return;
  if (analyticsRequestReports.size >= ANALYTICS_REPORT_MAX_KEYS) analyticsRequestReports.delete(analyticsRequestReports.keys().next().value);
  analyticsRequestReports.set(signature, now);
  const reportError = new Error(String(error?.message || error || "platform request failed").slice(0, 160));
  reportError.name = error?.name || "Error";
  void import("./analytics-background").then(({ analyticsRuntime }) =>
    analyticsRuntime.captureError(
      reportError,
      "background",
      Number(extra.durationMs) || undefined,
      status,
      true,
      {
        platform: safePlatform,
        operation,
        stage: safeStage,
        provider_code: providerCode,
        retry_after_ms: Number.isFinite(retryAfter) ? retryAfter : undefined,
        cache_hit: extra.cacheHit === true ? true : undefined,
        stale: extra.stale === true ? true : undefined,
        duration_ms: Number(extra.durationMs) || undefined,
      },
    ),
  ).catch(() => {});
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function computeAdaptiveSpacingMs(platform, policy, now) {
  const recent60s = (policy.history || []).filter((at) => now - at < 60_000).length;
  const idleMs = policy.lastAt ? Math.max(0, now - policy.lastAt) : 60_000;
  // 平台空闲 >= 4 秒时补充 2 个突发令牌，保证单次点击/打开零延迟；连续批量请求平滑错峰。
  let burst = platformBurstTokens.has(platform) ? platformBurstTokens.get(platform) : 2;
  if (idleMs >= 4000) burst = 2;
  else if (idleMs >= 2000 && burst < 1) burst = 1;
  if (burst > 0 && recent60s < 10) {
    platformBurstTokens.set(platform, burst - 1);
    return 0;
  }
  platformBurstTokens.set(platform, 0);
  const targetGap =
    platform === "x"
      ? recent60s >= 12
        ? 450
        : 220
      : recent60s >= 16
        ? 1400
        : recent60s >= 8
          ? 900
          : 520;
  return Math.max(0, targetGap - idleMs);
}

/**
 * 平台请求统一网关：
 * 1) 合并同一规范化 URL 的并发请求；
 * 2) 非强刷请求在极短窗口（3.5s）内复用刚成功的响应，消除切页/事件重入导致的重复请求且不报错；
 * 3) 按平台令牌桶平滑错峰：空闲点击零等待，批量连续请求自动插入温和间隔，避免触发 WAF；
 * 4) 仅在真实平台风控（403/429/验证码）时进入冷却，并在冷却恢复成功请求后自动清零累计失败阶梯。
 */
async function runGuardedPlatformRequest(platform, fingerprint, task, opts) {
  await ensureGuardedRequestReady();
  const force = !!(opts && opts.force);
  const canonicalUrl = canonicalRequestUrl(fingerprint);
  const canonicalKey = platform + ":" + canonicalUrl;
  const pending = platformRequestInflight.get(canonicalKey);
  if (pending) return pending;

  const activePause = guardedRequestBackoff.get(platform);
  if (activePause && activePause.until > Date.now()) {
    return {
      ok: false,
      error: "平台暂时限制了请求，请稍后再试",
      reason: "平台暂时限制了请求，请稍后再试",
      retryAfterMs: activePause.until - Date.now(),
      platformPause: true,
    };
  }

  if (!force) {
    const recent = platformRecentResponses.get(canonicalKey);
    if (recent && Date.now() - recent.at < RECENT_RESPONSE_DEDUPE_MS) {
      return { ok: true, value: recent.value, cached: true };
    }
  }

  const existing = platformRequestQueue.get(platform) || Promise.resolve();
  const run = existing
    .catch(() => {})
    .then(async () => {
      const queuedPause = guardedRequestBackoff.get(platform);
      if (queuedPause && queuedPause.until > Date.now()) {
        return {
          ok: false,
          error: "平台暂时限制了请求，请稍后再试",
          reason: "平台暂时限制了请求，请稍后再试",
          retryAfterMs: queuedPause.until - Date.now(),
          platformPause: true,
        };
      }
      if (!force) {
        const recent = platformRecentResponses.get(canonicalKey);
        if (recent && Date.now() - recent.at < RECENT_RESPONSE_DEDUPE_MS) {
          return { ok: true, value: recent.value, cached: true };
        }
      }
      const policy = platformPolicyStates.get(platform) || createPlatformPolicyState();
      platformPolicyStates.set(platform, policy);
      const waitMs = computeAdaptiveSpacingMs(platform, policy, Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
        const afterWaitPause = guardedRequestBackoff.get(platform);
        if (afterWaitPause && afterWaitPause.until > Date.now()) {
          return {
            ok: false,
            error: "平台暂时限制了请求，请稍后再试",
            reason: "平台暂时限制了请求，请稍后再试",
            retryAfterMs: afterWaitPause.until - Date.now(),
            platformPause: true,
          };
        }
      }
      const requestStartedAt = Date.now();
      notePolicyDispatch(policy, canonicalUrl, requestStartedAt);
      guardedRequestHistory.set(platform, policy.history);
      guardedRequestLastAt.set(canonicalKey, requestStartedAt);
      try {
        const result = await task();
        const risk = result && result.__platformRisk;
        if (risk) {
          await registerPlatformRisk(platform, risk.retryAfterMs);
          reportBackgroundRequestFailure(platform, fingerprint, new Error("rate limit"), {
            stage: "risk_detection",
            retryAfterMs: risk.retryAfterMs,
            durationMs: Date.now() - requestStartedAt,
          });
          return {
            ok: false,
            error: "平台暂时限制了请求，请稍后再试",
            reason: "平台暂时限制了请求，请稍后再试",
            retryAfterMs: Math.max(
              risk.retryAfterMs || 0,
              (guardedRequestBackoff.get(platform)?.until || Date.now()) - Date.now(),
            ),
            platformPause: true,
            riskHandled: true,
          };
        }
        const finishNow = Date.now();
        platformRecentResponses.set(canonicalKey, { at: finishNow, value: result });
        if (platformRecentResponses.size > 200) {
          for (const [k, v] of platformRecentResponses) {
            if (finishNow - v.at >= RECENT_RESPONSE_DEDUPE_MS) platformRecentResponses.delete(k);
          }
        }
        const stalePenalty = guardedRequestBackoff.get(platform);
        if (stalePenalty && stalePenalty.until <= finishNow) {
          guardedRequestBackoff.delete(platform);
          clearExpiredRiskPause(policy, finishNow);
          void persistGuardedRequests();
        }
        return { ok: true, value: result };
      } catch (error) {
        reportBackgroundRequestFailure(platform, fingerprint, error, {
          stage: "request",
          retryAfterMs: error && error.retryAfterMs,
          durationMs: Date.now() - requestStartedAt,
        });
        const risk = error && error.platformRisk;
        if (risk) {
          await registerPlatformRisk(platform, risk.retryAfterMs);
          return {
            ok: false,
            error: String(error.message || error),
            reason: String(error.message || error),
            retryAfterMs: Math.max(
              risk.retryAfterMs || 0,
              (guardedRequestBackoff.get(platform)?.until || Date.now()) - Date.now(),
            ),
            platformPause: true,
            riskHandled: true,
          };
        }
        return {
          ok: false,
          error: String((error && error.message) || error),
          reason: String((error && error.message) || error),
          retryAfterMs: Number(error && error.retryAfterMs) || 0,
          platformPause: !!(error && error.platformPause),
        };
      }
    });
  platformRequestQueue.set(
    platform,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  platformRequestInflight.set(canonicalKey, run);
  try {
    return await run;
  } finally {
    platformRequestInflight.delete(canonicalKey);
  }
}

async function registerPlatformRisk(platform, retryAfterMs) {
  const existing = platformRiskRegistrations.get(platform);
  if (existing && Date.now() - existing.at < 1000) {
    existing.count += 1;
    const pause = guardedRequestBackoff.get(platform);
    if (pause) {
      pause.until = Math.max(pause.until, Date.now() + (Number(retryAfterMs) || 0));
      const policy = platformPolicyStates.get(platform);
      if (policy && policy.pause) policy.pause.until = pause.until;
      void persistGuardedRequests();
    }
    return existing.promise;
  }
  const registration = { at: Date.now(), count: 1, promise: Promise.resolve() };
  platformRiskRegistrations.set(platform, registration);
  const previous = guardedRequestBackoff.get(platform) || platformPolicyStates.get(platform)?.pause;
  const failures = Math.min(4, (previous && Number(previous.failures)) || 0) + 1;
  const exponential = Math.min(
    PRIVATE_API_BACKOFF_MAX_MS,
    PRIVATE_API_BACKOFF_BASE_MS * Math.pow(2, failures - 1),
  );
  const delay = Math.max(exponential, Number(retryAfterMs) || 0);
  const until = Math.max((previous && previous.until) || 0, Date.now() + delay);
  guardedRequestBackoff.set(platform, { failures, until });
  const policy = platformPolicyStates.get(platform) || createPlatformPolicyState();
  policy.pause = { failures, until };
  platformPolicyStates.set(platform, policy);
  registration.promise = persistGuardedRequests();
  await registration.promise;
}

function beginGuardedRequest(platform, fingerprint, opts) {
  const now = Date.now();
  const penalty = guardedRequestBackoff.get(platform) || platformPolicyStates.get(platform)?.pause;
  if (penalty && penalty.until > now) {
    return {
      ok: false,
      reason: "平台暂时限制了请求，请稍后再试",
      retryAfterMs: penalty.until - now,
      platformPause: true,
    };
  }
  const key = platform + ":" + canonicalRequestUrl(String(fingerprint));
  const intentKey = platform + ":" + String(fingerprint);
  const lastAt = Math.max(
    Number(guardedRequestLastAt.get(key)) || 0,
    Number(guardedRequestLastAt.get(intentKey)) || 0,
    Number(
      platformPolicyStates.get(platform)?.requests[canonicalRequestUrl(String(fingerprint))],
    ) || 0,
  );
  const minGap = opts && opts.force ? PRIVATE_API_FORCE_GAP_MS : PRIVATE_API_REPEAT_GAP_MS;
  if (lastAt && now - lastAt < minGap) {
    return {
      ok: false,
      reason: "刚刚已读取过，请稍后再试",
      retryAfterMs: minGap - (now - lastAt),
    };
  }
  guardedRequestLastAt.set(key, now);
  guardedRequestLastAt.set(intentKey, now);
  return { ok: true };
}

function finishGuardedRequest(platform, result, fingerprint = String(platform)) {
  const message = String((result && (result.error || result.reason)) || "");
  if (result && result.ok === false) {
    reportBackgroundRequestFailure(platform, fingerprint, Object.assign(new Error(message || "platform request failed"), { status: result.status }), {
      stage: "response",
      retryAfterMs: result.retryAfterMs,
      providerCode: result.error_code || result.code,
      stale: result.stale === true,
      cacheHit: result.cached === true,
      durationMs: Number(result.duration_ms) || undefined,
    });
  }
  if (
    !result?.riskHandled &&
    /(?:HTTP\\s*)?(?:403|429)|RATE_LIMIT|请求过于频繁|账号存在异常|300011|_waf_|captcha|访问验证|安全验证/i.test(
      message,
    )
  ) {
    void registerPlatformRisk(platform, Number(result && result.retryAfterMs) || 0);
  }
}

function readRefreshMinutes(_settings) {
  return 0;
}

function readNotifyForm(settings) {
  const form = settings && settings.notifyForm;
  if (form === "quiet" || form === "system") return form;
  return settings && settings.notify === false ? "quiet" : "system";
}

async function syncRefreshAlarm() {
  try {
    if (!chrome.alarms) return;
    await chrome.alarms.clear(NOTIFY_ALARM);
  } catch (error) {
    /* alarms 不可用则跳过 */
  }
}

async function disableAutoRefreshSetting() {
  try {
    const stored = await chrome.storage.local.get(["settings"]);
    const settings =
      stored.settings && typeof stored.settings === "object" ? { ...stored.settings } : {};
    if (settings.refreshMinutes === 0) {
      await syncRefreshAlarm();
      return;
    }
    settings.refreshMinutes = 0;
    await chrome.storage.local.set({ settings });
    await syncRefreshAlarm();
  } catch (error) {
    await syncRefreshAlarm();
  }
}

async function storeNotifyClick(id, url) {
  try {
    const store = await chrome.storage.local.get(NOTIFY_CLICK_KEY);
    const map =
      store[NOTIFY_CLICK_KEY] && typeof store[NOTIFY_CLICK_KEY] === "object"
        ? store[NOTIFY_CLICK_KEY]
        : {};
    map[id] = String(url || "");
    const keys = Object.keys(map);
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete map[k];
    await chrome.storage.local.set({ [NOTIFY_CLICK_KEY]: map });
  } catch (error) {
    /* noop */
  }
}

function sendXueqiuNotification(source, post, name) {
  if (!chrome.notifications) return Promise.resolve(null);
  const text =
    String(post.title || post.summary || "")
      .trim()
      .slice(0, 120) || "发布了新动态";
  const rawAvatar = String(source.avatar || "").trim();
  const iconUrl = /^https?:\/\//i.test(rawAvatar)
    ? rawAvatar
    : chrome.runtime.getURL("icons/icon128.png");
  const id = "xq" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return new Promise((resolve) => {
    try {
      chrome.notifications.create(
        id,
        {
          type: "basic",
          iconUrl,
          title: name + " 发布了新动态",
          message: text,
          contextMessage: "Lesen · 莱森",
          priority: 1,
          requireInteraction: false,
        },
        async (createdId) => {
          void chrome.runtime.lastError;
          if (!createdId) {
            resolve(null);
            return;
          }
          await storeNotifyClick(createdId, post.url);
          resolve(createdId);
        },
      );
    } catch (error) {
      resolve(null);
    }
  });
}

// 后台定时检查仅用于允许后台读取的来源。
// 微博/雪球私有网页接口只在用户打开信息源或手动刷新时调用。
async function checkUpdates() {
  // 只用 notifyState 帖子 ID 去重；不再读/写 authorReadAt（已读水位已停用）
  const stored = await chrome.storage.local.get(["settings", "sources", "notifyState"]);
  const settings = stored.settings && typeof stored.settings === "object" ? stored.settings : {};
  if (!readRefreshMinutes(settings)) return;
  const announce = readNotifyForm(settings) === "system";
  const sources = Array.isArray(stored.sources) ? stored.sources.filter((s) => s && s.id) : [];
  if (!sources.length) return;
  const notifyState =
    stored.notifyState && typeof stored.notifyState === "object" ? stored.notifyState : {};

  let sent = 0;
  for (const source of sources) {
    if (sent >= NOTIFY_MAX_PER_CYCLE) break;
    const key = feedKeyFrom(source);
    const platform = String(source.platform || "xueqiu");
    // 只有不携带用户站点会话的 X 公共代理允许后台轮询。
    if (platform !== "x") continue;
    let result = null;
    try {
      result = await fetchXTimeline(String(source.id).toLowerCase());
    } catch (error) {
      continue;
    }
    if (!result || !result.ok || !Array.isArray(result.posts) || !result.posts.length) continue;
    // 轮询已经付出网络成本，静默落盘，打开阅读器时直接用本地时间线。
    await persistTimelineFeed(key, result.posts, {
      page: 1,
      hasMore: result.posts.length >= 10,
      loadMore: false,
      silent: true,
    });

    const state = notifyState[key];
    const seeded = !!(state && state.seeded);
    const seen = new Set(seeded && Array.isArray(state.ids) ? state.ids : []);
    const name = String(source.name || source.id);

    if (!seeded) {
      // 首次观察：只记录基线，不把历史动态当“更新”弹出
      for (const post of result.posts) seen.add(String(post.id));
      notifyState[key] = { seeded: true, ids: Array.from(seen).slice(-200), at: Date.now() };
      continue;
    }

    // 按时间新→旧辅助排序，仅用帖子 ID 去重挑选新内容
    const fresh = result.posts
      .slice()
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .filter((post) => !seen.has(String(post.id)));
    if (!announce) {
      for (const post of fresh) seen.add(String(post.id));
    } else {
      const candidates = fresh.slice(0, NOTIFY_MAX_PER_SOURCE);
      for (const post of candidates) {
        if (sent >= NOTIFY_MAX_PER_CYCLE) break;
        const nid = await sendXueqiuNotification(source, post, name);
        if (nid) {
          seen.add(String(post.id));
          sent += 1;
        }
      }
    }
    notifyState[key] = { seeded: true, ids: Array.from(seen).slice(-200), at: Date.now() };
    if (sent < NOTIFY_MAX_PER_CYCLE) await sleep(NOTIFY_GAP_MS);
  }
  await chrome.storage.local.set({ notifyState });
}

function registerNotifyListeners() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== NOTIFY_ALARM) return;
    checkUpdates().catch(() => {});
  });

  if (chrome.notifications && chrome.notifications.onClosed) {
    chrome.notifications.onClosed.addListener((id) => {
      if (String(id || "").indexOf("xq-test-") !== 0) return;
    });
  }

  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(async (id) => {
      const store = await chrome.storage.local.get(NOTIFY_CLICK_KEY);
      const map =
        store[NOTIFY_CLICK_KEY] && typeof store[NOTIFY_CLICK_KEY] === "object"
          ? store[NOTIFY_CLICK_KEY]
          : {};
      const url = String(map[id] || "");
      if (url && /^https?:\/\//i.test(url) && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url }, () => {
          void chrome.runtime.lastError;
        });
        void import("./analytics-background").then(({ recordOriginalOpenedFromUrl }) => {
          recordOriginalOpenedFromUrl(url);
        });
      }
    });
  }
}

/* ---------------- 登录态：直读雪球 cookie ---------------- */

function parseUid(text) {
  const direct = String(text || "").trim();
  if (!direct) return "";
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

// status: logged-in（有 u 或 xq_is_login）/ logged-out（无任何登录痕迹）/ unknown（只有匿名 token）
async function readSession() {
  let list = [];
  let readable = true;
  try {
    list = await chrome.cookies.getAll({ domain: "xueqiu.com" });
  } catch (error) {
    list = [];
    readable = false;
  }
  const map = Object.create(null);
  for (const cookie of Array.isArray(list) ? list : []) {
    if (cookie && cookie.name) map[cookie.name] = String(cookie.value == null ? "" : cookie.value);
  }
  const uid = parseUid(map["u"]);
  const flag = String(map["xq_is_login"] || "")
    .trim()
    .toLowerCase();
  const hasLoginFlag = flag === "1" || flag === "true";
  const hasToken = !!map["xq_a_token"];

  let status = "logged-out";
  if (!readable) status = "unknown"; // 读不到 cookie（权限/接口异常）≠ 未登录
  else if (uid || hasLoginFlag) status = "logged-in";
  else if (hasToken) status = "unknown"; // 匿名也会下发 token，不足以判定登录

  return {
    status,
    uid,
    hasLoginFlag,
    hasToken,
    readable,
    cookieCount: Object.keys(map).length,
    readAt: Date.now(),
  };
}

/** X 登录痕迹：只看 cookie 名，不读 value */
async function readXSession() {
  let readable = true;
  let names = [];
  try {
    const listA = await chrome.cookies.getAll({ domain: "x.com" });
    const listB = await chrome.cookies.getAll({ domain: "twitter.com" });
    const list = [].concat(Array.isArray(listA) ? listA : [], Array.isArray(listB) ? listB : []);
    names = list.map((c) => (c && c.name) || "").filter(Boolean);
  } catch (error) {
    readable = false;
    names = [];
  }
  const set = new Set(names);
  const hasAuth = X_SESSION_COOKIE_NAMES.some((n) => set.has(n));
  let status = "logged-out";
  if (!readable) status = "unknown";
  else if (hasAuth) status = "logged-in";
  return { status, readable, platform: "x", readAt: Date.now() };
}

/** 微博登录痕迹：有 SUB 视为已登录；只在需要发 ajax 时另读 XSRF-TOKEN 值 */
async function readWeiboSession() {
  let readable = true;
  let names = [];
  try {
    const listA = await chrome.cookies.getAll({ domain: "weibo.com" });
    const listB = await chrome.cookies.getAll({ domain: "weibo.cn" });
    const list = []
      .concat(Array.isArray(listA) ? listA : [])
      .concat(Array.isArray(listB) ? listB : []);
    names = list.map((c) => (c && c.name) || "").filter(Boolean);
  } catch (error) {
    readable = false;
    names = [];
  }
  const set = new Set(names);
  let status = "logged-out";
  if (!readable) status = "unknown";
  else if (set.has("SUB")) status = "logged-in";
  else if (WEIBO_SESSION_COOKIE_NAMES.some((n) => n !== "SUB" && set.has(n))) status = "unknown";
  return { status, readable, platform: "weibo", readAt: Date.now() };
}

async function readWeiboXsrfToken() {
  try {
    const byUrl = await chrome.cookies.get({ url: "https://weibo.com/", name: "XSRF-TOKEN" });
    if (byUrl && byUrl.value) return String(byUrl.value);
    const list = await chrome.cookies.getAll({ domain: "weibo.com", name: "XSRF-TOKEN" });
    for (const cookie of Array.isArray(list) ? list : []) {
      if (cookie && cookie.value) return String(cookie.value);
    }
  } catch (error) {
    /* noop */
  }
  return "";
}

function findWeiboTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ["*://weibo.com/*", "*://*.weibo.com/*"] }, (tabs) => {
      void chrome.runtime.lastError;
      const list = Array.isArray(tabs) ? tabs : [];
      const hit = list.find((tab) => tab && tab.id && WEIBO_TAB.test(String(tab.url || "")));
      resolve(hit || null);
    });
  });
}

/** 在已打开的微博页 MAIN world 请求，Origin 为 weibo.com，可避开扩展后台 403 */
async function fetchWeiboJsonViaTab(url, referer) {
  const initialPenalty = guardedRequestBackoff.get("weibo");
  if (initialPenalty && initialPenalty.until > Date.now()) {
    const error = new Error("平台暂时限制了请求，请稍后再试");
    error.platformPause = true;
    error.retryAfterMs = initialPenalty.until - Date.now();
    throw error;
  }
  const parsed = new URL(String(url));
  if (
    !/^https:$/.test(parsed.protocol) ||
    !/(^|\.)weibo\.com$|(^|\.)weibo\.cn$/i.test(parsed.hostname)
  )
    throw new Error("WEIBO_URL_NOT_ALLOWED");
  const guarded = await runGuardedPlatformRequest("weibo", parsed.href, async () => {
    const tab = await findWeiboTab();
    if (!tab || !tab.id) throw new Error("NO_WEIBO_TAB");
    const xsrf = await readWeiboXsrfToken();
    const [{ result, error } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (fetchUrl, pageReferer, token) => {
        const headers = {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          Referer: String(pageReferer || location.origin + "/"),
        };
        if (token) headers["X-XSRF-TOKEN"] = String(token);
        const response = await fetch(fetchUrl, {
          // The request runs in the already logged-in Weibo tab. Omitting
          // credentials makes Weibo answer with ok=-100 even though the tab
          // itself is authenticated.
          credentials: "include",
          cache: "no-store",
          headers,
        });
        return { status: response.status, ok: response.ok, text: await response.text(),
          retryAfter: response.headers.get("Retry-After") || "" };
      },
      args: [String(url), String(referer || "https://weibo.com/"), xsrf],
    });
    if (error) {
      throw new Error(String(error.message || error));
    }
    if (!result || typeof result.text !== "string") throw new Error("NON_JSON");
    const risk = riskDetails(result.status, result.text, { get: () => result.retryAfter });
    if (risk) return { __platformRisk: risk };
    if (!result.ok) throw new Error("HTTP " + result.status);
    if (/^\s*</.test(result.text) || /<html\b/i.test(result.text)) throw new Error("NON_JSON");
    try { return JSON.parse(result.text); } catch { throw new Error("NON_JSON"); }
  });
  if (!guarded.ok) {
    const failure = new Error(guarded.error || guarded.reason);
    failure.platformPause = !!guarded.platformPause;
    failure.retryAfterMs = guarded.retryAfterMs;
    throw failure;
  }
  return guarded.value;
}

async function fetchWeiboJson(url, referer, opts) {
  void opts;
  const initialPenalty = guardedRequestBackoff.get("weibo");
  if (initialPenalty && initialPenalty.until > Date.now()) {
    const error = new Error("平台暂时限制了请求，请稍后再试");
    error.platformPause = true;
    error.retryAfterMs = initialPenalty.until - Date.now();
    throw error;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (error) {
          /* noop */
        }
      }, 14000)
    : null;
  try {
    const xsrf = await readWeiboXsrfToken();
    const headers = {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: String(referer || "https://weibo.com/"),
    };
    if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
    const parsed = new URL(String(url));
    if (
      !/^https:$/.test(parsed.protocol) ||
      !/(^|\.)weibo\.com$|(^|\.)weibo\.cn$/i.test(parsed.hostname)
    )
      throw new Error("WEIBO_URL_NOT_ALLOWED");
    const guarded = await runGuardedPlatformRequest(
      "weibo",
      parsed.href,
      async () => {
        const response = await fetch(parsed.href, {
          credentials: "include",
          signal: controller ? controller.signal : undefined,
          cache: "no-store",
          headers,
        });
        const text = await response.text();
        const risk = riskDetails(response.status, text, response.headers);
        if (risk) return { __platformRisk: risk };
        if (!response.ok) throw new Error("HTTP " + response.status);
        if (/^\s*</.test(text) || /<html\b/i.test(text)) throw new Error("NON_JSON");
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("NON_JSON");
        }
      },
      { force: !!(opts && opts.force) },
    );
    if (!guarded.ok) {
      const err = new Error(guarded.error || guarded.reason);
      err.platformPause = !!guarded.platformPause;
      err.retryAfterMs = guarded.retryAfterMs;
      throw err;
    }
    return guarded.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWeiboText(url) {
  const initialPenalty = guardedRequestBackoff.get("weibo");
  if (initialPenalty && initialPenalty.until > Date.now()) {
    const error = new Error("平台暂时限制了请求，请稍后再试");
    error.platformPause = true;
    error.retryAfterMs = initialPenalty.until - Date.now();
    throw error;
  }
  const xsrf = await readWeiboXsrfToken();
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://weibo.com/",
  };
  const parsed = new URL(String(url));
  if (
    !/^https:$/.test(parsed.protocol) ||
    !/(^|\.)weibo\.com$|(^|\.)weibo\.cn$/i.test(parsed.hostname)
  )
    throw new Error("WEIBO_URL_NOT_ALLOWED");
  const guarded = await runGuardedPlatformRequest("weibo", parsed.href, async () => {
    const response = await fetch(parsed.href, {
      credentials: "omit",
      cache: "no-store",
      headers,
    });
    const text = await response.text();
    const risk = riskDetails(response.status, text, response.headers);
    if (risk) return { __platformRisk: risk };
    if (!response.ok) throw new Error("HTTP " + response.status);
    const isHtml = /^\s*</.test(text) || /<html\b/i.test(text);
    const isChallengeHtml = isHtml && /(?:_waf_|captcha|访问验证|安全验证)/i.test(text);
    if (isChallengeHtml) return { __platformRisk: { retryAfterMs: 0 } };
    return text;
  });
  if (!guarded.ok) {
    const error = new Error(guarded.error || guarded.reason);
    error.platformPause = !!guarded.platformPause;
    error.retryAfterMs = guarded.retryAfterMs;
    throw error;
  }
  return guarded.value;
}

function pickWeiboUid(raw) {
  const id = String(raw ?? "").trim();
  return /^\d{5,}$/.test(id) ? id : "";
}

async function fetchWeiboSelfUid() {
  const penalty = guardedRequestBackoff.get("weibo");
  if (penalty && penalty.until > Date.now()) return "";
  if (weiboSelfUidCache.uid && Date.now() - weiboSelfUidCache.at < 10 * 60 * 1000) {
    return weiboSelfUidCache.uid;
  }
  const trySet = (uid) => {
    const id = pickWeiboUid(uid);
    if (!id) return "";
    weiboSelfUidCache = { at: Date.now(), uid: id };
    return id;
  };
  try {
    const data = await fetchWeiboJson("https://m.weibo.cn/api/config", "https://m.weibo.cn/");
    const fromMobile = trySet(data && data.data && data.data.uid);
    if (fromMobile) return fromMobile;
  } catch (error) {
    if (error && error.platformPause) return "";
  }
  try {
    const data = await fetchWeiboJson(
      "https://weibo.com/ajax/login/checkLogin?_=" + Date.now(),
      WEIBO_HOME,
    );
    const fromCheck = trySet(
      (data && data.data && (data.data.uid || data.data.user_id)) || data.uid || data.user_id,
    );
    if (fromCheck) return fromCheck;
  } catch (error) {
    if (error && error.platformPause) return "";
  }
  try {
    const html = await fetchWeiboText(WEIBO_HOME);
    const patterns = [
      /\$CONFIG\s*=\s*\{[\s\S]{0,1200}?['"]?uid['"]?\s*:\s*['"]?(\d{5,})/,
      /"uid"\s*:\s*"(\d{5,})"/,
      /CONFIG\['uid'\]\s*=\s*'(\d{5,})'/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      const id = trySet(m && m[1]);
      if (id) return id;
    }
  } catch (error) {
    if (error && error.platformPause) return "";
  }
  return "";
}

function weiboAvatarUrl(user) {
  if (!user || typeof user !== "object") return "";
  const raw = String(
    user.avatar_hd || user.avatar_large || user.profile_image_url || user.avatar || "",
  ).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "https://").slice(0, 500);
  if (raw.indexOf("//") === 0) return ("https:" + raw).slice(0, 500);
  return "";
}

function mapWeiboFollowUser(user) {
  if (!user || typeof user !== "object") return null;
  const id = pickWeiboUid(user.id || user.idstr || user.uid);
  if (!id) return null;
  const name = String(user.screen_name || user.name || "").trim();
  if (!name) return null;
  return {
    id,
    name: name.slice(0, 80),
    avatar: weiboAvatarUrl(user),
    followers: Number(user.followers_count) || 0,
    verified: !!(user.verified || user.verified_type >= 0),
  };
}

async function fetchWeiboFollowing(force) {
  const session = await readWeiboSession();
  if (session.status !== "logged-in") {
    const out = {
      ok: false,
      reason: session.status === "logged-out" ? "NOT_LOGGED_IN" : "ACCOUNT_UNKNOWN",
      users: [],
    };
    return out;
  }
  if (
    !force &&
    weiboFollowingCache.users.length &&
    Date.now() - weiboFollowingCache.at < FOLLOWING_CACHE_MS
  ) {
    return { ok: true, users: weiboFollowingCache.users.slice(), reason: "cache" };
  }
  const activePenalty = guardedRequestBackoff.get("weibo");
  if (activePenalty && activePenalty.until > Date.now())
    return {
      ok: false,
      reason: "平台暂时限制了请求，请稍后再试",
      users: [],
      retryAfterMs: activePenalty.until - Date.now(),
      platformPause: true,
    };
  const selfUid = await fetchWeiboSelfUid();
  if (!selfUid) {
    return { ok: false, reason: "NO_SELF_UID", users: [] };
  }
  const gate = beginGuardedRequest("weibo", selfUid + ":following", { force: !!force });
  if (!gate.ok) {
    // Risk pauses are never hidden by stale cached data.
    if (gate.platformPause)
      return {
        ok: false,
        reason: gate.reason,
        users: [],
        retryAfterMs: gate.retryAfterMs,
        platformPause: true,
      };
    if (weiboFollowingCache.users.length)
      return { ok: true, users: weiboFollowingCache.users.slice(), reason: "cache" };
    return { ok: false, reason: gate.reason, users: [], retryAfterMs: gate.retryAfterMs };
  }
  const { list, reason, retryAfterMs, platformPause } = await readWeiboFollowingPages(selfUid);
  if (platformPause)
    return {
      ok: false,
      reason: reason || "平台暂时限制了请求，请稍后再试",
      users: [],
      retryAfterMs,
      platformPause: true,
    };
  if (list.length) {
    weiboFollowingCache = { at: Date.now(), users: list };
    finishGuardedRequest("weibo", { ok: true });
    return { ok: true, users: list, pages: Math.min(10, Math.ceil(list.length / 20)) };
  }
  const failReason = reason || "FOLLOWING_EMPTY";
  const failed = {
    ok: false,
    reason: failReason,
    users: [],
    retryAfterMs,
    platformPause: !!platformPause,
  };
  finishGuardedRequest("weibo", failed, "following");
  return failed;
}

function collectWeiboUsers(data, selfUid, all) {
  const buckets = [];
  if (Array.isArray(data?.users)) buckets.push(data.users);
  if (Array.isArray(data?.data?.users)) buckets.push(data.data.users);
  if (Array.isArray(data?.data?.follows?.users)) buckets.push(data.data.follows.users);
  const cards = []
    .concat(Array.isArray(data?.data?.cards) ? data.data.cards : [])
    .concat(Array.isArray(data?.cards) ? data.cards : []);
  for (const card of cards) {
    if (card && card.user) buckets.push([card.user]);
    if (card && Array.isArray(card.card_group)) {
      for (const item of card.card_group) {
        if (item && item.user) buckets.push([item.user]);
      }
    }
  }
  let added = 0;
  for (const users of buckets) {
    for (const raw of users) {
      const person = mapWeiboFollowUser(raw);
      if (!person || person.id === selfUid || all.has(person.id)) continue;
      all.set(person.id, person);
      added += 1;
    }
  }
  return added;
}

let weiboMobileChain = Promise.resolve();

function findWeiboMobileTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ["*://m.weibo.cn/*"] }, (tabs) => {
      void chrome.runtime.lastError;
      const list = Array.isArray(tabs) ? tabs : [];
      const hit = list.find((tab) => tab && tab.id && /^https:\/\/m\.weibo\.cn\//i.test(String(tab.url || "")));
      resolve(hit || null);
    });
  });
}

function releaseWeiboExtensionPause() {
  const pause = guardedRequestBackoff.get("weibo");
  const active = !!(pause && pause.until > Date.now());
  if (!active) return false;
  guardedRequestBackoff.set("weibo", { failures: 0, until: 0 });
  const policy = platformPolicyStates.get("weibo");
  if (policy) policy.pause = null;
  void persistGuardedRequests();
  return true;
}

async function fetchWeiboMobileJsonInPage(url, tabId) {
  const parsed = new URL(String(url));
  if (!/^https:$/.test(parsed.protocol) || !/(^|\.)weibo\.cn$/i.test(parsed.hostname))
    throw new Error("WEIBO_URL_NOT_ALLOWED");
  const run = weiboMobileChain.catch(() => {}).then(async () => {
    releaseWeiboExtensionPause();
    const [{ result, error } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (requestUrl) => {
        try {
          const current = new URL(location.href);
          const requested = new URL(requestUrl);
          if (
            current.protocol !== "https:" ||
            current.hostname !== "m.weibo.cn" ||
            requested.protocol !== "https:" ||
            !/(^|\.)weibo\.cn$/i.test(requested.hostname)
          )
            return { __error: "WEIBO_URL_NOT_ALLOWED" };
          const sameOriginUrl = new URL(requested.pathname + requested.search, current.origin).href;
          const response = await fetch(sameOriginUrl, {
            credentials: "include",
            cache: "no-store",
            headers: {
              Accept: "application/json, text/plain, */*",
              "X-Requested-With": "XMLHttpRequest",
              "MWeibo-Pwa": "1",
            },
          });
          const text = await response.text();
          return { status: response.status, ok: response.ok, text: String(text || "").slice(0, 500000) };
        } catch (requestError) {
          return { __error: String((requestError && requestError.message) || requestError) };
        }
      },
      args: [parsed.href],
    });
    if (error) throw new Error(String(error.message || error));
    if (!result || result.__error) throw new Error((result && result.__error) || "WEIBO_MOBILE_CONTEXT_REQUEST_FAILED");
    const risk = riskDetails(Number(result.status) || 0, result.text, { get: () => "" });
    if (risk) {
      const riskError = new Error("平台暂时限制了请求，请稍后再试");
      riskError.platformPause = true;
      throw riskError;
    }
    if (!result.ok) throw new Error("HTTP " + result.status);
    if (/^\s*</.test(result.text) || /<html\b/i.test(result.text)) throw new Error("NON_JSON");
    const data = JSON.parse(result.text);
    return data;
  });
  weiboMobileChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 移动站关注接口接受已登录 Cookie，不需要打开微博页面。 */
async function fetchWeiboMobileJson(url) {
  const initialPenalty = guardedRequestBackoff.get("weibo");
  if (initialPenalty && initialPenalty.until > Date.now()) {
    const error = new Error("平台暂时限制了请求，请稍后再试");
    error.platformPause = true;
    error.retryAfterMs = initialPenalty.until - Date.now();
    throw error;
  }
  const parsed = new URL(String(url));
  if (!/^https:$/.test(parsed.protocol) || !/(^|\.)weibo\.cn$/i.test(parsed.hostname))
    throw new Error("WEIBO_URL_NOT_ALLOWED");
  const guarded = await runGuardedPlatformRequest("weibo", parsed.href, async () => {
    const response = await fetch(parsed.href, {
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://m.weibo.cn/",
        "MWeibo-Pwa": "1",
      },
    });
    const text = await response.text();
    const risk = riskDetails(response.status, text, response.headers);
    if (risk) return { __platformRisk: risk };
    if (!response.ok) throw new Error("HTTP " + response.status);
    if (/^\s*</.test(text) || /<html/i.test(text)) throw new Error("NON_JSON");
    return JSON.parse(text);
  });
  if (!guarded.ok) {
    const errMsg = String(guarded.error || guarded.reason || "");
    if (!guarded.platformPause && /HTTP 432/i.test(errMsg)) {
      // 只复用已有的移动站标签页，后台请求不创建浏览器窗口。
      const tab = await findWeiboMobileTab();
      if (tab) return await fetchWeiboMobileJsonInPage(parsed.href, tab.id);
    }
    const error = new Error(guarded.error || guarded.reason);
    error.platformPause = !!guarded.platformPause;
    error.retryAfterMs = guarded.retryAfterMs;
    throw error;
  }
  return guarded.value;
}

async function readWeiboFollowingFromMobile(selfUid) {
  const all = new Map();
  let reason = "";
  const sources = [
    (page) =>
      "https://m.weibo.cn/api/friendships/sortedList?uid=" +
      encodeURIComponent(selfUid) +
      "&page=" +
      page,
    (page) =>
      "https://m.weibo.cn/api/container/getIndex?containerid=231093_-_selffollowed&page=" + page,
  ];
  for (const buildUrl of sources) {
    if (all.size) break;
    for (let page = 1; page <= 15; page++) {
      try {
        const data = await fetchWeiboMobileJson(buildUrl(page));
        if (data && (Number(data.code) === 300011 || Number(data.error_code) === 300011)) {
          const msg = String(data.msg || data.message || data.code);
          await registerPlatformRisk("weibo", 0);
          return {
            list: Array.from(all.values()),
            reason: msg,
            retryAfterMs: guardedRequestBackoff.get("weibo").until - Date.now(),
            platformPause: true,
          };
        }
        if (data && Number(data.ok) === 0 && !all.size) {
          reason = String(data.msg || "MOBILE_REJECTED").slice(0, 60);
          if (/RATE_LIMIT|300011|过于频繁|验证码|安全验证/i.test(reason)) {
            await registerPlatformRisk("weibo", 0);
            return {
              list: Array.from(all.values()),
              reason,
              retryAfterMs: guardedRequestBackoff.get("weibo")?.until - Date.now(),
              platformPause: true,
            };
          }
          break;
        }
        const added = collectWeiboUsers(data, selfUid, all);
        if (!added) break;
        await sleep(350);
      } catch (error) {
        reason = String((error && error.message) || error).slice(0, 60);
        if (error && error.platformPause)
          return {
            list: Array.from(all.values()).slice(0, 2000),
            reason,
            retryAfterMs: error.retryAfterMs,
            platformPause: true,
            via: "mobile-cookie",
          };
        break;
      }
    }
  }
  return { list: Array.from(all.values()).slice(0, 2000), reason, via: "mobile-cookie" };
}

async function readWeiboFollowingFromWeb(selfUid, opts) {
  const all = new Map();
  let reason = "";
  for (let page = 1; page <= 10; page++) {
    const url =
      "https://weibo.com/ajax/friendships/friends?page=" +
      page +
      "&uid=" +
      encodeURIComponent(selfUid);
    try {
      const data = await fetchWeiboJson(url, "https://weibo.com/u/" + selfUid, opts);
      if (data && (Number(data.code) === 300011 || Number(data.error_code) === 300011)) {
        const reason = String(data.msg || data.message || data.code);
        await registerPlatformRisk("weibo", 0);
        return {
          list: Array.from(all.values()),
          reason,
          retryAfterMs: guardedRequestBackoff.get("weibo").until - Date.now(),
          platformPause: true,
          via: "web-cookie",
        };
      }
      const added = collectWeiboUsers(data, selfUid, all);
      if (!added) break;
      if (added < 15) break;
      await sleep(350);
    } catch (error) {
      reason = String((error && error.message) || error).slice(0, 60);
      if (error && error.platformPause)
        return {
          list: Array.from(all.values()).slice(0, 2000),
          reason,
          retryAfterMs: error.retryAfterMs,
          platformPause: true,
          via: "web-cookie",
        };
      break;
    }
  }
  return { list: Array.from(all.values()).slice(0, 2000), reason, via: "web-cookie" };
}

/** 只用已登录 Cookie 读取关注。已打开的微博页可以借来重试，但绝不新建标签。 */
async function readWeiboFollowingPages(selfUid) {
  const web = await readWeiboFollowingFromWeb(selfUid);
  if (web.platformPause || (guardedRequestBackoff.get("weibo")?.until || 0) > Date.now())
    return {
      ...web,
      platformPause: true,
      retryAfterMs: web.retryAfterMs || guardedRequestBackoff.get("weibo").until - Date.now(),
    };
  if (web.list.length && !web.reason) return web;
  const mobile = await readWeiboFollowingFromMobile(selfUid);
  if (mobile.platformPause || (guardedRequestBackoff.get("weibo")?.until || 0) > Date.now())
    return {
      ...mobile,
      platformPause: true,
      retryAfterMs: mobile.retryAfterMs || guardedRequestBackoff.get("weibo").until - Date.now(),
    };
  if (mobile.list.length > web.list.length) return mobile;
  if (web.list.length) return web;
  const tab = await findWeiboTab();
  if (tab) {
    const viaTab = await readWeiboFollowingFromWeb(selfUid);
    if (viaTab.platformPause || (guardedRequestBackoff.get("weibo")?.until || 0) > Date.now())
      return {
        ...viaTab,
        platformPause: true,
        retryAfterMs: viaTab.retryAfterMs || guardedRequestBackoff.get("weibo").until - Date.now(),
      };
    if (viaTab.list.length) return { ...viaTab, via: "existing-tab" };
  }
  return {
    list: [],
    reason: web.reason || mobile.reason || "FOLLOWING_EMPTY",
    via: "none",
  };
}

async function fetchWeiboUserProfile(uid) {
  const penalty = guardedRequestBackoff.get("weibo");
  if (penalty && penalty.until > Date.now()) return null;
  const want = pickWeiboUid(uid);
  if (!want) return null;
  try {
    const data = await fetchWeiboJson(
      "https://weibo.com/ajax/profile/info?uid=" + encodeURIComponent(want),
      "https://weibo.com/u/" + want,
    );
    const user = (data && data.data && data.data.user) || (data && data.user) || null;
    if (!user || typeof user !== "object") return null;
    const id = pickWeiboUid(user.id || user.idstr || user.uid);
    if (id !== want) return null;
    const name = String(user.screen_name || user.name || "").trim();
    if (!name) return null;
    return { platform: "weibo", id: want, name: name.slice(0, 80), avatar: weiboAvatarUrl(user) };
  } catch (error) {
    if (error && error.platformPause) throw error;
    return null;
  }
}

function stripWeiboHtml(input) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pushWeiboMediaUrl(out, url) {
  const value = String(url || "").trim().replace(/^http:\/\//i, "https://");
  if (/^https:\/\//i.test(value)) out.push(value);
}

function weiboPlayableUrl(page) {
  if (!page || typeof page !== "object") return "";
  const media = page.media_info && typeof page.media_info === "object" ? page.media_info : {};
  const candidates = [
    media.mp4_hd_url,
    media.mp4_720p_mp4,
    media.mp4_sd_url,
    media.stream_url,
    media.stream_url_hd,
  ];
  const playback = Array.isArray(media.playback_list) ? media.playback_list : [];
  for (const item of playback) {
    const play = item && typeof item === "object" ? item.play_info || item : null;
    if (play && typeof play === "object") candidates.push(play.url, play.stream_url);
  }
  const urls = page.urls && typeof page.urls === "object" ? Object.values(page.urls) : [];
  for (const item of urls) {
    if (typeof item === "string") candidates.push(item);
    else if (item && typeof item === "object") candidates.push(item.url, item.stream_url);
  }
  for (const item of candidates) {
    const url = String(item || "");
    if (/\.(mp4|webm|mov)(?:$|\?)/i.test(url)) return url;
  }
  return "";
}

function collectWeiboMedia(status) {
  if (!status || typeof status !== "object") return [];
  const out = [];
  const infos = status.pic_infos && typeof status.pic_infos === "object" ? status.pic_infos : null;
  const ids = Array.isArray(status.pic_ids) ? status.pic_ids : infos ? Object.keys(infos) : [];
  for (const pid of ids) {
    const info = infos && infos[pid];
    if (!info || typeof info !== "object") continue;
    const url = String(
      (info.largest && info.largest.url) ||
        (info.original && info.original.url) ||
        (info.large && info.large.url) ||
        (info.mw2000 && info.mw2000.url) ||
        info.url ||
        "",
    ).trim();
    if (url) pushWeiboMediaUrl(out, url);
  }
  if (Array.isArray(status.pics)) {
    for (const pic of status.pics) {
      if (!pic || typeof pic !== "object") continue;
      const large = pic.large && typeof pic.large === "object" ? pic.large.url : "";
      pushWeiboMediaUrl(out, large || pic.url || pic.pic);
    }
  }
  const mix = status.mix_media_info && status.mix_media_info.items;
  if (Array.isArray(mix)) {
    for (const item of mix) {
      if (!item || typeof item !== "object") continue;
      const data = item.data && typeof item.data === "object" ? item.data : item;
      const video = weiboPlayableUrl(data);
      const url = String(
        video ||
          (data.largest && data.largest.url) ||
          (data.original && data.original.url) ||
          (data.large && data.large.url) ||
          data.media_url ||
          data.url ||
          "",
      ).trim();
      if (url) pushWeiboMediaUrl(out, url);
    }
  }
  const video = weiboPlayableUrl(status.page_info);
  if (video) pushWeiboMediaUrl(out, video);
  return Array.from(new Set(out)).slice(0, 9);
}

function minimalWeiboQuote(retweet) {
  if (!retweet || typeof retweet !== "object") return null;
  const text = stripWeiboHtml(retweet.text_raw || retweet.text || "").slice(0, 1600);
  const user = retweet.user && typeof retweet.user === "object" ? retweet.user : {};
  const authorName = String(user.screen_name || user.name || "").slice(0, 60);
  if (!text && !authorName) return null;
  const uid = pickWeiboUid(user.id || user.idstr);
  const mid = String(retweet.mid || retweet.id || retweet.idstr || "");
  const url = uid && mid ? "https://weibo.com/" + uid + "/" + encodeURIComponent(mid) : "";
  const mediaUrls = collectWeiboMedia(retweet);
  return {
    authorName,
    text,
    url,
    likeCount: Number(retweet.attitudes_count) || 0,
    ...(mediaUrls.length ? { mediaUrls } : {}),
  };
}

function parseWeiboCreatedAt(raw, now = Date.now()) {
  const text = String(raw ?? "").trim();
  if (!text) return { timestamp: now, timeText: "" };
  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    return { timestamp: num < 1e12 ? num * 1000 : num, timeText: "" };
  }
  if (text === "刚刚") return { timestamp: now, timeText: "刚刚" };
  let m = text.match(/^(\d+)\s*秒前$/);
  if (m) return { timestamp: Math.max(1, now - Number(m[1]) * 1000), timeText: text };
  m = text.match(/^(\d+)\s*分钟前$/);
  if (m) return { timestamp: Math.max(1, now - Number(m[1]) * 60_000), timeText: text };
  m = text.match(/^(\d+)\s*小时前$/);
  if (m) return { timestamp: Math.max(1, now - Number(m[1]) * 3_600_000), timeText: text };
  m = text.match(/^(昨天|前天)(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const base = new Date(now);
    base.setDate(base.getDate() - (m[1] === "昨天" ? 1 : 2));
    if (m[2] != null) base.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return { timestamp: base.getTime(), timeText: text };
  }
  m = text.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const base = new Date(now);
    const candidate = new Date(
      base.getFullYear(),
      Number(m[1]) - 1,
      Number(m[2]),
      m[3] != null ? Number(m[3]) : 12,
      m[4] != null ? Number(m[4]) : 0,
      0,
      0,
    );
    if (candidate.getTime() > now + 86_400_000) candidate.setFullYear(candidate.getFullYear() - 1);
    return { timestamp: candidate.getTime(), timeText: text };
  }
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const candidate = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] != null ? Number(m[4]) : 12,
      m[5] != null ? Number(m[5]) : 0,
      m[6] != null ? Number(m[6]) : 0,
      0,
    );
    const ts = candidate.getTime();
    if (Number.isFinite(ts) && ts > 0) return { timestamp: ts, timeText: "" };
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && parsed > 946684800000) {
    return { timestamp: parsed, timeText: "" };
  }
  return { timestamp: now, timeText: text.slice(0, 30) };
}

function minimalWeiboPost(status, expectedUid) {
  if (!status || typeof status !== "object") return null;
  const user = status.user && typeof status.user === "object" ? status.user : {};
  const userId = pickWeiboUid(user.id || user.idstr || expectedUid);
  const id = String(status.mid || status.idstr || status.id || "");
  if (!id || !userId) return null;
  if (expectedUid && userId !== String(expectedUid)) return null;
  const text = stripWeiboHtml(status.text_raw || status.text || "");
  const retweet = status.retweeted_status;
  const hasRetweet = !!(retweet && typeof retweet === "object");
  const quoted = hasRetweet ? minimalWeiboQuote(retweet) : null;
  const mediaUrls = collectWeiboMedia(status);
  const created = parseWeiboCreatedAt(status.created_at);
  return {
    id,
    mid: String(status.mid || id),
    userId,
    platform: "weibo",
    authorName: String(user.screen_name || user.name || "").slice(0, 80),
    authorAvatar: weiboAvatarUrl(user),
    title: text.slice(0, 90) || "无标题",
    summary: text.slice(0, 1600),
    timestamp: created.timestamp,
    timeText: created.timeText,
    source: "weibo",
    url: "https://weibo.com/" + userId + "/" + encodeURIComponent(String(status.mid || id)),
    isRetweet: hasRetweet,
    likeCount: Number(status.attitudes_count) || 0,
    replyCount: Number(status.comments_count) || 0,
    retweetCount: Number(status.reposts_count) || 0,
    quoted,
    quoteMissing: hasRetweet && !quoted,
    ...(mediaUrls.length ? { mediaUrls } : {}),
  };
}

function weiboCardlistSinceId(data) {
  const pools = [];
  if (data && data.data && data.data.cardlistInfo) pools.push(data.data.cardlistInfo);
  if (data && data.cardlistInfo) pools.push(data.cardlistInfo);
  for (const info of pools) {
    const value = String((info && (info.since_id || info.sinceId)) || "").trim();
    if (value && value !== "0") return value;
  }
  return "";
}

function weiboSincePath(value, path, depth) {
  if (!value || typeof value !== "object" || depth > 4) return "";
  if (!Array.isArray(value)) {
    const direct = value.since_id != null ? value.since_id : value.sinceId;
    if (direct != null && String(direct) !== "0" && String(direct) !== "") return path;
  }
  const entries = Array.isArray(value)
    ? value.slice(0, 3).map((item, index) => [String(index), item])
    : Object.entries(value).slice(0, 12);
  for (const [key, child] of entries) {
    const hit = weiboSincePath(child, path ? path + "." + key : key, depth + 1);
    if (hit) return hit;
  }
  return "";
}

const weiboCursorMissAt = new Map();

function publicWeiboStatusList(data) {
  const out = [];
  const walk = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) walk(item, depth + 1);
      return;
    }
    if (value.mblog && typeof value.mblog === "object") out.push(value.mblog);
    if (value.card_group) walk(value.card_group, depth + 1);
    if (value.cards) walk(value.cards, depth + 1);
    if (value.data && typeof value.data === "object") walk(value.data, depth + 1);
  };
  walk(data);
  return out;
}

async function fetchWeiboPublicTimeline(uid, page, sinceId) {
  if (typeof fetchWeiboMobileJson !== "function") return null;
  if (typeof releaseWeiboExtensionPause === "function") releaseWeiboExtensionPause();
  const id = pickWeiboUid(uid);
  if (!id) return null;
  const pageNo = Math.max(1, Number(page) || 1);
  // 未登录时微博只放开第一页，继续翻页会转到登录校验。不再追这次校验，直接告诉阅读器。
  if (pageNo > 1) {
    return { posts: [], hasMore: false, limited: true };
  }
  const cursor = String(sinceId || "").trim();
  const useCursor = pageNo > 1 && !!cursor;
  const missKey = id + ":" + (useCursor ? cursor : "page" + pageNo);
  if (pageNo > 1 && Date.now() - (weiboCursorMissAt.get(missKey) || 0) < 15000) {
    return { posts: [], hasMore: false, limited: true };
  }
  // type=uid is what makes the public profile return cardlistInfo.since_id. page alone is rejected.
  const containers = useCursor
    ? ["107603" + id]
    : ["107603" + id, "230413" + id + "_-_WEIBO_SECOND_PROFILE_WEIBO"];
  let lastError = "";
  for (const container of containers) {
    const params = new URLSearchParams();
    params.set("type", "uid");
    params.set("value", id);
    params.set("containerid", container);
    if (useCursor) params.set("since_id", cursor);
    else params.set("page_type", "03");
    if (!useCursor) params.set("page", String(pageNo));
    const url = "https://m.weibo.cn/api/container/getIndex?" + params.toString();
    try {
      const data = await fetchWeiboMobileJson(url);
      const raw = publicWeiboStatusList(data);
      const posts = raw.map((item) => minimalWeiboPost(item, id)).filter(Boolean);
      if (pageNo > 1 && Number(data && data.ok) === -100) {
        weiboCursorMissAt.set(missKey, Date.now());
        return { posts: [], hasMore: false, limited: true };
      }
      if (Number(data && data.ok) === -100) weiboCursorMissAt.set(missKey, Date.now());
      if (posts.length) {
        const nextSince = weiboCardlistSinceId(data);
        return { posts, hasMore: !!nextSince || raw.length >= 10, sinceId: nextSince };
      }
    } catch (error) {
      lastError = String((error && error.message) || error).slice(0, 80);
    }
  }
  if (lastError) throw new Error(lastError);
  return { posts: [], hasMore: false };
}

async function fetchWeiboTimeline(uid, page, sinceId) {
  const id = pickWeiboUid(uid);
  if (!id) return { ok: false, error: "BAD_USER_ID" };
  const pageNo = Math.max(1, Number(page) || 1);
  const url =
    "https://weibo.com/ajax/statuses/mymblog?uid=" +
    encodeURIComponent(id) +
    "&page=" +
    pageNo +
    "&feature=0";
  try {
    let data = await fetchWeiboJson(url, "https://weibo.com/u/" + id);
    // Weibo frequently returns ok=-100 to extension-origin requests while
    // the same request succeeds from an open, authenticated Weibo tab. Retry
    // through that tab before surfacing the API rejection to the reader.
    if (
      data &&
      typeof data === "object" &&
      Number(data.ok) === -100 &&
      typeof fetchWeiboJsonViaTab === "function"
    ) {
      try {
        data = await fetchWeiboJsonViaTab(url, "https://weibo.com/u/" + id);
      } catch {
        // Keep the original API response below when no usable tab session exists.
      }
    }
    if (data && typeof data === "object" && Number(data.ok) !== 1) {
      try {
        const publicResult = await fetchWeiboPublicTimeline(id, pageNo, sinceId);
        if (publicResult && publicResult.limited) {
          return { ok: false, limited: true, error: "微博限制了继续加载，未登录只能看最近一页" };
        }
        if (publicResult && publicResult.posts.length) {
          const success = { ok: true, posts: publicResult.posts, hasMore: publicResult.hasMore, page: pageNo, sinceId: publicResult.sinceId || "", public: true };
          finishGuardedRequest("weibo", success);
          return success;
        }
      } catch {
        // Fall through to the original API error when the public endpoint is unavailable.
      }
    }
    if (
      data &&
      typeof data === "object" &&
      Object.prototype.hasOwnProperty.call(data, "ok") &&
      Number.isFinite(Number(data.ok)) &&
      Number(data.ok) !== 1
    ) {
      const code = Number(data.ok);
      const detail = String(
        data.message || data.msg || data.error || "微博接口返回失败状态 (ok=" + code + ")",
      );
      const failed = { ok: false, error: detail.slice(0, 80) };
      finishGuardedRequest("weibo", failed, "timeline");
      return failed;
    }
    const list = Array.isArray(data?.data?.list)
      ? data.data.list
      : Array.isArray(data?.list)
        ? data.list
        : [];
    const posts = list.map((raw) => minimalWeiboPost(raw, id)).filter(Boolean);
    const success = { ok: true, posts, hasMore: list.length >= 10, page: pageNo };
    finishGuardedRequest("weibo", success);
    return success;
  } catch (error) {
    try {
      const publicResult = await fetchWeiboPublicTimeline(id, pageNo, sinceId);
      if (publicResult && publicResult.limited) {
        return { ok: false, limited: true, error: "微博限制了继续加载，未登录只能看最近一页" };
      }
      if (publicResult && publicResult.posts.length) {
        const success = { ok: true, posts: publicResult.posts, hasMore: publicResult.hasMore, page: pageNo, sinceId: publicResult.sinceId || "", public: true };
        finishGuardedRequest("weibo", success);
        return success;
      }
    } catch {
      // Keep the original request error below when the public endpoint is unavailable.
    }
    const msg = String((error && error.message) || error);
    const failed = {
      ok: false,
      error: /RATE_LIMITED/i.test(msg) ? "请求过于频繁，请稍后再试" : msg,
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
      platformPause: !!(error && error.platformPause),
      riskHandled: !!(error && error.platformPause),
    };
    finishGuardedRequest("weibo", failed, "timeline");
    return failed;
  }
}

async function refreshTimelineWeibo(uid, opts) {
  const id = pickWeiboUid(uid);
  if (!id) return { ok: false, reason: "BAD_USER_ID" };
  const key = "weibo:" + id;
  const info = opts && typeof opts === "object" ? opts : {};
  const pageNo = Math.max(1, Number(info.page) || 1);
  const loadMore = !!info.loadMore;
  let sinceId = loadMore ? String(info.cursor || "").trim() : "";
  if (loadMore && !sinceId) {
    try {
      const stored = await chrome.storage.local.get("timelinePaging");
      const paging = stored.timelinePaging && stored.timelinePaging[key];
      sinceId = String((paging && paging.cursor) || "").trim();
    } catch {
      sinceId = "";
    }
  }
  if (!loadMore) broadcast({ type: "USER_LOADING", userId: id, feedKey: key, platform: "weibo" });
  const result = await fetchWeiboTimeline(id, loadMore ? pageNo : 1, sinceId);
  if (result.ok) {
    const nextCursor = String(result.sinceId || "");
    await persistTimelineFeed(key, result.posts, {
      page: pageNo,
      hasMore: result.hasMore,
      loadMore,
      cursor: nextCursor,
    });
    return { ok: true, count: result.posts.length, hasMore: result.hasMore, page: pageNo, cursor: nextCursor };
  }
  broadcast({
    type: "USER_TIMELINE_RESULT",
    ok: false,
    userId: id,
    feedKey: key,
    error: result.error || "读取失败",
    retryAfterMs: result.retryAfterMs,
    platformPause: !!result.platformPause,
    limited: !!result.limited,
    loadMore,
  });
  await persistTimelineFailure(key, result);
  return {
    ok: false,
    reason: result.error || "TIMELINE_FAILED",
    hasMore: !result.limited,
    limited: !!result.limited,
    retryAfterMs: result.retryAfterMs,
    platformPause: !!result.platformPause,
  };
}

function publicUserCandidate(platform, raw) {
  if (!raw || typeof raw !== "object") return null;
  if (platform === "xueqiu") {
    const id = String(raw.id ?? raw.user_id ?? raw.uid ?? "").trim();
    const name = String(raw.screen_name ?? raw.name ?? raw.nickname ?? "").trim();
    if (!/^\d{5,}$/.test(id) || !name) return null;
    return {
      platform,
      id,
      name: name.slice(0, 80),
      avatar: xueqiuAvatarUrl(raw).slice(0, 500),
      followers: Number(raw.followers_count ?? raw.followers) || 0,
      verified: !!(raw.verified || raw.verify_type >= 0 || raw.verified_type >= 0),
      description: String(raw.description ?? raw.introduction ?? "").slice(0, 120),
    };
  }
  if (platform === "weibo") return mapWeiboFollowUser(raw);
  return null;
}

function collectPublicUserObjects(value, depth = 0, out = []) {
  if (depth > 5 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) collectPublicUserObjects(item, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  out.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectPublicUserObjects(child, depth + 1, out);
  }
  return out;
}

function uniquePublicUsers(platform, payload) {
  const byId = new Map();
  for (const raw of collectPublicUserObjects(payload)) {
    const user = publicUserCandidate(platform, raw);
    if (!user || byId.has(user.id)) continue;
    byId.set(user.id, user);
  }
  return Array.from(byId.values()).slice(0, 30);
}

async function searchXueqiuUsers(query) {
  const q = String(query || "").trim();
  if (!q) return { ok: true, users: [] };
  const paths = [
    "/query/v1/old/search/user?u=-1&uuid=" +
      Date.now() +
      "&q=" +
      encodeURIComponent(q) +
      "&count=30&page=1&session_token=null",
    "/users/search.json?q=" + encodeURIComponent(q) + "&count=30&page=1",
  ];
  let lastError = "SEARCH_FAILED";
  for (const path of paths) {
    try {
      const data = await fetchXueqiuJson("https://xueqiu.com" + path + "&_=" + Date.now());
      const users = uniquePublicUsers("xueqiu", data);
      if (users.length) return { ok: true, users, public: true };
      if (data && typeof data === "object" && !data.error_code) {
        return { ok: false, users: [], error: "NO_RESULTS" };
      }
      lastError = "NO_RESULTS";
    } catch (error) {
      lastError = String((error && error.message) || error).slice(0, 100);
      if (error && error.platformPause) break;
    }
  }
  return { ok: false, users: [], error: lastError };
}

async function searchWeiboUsers(query) {
  const q = String(query || "").trim();
  if (!q) return { ok: true, users: [] };
  const urls = [
    "https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D3%26q%3D" +
      encodeURIComponent(q) +
      "&page_type=searchall",
    "https://weibo.com/ajax/side/search?q=" + encodeURIComponent(q),
  ];
  let lastError = "SEARCH_FAILED";
  for (const url of urls) {
    try {
      const data = await fetchWeiboJson(url, "https://weibo.com/");
      const users = uniquePublicUsers("weibo", data);
      if (users.length) return { ok: true, users, public: true };
      if (data && Number(data.ok) === 1) {
        return { ok: false, users: [], error: "NO_RESULTS" };
      }
      lastError = "NO_RESULTS";
    } catch (error) {
      lastError = String((error && error.message) || error).slice(0, 100);
      if (error && error.platformPause) break;
    }
  }
  return { ok: false, users: [], error: lastError };
}

const X_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
let xFollowingCache = { at: 0, users: [] };

async function readXAuthCookies() {
  let list = [];
  try {
    list = await chrome.cookies.getAll({ url: "https://x.com/" });
    if (!list.length) list = await chrome.cookies.getAll({ domain: "x.com" });
  } catch (error) {
    list = [];
  }
  const map = Object.create(null);
  for (const cookie of Array.isArray(list) ? list : []) {
    if (cookie && cookie.name && map[cookie.name] == null) {
      map[cookie.name] = String(cookie.value == null ? "" : cookie.value);
    }
  }
  return map;
}

function mapXFollowingUser(user) {
  const id = String((user && (user.screen_name || user.username)) || "")
    .replace(/^@/, "")
    .toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(id)) return null;
  const avatar = String((user && (user.profile_image_url_https || user.profile_image_url)) || "")
    .replace(/^http:\/\//i, "https://")
    .replace("_normal", "_bigger")
    .slice(0, 500);
  return {
    id,
    name: String((user && user.name) || id).slice(0, 80),
    avatar,
  };
}

const X_FOLLOWING_QUERY_ID = "BEkNpEt5pNETESoqMsTEGA";
const X_FOLLOWING_FEATURES = {
  rweb_video_screen_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  responsive_web_jetfuel_frame: false,
  post_ctas_fetch_enabled: true,
  responsive_web_grok_share_attachment_enabled: false,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

function xUserIdFromCookies(cookies) {
  let raw = String((cookies && cookies.twid) || "");
  try {
    raw = decodeURIComponent(raw);
  } catch (error) {
    /* keep raw */
  }
  const match = raw.match(/(\d{4,})/);
  return match ? match[1] : "";
}

function xApiHeaders(cookies) {
  const header = ["auth_token", "ct0", "twid"]
    .filter((name) => cookies[name])
    .map((name) => name + "=" + cookies[name])
    .join("; ");
  return {
    Accept: "application/json",
    Authorization: "Bearer " + X_WEB_BEARER,
    Referer: "https://x.com/following",
  };
}

async function xApiGet(cookies, url) {
  const parsed = new URL(String(url));
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "x.com" && !parsed.hostname.endsWith(".x.com"))
  )
    throw new Error("X_URL_NOT_ALLOWED");
  const guarded = await runGuardedPlatformRequest("x-account", parsed.href, async () => {
    const response = await fetch(parsed.href, {
      cache: "no-store",
      credentials: "omit",
      headers: xApiHeaders(cookies),
    });
    const text = await response.text();
    const risk = riskDetails(response.status, text, response.headers);
    if (risk) {
      const error = new Error("HTTP " + response.status);
      error.status = response.status;
      error.platformRisk = risk;
      throw error;
    }
    if (!response.ok) throw Object.assign(new Error("HTTP " + response.status), { status: response.status });
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  });
  if (!guarded.ok) {
    const error = new Error(guarded.error || guarded.reason);
    error.platformPause = !!guarded.platformPause;
    error.retryAfterMs = guarded.retryAfterMs;
    throw error;
  }
  return guarded.value;
}

function usersFromFollowingGraphql(json) {
  const result = json && json.data && json.data.user && json.data.user.result;
  const timeline = result && (result.timeline || result.timeline_v2);
  const instructions = (timeline && timeline.timeline && timeline.timeline.instructions) || [];
  const users = [];
  let nextCursor = "";
  for (const instruction of instructions) {
    const entries = instruction && Array.isArray(instruction.entries) ? instruction.entries : [];
    for (const entry of entries) {
      const content = entry && entry.content;
      if (!content) continue;
      if (content.cursorType === "Bottom" && content.value) nextCursor = String(content.value);
      const raw =
        content.itemContent &&
        content.itemContent.user_results &&
        content.itemContent.user_results.result;
      const user = raw && raw.__typename === "UserWithVisibilityResults" ? raw.user : raw;
      if (!user) continue;
      const legacy = user.legacy || {};
      const core = user.core || {};
      const avatarObj = user.avatar && typeof user.avatar === "object" ? user.avatar : {};
      const person = mapXFollowingUser({
        screen_name: legacy.screen_name || core.screen_name,
        name: legacy.name || core.name,
        profile_image_url_https:
          avatarObj.image_url ||
          avatarObj.url ||
          legacy.profile_image_url_https ||
          legacy.profile_image_url,
      });
      if (person) users.push(person);
    }
  }
  return { users, nextCursor };
}

async function fetchXFollowingGraphql(cookies, userId, cursor) {
  const variables = { userId, count: 100, includePromotedContent: false };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(X_FOLLOWING_FEATURES),
  });
  const url =
    "https://x.com/i/api/graphql/" + X_FOLLOWING_QUERY_ID + "/Following?" + params.toString();
  const response = await xApiGet(cookies, url);
  const parsed = usersFromFollowingGraphql(response.json);
  const errorCode =
    response.json && Array.isArray(response.json.errors) && response.json.errors[0]
      ? response.json.errors[0].code
      : 0;
  return {
    ok: response.status === 200 && parsed.users.length > 0,
    status: response.status,
    reason:
      errorCode === 88
        ? "RATE_LIMITED"
        : errorCode === 32
          ? "NOT_LOGGED_IN"
          : "HTTP_" + response.status,
    users: parsed.users,
    nextCursor: parsed.nextCursor,
    route: "graphql",
  };
}

async function fetchXFollowingRest(cookies, userId) {
  const params =
    "user_id=" +
    encodeURIComponent(userId) +
    "&count=200&skip_status=true&include_user_entities=false";
  const urls = ["https://x.com/i/api/1.1/friends/list.json?" + params];
  let last = { ok: false, status: 0, reason: "HTTP_0", users: [], nextCursor: "0", route: "rest" };
  for (const url of urls) {
    const response = await xApiGet(cookies, url);
    const users = response.json && Array.isArray(response.json.users) ? response.json.users : [];
    const code =
      response.json && Array.isArray(response.json.errors) && response.json.errors[0]
        ? response.json.errors[0].code
        : 0;
    last = {
      ok: response.status === 200 && users.length > 0,
      status: response.status,
      reason:
        code === 88 ? "RATE_LIMITED" : code === 32 ? "NOT_LOGGED_IN" : "HTTP_" + response.status,
      users,
      nextCursor: String(
        (response.json && (response.json.next_cursor_str || response.json.next_cursor)) || "0",
      ),
      route: "rest-web",
    };
    if (last.ok) return last;
  }
  return last;
}

async function fetchXFollowing(force) {
  const started = Date.now();
  if (
    !force &&
    xFollowingCache.users.length &&
    Date.now() - xFollowingCache.at < FOLLOWING_CACHE_MS
  ) {
    const cachedAvatars = xFollowingCache.users.filter((user) =>
      /^https:\/\//i.test(String((user && user.avatar) || "")),
    ).length;
    if (cachedAvatars) {
      return { ok: true, users: xFollowingCache.users, cached: true, pages: 0, status: 200 };
    }
  }
  const cookies = await readXAuthCookies();
  if (!cookies.auth_token || !cookies.ct0) {
    return { ok: false, reason: "NOT_LOGGED_IN", users: [], pages: 0, status: 0 };
  }
  const gate = beginGuardedRequest("x", "following", { force: !!force });
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason,
      users: [],
      pages: 0,
      status: 0,
      retryAfterMs: gate.retryAfterMs,
    };
  }
  let userId = xUserIdFromCookies(cookies);
  const attempts = [];
  if (!userId) {
    const settings = await xApiGet(cookies, "https://x.com/i/api/1.1/account/settings.json");
    const id = settings.json && (settings.json.user_id || settings.json.user_id_str);
    userId = id ? String(id) : "";
    attempts.push({ route: "settings", status: settings.status, count: userId ? 1 : 0 });
  }
  const users = [];
  const seen = new Set();
  let status = 0;
  let reason = userId ? "" : "NO_USER_ID";
  if (userId) {
    let cursor = "";
    let pages = 0;
    while (pages < 3) {
      pages += 1;
      const page = await fetchXFollowingGraphql(cookies, userId, cursor);
      status = page.status;
      attempts.push({ route: page.route, status: page.status, count: page.users.length });
      if (!page.ok && !page.users.length) {
        reason = page.reason || "HTTP_" + page.status;
        break;
      }
      reason = "";
      for (const person of page.users) {
        if (!person || seen.has(person.id)) continue;
        seen.add(person.id);
        users.push(person);
      }
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
      await sleep(350);
    }
    if (!users.length) {
      const rest = await fetchXFollowingRest(cookies, userId);
      status = rest.status;
      attempts.push({ route: rest.route, status: rest.status, count: rest.users.length });
      if (rest.ok) {
        reason = "";
        for (const raw of rest.users) {
          const person = mapXFollowingUser(raw);
          if (!person || seen.has(person.id)) continue;
          seen.add(person.id);
          users.push(person);
        }
      } else if (!reason) {
        reason = rest.reason || "HTTP_" + rest.status;
      }
    }
  }
  const pages = attempts.length;
  if (!users.length && reason) {
    const failed = {
      ok: false,
      reason,
      users: [],
      pages,
      status,
      elapsedMs: Date.now() - started,
    };
    finishGuardedRequest("x", failed, "following");
    return failed;
  }
  xFollowingCache = { at: Date.now(), users };
  const success = { ok: true, users, pages, status, elapsedMs: Date.now() - started };
  finishGuardedRequest("x", success);
  return success;
}

async function readPlatformSessions() {
  const [xueqiu, x, weibo] = await Promise.all([
    readSession(),
    readXSession(),
    readWeiboSession(),
  ]);
  return { xueqiu, x, weibo };
}

// 雪球 / X / 微博登录状态变化时通知阅读窗口（不广播 cookie 值）
let sessionTimer = null;
function registerCookieSessionListener() {
  chrome.cookies.onChanged.addListener((info) => {
    const cookie = info && info.cookie;
    if (!cookie || !cookie.name) return;
    const domain = String(cookie.domain || "");
    const isXueqiu =
      SESSION_COOKIES.indexOf(cookie.name) !== -1 && /(^|\.)xueqiu\.com$/i.test(domain);
    const isX =
      X_SESSION_COOKIE_NAMES.indexOf(cookie.name) !== -1 && /(^|\.)(x|twitter)\.com$/i.test(domain);
    const isWeibo =
      WEIBO_SESSION_COOKIE_NAMES.indexOf(cookie.name) !== -1 &&
      /(^|\.)weibo\.(com|cn)$/i.test(domain);
    if (!isXueqiu && !isX && !isWeibo) return;
    if (isX) xFollowingCache = { at: 0, users: [] };
    if (isWeibo) weiboFollowingCache = { at: 0, users: [] };
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(async () => {
      sessionTimer = null;
      const sessions = await readPlatformSessions();
      broadcast({ type: "SESSION_CHANGED", session: sessions.xueqiu, sessions });
    }, 350);
  });
}

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    /* 没有打开的窗口时忽略 */
  }
}

/* ---------------- 独立窗口：仅作为 popup 的可选升级形态 ---------------- */

function normalizeBounds(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const clamp = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  };
  return {
    width: clamp(source.width, LIMITS.minWidth, LIMITS.maxWidth, DEFAULT_BOUNDS.width),
    height: clamp(source.height, LIMITS.minHeight, LIMITS.maxHeight, DEFAULT_BOUNDS.height),
  };
}

function getAllWindows() {
  return new Promise((resolve) => {
    chrome.windows.getAll({ populate: true }, (list) => {
      void chrome.runtime.lastError;
      resolve(Array.isArray(list) ? list : []);
    });
  });
}

async function findReaderWindow() {
  const page = chrome.runtime.getURL(WINDOW_PAGE);
  const windows = await getAllWindows();
  for (const win of windows) {
    for (const tab of win.tabs || []) {
      if (String((tab && tab.url) || "").startsWith(page)) return win;
    }
  }
  return null;
}

async function openReaderWindow() {
  if (readerWindowOpenPromise) return readerWindowOpenPromise;

  readerWindowOpenPromise = (async () => {
    const stored = await chrome.storage.local.get(WINDOW_KEY);
    const bounds = normalizeBounds(stored[WINDOW_KEY]);
    const existing = await findReaderWindow();
    if (existing) {
      await chrome.windows.update(existing.id, { focused: true });
      return { ok: true, windowId: existing.id, reused: true, bounds };
    }
    const url = chrome.runtime.getURL(WINDOW_PAGE) + "?mode=window";
    const created = await new Promise((resolve) => {
      chrome.windows.create(
        { url, type: "popup", width: bounds.width, height: bounds.height, focused: true },
        (win) => {
          void chrome.runtime.lastError;
          resolve(win || null);
        },
      );
    });
    return created
      ? { ok: true, windowId: created.id, created: true, bounds }
      : { ok: false, reason: "WINDOW_FAILED" };
  })();

  try {
    return await readerWindowOpenPromise;
  } finally {
    readerWindowOpenPromise = null;
  }
}

/* ---------------- Chrome Side Panel：与 popup 共用同一套阅读 UI ---------------- */

function hasSidePanelApi() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.open === "function");
}

function sidebarActionApi() {
  const fromChrome = chrome.sidebarAction;
  if (fromChrome && (fromChrome.open || fromChrome.toggle)) return fromChrome;
  const browserApi = globalThis.browser;
  const fromBrowser = browserApi && browserApi.sidebarAction;
  if (fromBrowser && (fromBrowser.open || fromBrowser.toggle)) return fromBrowser;
  return null;
}

function primeSidePanel() {
  if (!hasSidePanelApi() || typeof chrome.sidePanel.setOptions !== "function") return;
  try {
    void chrome.sidePanel.setOptions({ path: SIDEBAR_PAGE, enabled: true });
  } catch {
    /* Firefox / 旧内核无此 API */
  }
}

async function ensureSidePanel() {
  if (!hasSidePanelApi() || typeof chrome.sidePanel.setOptions !== "function") return;
  try {
    await chrome.sidePanel.setOptions({ path: SIDEBAR_PAGE, enabled: true });
  } catch {
    /* Firefox / 旧内核无此 API */
  }
}

function resolveWindowId(hint) {
  const fromHint = Number(hint);
  if (Number.isFinite(fromHint) && fromHint > 0) return Promise.resolve(fromHint);
  return new Promise((resolve) => {
    const query = chrome.windows.getLastFocused
      ? (done) => chrome.windows.getLastFocused({ windowTypes: ["normal"] }, done)
      : (done) => chrome.windows.getCurrent(done);
    query((win) => {
      void chrome.runtime.lastError;
      if (win && win.id && win.type !== "popup") {
        resolve(win.id);
        return;
      }
      chrome.windows.getCurrent((current) => {
        void chrome.runtime.lastError;
        resolve(current && current.type !== "popup" && current.id ? current.id : null);
      });
    });
  });
}

function openFirefoxSidebar() {
  const action = sidebarActionApi();
  if (!action) return Promise.resolve({ ok: false, reason: "NO_SIDE_PANEL" });
  try {
    const opening =
      typeof action.open === "function"
        ? action.open()
        : typeof action.toggle === "function"
          ? action.toggle()
          : null;
    if (!opening && typeof action.toggle !== "function") {
      return Promise.resolve({ ok: false, reason: "NO_SIDE_PANEL" });
    }
    return Promise.resolve(opening)
      .then(() => ({ ok: true }))
      .catch(() => ({ ok: false, reason: "SIDEBAR_FAILED" }));
  } catch {
    return Promise.resolve({ ok: false, reason: "SIDEBAR_FAILED" });
  }
}

// sidePanel.open 必须和用户点击在同一轮执行。前面任何 await 都会丢掉手势，
// Edge / Arc / Firefox 会直接拒绝；也不要把弹窗自己的 windowId 传进来。
function openReaderSidebar(windowIdHint) {
  if (!hasSidePanelApi()) return openFirefoxSidebar();
  const hinted = Number(windowIdHint);
  const openNow = (windowId) => {
    primeSidePanel();
    try {
      return Promise.resolve(chrome.sidePanel.open({ windowId }))
        .then(() => ({ ok: true, windowId }))
        .catch(() => ({ ok: false, reason: "SIDEBAR_FAILED" }));
    } catch {
      return Promise.resolve({ ok: false, reason: "SIDEBAR_FAILED" });
    }
  };
  if (Number.isFinite(hinted) && hinted > 0) return openNow(hinted);
  return resolveWindowId(0).then((windowId) => {
    if (!windowId) return { ok: false, reason: "NO_WINDOW" };
    return openNow(windowId);
  });
}

/* 工具栏图标只开关设置里保存的一种形态：popup 或 sidebar */
const sidebarWindows = new Set();
let actionSurface = "sidebar";

function surfaceFromSettings(settings) {
  return settings && settings.surface === "popup" ? "popup" : "sidebar";
}

async function closeSidebarWindow(windowId) {
  if (!windowId) return;
  if (chrome.sidePanel && typeof chrome.sidePanel.close === "function") {
    try {
      await chrome.sidePanel.close({ windowId });
    } catch {
      /* Chrome < 141 无 close */
    }
  }
  const action = sidebarActionApi();
  if (action && typeof action.close === "function") {
    try {
      await action.close();
    } catch {
      /* Firefox sidebar close may be unavailable in older versions */
    }
  }
  sidebarWindows.delete(windowId);
}

async function applyActionSurface() {
  const stored = await chrome.storage.local.get("settings");
  const surface = surfaceFromSettings(stored.settings);
  actionSurface = surface;
  if (!chrome.action || typeof chrome.action.setPopup !== "function") return;
  if (surface === "sidebar") {
    await chrome.action.setPopup({ popup: "" });
    await ensureSidePanel();
    return;
  }
  await chrome.action.setPopup({ popup: "popup.html" });
  for (const windowId of sidebarWindows) await closeSidebarWindow(windowId);
}

function registerSidePanelListeners() {
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== "sidebar") return;
    let windowId = 0;
    port.onMessage.addListener((msg) => {
      windowId = Number(msg && msg.windowId) || 0;
      if (!windowId) return;
      chrome.storage.local.get("settings", (data) => {
        if (surfaceFromSettings(data && data.settings) !== "sidebar") {
          void closeSidebarWindow(windowId);
          return;
        }
        sidebarWindows.add(windowId);
      });
    });
    port.onDisconnect.addListener(() => {
      if (windowId) sidebarWindows.delete(windowId);
    });
  });

  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener((tab) => {
      const windowId = tab && tab.windowId;
      if (!windowId) return;
      // 能进 onClicked 说明弹窗已被清空，当前形态就是侧栏。
      // 必须在这次点击里同步 open；先读 storage 或依赖内存里的 actionSurface，
      // 在 Service Worker 刚被唤醒时会丢掉手势，别的浏览器就会打不开。
      if (sidebarWindows.has(windowId)) {
        void closeSidebarWindow(windowId);
        return;
      }
      if (hasSidePanelApi()) {
        primeSidePanel();
        Promise.resolve(chrome.sidePanel.open({ windowId }))
          .then(() => {
            sidebarWindows.add(windowId);
          })
          .catch(() => {});
        return;
      }
      void openFirefoxSidebar();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) void applyActionSurface();
  });

  void applyActionSurface();
}

/* ---------------- 雪球标签页：数据链路载体 ---------------- */

// 跨窗口查找雪球标签页：先看当前窗口的活动标签，再退到任意窗口的活动标签。
function findXueqiuTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      void chrome.runtime.lastError;
      const candidates = (tabs || []).filter(
        (tab) => tab && tab.id && XUEQIU_TAB.test(tab.url || ""),
      );
      if (!candidates.length) {
        resolve(null);
        return;
      }
      const pathScore = (tab) => {
        try {
          const p = new URL(tab.url || "").pathname;
          return p && p !== "/" ? 2 : 0;
        } catch (error) {
          return 0;
        }
      };
      candidates.sort((a, b) => pathScore(b) - pathScore(a));
      chrome.tabs.query({ active: true, currentWindow: true }, (actives) => {
        void chrome.runtime.lastError;
        const activeId = actives && actives[0] ? actives[0].id : null;
        resolve(
          candidates.find((tab) => tab.id === activeId) ||
            candidates.find((tab) => tab.active) ||
            candidates[0],
        );
      });
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab && tab.id ? tab : null);
    });
  });
}

function closeTemporaryXueqiuTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function createTemporaryXueqiuTab() {
  const created = await new Promise((resolve) => {
    chrome.tabs.create({ url: XUEQIU_HOME, active: false }, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab || null);
    });
  });
  if (!created || !created.id) throw new Error("XUEQIU_TAB_OPEN_FAILED");
  try {
    if (created.status !== "complete") await waitForComplete(created.id, 20000);
    const ready = await getTab(created.id);
    if (!ready || ready.status !== "complete") throw new Error("XUEQIU_TAB_LOAD_FAILED");
    return ready;
  } catch (error) {
    await closeTemporaryXueqiuTab(created.id);
    throw error;
  }
}

async function fetchXueqiuJsonWithPageSession(url) {
  let tab = await findXueqiuTab();
  const temporary = !tab || !tab.id || tab.discarded;
  if (temporary) tab = await createTemporaryXueqiuTab();
  try {
    const [{ result, error } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (requestUrl) => {
        try {
          const current = new URL(location.href);
          const requested = new URL(requestUrl);
          if (
            current.protocol !== "https:" ||
            !/(^|\.)xueqiu\.com$/i.test(current.hostname) ||
            requested.protocol !== "https:" ||
            !/(^|\.)xueqiu\.com$/i.test(requested.hostname)
          ) return { __error: "XUEQIU_URL_NOT_ALLOWED" };
          // Keep the request same-origin so the logged-in page session is used without CORS.
          const sameOriginUrl = new URL(requested.pathname + requested.search, current.origin).href;
          const response = await fetch(sameOriginUrl, {
            credentials: "include",
            cache: "no-store",
            headers: {
              Accept: "application/json, text/plain, */*",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          const text = await response.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            return { __error: response.ok ? "NON_JSON" : "HTTP " + response.status };
          }
          if (Number(data && data.error_code) === 400016)
            return { __error: "XUEQIU_SESSION_REQUIRED" };
          if (!response.ok) return { __error: "HTTP " + response.status };
          return { data };
        } catch (requestError) {
          return { __error: String((requestError && requestError.message) || requestError) };
        }
      },
      args: [String(url)],
    });
    if (error) throw new Error(String(error.message || error));
    if (!result || result.__error)
      throw new Error((result && result.__error) || "XUEQIU_TAB_REQUEST_FAILED");
    return result.data;
  } finally {
    if (temporary && tab && tab.id) await closeTemporaryXueqiuTab(tab.id);
  }
}

async function fetchXueqiuJson(url, opts) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error("BAD_URL");
  }
  if (!/(^|\.)xueqiu\.com$/i.test(parsed.hostname) || parsed.protocol !== "https:") {
    throw new Error("XUEQIU_URL_NOT_ALLOWED");
  }
  const sessionFallback = !!(opts && opts.sessionFallback);
  const canonical = canonicalRequestUrl(parsed.href);
  const guarded = await runGuardedPlatformRequest(
    "xueqiu",
    canonical,
    async () => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
    try {
      const response = await fetch(parsed.href, {
        credentials: "omit",
        signal: controller ? controller.signal : undefined,
        cache: "no-store",
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://xueqiu.com/today",
        },
      });
      const text = await response.text();
      const risk = riskDetails(response.status, text, response.headers);
      if (risk) {
        const error = new Error(response.status ? "HTTP " + response.status : "RISK_RESPONSE");
        error.platformRisk = risk;
        throw error;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok || !/^\s*</.test(text))
          throw new Error(response.ok ? "NON_JSON" : "HTTP " + response.status);
      }
      if (!sessionFallback && Number(data && data.error_code) === 400016) {
        throw Object.assign(new Error("请先登录雪球后重试"), { needsLogin: true });
      }
      if (sessionFallback && Number(data && data.error_code) === 400016) {
        let sessionResponse;
        try {
          sessionResponse = await fetch(parsed.href, {
            credentials: "include",
            signal: controller ? controller.signal : undefined,
            cache: "no-store",
            headers: {
              Accept: "application/json, text/plain, */*",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://xueqiu.com/today",
            },
          });
        } catch {
          return await fetchXueqiuJsonWithPageSession(parsed.href);
        }
        const sessionText = await sessionResponse.text();
        const sessionRisk = riskDetails(sessionResponse.status, sessionText, sessionResponse.headers);
        if (sessionRisk) {
          const error = new Error(
            sessionResponse.status ? "HTTP " + sessionResponse.status : "RISK_RESPONSE",
          );
          error.platformRisk = sessionRisk;
          throw error;
        }
        let sessionData;
        try {
          sessionData = JSON.parse(sessionText);
        } catch {
          throw new Error(sessionResponse.ok ? "NON_JSON" : "HTTP " + sessionResponse.status);
        }
        if (Number(sessionData && sessionData.error_code) === 400016)
          return await fetchXueqiuJsonWithPageSession(parsed.href);
        if (!sessionResponse.ok) throw new Error("HTTP " + sessionResponse.status);
        return sessionData;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      if (typeof data === "undefined") throw new Error("NON_JSON");
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  { force: !!(opts && opts.force) },
  );
  if (!guarded.ok) {
    const error = new Error(guarded.error || guarded.reason || "REQUEST_REJECTED");
    error.retryAfterMs = guarded.retryAfterMs;
    error.platformPause = guarded.platformPause;
    throw error;
  }
  return guarded.value;
}

async function probeBackgroundSession() {
  try {
    await fetchXueqiuJson("https://xueqiu.com/user/current.json?_=" + Date.now());
    return true;
  } catch (error) {
    return false;
  }
}

function waitForComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdate);
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    const onUpdate = (id, info) => {
      if (id === tabId && info && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdate);
    timer = setTimeout(finish, timeout || 20000);
    chrome.tabs.get(tabId, (tab) => {
      void chrome.runtime.lastError;
      if (tab && tab.status === "complete") finish();
    });
  });
}

// 只复用已有雪球标签页；没有则不创建，避免唤醒插件时自动打开雪球。
async function ensureDataTab() {
  let tab = await findXueqiuTab();
  if (!tab) return { tab: null, created: false };
  if (tab.discarded) {
    await new Promise((resolve) => {
      chrome.tabs.reload(tab.id, {}, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
    await waitForComplete(tab.id, 20000);
    await sleep(500);
    tab = (await getTab(tab.id)) || tab;
  }
  await new Promise((resolve) => {
    chrome.tabs.update(tab.id, { autoDiscardable: false }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  return { tab, created: false };
}

function forward(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: "NO_CONTENT_SCRIPT" });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function faceTokenFromAlt(alt) {
  const m = String(alt || "")
    .trim()
    .match(/^\[([^\]]+)\]$/);
  return m ? "[:name:" + m[1] + ":]" : "";
}

function plainFromHtml(input) {
  const raw = String(input || "");
  if (!raw) return "";
  const tag = "im" + "g";
  const open = "<" + tag;
  let text = raw
    .replace(
      new RegExp(open + '[^>]*\\bsrc="([^"]+)"[^>]*\\balt="(\\[[^"]+\\])"[^>]*>', "gi"),
      (_, src) => " [:img:" + src + ":] ",
    )
    .replace(
      new RegExp(open + '[^>]*\\balt="(\\[[^"]+\\])"[^>]*>', "gi"),
      (_, alt) => " " + faceTokenFromAlt(alt) + " ",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function followArray(data) {
  if (!data || typeof data !== "object") return [];
  const out = [];
  const push = (value) => {
    if (Array.isArray(value)) out.push(...value);
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
  return out;
}

function normalizeFollowUser(raw) {
  if (!raw || typeof raw !== "object") return null;
  const profile = String(raw.profile || raw.url || "");
  const fromProfile = profile.match(/(?:\/u)?\/(\d+)(?:[/?#]|$)/);
  const id = String(raw.id ?? raw.user_id ?? raw.uid ?? (fromProfile && fromProfile[1]) ?? "");
  if (!/^\d+$/.test(id)) return null;
  const name = String(raw.screen_name ?? raw.name ?? raw.nickname ?? raw.user_name ?? "").trim();
  if (!name) return null;
  const avatar = xueqiuAvatarUrl(raw);
  return { id, name, avatar };
}

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
      "https://xueqiu.com/v4/friendships/friends.json?uid=" + uid + "&page=" + page + "&count=100",
  },
];

async function fetchFollowingBackground(uid, force) {
  const accountId = String(uid || "");
  const activePenalty = guardedRequestBackoff.get("xueqiu");
  if (activePenalty && activePenalty.until > Date.now())
    return {
      list: [],
      notes: ["平台暂时限制了请求，请稍后再试"],
      fetched: false,
      retryAfterMs: activePenalty.until - Date.now(),
      platformPause: true,
    };
  if (
    !force &&
    xueqiuFollowingCache.result &&
    xueqiuFollowingCache.uid === accountId &&
    Date.now() - xueqiuFollowingCache.at < FOLLOWING_CACHE_MS
  ) {
    return xueqiuFollowingCache.result;
  }
  const gate = beginGuardedRequest("xueqiu", accountId + ":following", { force: !!force });
  if (!gate.ok) {
    return {
      list: [],
      notes: [gate.reason],
      fetched: false,
      retryAfterMs: gate.retryAfterMs,
      platformPause: !!gate.platformPause,
    };
  }
  const notes = [];
  let fetched = false;
  for (const route of FOLLOW_ROUTES) {
    const activePause = guardedRequestBackoff.get("xueqiu");
    if (activePause && activePause.until > Date.now())
      return { list: [], notes, fetched, platformPause: true, retryAfterMs: activePause.until - Date.now() };
    const all = new Map();
    for (let page = 1; page <= 12; page++) {
      const activePause = guardedRequestBackoff.get("xueqiu");
      if (activePause && activePause.until > Date.now())
        return {
          list: Array.from(all.values()).slice(0, 2000),
          notes,
          fetched,
          platformPause: true,
          retryAfterMs: activePause.until - Date.now(),
        };
      const url = route.build(encodeURIComponent(uid), page) + "&_=" + Date.now();
      try {
        const data = await fetchXueqiuJson(url);
        fetched = true;
        if (data.error_code || data.error_description) {
          const apiError = String(data.error_description || data.error_code);
          notes.push(route.name + " → " + apiError.slice(0, 42));
          if (/RATE_LIMIT|过于频繁|验证码|风控|安全验证/i.test(apiError)) {
            await registerPlatformRisk("xueqiu", 0);
            const penalty = guardedRequestBackoff.get("xueqiu");
            return {
              list: Array.from(all.values()).slice(0, 2000),
              notes,
              fetched,
              platformPause: true,
              retryAfterMs: penalty ? penalty.until - Date.now() : PRIVATE_API_BACKOFF_BASE_MS,
            };
          }
          break;
        }
        const rawList = followArray(data);
        if (!rawList.length) {
          notes.push(route.name + " p" + page + " → 空");
          break;
        }
        for (const raw of rawList) {
          const person = normalizeFollowUser(raw);
          if (person && person.id !== String(uid)) all.set(person.id, person);
        }
        if (rawList.length < 20) break;
        await sleep(350);
      } catch (error) {
        notes.push(route.name + " p" + page + " → " + String(error.message || error).slice(0, 40));
        if (error && error.platformPause)
          return {
            list: Array.from(all.values()).slice(0, 2000),
            notes,
            fetched,
            retryAfterMs: error.retryAfterMs,
            platformPause: true,
          };
        break;
      }
    }
    notes.push(route.name + " → " + all.size + " 人");
    if (all.size) {
      const result = { list: Array.from(all.values()).slice(0, 2000), notes, fetched: true };
      xueqiuFollowingCache = { at: Date.now(), uid: accountId, result };
      finishGuardedRequest("xueqiu", { ok: true });
      return result;
    }
  }
  const pause = guardedRequestBackoff.get("xueqiu");
  const result = {
    list: [],
    notes,
    fetched,
    ...(pause && pause.until > Date.now()
      ? { retryAfterMs: pause.until - Date.now(), platformPause: true }
      : {}),
  };
  if (result.platformPause) return result;
  finishGuardedRequest("xueqiu", { ok: false, reason: notes.join(" | ") }, "following");
  return result;
}

/** 从 show.json 取出用户对象；避免把 session/列表包装当成目标作者 */
function pickUserFromProfilePayload(data) {
  if (!data || typeof data !== "object") return null;
  if (data.user && typeof data.user === "object") return data.user;
  if (data.data && typeof data.data === "object") {
    if (data.data.user && typeof data.data.user === "object") return data.data.user;
    if (
      data.data.id != null ||
      data.data.user_id != null ||
      data.data.screen_name ||
      data.data.name
    ) {
      return data.data;
    }
  }
  if (
    (data.id != null || data.user_id != null) &&
    (data.screen_name || data.name || data.nickname) &&
    !Array.isArray(data.statuses) &&
    !Array.isArray(data.list) &&
    !Array.isArray(data.users)
  ) {
    return data;
  }
  return null;
}

/**
 * 拉取目标 uid 的公开资料。返回 id 必须等于请求的 uid；
 * 若响应主体是登录用户或其他人，直接丢弃（禁止写成 viewer）。
 */
async function fetchXueqiuUserProfile(uid) {
  const want = String(uid || "").trim();
  if (!/^\d+$/.test(want)) return null;
  const paths = [
    "/user/show.json?user_id=" + encodeURIComponent(want),
    "/v4/users/show.json?user_id=" + encodeURIComponent(want),
  ];
  for (const path of paths) {
    try {
      const data = await fetchXueqiuJson("https://xueqiu.com" + path + "&_=" + Date.now());
      const user = pickUserFromProfilePayload(data);
      if (!user || typeof user !== "object") continue;
      const id = String(user.id ?? user.user_id ?? "");
      if (id !== want) continue;
      const name = String(user.screen_name ?? user.name ?? user.nickname ?? "").trim();
      const avatar = xueqiuAvatarUrl(user);
      if (name) return { platform: "xueqiu", id: want, name, avatar };
    } catch (error) {
      if (error && error.platformPause) break;
    }
  }
  return null;
}

async function parseSourceInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "EMPTY" };
  const weiboPrefixed = text.match(/^weibo[:/](\d{5,})$/i);
  if (weiboPrefixed) return { platform: "weibo", id: weiboPrefixed[1] };
  if (
    /^x\.com\//i.test(text) ||
    /^twitter\.com\//i.test(text) ||
    /^weibo\.com\//i.test(text) ||
    /^m\.weibo\.cn\//i.test(text) ||
    /^https?:\/\//i.test(text)
  ) {
    try {
      const url = new URL(text.includes("://") ? text : "https://" + text);
      const host = url.hostname.replace(/^www\./, "");
      if (host === "x.com" || host === "twitter.com") {
        const handle = url.pathname.split("/").filter(Boolean)[0];
        if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== "i") {
          return { platform: "x", id: handle.toLowerCase(), handle: handle.toLowerCase() };
        }
      }
      if (host === "weibo.com" || host.endsWith(".weibo.com") || host === "m.weibo.cn") {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "u" && /^\d{5,}$/.test(parts[1] || "")) {
          return { platform: "weibo", id: parts[1] };
        }
        if (parts[0] === "profile" && /^\d{5,}$/.test(parts[1] || "")) {
          return { platform: "weibo", id: parts[1] };
        }
        if (/^\d{5,}$/.test(parts[0] || "")) {
          return { platform: "weibo", id: parts[0] };
        }
      }
      const m = url.pathname.match(/(?:\/u)?\/(\d+)/);
      if ((host === "xueqiu.com" || host.endsWith(".xueqiu.com")) && m) {
        return { platform: "xueqiu", id: m[1] };
      }
    } catch (error) {
      /* fall through */
    }
  }
  if (text.startsWith("@")) {
    const handle = text.slice(1).trim().toLowerCase();
    if (/^[a-z0-9_]{1,15}$/.test(handle)) return { platform: "x", id: handle, handle };
    return { error: "BAD_X_HANDLE" };
  }
  if (/^[a-z0-9_]{1,15}$/i.test(text) && /[a-z_]/i.test(text)) {
    return { platform: "x", id: text.toLowerCase(), handle: text.toLowerCase() };
  }
  const digits = text.match(/(\d{5,})/);
  if (digits) return { platform: "xueqiu", id: digits[1] };
  return { error: "UNRECOGNIZED" };
}

async function resolveSourceSpec(spec, hint) {
  if (spec.error) return { ok: false, error: spec.error };
  // 选择器已带昵称/头像时只落本地，不拉资料；时间线等用户点开再请求
  const hintId = hint && String(hint.id || "").trim();
  const hintName = hint && String(hint.name || "").trim();
  if (hintId && hintName) {
    const want = String(spec.id || "").trim();
    const idOk =
      spec.platform === "x"
        ? hintId.toLowerCase() === want.toLowerCase()
        : hintId === want;
    if (idOk) {
      if (spec.platform === "x") {
        const handle = want.toLowerCase();
        return {
          ok: true,
          source: {
            platform: "x",
            id: handle,
            name: hintName,
            avatar: String(hint.avatar || "").slice(0, 500),
            handle,
          },
        };
      }
      if (spec.platform === "weibo") {
        return {
          ok: true,
          source: {
            platform: "weibo",
            id: want,
            name: hintName,
            avatar: String(hint.avatar || "").slice(0, 500),
          },
        };
      }
      return {
        ok: true,
        source: {
          platform: "xueqiu",
          id: want,
          name: hintName,
          avatar: String(hint.avatar || "").slice(0, 500),
        },
      };
    }
  }
  if (spec.platform === "weibo") {
    const want = String(spec.id || "").trim();
    if (!/^\d{5,}$/.test(want)) return { ok: false, error: "BAD_TARGET" };
    const profile = await fetchWeiboUserProfile(want);
    if (profile) {
      if (String(profile.id) !== want) return { ok: false, error: "PROFILE_MISMATCH" };
      return { ok: true, source: profile };
    }
    if (hintId && hintId === want && hintName) {
      return {
        ok: true,
        source: {
          platform: "weibo",
          id: want,
          name: hintName,
          avatar: String(hint.avatar || "").slice(0, 500),
        },
      };
    }
    return {
      ok: true,
      source: { platform: "weibo", id: want, name: "用户 " + want, avatar: "" },
    };
  }
  if (spec.platform === "x") {
    const handle = String(spec.id || "").toLowerCase();
    try {
      const data = await fetch(
        "https://api.fxtwitter.com/2/profile/" + encodeURIComponent(handle),
        { cache: "no-store" },
      );
      const json = await data.json();
      const user = json && (json.user || json.profile);
      const name = String(user?.name || handle).trim();
      const avatar = String(user?.avatar_url || "")
        .replace(/^http:\/\//i, "https://")
        .replace("_normal", "_bigger")
        .slice(0, 500);
      if (json && json.code === 200) {
        return {
          ok: true,
          source: { platform: "x", id: handle, name: name || handle, avatar, handle },
        };
      }
    } catch (error) {
      /* fallback below */
    }
    return { ok: true, source: { platform: "x", id: handle, name: handle, avatar: "", handle } };
  }
  const want = String(spec.id || "").trim();
  if (!/^\d+$/.test(want)) return { ok: false, error: "BAD_TARGET" };
  const profile = await fetchXueqiuUserProfile(want);
  if (profile) {
    if (String(profile.id) !== want) return { ok: false, error: "PROFILE_MISMATCH" };
    return { ok: true, source: profile };
  }
  // profile 失败：仅当候选 hint.id 与目标一致时保留昵称/头像；绝不改成登录用户
  if (hintId && hintId === want && hintName) {
    return {
      ok: true,
      source: {
        platform: "xueqiu",
        id: want,
        name: hintName,
        avatar: String(hint.avatar || "").slice(0, 500),
      },
    };
  }
  return {
    ok: true,
    source: { platform: "xueqiu", id: want, name: "用户 " + want, avatar: "" },
  };
}

function parseTwitterDate(text) {
  const t = Date.parse(String(text || ""));
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function pickFxMediaUrl(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const type = String(node.type || "").toLowerCase();
  const format = String(node.format || "").toLowerCase();
  const isVideo = type === "video" || type === "gif" || format.indexOf("video/") === 0;
  if (isVideo && Array.isArray(node.formats)) {
    const mp4s = node.formats
      .filter((item) => item && String(item.container || "").toLowerCase() === "mp4" && item.url)
      .slice()
      .sort((a, b) => (Number(a.bitrate) || 0) - (Number(b.bitrate) || 0));
    if (mp4s.length) {
      // 侧栏内播优先约 720p / 2Mbps，避免默认拉到 4K 大文件
      const preferred =
        mp4s.find((item) => {
          const bitrate = Number(item.bitrate) || 0;
          return bitrate >= 800000 && bitrate <= 2500000;
        }) ||
        mp4s.filter((item) => (Number(item.bitrate) || 0) <= 2500000).pop() ||
        mp4s[Math.min(mp4s.length - 1, Math.floor(mp4s.length / 2))];
      if (preferred?.url) return String(preferred.url);
    }
  }
  return String(node.url || node.src || node.media_url_https || node.media_url || "");
}

function collectFxMedia(raw) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    let url = String(value || "").trim();
    if (!url) return;
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
    if (!/^https:\/\//i.test(url)) return;
    // HLS 需额外播放器；侧栏只保留可直接 <video> 的 progressive mp4
    if (/\.m3u8(?:$|\?)/i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url.slice(0, 500));
  };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (typeof node !== "object") return;
    push(pickFxMediaUrl(node));
    if (node.photos) walk(node.photos);
    if (node.videos) walk(node.videos);
    if (node.all) walk(node.all);
    if (node.images) walk(node.images);
  };
  walk(raw?.media);
  walk(raw?.photos);
  walk(raw?.gallery);
  walk(raw?.mediaUrls);
  return out.slice(0, 9);
}

const X_TIMELINE_CACHE_MS = 60 * 1000;
const xTimelineCache = new Map();
const xTimelineInFlight = new Map();

async function fetchXTimelineNetwork(handle, cursor) {
  const screen = String(handle || "").toLowerCase();
  let url =
    "https://api.fxtwitter.com/2/profile/" + encodeURIComponent(screen) + "/statuses?count=10";
  const cursorValue = String(cursor || "").trim();
  if (cursorValue) url += "&cursor=" + encodeURIComponent(cursorValue);
  try {
    const guarded = await runGuardedPlatformRequest("x", url, async () => {
      const readPage = async () => {
        const response = await fetch(url, { cache: "no-store" });
        const text = await response.text();
        const risk = riskDetails(response.status, text, response.headers);
        if (risk) {
          const blocked = new Error("HTTP " + response.status);
          blocked.platformRisk = risk;
          throw blocked;
        }
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* invalid response */
        }
        return json;
      };
      let json = await readPage();
      // FxTwitter occasionally answers an available cursor page with a transient empty 404.
      // Recheck once before treating it as the end of the timeline, which would disable paging.
      if (
        cursorValue &&
        Number(json?.code) === 404 &&
        Array.isArray(json?.results) &&
        json.results.length === 0
      ) {
        await sleep(250);
        json = await readPage();
      }
      return json;
    });
    if (!guarded.ok)
      return {
        ok: false,
        error: guarded.error || guarded.reason,
        retryAfterMs: guarded.retryAfterMs,
        platformPause: !!guarded.platformPause,
        riskHandled: !!guarded.riskHandled,
      };
    const json = guarded.value;
    if (!json || (json.code !== 200 && !Array.isArray(json.results))) {
      const failed = { ok: false, error: String(json?.message || "X 时间线请求失败") };
      finishGuardedRequest("x", failed);
      return failed;
    }
    const posts = postsFromFxTwitter(json, screen, normalizeReplyHandle);
    const nextCursor =
      json.cursor && json.cursor.bottom != null ? String(json.cursor.bottom).trim() : "";
    // FxTwitter documents an empty list as 404 with a normal results array.
    if (Array.isArray(json.results)) {
      const success = {
        ok: true,
        posts,
        cursor: nextCursor,
        hasMore: !!nextCursor,
      };
      finishGuardedRequest("x", success);
      return success;
    }
    const failed = { ok: false, error: "X 时间线为空（受保护账号或暂无公开帖）" };
    finishGuardedRequest("x", failed);
    return failed;
  } catch (error) {
    const failed = {
      ok: false,
      error: String((error && error.message) || error),
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
      platformPause: !!(error && error.platformPause),
      riskHandled: !!(error && error.platformPause),
    };
    finishGuardedRequest("x", failed);
    return failed;
  }
}

async function fetchXTimeline(handle, cursor) {
  const screen = String(handle || "").toLowerCase();
  const cursorValue = String(cursor || "").trim();
  // 翻页带 cursor 时不走首页短缓存，避免重复返回同一页。
  if (!cursorValue) {
    const cached = xTimelineCache.get(screen);
    // 旧缓存可能只有 posts、没有 cursor；不能再当有效首页。
    if (
      cached &&
      Date.now() - cached.at < X_TIMELINE_CACHE_MS &&
      cached.result &&
      cached.result.ok &&
      String(cached.result.cursor || "").trim()
    ) {
      return cached.result;
    }
    const pending = xTimelineInFlight.get(screen);
    if (pending) {
      return pending;
    }
  }
  const request = fetchXTimelineNetwork(screen, cursorValue)
    .then((result) => {
      if (result.ok && !cursorValue && String(result.cursor || "").trim()) {
        xTimelineCache.set(screen, { at: Date.now(), result });
      }
      return result;
    })
    .finally(() => {
      if (!cursorValue) xTimelineInFlight.delete(screen);
    });
  if (!cursorValue) xTimelineInFlight.set(screen, request);
  return request;
}

async function persistTimelineFeed(feedKeyValue, posts, meta) {
  const run = timelinePersistChain.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get([
      "timelines",
      "timelineSync",
      "timelineError",
      "timelinePaging",
      "timelineFresh",
    ]);
    const timelines =
      stored.timelines && typeof stored.timelines === "object" ? { ...stored.timelines } : {};
    const old = Array.isArray(timelines[feedKeyValue]) ? timelines[feedKeyValue] : [];
    const previousIds = new Set(old.map((post) => String((post && post.id) || "")).filter(Boolean));
    const incoming = Array.isArray(posts) ? posts : [];
    const map = new Map(old.map((post) => [post.id, post]));
    for (const post of incoming) map.set(post.id, { ...map.get(post.id), ...post });
    const merged = Array.from(map.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 1000);
    timelines[feedKeyValue] = merged;
    const timelineSync =
      stored.timelineSync && typeof stored.timelineSync === "object"
        ? { ...stored.timelineSync }
        : {};
    timelineSync[feedKeyValue] = Date.now();
    const timelineError =
      stored.timelineError && typeof stored.timelineError === "object"
        ? { ...stored.timelineError }
        : {};
    if (timelineError[feedKeyValue]) delete timelineError[feedKeyValue];
    const info = meta && typeof meta === "object" ? meta : {};
    const timelinePaging =
      stored.timelinePaging && typeof stored.timelinePaging === "object"
        ? { ...stored.timelinePaging }
        : {};
    const prevPaging =
      timelinePaging[feedKeyValue] && typeof timelinePaging[feedKeyValue] === "object"
        ? timelinePaging[feedKeyValue]
        : {};
    const pageNo = Math.max(1, Number(info.page) || Number(prevPaging.page) || 1);
    const nextCursor =
      info.cursor !== undefined ? String(info.cursor || "") : String(prevPaging.cursor || "");
    // 静默轮询只合并帖子，不回退翻页游标，避免误显示「没有更早的内容了」。
    if (!info.silent) {
      timelinePaging[feedKeyValue] = {
        page: pageNo,
        done: info.hasMore === false,
        cursor: nextCursor,
      };
    }
    const storedFresh = stored.timelineFresh;
    const timelineFresh =
      storedFresh && typeof storedFresh === "object" && !Array.isArray(storedFresh)
        ? { ...storedFresh }
        : {};
    const mergedIds = new Set(merged.map((post) => String((post && post.id) || "")).filter(Boolean));
    const prevFresh = Array.isArray(timelineFresh[feedKeyValue]) ? timelineFresh[feedKeyValue] : [];
    const added =
      previousIds.size > 0 && !info.loadMore
        ? incoming
            .map((post) => String((post && post.id) || ""))
            .filter((id) => id && !previousIds.has(id))
        : [];
    const nextFresh = [];
    const seenFresh = new Set();
    for (const id of prevFresh.concat(added)) {
      const value = String(id || "");
      if (!value || seenFresh.has(value) || !mergedIds.has(value)) continue;
      seenFresh.add(value);
      nextFresh.push(value);
    }
    timelineFresh[feedKeyValue] = nextFresh.slice(-300);
    await chrome.storage.local.set({
      timelines,
      timelineSync,
      timelineError,
      timelinePaging,
      timelineFresh,
    });
    if (!info.silent) {
      broadcast({
        type: "USER_TIMELINE_RESULT",
        ok: true,
        feedKey: feedKeyValue,
        userId: feedKeyValue,
        count: merged.length,
        at: timelineSync[feedKeyValue],
        page: pageNo,
        hasMore: info.hasMore !== false,
        cursor: nextCursor,
        loadMore: !!info.loadMore,
      });
    }
  });
  timelinePersistChain = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

let timelinePersistChain = Promise.resolve();

async function persistTimelineFailure(feedKeyValue, result) {
  const key = String(feedKeyValue || "").trim();
  if (!key) return;
  try {
    const stored = await chrome.storage.local.get(["timelineError"]);
    const timelineError =
      stored.timelineError && typeof stored.timelineError === "object" ? { ...stored.timelineError } : {};
    const message = String(result?.error || result?.reason || "读取失败")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 180);
    timelineError[key] = {
      error: message,
      at: Date.now(),
      retryAfterMs: Math.max(0, Number(result?.retryAfterMs) || 0),
      platformPause: result?.platformPause === true,
    };
    await chrome.storage.local.set({ timelineError });
  } catch {
    /* A diagnostic write must never mask the original fetch failure. */
  }
}

async function refreshTimelineX(handle, opts) {
  const screen = String(handle || "").toLowerCase();
  const key = "x:" + screen;
  const info = opts && typeof opts === "object" ? opts : {};
  const loadMore = !!info.loadMore;
  const pageNo = Math.max(1, Number(info.page) || 1);
  let cursor = String(info.cursor || "").trim();
  // 加载更多但前端没带 cursor（常见于旧缓存/只命中本地帖）：直连首页拿 bottom 游标再翻页。
  if (loadMore && !cursor) {
    xTimelineCache.delete(screen);
    const seed = await fetchXTimelineNetwork(screen, "");
    cursor = String((seed && seed.cursor) || "").trim();
    if (!seed.ok || !cursor) {
      broadcast({
        type: "USER_TIMELINE_RESULT",
        ok: true,
        feedKey: key,
        userId: screen,
        count: 0,
        at: Date.now(),
        page: pageNo,
        hasMore: false,
        cursor: "",
        loadMore: true,
      });
      return { ok: true, count: 0, hasMore: false, page: pageNo, cursor: "" };
    }
    if (seed.ok && Array.isArray(seed.posts) && seed.posts.length) {
      // 顺手把带 cursor 的首页分页状态写回，避免下次仍空游标。
      await persistTimelineFeed(key, seed.posts, {
        page: 1,
        hasMore: true,
        cursor,
        loadMore: false,
        silent: true,
      });
      // silent 不写 paging；这里显式补写游标。
      const stored = await chrome.storage.local.get(["timelinePaging"]);
      const timelinePaging =
        stored.timelinePaging && typeof stored.timelinePaging === "object"
          ? { ...stored.timelinePaging }
          : {};
      timelinePaging[key] = { page: 1, done: false, cursor };
      await chrome.storage.local.set({ timelinePaging });
    }
  }
  if (!loadMore) broadcast({ type: "USER_LOADING", feedKey: key, userId: screen, platform: "x" });
  const result = await fetchXTimeline(screen, loadMore ? cursor : "");
  if (result.ok) {
    const nextCursor = String(result.cursor || "");
    const hasMore = result.hasMore !== false && !!nextCursor;
    await persistTimelineFeed(key, result.posts, {
      page: loadMore ? pageNo : 1,
      hasMore,
      cursor: nextCursor,
      loadMore,
    });
    return {
      ok: true,
      count: result.posts.length,
      hasMore,
      page: loadMore ? pageNo : 1,
      cursor: nextCursor,
    };
  }
  broadcast({
    type: "USER_TIMELINE_RESULT",
    ok: false,
    feedKey: key,
    userId: screen,
    error: result.error || "读取失败",
    retryAfterMs: result.retryAfterMs,
    status: Number(result.status) || 0,
    platformPause: !!result.platformPause,
    loadMore,
  });
  await persistTimelineFailure(key, result);
  return {
    ok: false,
    reason: result.error || "X_TIMELINE_FAILED",
    hasMore: !loadMore,
    retryAfterMs: result.retryAfterMs,
    platformPause: !!result.platformPause,
  };
}

async function fetchAccountName(uid) {
  const paths = [
    "/user/show.json?user_id=" + encodeURIComponent(uid),
    "/v4/users/show.json?user_id=" + encodeURIComponent(uid),
  ];
  for (const path of paths) {
    try {
      const data = await fetchXueqiuJson("https://xueqiu.com" + path + "&_=" + Date.now());
      const user = data && (data.user || data.data?.user || data.data || data);
      const name = user && String(user.screen_name ?? user.name ?? "").trim();
      if (name) return name;
    } catch (error) {
      /* next */
    }
  }
  return "";
}

function chooseDefaultAuthor(following) {
  return following[0] ? following[0].id : "";
}

function hasHttpAvatar(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function mergeSourcesWithFollowing(following) {
  const stored = await chrome.storage.local.get(["sources"]);
  const list = Array.isArray(stored.sources) ? stored.sources : [];
  if (!list.length) return;
  const byId = new Map((following || []).map((p) => [String(p.id), p]));
  let changed = false;
  const next = [];
  for (const source of list) {
    if (!source || !source.id) {
      next.push(source);
      continue;
    }
    if (source.platform !== "xueqiu") {
      next.push(source);
      continue;
    }
    let avatar = String(source.avatar || "").trim();
    let name = String(source.name || "").trim();
    const hit = byId.get(String(source.id));
    if (hit) {
      if (!name && hit.name) name = hit.name;
      if (!hasHttpAvatar(avatar) && hit.avatar) avatar = String(hit.avatar);
    }
    if (!hasHttpAvatar(avatar)) {
      const profile = await fetchXueqiuUserProfile(source.id);
      if (profile && profile.avatar) avatar = profile.avatar;
      if (profile && profile.name && !name) name = profile.name;
    }
    const updated = { ...source, name: name || source.name, avatar: avatar || source.avatar || "" };
    if (updated.name !== source.name || updated.avatar !== source.avatar) changed = true;
    next.push(updated);
  }
  if (changed) await chrome.storage.local.set({ sources: next });
}

/** 仅当关注列表里已有该作者时补全头像/昵称，不再默认塞入「大道」 */
async function enrichAuthorInFollowing(following, authorId) {
  const targetId = String(authorId || "");
  if (!/^\d+$/.test(targetId)) return Array.isArray(following) ? following : [];
  const list = Array.isArray(following) ? [...following] : [];
  const idx = list.findIndex((p) => String(p.id) === targetId);
  if (idx < 0) return list;
  const entry = list[idx];
  if (hasHttpAvatar(entry.avatar) && String(entry.name || "").trim()) return list;
  const profile = await fetchXueqiuUserProfile(targetId);
  if (!profile) return list;
  list[idx] = {
    id: targetId,
    name: profile.name || entry.name || "",
    avatar: profile.avatar || entry.avatar || "",
  };
  return list;
}

async function syncAccountWithoutTab(force) {
  const session = await readSession();
  if (session.status !== "logged-in" || !session.uid) {
    return {
      ok: false,
      reason: session.status === "logged-out" ? "NOT_LOGGED_IN" : "ACCOUNT_UNKNOWN",
      fetched: false,
      followingCount: 0,
    };
  }
  const uid = String(session.uid);
  const activePenalty = guardedRequestBackoff.get("xueqiu");
  if (activePenalty && activePenalty.until > Date.now())
    return {
      ok: false,
      reason: "平台暂时限制了请求，请稍后再试",
      fetched: false,
      followingCount: 0,
      retryAfterMs: activePenalty.until - Date.now(),
      platformPause: true,
    };
  const accountGate = beginGuardedRequest("xueqiu", uid + ":account");
  if (!accountGate.ok)
    return {
      ok: false,
      reason: accountGate.reason,
      fetched: false,
      followingCount: 0,
      retryAfterMs: accountGate.retryAfterMs,
      platformPause: !!accountGate.platformPause,
    };
  broadcast({ type: "ACCOUNT_LOADING" });
  const displayName = await fetchAccountName(uid);
  const account = { id: uid, name: displayName || "用户 " + uid };
  const accountPenalty = guardedRequestBackoff.get("xueqiu");
  if (accountPenalty && accountPenalty.until > Date.now())
    return {
      ok: false,
      reason: "平台暂时限制了请求，请稍后再试",
      fetched: false,
      followingCount: 0,
      retryAfterMs: accountPenalty.until - Date.now(),
      platformPause: true,
    };
  const result = await fetchFollowingBackground(uid, !!force);
  const storedPicker = await chrome.storage.local.get([
    "selectedFeedKey",
    "selectedUserId",
    "sources",
    "following",
  ]);
  let following = result.list;
  let degraded = false;
  let error = "";
  if (!following.length) {
    const previous = Array.isArray(storedPicker.following) ? storedPicker.following : [];
    // 接口没读到（校验页/网络）时保留上次的关注列表，避免升级或重开后变空。
    if (!result.fetched && previous.length) following = previous;
    else {
      degraded = true;
      error = "FOLLOWING_EMPTY";
    }
  }
  following = await enrichAuthorInFollowing(following, TARGET_AUTHOR.userId);
  await mergeSourcesWithFollowing(following);
  const persistedSources = Array.isArray(storedPicker.sources) ? storedPicker.sources : [];
  const sourceKeySet = new Set(
    persistedSources.filter((s) => s && s.id).map((s) => feedKeyFrom(s)),
  );
  let selectedUserId = String(storedPicker.selectedUserId || "") || chooseDefaultAuthor(following);
  // 已订阅 source 的作者可以不在 following 里；登录恢复不得因此改成别人/自己
  if (
    selectedUserId &&
    !following.some((p) => String(p.id) === String(selectedUserId)) &&
    !sourceKeySet.has("xueqiu:" + selectedUserId)
  ) {
    selectedUserId = chooseDefaultAuthor(following);
  }
  let selectedFeedKey = String(storedPicker.selectedFeedKey || "");
  if (selectedFeedKey === "__all__" || selectedFeedKey === "xueqiu:") {
    /* keep aggregate / empty */
  } else if (selectedFeedKey && selectedFeedKey.startsWith("xueqiu:")) {
    const sid = selectedFeedKey.slice("xueqiu:".length);
    if (sid && !following.some((p) => String(p.id) === sid) && !sourceKeySet.has(selectedFeedKey)) {
      selectedFeedKey = following.length ? "xueqiu:" + following[0].id : "__all__";
    }
  } else if (selectedFeedKey && sourceKeySet.has(selectedFeedKey)) {
    /* 非雪球或已在 sources 中的键一律保留，登录恢复不覆盖 */
  } else if (!selectedFeedKey && selectedUserId) {
    selectedFeedKey = "xueqiu:" + selectedUserId;
  } else if (!selectedFeedKey) {
    selectedFeedKey = "__all__";
  }
  await chrome.storage.local.set({
    account,
    loggedIn: true,
    following,
    selectedUserId,
    selectedFeedKey,
    accountCheckedAt: Date.now(),
  });
  broadcast({
    type: "ACCOUNT_RESULT",
    ok: true,
    status: "logged-in",
    loggedIn: true,
    account,
    following,
    selectedUserId,
    selectedFeedKey,
    degraded,
    error,
    diagnostics: {
      uidSource: "chrome-cookies",
      followingCount: following.length,
      followingFrom: result.list.length
        ? "background-cookies"
        : result.fetched
          ? "关注列表接口无数据"
          : "保留上次关注列表",
      followNotes: result.notes.slice(-6),
    },
  });
  return {
    ok: true,
    fetched: !!result.fetched,
    followingCount: following.length,
    degraded,
    ...(result.platformPause ? { platformPause: true, retryAfterMs: result.retryAfterMs } : {}),
  };
}

function collectTimelineStatuses(data) {
  if (!data || typeof data !== "object") return [];
  const out = [];
  const push = (value) => {
    if (Array.isArray(value)) out.push(...value);
  };
  push(data.statuses);
  push(data.list);
  push(data.items);
  const nested = data.data;
  if (nested && typeof nested === "object") {
    push(nested.statuses);
    push(nested.list);
    push(nested.items);
  }
  return out;
}

function minimalQuoteFromRetweet(retweet) {
  if (!retweet || typeof retweet !== "object") return null;
  const user = retweet.user || retweet.author || {};
  const text = plainFromHtml(retweet.description ?? retweet.text ?? retweet.content ?? "");
  const authorName = String(user.screen_name ?? user.name ?? "")
    .trim()
    .slice(0, 60);
  if (!text && !authorName) return null;
  const uid = String(retweet.user_id ?? retweet.userId ?? user.id ?? "");
  const id = String(retweet.id ?? retweet.status_id ?? "");
  return {
    authorName,
    text: text.slice(0, 800),
    url: /^\d+$/.test(uid) && /^\d+$/.test(id) ? "https://xueqiu.com/" + uid + "/" + id : "",
    likeCount: 0,
  };
}

function minimalTimelinePost(raw, expectedUid) {
  if (!raw || typeof raw !== "object") return null;
  const user = raw.user || raw.author || {};
  const uid = String(raw.user_id ?? raw.userId ?? user.id ?? "");
  if (uid !== String(expectedUid)) return null;
  const id = String(raw.id ?? raw.status_id ?? "");
  if (!/^\d+$/.test(id)) return null;
  const text = plainFromHtml(raw.description ?? raw.text ?? raw.content ?? "");
  const title = String(raw.title || "") || text.slice(0, 90) || "无标题";
  const created = Number(raw.created_at ?? 0);
  const timestamp = created && created < 1e12 ? Math.round(created * 1000) : created || Date.now();
  const retweet = raw.retweet_status || raw.retweeted_status || null;
  const hasRetweet = !!(retweet && typeof retweet === "object");
  const quoted = minimalQuoteFromRetweet(retweet);
  const replyMatch = String(text || "").match(/^\s*回复\s*@([^\s:：]+)\s*[:：]?/i);
  const out = {
    id,
    userId: uid,
    authorName: String(user.screen_name ?? user.name ?? "").slice(0, 80),
    title: title.slice(0, 90),
    summary: text.slice(0, 1600),
    timestamp,
    timeText: String(raw.timeBefore || ""),
    source: String(raw.source || "").slice(0, 30),
    url: "https://xueqiu.com/" + uid + "/" + id,
    isRetweet: hasRetweet,
    likeCount: 0,
    replyCount: 0,
    retweetCount: 0,
    quoted,
    quoteMissing: hasRetweet && !quoted,
  };
  if (replyMatch) out.replyToHandle = replyMatch[1].slice(0, 60);
  return out;
}

// 只打稳定主接口；v4 / 多模板回退会叠请求并易触发「过于频繁」WAF。
const TIMELINE_URL =
  "https://xueqiu.com/statuses/user_timeline.json?user_id={uid}&page={page}&count=10&_={ts}";
// 单页明显少于该条数即视为翻到末页
const PAGE_MORE_MIN = 10;

function isXueqiuRateLimited(errorText) {
  return /RATE_LIMITED|过于频繁|too many/i.test(String(errorText || ""));
}

async function fetchTimelineBackground(uid, page) {
  const pageNo = Math.max(1, Number(page) || 1);
  const url = TIMELINE_URL.replace("{uid}", encodeURIComponent(uid))
    .replace("{page}", String(pageNo))
    .replace("{ts}", String(Date.now()));
  try {
    const data = await fetchXueqiuJson(url, { sessionFallback: true });
    if (data.error_code || data.error_description) {
      const msg = String(data.error_description || data.error_msg || "接口暂不可用");
      const failed = {
        ok: false,
        error: isXueqiuRateLimited(msg) ? "请求过于频繁，请稍后再试" : msg,
      };
      if (/RATE_LIMIT|300011|过于频繁|验证码|风控|安全验证/i.test(msg)) {
        await registerPlatformRisk("xueqiu", 0);
        failed.platformPause = true;
        failed.riskHandled = true;
        failed.retryAfterMs = guardedRequestBackoff.get("xueqiu").until - Date.now();
      }
      finishGuardedRequest("xueqiu", failed, "timeline");
      return failed;
    }
    const rawCount = collectTimelineStatuses(data).length;
    const posts = collectTimelineStatuses(data)
      .map((raw) => minimalTimelinePost(raw, uid))
      .filter(Boolean);
    const success = { ok: true, posts, hasMore: rawCount >= PAGE_MORE_MIN, page: pageNo };
    finishGuardedRequest("xueqiu", success);
    return success;
  } catch (error) {
    const msg = String((error && error.message) || error);
    const failed = {
      ok: false,
      error: isXueqiuRateLimited(msg) ? "请求过于频繁，请稍后再试" : msg,
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
      platformPause: !!(error && error.platformPause),
      riskHandled: !!(error && error.platformPause),
    };
    finishGuardedRequest("xueqiu", failed, "timeline");
    return failed;
  }
}

async function persistTimelineBackground(uid, posts, meta) {
  const key = /^\d+$/.test(String(uid)) ? "xueqiu:" + uid : String(uid);
  await persistTimelineFeed(key, posts, meta);
}

async function refreshTimelineWithoutTab(uid, feedKeyValue, opts) {
  const id = String(uid || "");
  if (!/^\d+$/.test(id)) return { ok: false, reason: "BAD_USER_ID" };
  const key = String(feedKeyValue || "xueqiu:" + id);
  const info = opts && typeof opts === "object" ? opts : {};
  const pageNo = Math.max(1, Number(info.page) || 1);
  const loadMore = !!info.loadMore;
  if (!loadMore) broadcast({ type: "USER_LOADING", userId: id, feedKey: key, platform: "xueqiu" });
  const result = await fetchTimelineBackground(id, pageNo);
  if (result.ok) {
    const meta = { page: pageNo, hasMore: result.hasMore, loadMore };
    await persistTimelineBackground(id, result.posts, meta);
    return { ok: true, count: result.posts.length, hasMore: result.hasMore, page: pageNo };
  }
  broadcast({
    type: "USER_TIMELINE_RESULT",
    ok: false,
    userId: id,
    feedKey: key,
    error: result.error || "读取失败",
    retryAfterMs: result.retryAfterMs,
    status: Number(result.status) || 0,
    platformPause: !!result.platformPause,
    loadMore,
  });
  await persistTimelineFailure(key, result);
  return {
    ok: false,
    reason: result.error || "TIMELINE_FAILED",
    hasMore: true,
    retryAfterMs: result.retryAfterMs,
    platformPause: !!result.platformPause,
  };
}

async function refreshTimelineMessage(message) {
  const started = Date.now();
  const platform = String(message.platform || "xueqiu");
  const parsed = parseFeedKey(message.feedKey || "");
  const userId = String(message.userId || parsed.id || "");
  const opts = {
    page: Number(message.page) || 1,
    loadMore: !!message.loadMore || message.type === "POPUP_LOAD_MORE",
    cursor: String(message.cursor || ""),
  };
  const trigger =
    message.scheduled === true ? "scheduled" : message.type === "POPUP_REFRESH" ? "manual" : "feed";
  try {
    let result;
    if (!["xueqiu", "x", "weibo"].includes(platform)) {
      return { ok: false, reason: "UNSUPPORTED_PLATFORM" };
    }
    if (platform === "x") result = await refreshTimelineX(userId, opts);
    else if (platform === "weibo") result = await refreshTimelineWeibo(userId, opts);
    else
      result = await refreshTimelineWithoutTab(userId, message.feedKey || "xueqiu:" + userId, opts);
    if (result && typeof result.ok === "boolean") {
      const durationMs = Date.now() - started;
      void import("./analytics-background").then(({ analyticsRuntime }) =>
        analyticsRuntime.capture("refresh_completed", {
          ok: result.ok,
          duration_ms: durationMs,
          trigger,
          platform,
          ...(Number.isFinite(Number(result.status)) ? { status_code: Number(result.status) } : {}),
        }),
      );
      if (!result.ok) reportBackgroundRequestFailure(platform, "timeline", new Error(String(result.error || result.reason || "timeline refresh failed")), {
        stage: "refresh",
        retryAfterMs: result.retryAfterMs,
        stale: result.stale === true,
        cacheHit: result.cached === true,
        durationMs,
      });
    }
    return result;
  } catch (error) {
    void import("./analytics-background").then(({ analyticsRuntime }) =>
      analyticsRuntime.captureError(error, "refresh", Date.now() - started, analyticsStatusFromError(error), true, {
        platform,
        operation: "timeline",
        stage: "refresh",
        retry_after_ms: Number(error && error.retryAfterMs) || undefined,
        duration_ms: Date.now() - started,
      }),
    );
    return {
      ok: false,
      reason: String((error && error.message) || "REFRESH_FAILED"),
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
      platformPause: !!(error && error.platformPause),
    };
  }
}

async function injectIntoTab(tabId) {
  let injected = false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_MAIN, world: "MAIN" });
    injected = true;
  } catch (error) {
    /* 某些页面不允许注入 */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_ISOLATED });
    injected = true;
  } catch (error) {
    /* noop */
  }
  if (injected) await sleep(240);
  return injected;
}

async function syncAccountPreferCookies(force) {
  return syncAccountWithoutTab(!!force);
}

async function dispatch(message) {
  if (message.type === "POPUP_ACCOUNT_REQUEST") {
    const direct = await syncAccountPreferCookies(message.force === true);
    if (direct) return direct;
  }
  const prepared = await ensureDataTab();
  if (!prepared.tab) {
    if (message.type === "POPUP_ACCOUNT_REQUEST") {
      return syncAccountWithoutTab(message.force === true);
    }
    if (
      message.type === "POPUP_REFRESH" ||
      message.type === "POPUP_LOAD_USER" ||
      message.type === "POPUP_LOAD_MORE"
    ) {
      const platform = String(
        message.platform || parseFeedKey(message.feedKey || "").platform || "xueqiu",
      );
      if (platform === "x" || platform === "weibo") return refreshTimelineMessage(message);
      const session = await readSession();
      if (session.status !== "logged-in") {
        return {
          ok: false,
          reason: session.status === "logged-out" ? "NOT_LOGGED_IN" : "ACCOUNT_UNKNOWN",
        };
      }
      return refreshTimelineMessage(message);
    }
    return { ok: false, reason: "NO_XUEQIU_TAB" };
  }
  const session = await readSession();
  await injectIntoTab(prepared.tab.id);
  const payload = { ...message, session };
  let response = await forward(prepared.tab.id, payload);
  if (response.reason === "NO_CONTENT_SCRIPT") {
    const injected = await injectIntoTab(prepared.tab.id);
    if (injected) {
      response = await forward(prepared.tab.id, payload);
    }
    if (response.reason === "NO_CONTENT_SCRIPT") {
      return {
        ok: false,
        reason: "NO_CONTENT_SCRIPT",
        tabId: prepared.tab.id,
        tabUrl: prepared.tab.url || "",
      };
    }
  }
  return response;
}

function openXueqiu() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: XUEQIU_HOME }, (tab) => {
      void chrome.runtime.lastError;
      resolve(
        tab ? { ok: true, tabId: tab.id, url: XUEQIU_HOME } : { ok: false, reason: "OPEN_FAILED" },
      );
    });
  });
}

export function installAnalyticsHooks() {
  // analytics-background registers SW error and rejection hooks
}

/** 添加信息源：先按平台校验登录，再解析资料并落盘 */
function handleAddSource(message, spec, sendResponse) {
  if (!["xueqiu", "x", "weibo"].includes(String(spec.platform || ""))) {
    sendResponse({ ok: false, error: "UNSUPPORTED_PLATFORM" });
    return;
  }
  const hint =
    message.hint && typeof message.hint === "object"
      ? {
          id: String(message.hint.id || ""),
          name: String(message.hint.name || ""),
          avatar: String(message.hint.avatar || ""),
        }
      : null;

  if (
    hint &&
    hint.id &&
    (spec.platform === "xueqiu" || spec.platform === "weibo") &&
    hint.id !== String(spec.id)
  ) {
    sendResponse({ ok: false, error: "HINT_MISMATCH" });
    return;
  }

  Promise.resolve()
    .then(async () => {
      const result = await resolveSourceSpec(spec, hint);
      if (!result || !result.ok || !result.source) {
        sendResponse({ ok: false, error: (result && result.error) || "UNRECOGNIZED" });
        return;
      }
      if (String(result.source.id) !== String(spec.id)) {
        sendResponse({ ok: false, error: "PROFILE_MISMATCH" });
        return;
      }
      const stored = await chrome.storage.local.get(["sources"]);
      const list = Array.isArray(stored.sources) ? stored.sources : [];
      const key = feedKeyFrom(result.source);
      const next = [...list.filter((item) => feedKeyFrom(item) !== key), result.source];
      await chrome.storage.local.set({ sources: next });
      sendResponse({ ok: true, source: result.source, feedKey: key });
    })
    .catch((error) => {
      void error;
      const mapped = "RESOLVE_FAILED";
      sendResponse({ ok: false, reason: mapped === "RESOLVE_FAILED" ? "" : mapped, error: mapped });
    });
}

// 广场数据只按显式请求获取，独立于订阅、阅读状态与后台刷新。
const WEIBO_HOT_CACHE_KEY = "weiboHotCache";
const WEIBO_HOT_CACHE_MS = 2 * 60 * 1000;
const WEIBO_HOT_MIN_GAP_MS = 10 * 1000;
const SQUARE_FEED_CACHE_MS = 2 * 60 * 1000;
const SQUARE_FEED_MIN_GAP_MS = 10 * 1000;
let weiboHotInFlight = null;
let weiboHotSnapshot = null;
const squareFeedInFlight = new Map();

function cachedWeiboHotItems(raw) {
  return normalizeWeiboHotItems({ ok: 1, data: { band_list: Array.isArray(raw) ? raw.map((item) => ({
    realpos: item?.rank, word: item?.word, num: item?.heat, label_name: item?.label,
  })) : [] } });
}

async function requestWeiboHotData() {
  const url = "https://weibo.com/ajax/side/hotSearch?_=" + Date.now();
  const referer = "https://weibo.com/";
  let data;
  let usedTab = false;
  try {
    data = await fetchWeiboJson(url, referer);
  } catch (error) {
    // 只允许非风控的格式错误复用现有标签页，限频与暂停直接向上传递。
    if (error?.platformPause || error?.retryAfterMs || error?.message !== "NON_JSON") throw error;
    usedTab = true;
    data = await fetchWeiboJsonViaTab(url, referer);
  }
  const inspect = async (value) => {
    const risk = riskDetails(200, JSON.stringify(value), { get: () => "" });
    if (!risk) return;
    await registerPlatformRisk("weibo", risk.retryAfterMs);
    const error = new Error("平台暂时限制了请求，请稍后再试");
    error.platformPause = true;
    error.retryAfterMs = guardedRequestBackoff.get("weibo")?.until - Date.now();
    throw error;
  };
  await inspect(data);
  if (!usedTab && data && Number(data.ok) === -100) {
    try {
      data = await fetchWeiboJsonViaTab(url, referer);
      await inspect(data);
    } catch (error) {
      if (!error?.platformPause && !error?.retryAfterMs) error.needsLogin = true;
      throw error;
    }
  }
  if (data && Number(data.ok) === -100) {
    const error = new Error("请先登录微博后重试");
    error.needsLogin = true;
    throw error;
  }
  const items = normalizeWeiboHotItems(data);
  if (!items.length) throw new Error("微博热搜暂不可用，未取得有效榜单");
  return items;
}

function fetchWeiboHot(force) {
  if (weiboHotInFlight) return weiboHotInFlight;
  weiboHotInFlight = (async () => {
    let stored = weiboHotSnapshot || {};
    if (!weiboHotSnapshot) {
      try { stored = (await chrome.storage.local.get([WEIBO_HOT_CACHE_KEY]))[WEIBO_HOT_CACHE_KEY] || {}; } catch { /* 存储异常不阻断只读请求。 */ }
    }
    const items = cachedWeiboHotItems(stored.items);
    const now = Date.now();
    const updatedAt = items.length && Number(stored.updatedAt) > 0 && Number(stored.updatedAt) <= now
      ? Number(stored.updatedAt) : 0;
    const previousItems = updatedAt ? items : [];
    const retryAt = Math.max(Number(stored.attemptedAt) + WEIBO_HOT_MIN_GAP_MS || 0, Number(stored.retryAt) || 0);
    if (retryAt > now && stored.failure) {
      return { ok: false, items: previousItems, updatedAt, cached: !!updatedAt, stale: !!updatedAt,
        error: stored.needsLogin ? "请先登录微博后重试" : "微博热搜请求失败，请稍后重试",
        needsLogin: stored.needsLogin === true, retryAfterMs: retryAt - now };
    }
    if (updatedAt && ((!force && now - updatedAt < WEIBO_HOT_CACHE_MS) || retryAt > now)) {
      return { ok: true, items: previousItems, updatedAt, cached: true,
        ...(retryAt > now ? { retryAfterMs: retryAt - now } : {}) };
    }
    if (retryAt > now) return { ok: false, items: [], updatedAt: 0, error: "请求过于频繁，请稍后再试", retryAfterMs: retryAt - now };
    const attemptedAt = now;
    try {
      const nextItems = await requestWeiboHotData();
      const next = { items: nextItems, updatedAt: Date.now(), attemptedAt };
      weiboHotSnapshot = next;
      try { await chrome.storage.local.set({ [WEIBO_HOT_CACHE_KEY]: next }); } catch { /* 不将存储失败误报为榜单失败。 */ }
      return { ok: true, items: nextItems, updatedAt: next.updatedAt };
    } catch (error) {
      const retryAfterMs = Math.max(WEIBO_HOT_MIN_GAP_MS, Number(error?.retryAfterMs) || 0);
      const next = { items: previousItems, updatedAt, attemptedAt, failure: true,
        needsLogin: error?.needsLogin === true, retryAt: Date.now() + retryAfterMs };
      weiboHotSnapshot = next;
      try { await chrome.storage.local.set({ [WEIBO_HOT_CACHE_KEY]: next }); } catch { /* 保留原始请求错误。 */ }
      return { ok: false, items: previousItems, updatedAt, stale: !!updatedAt, status: Number(error?.status) || 0,
        error: error?.platformPause ? "平台暂时限制了请求，请稍后再试" : error?.needsLogin ? "请先登录微博后重试" : "微博热搜暂不可用，请稍后重试",
        needsLogin: error?.needsLogin === true, retryAfterMs };
    }
  })().finally(() => { weiboHotInFlight = null; });
  return weiboHotInFlight;
}

// X 趋势与话题只读取正常浏览器会话的 DOM；不会导航、关闭用户标签页。
let xTopicService = null;
async function readOwnedXTab(url, mode, seen = [], opts) {
  const guarded = await runGuardedPlatformRequest(
    "x",
    url,
    async () => {
      let ownedTabId;
      let ownedWindowId;
      const deadline = Date.now() + 20000;
      try {
        // X 的热搜/话题读取需要真实 DOM，但临时页不能出现在用户当前窗口的标签栏。
        // 放进未聚焦的最小化 popup 窗口，完成后整窗销毁。
        let tab;
        if (chrome.windows?.create) {
          try {
            const hiddenWindow = await chrome.windows.create({
              url,
              type: "popup",
              focused: false,
              state: "minimized",
            });
            ownedWindowId = hiddenWindow?.id;
            tab =
              hiddenWindow?.tabs?.[0] ||
              (ownedWindowId ? await chrome.tabs.query({ windowId: ownedWindowId }) : null)?.[0];
          } catch {
            // 未授予 windows 权限时降级到非激活标签页，保证 X 热搜仍可读取。
            tab = await chrome.tabs.create({ url, active: false });
          }
        } else {
          tab = await chrome.tabs.create({ url, active: false });
        }
        ownedTabId = tab?.id;
        if (!ownedTabId) throw new Error("X_TAB_OPEN_FAILED");
        await chrome.tabs.update(ownedTabId, { autoDiscardable: true });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => finish(new Error("X 页面加载超时，请稍后重试")),
            Math.max(1, deadline - Date.now()),
          );
          const listener = (id, info) => {
            if (id === ownedTabId && info.status === "complete") finish();
          };
          function finish(error) {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            error ? reject(error) : resolve();
          }
          chrome.tabs.onUpdated.addListener(listener);
          chrome.tabs
            .get(ownedTabId)
            .then((current) => {
              if (current.status === "complete") finish();
            })
            .catch(finish);
        });
        const snapshot = async (previous, scroll) => {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error("X 页面读取超时，请稍后重试");
          await chrome.scripting.executeScript({
            target: { tabId: ownedTabId },
            func: waitXDom,
            args: [mode, previous, Math.min(scroll ? 3000 : 12000, remaining), scroll],
          });
          const results = await chrome.scripting.executeScript({
            target: { tabId: ownedTabId },
            func: extractXDom,
            args: [mode],
          });
          const result = results?.[0]?.result;
          if (!result) throw new Error("X 页面未返回可读取的数据");
          if (result.limited)
            throw Object.assign(new Error(result.error), { platformRisk: { retryAfterMs: 60000 } });
          if (result.error)
            throw Object.assign(new Error(result.error), { needsLogin: result.needsLogin === true });
          return result;
        };
        let result = await snapshot([], false);
        if (mode === "hot") return result;
        let posts = result.posts.filter((post) => !seen.includes(post.id));
        const collected = new Set([...seen, ...result.posts.map((post) => post.id)]);
        // 最多重放三次滚动找到下一批真实新帖子；不把旧 DOM 或空页当作更多。
        for (
          let attempt = 0;
          !posts.length && !result.empty && attempt < 3 && Date.now() < deadline - 500;
          attempt++
        ) {
          result = await snapshot([...collected], true);
          posts = result.posts.filter((post) => !collected.has(post.id));
          for (const post of result.posts) collected.add(post.id);
        }
        if (!posts.length) {
          if (!result.empty && !result.posts.length)
            throw new Error("X 搜索页尚未返回有效帖子，请稍后重试");
          return { posts: [], more: [] };
        }
        // 首屏已拿到充足实时帖时不再额外滚动一屏探测下一页，减少 X 搜索请求与 3 秒延迟。
        if (seen.length === 0 && posts.length >= 6) {
          return { posts, more: [], hasMoreHint: true };
        }
        let more = [];
        if (Date.now() < deadline - 500) {
          const next = await snapshot([...collected], true);
          more = next.posts.filter((post) => !collected.has(post.id));
        }
        return { posts, more };
      } finally {
        if (Number.isInteger(ownedWindowId) && chrome.windows?.remove) {
          try {
            await chrome.windows.remove(ownedWindowId);
          } catch {
            /* 临时窗口可能已被系统回收。 */
          }
        } else if (Number.isInteger(ownedTabId)) {
          try {
            await chrome.tabs.remove(ownedTabId);
          } catch {
            /* 临时页可能已被系统回收。 */
          }
        }
      }
    },
    { force: !!(opts && opts.force) },
  );
  if (!guarded.ok)
    throw Object.assign(new Error(guarded.error || "X 内容暂不可用"), {
      retryAfterMs: guarded.retryAfterMs,
      platformPause: guarded.platformPause,
      needsLogin: /请先登录 X/.test(guarded.error || ""),
    });
  return guarded.value;
}
// 后台标签页不渲染头像图片，按 handle 用已声明的 FxTwitter 资料接口补齐，并缓存（含负缓存避免重复请求）。
const X_AVATAR_CACHE_KEY = "xAvatarCache";
let xAvatarCache = null;
let xAvatarCacheSaving = null;
const xAvatarMissAt = new Map();
async function fillXAuthorAvatars(posts) {
  if (!Array.isArray(posts) || !posts.length) return [];
  const missing = [
    ...new Set(
      posts
        .filter((post) => !post?.authorAvatar && /^[a-zA-Z0-9_]{1,15}$/.test(post?.handle || ""))
        .map((post) => post.handle),
    ),
  ];
  if (!missing.length) return posts;
  if (!xAvatarCache) {
    try {
      xAvatarCache = (await chrome.storage.local.get([X_AVATAR_CACHE_KEY]))[X_AVATAR_CACHE_KEY] || {};
    } catch {
      xAvatarCache = {};
    }
  }
  const fetched = {};
  const toQuery = [];
  const now = Date.now();
  for (const handle of missing) {
    const cached = xAvatarCache[handle];
    if (typeof cached === "string" && cached) {
      fetched[handle] = cached;
      continue;
    }
    const missAt = xAvatarMissAt.get(handle) || 0;
    if (now - missAt < 10 * 60 * 1000) continue;
    if (toQuery.length < 8) toQuery.push(handle);
  }
  let dirty = false;
  for (let i = 0; i < toQuery.length; i += 4) {
    const batch = toQuery.slice(i, i + 4);
    await Promise.all(
      batch.map(async (handle) => {
        try {
          const response = await fetch("https://api.fxtwitter.com/" + encodeURIComponent(handle), {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            xAvatarMissAt.set(handle, Date.now());
            return;
          }
          const data = await response.json();
          const avatar = String(data?.user?.avatar_url || "").replace(/_normal(\.\w+)$/, "_x96$1");
          if (/^https:\/\/pbs\.twimg\.com\//.test(avatar)) {
            fetched[handle] = avatar;
            dirty = true;
          } else {
            xAvatarMissAt.set(handle, Date.now());
          }
        } catch {
          xAvatarMissAt.set(handle, Date.now());
        }
      }),
    );
  }
  if (dirty) {
    const nextCache = { ...xAvatarCache, ...fetched };
    const keys = Object.keys(nextCache);
    for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete nextCache[key];
    xAvatarCache = nextCache;
    if (!xAvatarCacheSaving) {
      xAvatarCacheSaving = chrome.storage.local
        .set({ [X_AVATAR_CACHE_KEY]: nextCache })
        .catch(() => {})
        .finally(() => {
          xAvatarCacheSaving = null;
        });
    }
  }
  return posts.map((post) =>
    post?.authorAvatar || !fetched[post?.handle]
      ? post
      : { ...post, authorAvatar: fetched[post.handle] },
  );
}
function getXTopicService() {
  if (!xTopicService)
    xTopicService = createXTopicService({
      // 趋势页与话题页均附带时间戳，避免浏览器或边缘层复用旧快照；more 仅用于判定 hasMore，不补头像。
      readHot: () =>
        readOwnedXTab("https://x.com/explore/tabs/trending?_=" + Date.now(), "hot", [], {
          force: true,
        }),
      readTopic: async (word, seen) => {
        const base = xTopicUrl(word);
        const url = base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
        const result = await readOwnedXTab(url, "topic", seen, { force: true });
        return {
          posts: await fillXAuthorAvatars(result.posts),
          more: result.more,
          hasMoreHint: result.hasMoreHint,
        };
      },
      readCache: async (key) => (await chrome.storage.local.get([key]))[key],
      writeCache: async (key, value) => {
        await chrome.storage.local.set({ [key]: value });
      },
    });
  return xTopicService;
}

let weiboTopicFetcher = null;
function fetchWeiboTopic(input) {
  if (!weiboTopicFetcher)
    weiboTopicFetcher = createWeiboTopicFetcher({
      getHotItems: async () => {
        if (weiboHotSnapshot) return cachedWeiboHotItems(weiboHotSnapshot.items);
        const stored = (await chrome.storage.local.get([WEIBO_HOT_CACHE_KEY]))[WEIBO_HOT_CACHE_KEY];
        return cachedWeiboHotItems(stored?.items);
      },
      request: async (url, reqOpts) => {
        // 仅使用现有风控链请求移动端接口，不切换标签页绕过验证码或登录校验。
        const checkRisk = async (payload) => {
          const risk = riskDetails(200, JSON.stringify(payload), { get: () => "" });
          if (risk) {
            await registerPlatformRisk("weibo", risk.retryAfterMs);
            throw Object.assign(new Error("平台暂时限制了请求，请稍后再试"), {
              platformPause: true,
              retryAfterMs: Math.max(0, (guardedRequestBackoff.get("weibo")?.until || 0) - Date.now()),
            });
          }
        };
        const fetchOnce = (targetUrl) =>
          reqOpts?.force
            ? fetchWeiboJson(
                targetUrl + (targetUrl.includes("?") ? "&" : "?") + "_=" + Date.now(),
                "https://m.weibo.cn/",
                { force: true },
              )
            : fetchWeiboJson(targetUrl, "https://m.weibo.cn/");
        let data = await fetchOnce(url);
        await checkRisk(data);
        // 实时流（type=61）若该话题暂无实时卡片，在第一页回退一次综合流（type=1），避免冷门话题空白。
        if (
          url.includes("100103type%3D61") &&
          /[?&]page=1(?:&|$)/.test(url) &&
          Number(data?.ok) === 1 &&
          Array.isArray(data?.data?.cards) &&
          data.data.cards.length === 0
        ) {
          const fallbackUrl = url.replace("100103type%3D61", "100103type%3D1");
          data = await fetchOnce(fallbackUrl);
          await checkRisk(data);
        }
        return data;
      },
      normalizePost: (mblog) => minimalWeiboPost(mblog),
      readCache: async (key) => (await chrome.storage.local.get([key]))[key],
      writeCache: async (key, value) => {
        await chrome.storage.local.set({ [key]: value });
      },
    });
  return weiboTopicFetcher(input);
}

let xueqiuHotService = null;
function getXueqiuHotService() {
  if (!xueqiuHotService)
    xueqiuHotService = createXueqiuHotService({
      request: async (url, reqOpts) => {
        // 先匿名请求；仅在需要会话时复用既有同源 fallback，不读取 cookie 内容或绕过风控。
        let data;
        try {
          const isHotRank = /\/query\/v1\/hot_event\/rich_tag\.json(?:\?|$)/.test(url);
          const bust = isHotRank || !!(reqOpts && reqOpts.force);
          const requestUrl = bust ? url + (url.includes("?") ? "&" : "?") + "_=" + Date.now() : url;
          data = await fetchXueqiuJson(
            requestUrl,
            reqOpts && reqOpts.force ? { sessionFallback: true, force: true } : { sessionFallback: true },
          );
        } catch (error) {
          if (
            /请先登录雪球后重试|400016|XUEQIU_SESSION_REQUIRED/i.test(
              String(error?.message || error),
            )
          )
            error.needsLogin = true;
          throw error;
        }
        const risk = riskDetails(200, JSON.stringify(data), { get: () => "" });
        if (risk) {
          await registerPlatformRisk("xueqiu", risk.retryAfterMs);
          throw Object.assign(new Error("平台暂时限制了请求，请稍后再试"), {
            platformPause: true,
            retryAfterMs: Math.max(0, (guardedRequestBackoff.get("xueqiu")?.until || 0) - Date.now()),
          });
        }
        if (Number(data?.error_code) === 400016)
          throw Object.assign(new Error("请先登录雪球后重试"), { needsLogin: true });
        return data;
      },
      readCache: async (key) => (await chrome.storage.local.get([key]))[key],
      writeCache: async (key, value) => {
        await chrome.storage.local.set({ [key]: value });
      },
    });
  return xueqiuHotService;
}

function fetchXueqiuHot(force) {
  return getXueqiuHotService().hot(force === true);
}

function fetchXueqiuTopic(input) {
  return getXueqiuHotService().topic(input);
}

function normalizeSquarePosts(posts, source) {
  const seen = new Set();
  return (Array.isArray(posts) ? posts : [])
    .slice(0, 100)
    .map((raw) => {
      const post = sanitizeFeedPost(raw, source.key);
      if (!post || seen.has(post.id)) return null;
      // 二次约束正文路由，拒绝路径字符与跨作者数据。
      if (
        source.platform === "x" &&
        raw?.userId &&
        String(raw.userId).replace(/^x:/, "").toLowerCase() !== source.id.toLowerCase()
      )
        return null;
      if (
        source.platform === "x"
          ? !/^\d+$/.test(post.id)
          : source.platform === "weibo"
            ? !/^[a-zA-Z0-9]+$/.test(post.id)
            : !/^\d+$/.test(post.id)
      )
        return null;
      if (post.quoted?.url) {
        try {
          const url = new URL(post.quoted.url);
          if (url.protocol !== "https:" || url.username || url.password) post.quoted.url = "";
        } catch {
          post.quoted.url = "";
        }
      }
      seen.add(post.id);
      return {
        ...post,
        platform: source.platform,
        feedKey: source.key,
        feedName: source.name || source.id,
        feedPlatform: source.platform,
      };
    })
    .filter(Boolean);
}

function fetchSquareFeed(feedKeyValue, force = false) {
  const source =
    typeof feedKeyValue === "string" && SQUARE_SOURCES.find((item) => item.key === feedKeyValue);
  if (
    !source ||
    source.key !== source.platform + ":" + source.id ||
    !(["xueqiu", "weibo"].includes(source.platform)
      ? /^\d+$/.test(source.id)
      : source.platform === "x" && /^[a-zA-Z0-9_]{1,15}$/.test(source.id))
  ) {
    return Promise.resolve({
      ok: false,
      posts: [],
      updatedAt: 0,
      error: "广场数据源不在允许列表中",
    });
  }
  if (squareFeedInFlight.has(source.key)) return squareFeedInFlight.get(source.key);
  const request = (async () => {
    const storageKey = "squareFeedCache:" + source.key;
    let cached = {};
    try {
      cached = (await chrome.storage.local.get([storageKey]))[storageKey] || {};
    } catch {
      /* 只读请求可继续。 */
    }
    const posts = normalizeSquarePosts(cached.posts, source);
    const updatedAt =
      Number(cached.updatedAt) > 0 && Number(cached.updatedAt) <= Date.now()
        ? Number(cached.updatedAt)
        : 0;
    const now = Date.now();
    const retryAt = Math.max(
      Number(cached.attemptedAt) + SQUARE_FEED_MIN_GAP_MS || 0,
      Number(cached.retryAt) || 0,
    );
    if (retryAt > now && cached.failure)
      return {
        ok: false,
        posts: updatedAt ? posts : [],
        updatedAt,
        stale: !!updatedAt,
        error: "广场内容暂不可用，请稍后重试",
        retryAfterMs: retryAt - now,
      };
    if (updatedAt && ((!force && now - updatedAt < SQUARE_FEED_CACHE_MS) || retryAt > now))
      return {
        ok: true,
        posts,
        updatedAt,
        cached: true,
        ...(retryAt > now ? { retryAfterMs: retryAt - now } : {}),
      };
    if (retryAt > now)
      return {
        ok: false,
        posts: [],
        updatedAt: 0,
        error: "请求过于频繁，请稍后再试",
        retryAfterMs: retryAt - now,
      };
    const attemptedAt = now;
    try {
      const result =
        source.platform === "weibo"
          ? await fetchWeiboTimeline(source.id, 1, "")
          : source.platform === "x"
            ? await fetchXTimeline(source.id, "")
            : await fetchTimelineBackground(source.id, 1);
      if (!result?.ok || !Array.isArray(result.posts))
        throw Object.assign(new Error("广场内容暂不可用，请稍后重试"), {
          retryAfterMs: Number(result?.retryAfterMs) || 0,
          platformPause: !!result?.platformPause,
        });
      const nextPosts = normalizeSquarePosts(result.posts, source);
      if (Array.isArray(result.posts) && result.posts.length && !nextPosts.length)
        throw new Error("无有效广场内容");
      const next = { posts: nextPosts, updatedAt: Date.now(), attemptedAt };
      try {
        await chrome.storage.local.set({ [storageKey]: next });
      } catch {
        /* 不影响已取得的内容。 */
      }
      return { ok: true, ...next };
    } catch (error) {
      const retryAfterMs = Math.max(SQUARE_FEED_MIN_GAP_MS, Number(error?.retryAfterMs) || 0);
      try {
        await chrome.storage.local.set({
          [storageKey]: {
            posts: updatedAt ? posts : [],
            updatedAt,
            attemptedAt,
            failure: true,
            retryAt: Date.now() + retryAfterMs,
          },
        });
      } catch {
        /* 存储失败不覆盖原错误。 */
      }
      return {
        ok: false,
        posts: updatedAt ? posts : [],
        updatedAt,
        stale: !!updatedAt,
        status: Number(error?.status) || 0,
        error: "广场内容暂不可用，请稍后重试",
        retryAfterMs,
      };
    }
  })().finally(() => {
    squareFeedInFlight.delete(source.key);
  });
  squareFeedInFlight.set(source.key, request);
  return request;
}

function isTrustedExtensionPageSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (sender.tab) {
    // 独立窗口或首页标签页（chrome-extension://<id>/popup.html | home.html）允许，普通网页内容脚本不允许发管理类 POPUP_*。
    const senderUrl = String(sender.url || "");
    return senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  }
  return true;
}

function registerRuntimeMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Analytics has its own strict popup/sidepanel sender gate and consumes all analytics-prefixed requests.
    if (message && typeof message.type === "string" && message.type.startsWith("ANALYTICS_")) {
      void import("./analytics-background").then(({ handleAnalyticsMessage }) =>
        handleAnalyticsMessage(message, sender, sendResponse),
      );
      return true;
    }
    if (!message || typeof message.type !== "string") return false;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return false;

    // 登录态：后台直接读 cookie，不依赖任何雪球标签页，打开窗口即可返回。
    if (message.type === "XUEQIU_FETCH_JSON") {
      fetchXueqiuJson(String(message.url || ""))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: String((error && error.message) || error),
            retryAfterMs: Number(error && error.retryAfterMs) || 0,
            platformPause: !!(error && error.platformPause),
          }),
        );
      return true;
    }

    // POPUP_SESSION 允许同扩展隔离内容脚本读取雪球 cookie 登录状态；其余 POPUP_* 限定本扩展页面。
    if (
      message.type.startsWith("POPUP_") &&
      message.type !== "POPUP_SESSION" &&
      !isTrustedExtensionPageSender(sender)
    ) {
      sendResponse({ ok: false, error: "FORBIDDEN_SENDER", reason: "FORBIDDEN_SENDER" });
      return false;
    }

    if (message.type === "POPUP_X_HOT" || message.type === "POPUP_X_TOPIC") {
      const senderUrl = sender?.url || "";
      const readerSender =
        sender?.id === chrome.runtime.id &&
        ["popup.html", "sidepanel.html", "home.html"].some(
          (page) => senderUrl.split("?")[0].split("#")[0] === chrome.runtime.getURL(page),
        );
      if (!readerSender || (message.force !== undefined && typeof message.force !== "boolean")) {
        sendResponse({
          ok: false,
          items: [],
          posts: [],
          updatedAt: 0,
          hasMore: false,
          error: "无效的 X 请求",
        });
        return false;
      }
      const service = getXTopicService();
      const started = Date.now();
      const request =
        message.type === "POPUP_X_HOT" ? service.hot(message.force === true) : service.topic(message);
      request
        .then((result) => {
          if (!result?.ok)
            reportBackgroundRequestFailure(
              "x",
              message.type === "POPUP_X_HOT" ? "hot" : "topic",
              new Error(result?.error || "X content request failed"),
              {
                stage: "response",
                retryAfterMs: result?.retryAfterMs,
                stale: result?.stale === true,
                cacheHit: result?.cached === true,
                durationMs: Date.now() - started,
              },
            );
          sendResponse(result);
        })
        .catch((error) => {
          reportBackgroundRequestFailure(
            "x",
            message.type === "POPUP_X_HOT" ? "hot" : "topic",
            error,
            { stage: "response", durationMs: Date.now() - started },
          );
          sendResponse({
            ok: false,
            items: [],
            posts: [],
            updatedAt: 0,
            hasMore: false,
            error: "X 内容暂不可用，请稍后重试",
          });
        });
      return true;
    }

    if (message.type === "POPUP_XUEQIU_HOT" || message.type === "POPUP_XUEQIU_TOPIC") {
      const senderUrl = sender?.url || "";
      const readerSender =
        sender?.id === chrome.runtime.id &&
        ["popup.html", "sidepanel.html", "home.html"].some(
          (page) => senderUrl.split("?")[0].split("#")[0] === chrome.runtime.getURL(page),
        );
      if (!readerSender || (message.force !== undefined && typeof message.force !== "boolean")) {
        sendResponse({
          ok: false,
          items: [],
          posts: [],
          updatedAt: 0,
          page: 1,
          hasMore: false,
          error: "无效的雪球热搜请求",
        });
        return false;
      }
      const started = Date.now();
      const hot = message.type === "POPUP_XUEQIU_HOT";
      const request = hot ? fetchXueqiuHot(message.force === true) : fetchXueqiuTopic(message);
      request
        .then((result) => {
          if (!result?.ok)
            reportBackgroundRequestFailure(
              "xueqiu",
              hot ? "hot" : "topic",
              new Error(result?.error || "雪球内容请求失败"),
              {
                stage: "response",
                retryAfterMs: result?.retryAfterMs,
                stale: result?.stale === true,
                cacheHit: result?.cached === true,
                durationMs: Date.now() - started,
              },
            );
          sendResponse(result);
        })
        .catch((error) => {
          reportBackgroundRequestFailure("xueqiu", hot ? "hot" : "topic", error, {
            stage: "response",
            durationMs: Date.now() - started,
          });
          sendResponse(
            hot
              ? { ok: false, items: [], updatedAt: 0, error: "雪球热搜暂不可用" }
              : {
                  ok: false,
                  posts: [],
                  updatedAt: 0,
                  page: 1,
                  hasMore: false,
                  error: "雪球话题暂不可用，请稍后重试",
                },
          );
        });
      return true;
    }

    if (message.type === "POPUP_WEIBO_TOPIC") {
      const started = Date.now();
      fetchWeiboTopic(message)
        .then((result) => {
          if (!result?.ok)
            reportBackgroundRequestFailure(
              "weibo",
              "topic",
              new Error(result?.error || "微博话题请求失败"),
              {
                stage: "response",
                retryAfterMs: result?.retryAfterMs,
                stale: result?.stale === true,
                cacheHit: result?.cached === true,
                durationMs: Date.now() - started,
              },
            );
          sendResponse(result);
        })
        .catch((error) => {
          reportBackgroundRequestFailure("weibo", "topic", error, {
            stage: "response",
            durationMs: Date.now() - started,
          });
          sendResponse({
            ok: false,
            posts: [],
            updatedAt: 0,
            page: 1,
            hasMore: false,
            error: "微博话题暂不可用",
          });
        });
      return true;
    }

    if (message.type === "POPUP_WEIBO_HOT") {
      if (message.force != null && typeof message.force !== "boolean") {
        sendResponse({ ok: false, items: [], updatedAt: 0, error: "无效的刷新参数" });
        return false;
      }
      const started = Date.now();
      fetchWeiboHot(message.force === true)
        .then((result) => {
          if (!result?.ok)
            reportBackgroundRequestFailure(
              "weibo",
              "hot",
              new Error(result?.error || "微博热搜请求失败"),
              {
                stage: "response",
                retryAfterMs: result?.retryAfterMs,
                stale: result?.stale === true,
                cacheHit: result?.cached === true,
                durationMs: Date.now() - started,
              },
            );
          sendResponse(result);
        })
        .catch((error) => {
          reportBackgroundRequestFailure("weibo", "hot", error, {
            stage: "response",
            durationMs: Date.now() - started,
          });
          sendResponse({ ok: false, items: [], updatedAt: 0, error: "微博热搜暂不可用" });
        });
      return true;
    }

    if (message.type === "POPUP_SQUARE_FEED") {
      if (message.force != null && typeof message.force !== "boolean") {
        sendResponse({ ok: false, posts: [], updatedAt: 0, error: "无效的刷新参数" });
        return false;
      }
      const started = Date.now();
      const platform = parseFeedKey(String(message.feedKey || "")).platform;
      fetchSquareFeed(message.feedKey, message.force === true)
        .then((result) => {
          if (!result?.ok)
            reportBackgroundRequestFailure(
              platform,
              "square",
              new Error(result?.error || "广场内容请求失败"),
              {
                stage: "response",
                retryAfterMs: result?.retryAfterMs,
                stale: result?.stale === true,
                cacheHit: result?.cached === true,
                durationMs: Date.now() - started,
              },
            );
          sendResponse(result);
        })
        .catch((error) => {
          reportBackgroundRequestFailure(platform, "square", error, {
            stage: "response",
            durationMs: Date.now() - started,
          });
          sendResponse({ ok: false, posts: [], updatedAt: 0, error: "广场内容暂不可用" });
        });
      return true;
    }

    if (message.type === "POPUP_SESSION") {
      // 兼容：仍返回雪球 session；同时附带 sessions.xueqiu / sessions.x / sessions.weibo（不含 cookie 值）
      readPlatformSessions()
        .then((sessions) => sendResponse({ ...sessions.xueqiu, sessions }))
        .catch(() =>
          sendResponse({
            status: "unknown",
            readable: false,
            sessions: {
              xueqiu: { status: "unknown", readable: false },
              x: { status: "unknown", readable: false },
              weibo: { status: "unknown", readable: false },
            },
          }),
        );
      return true;
    }

    if (message.type === "POPUP_PLATFORM_SESSIONS") {
      readPlatformSessions()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            xueqiu: { status: "unknown", readable: false },
            x: { status: "unknown", readable: false },
            weibo: { status: "unknown", readable: false },
          }),
        );
      return true;
    }

    if (message.type === "POPUP_OPEN_X_LOGIN") {
      const url = "https://x.com/i/flow/login";
      chrome.tabs.create({ url }, () => {
        sendResponse(
          chrome.runtime.lastError ? { ok: false, reason: "OPEN_FAILED" } : { ok: true, url },
        );
      });
      return true;
    }

    if (message.type === "POPUP_OPEN_WEIBO_LOGIN") {
      const url = "https://weibo.com/login.php";
      chrome.tabs.create({ url }, () => {
        sendResponse(
          chrome.runtime.lastError ? { ok: false, reason: "OPEN_FAILED" } : { ok: true, url },
        );
      });
      return true;
    }

    if (message.type === "POPUP_OPEN_WINDOW") {
      openReaderWindow()
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "WINDOW_FAILED" }));
      return true;
    }

    if (message.type === "POPUP_OPEN_SIDEBAR") {
      openReaderSidebar(message.windowId)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "SIDEBAR_FAILED" }));
      return true;
    }

    if (message.type === "POPUP_CLOSE_SIDEBAR") {
      resolveWindowId(message.windowId)
        .then(async (windowId) => {
          if (!windowId) return { ok: false, reason: "NO_WINDOW" };
          await closeSidebarWindow(windowId);
          return { ok: true, windowId };
        })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "SIDEBAR_FAILED" }));
      return true;
    }

    // 侧栏 → 工具栏普通弹窗（非独立窗口）。优先在页面侧调用；此处作回退。
    if (message.type === "POPUP_OPEN_POPUP") {
      (async () => {
        const windowId = await resolveWindowId(message.windowId);
        try {
          if (windowId && chrome.sidePanel && typeof chrome.sidePanel.close === "function") {
            await chrome.sidePanel.close({ windowId });
          }
        } catch {
          /* Chrome < 141 无 close */
        }
        try {
          if (chrome.action && typeof chrome.action.openPopup === "function") {
            await chrome.action.openPopup();
            sendResponse({ ok: true });
            return;
          }
          sendResponse({ ok: false, reason: "NO_OPEN_POPUP" });
        } catch {
          sendResponse({ ok: false, reason: "OPEN_POPUP_FAILED" });
        }
      })();
      return true;
    }

    if (message.type === "POPUP_OPEN_XUEQIU") {
      openXueqiu().then(sendResponse);
      return true;
    }

    if (message.type === "POPUP_OPEN_URL") {
      const url = String(message.url || "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        sendResponse({ ok: false, reason: "NO_URL" });
        return true;
      }
      if (!chrome.tabs || !chrome.tabs.create) {
        sendResponse({ ok: false, reason: "NO_TABS" });
        return true;
      }
      chrome.tabs.create({ url }, () => {
        sendResponse(
          chrome.runtime.lastError ? { ok: false, reason: "OPEN_FAILED" } : { ok: true },
        );
      });
      return true;
    }

    if (message.type === "POPUP_RELOAD_TAB") {
      findXueqiuTab().then(async (tab) => {
        if (!tab) {
          sendResponse(await openXueqiu());
          return;
        }
        chrome.tabs.reload(tab.id, {}, () => {
          void chrome.runtime.lastError;
          sendResponse({ ok: true, tabId: tab.id, created: false, url: tab.url || "" });
        });
      });
      return true;
    }

    if (message.type === "POPUP_NOTIFY_TEST") {
      if (!chrome.notifications?.create) {
        sendResponse({ ok: false, reason: "NO_NOTIFICATIONS", stage: "no-api" });
        return true;
      }
      const finish = (createdId) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        sendResponse(
          createdId && !err
            ? { ok: true, createdId: createdId || "", lastError: "", stage: "created" }
            : {
                ok: false,
                reason: String(err || "NOTIFY_FAILED"),
                createdId: createdId || "",
                lastError: String(err || ""),
                stage: "create-failed",
              },
        );
      };
      const show = () => {
        const id = "xq-test-" + Date.now().toString(36);
        const iconUrl = chrome.runtime.getURL("icons/icon128.png");
        try {
          chrome.notifications.create(
            id,
            {
              type: "basic",
              iconUrl,
              title: "测试提醒 发布了新动态",
              message: "这是一条测试通知，用来预览新动态提醒的样式。",
              contextMessage: "Lesen · 莱森",
              priority: 2,
              requireInteraction: false,
            },
            finish,
          );
        } catch (error) {
          sendResponse({
            ok: false,
            reason: String((error && error.message) || error),
            stage: "create-throw",
          });
        }
      };
      try {
        chrome.notifications.getPermissionLevel((level) => {
          if (level === "denied") {
            sendResponse({ ok: false, reason: "NOTIFICATIONS_DENIED", level, stage: "denied" });
            return;
          }
          if (!chrome.notifications.getAll) {
            show();
            return;
          }
          chrome.notifications.getAll((all) => {
            const old = Object.keys(all || {}).filter((key) => key.indexOf("xq-test-") === 0);
            if (!old.length || !chrome.notifications.clear) {
              show();
              return;
            }
            let pending = old.length;
            old.forEach((key) => {
              chrome.notifications.clear(key, () => {
                void chrome.runtime.lastError;
                pending -= 1;
                if (pending === 0) show();
              });
            });
          });
        });
      } catch (error) {
        sendResponse({
          ok: false,
          reason: String((error && error.message) || error),
          stage: "permission-throw",
        });
      }
      return true;
    }

    if (message.type === "POPUP_NOTIFY_SET") {
      const enabled = message.enabled !== false;
      (async () => {
        try {
          const stored = await chrome.storage.local.get(["settings"]);
          const settings =
            stored.settings && typeof stored.settings === "object" ? { ...stored.settings } : {};
          settings.notify = message.notifyForm === "quiet" ? false : enabled;
          if (message.notifyForm === "system" || message.notifyForm === "quiet") {
            settings.notifyForm = message.notifyForm;
            settings.notify = message.notifyForm === "system";
          }
          settings.refreshMinutes = 0;
          await chrome.storage.local.set({ settings });
          await syncRefreshAlarm();
          sendResponse({ ok: true, enabled: settings.notify !== false, refreshMinutes: 0 });
        } catch (error) {
          sendResponse({ ok: false, reason: "NOTIFY_SET_FAILED" });
        }
      })();
      return true;
    }

    if (message.type === "POPUP_X_FOLLOWING") {
      fetchXFollowing(message.force === true)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false, reason: "FOLLOWING_FAILED", users: [] }));
      return true;
    }

    if (message.type === "POPUP_WEIBO_FOLLOWING") {
      fetchWeiboFollowing(message.force === true)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false, reason: "FOLLOWING_FAILED", users: [] }));
      return true;
    }

    if (message.type === "POPUP_SEARCH_X_USERS") {
      const q = String(message.query || "").trim();
      if (q.length < 1) {
        sendResponse({ ok: true, users: [] });
        return true;
      }
      const url =
        "https://api.fxtwitter.com/2/search/users?q=" + encodeURIComponent(q) + "&count=15";
      fetch(url, { cache: "no-store" })
        .then((response) => response.json())
        .then((json) => {
          const raw = Array.isArray(json?.results) ? json.results : [];
          const users = raw
            .map((user) => ({
              platform: "x",
              id: String(user.screen_name || "").toLowerCase(),
              name: String(user.name || user.screen_name || ""),
              avatar: String(user.avatar_url || "")
                .replace(/^http:\/\//i, "https://")
                .replace("_normal", "_bigger")
                .slice(0, 500),
              followers: Number(user.followers) || 0,
              verified: !!(user.verification && user.verification.verified),
              description: String(user.description || "").slice(0, 80),
            }))
            .filter((user) => user.id);
          if (json && json.code === 200 && users.length) {
            sendResponse({ ok: true, users });
            return;
          }
          const handle = q.replace(/^@/, "").trim().toLowerCase();
          if (/^[a-z0-9_]{1,15}$/.test(handle)) {
            return fetch("https://api.fxtwitter.com/2/profile/" + encodeURIComponent(handle), {
              cache: "no-store",
            })
              .then((profileResponse) => profileResponse.json())
              .then((profileJson) => {
                const user = profileJson && (profileJson.user || profileJson.profile);
                const profileUser =
                  profileJson && profileJson.code === 200 && user
                    ? {
                        platform: "x",
                        id: handle,
                        name: String(user.name || handle),
                        avatar: String(user.avatar_url || "")
                          .replace(/^http:\/\//i, "https://")
                          .replace("_normal", "_bigger")
                          .slice(0, 500),
                        followers: Number(user.followers) || 0,
                        verified: !!user.verified,
                      }
                    : null;
                sendResponse(
                  profileUser
                    ? { ok: true, users: [profileUser], public: true }
                    : { ok: false, users: [], error: "NO_RESULTS" },
                );
              });
          }
          sendResponse({ ok: false, users: [], error: "NO_RESULTS" });
        })
        .catch((error) =>
          sendResponse({ ok: false, users: [], error: String((error && error.message) || error) }),
        );
      return true;
    }

    if (message.type === "POPUP_SEARCH_USERS") {
      const platform = String(message.platform || "");
      const query = String(message.query || "").trim();
      if (!query) {
        sendResponse({ ok: true, users: [] });
        return true;
      }
      const task =
        platform === "xueqiu"
          ? searchXueqiuUsers(query)
          : platform === "weibo"
            ? searchWeiboUsers(query)
            : Promise.resolve({
                ok: false,
                users: [],
                error: "UNSUPPORTED_PLATFORM",
              });
      task.then(sendResponse).catch((error) =>
        sendResponse({
          ok: false,
          users: [],
          error: String((error && error.message) || error).slice(0, 100),
        }),
      );
      return true;
    }

    if (message.type === "POPUP_ADD_SOURCE") {
      parseSourceInput(message.input)
        .then((spec) => {
          if (spec.error) {
            sendResponse({ ok: false, error: spec.error });
            return;
          }
          if (!["xueqiu", "x", "weibo"].includes(String(spec.platform || ""))) {
            sendResponse({ ok: false, error: "UNSUPPORTED_PLATFORM" });
            return;
          }
          handleAddSource(message, spec, sendResponse);
        })
        .catch(() => sendResponse({ ok: false, error: "RESOLVE_FAILED" }));
      return true;
    }

    // Timeline ops: prefer background fetch (cookie / fxtwitter). Avoids tab inject+warm latency
    // and fixes X POPUP_REFRESH which content scripts only answer with USE_BACKGROUND_X.
    if (
      message.type === "POPUP_LOAD_USER" ||
      message.type === "POPUP_LOAD_MORE" ||
      message.type === "POPUP_REFRESH"
    ) {
      refreshTimelineMessage(message)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "DISPATCH_FAILED" }));
      return true;
    }

    if (!FORWARDED.has(message.type)) return false;
    dispatch(message)
      .then((response) => {
        sendResponse(response);
      })
      .catch(() => sendResponse({ ok: false, reason: "DISPATCH_FAILED" }));
    return true;
  });
}

let backgroundMainInstalled = false;
export function installBackgroundMain() {
  if (backgroundMainInstalled) return;
  backgroundMainInstalled = true;
  void ensureGuardedRequestReady();
  installWeiboImageRefererRule();
  registerOnInstalledListener();
  registerNotifyListeners();
  void disableAutoRefreshSetting();
  registerCookieSessionListener();
  registerSidePanelListeners();
  registerRuntimeMessageListener();
}
