export const PLATFORM_GAP_MS = 3000;
export const PLATFORM_WINDOW_MS = 5 * 60 * 1000;
export const PLATFORM_MAX_REQUESTS = 20;
// 同一公开请求的去重窗口只用于吸收 UI 重复触发；不应让一次手动操作锁住用户一分钟。
export const SAME_REQUEST_GAP_MS = 10 * 1000;
export const RISK_BASE_MS = 5 * 60 * 1000;
export const RISK_MAX_MS = 30 * 60 * 1000;

export function canonicalRequestUrl(raw) {
  try {
    const url = new URL(String(raw));
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:_|cacheBust|cachebuster|timestamp|ts)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return String(raw || "");
  }
}

export function inspectRisk(status, body, headers, now = Date.now()) {
  const text = String(body || "");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* Non-JSON bodies are inspected as text below. */
  }
  const codes = [parsed?.error_code, parsed?.code, parsed?.status].map((value) =>
    String(value ?? ""),
  );
  const messages = [parsed?.error_description, parsed?.error_msg, parsed?.message, parsed?.msg].map(
    (value) => String(value ?? ""),
  );
  const codeRisk = codes.some((code) => /^(?:403|429|300011)$|RATE_LIMIT/i.test(code));
  const messageRisk = /RATE_LIMIT|too many requests|请求过于频繁|操作过于频繁|账号存在异常|captcha|验证码|访问验证|安全验证|风控/i.test(
    messages.join(" "),
  );
  const nonJsonRisk = !parsed && /RATE_LIMITED|RATE_LIMIT|too many requests|请求过于频繁|操作过于频繁|账号存在异常|captcha|验证码|访问验证|安全验证|风控/i.test(text);
  const htmlChallenge = /(?:_waf_|captcha|访问验证|安全验证)/i.test(text);
  const risky =
    status === 403 ||
    status === 429 ||
    codeRisk ||
    messageRisk ||
    nonJsonRisk ||
    (!parsed && htmlChallenge && /^\s*</.test(text));
  if (!risky) return null;
  const retry = headers?.get("Retry-After") || "";
  const seconds = Number(retry);
  const parsedDate = Date.parse(retry);
  const retryAfterMs = retry
    ? Number.isFinite(seconds) && retry.trim() !== ""
      ? Math.max(0, seconds * 1000)
      : Number.isFinite(parsedDate)
        ? Math.max(0, parsedDate - now)
        : 0
    : 0;
  return { retryAfterMs };
}

export function createPlatformPolicyState() {
  return { requests: {}, history: [], pause: null, lastAt: 0 };
}

export function hydratePlatformPolicy(raw, now = Date.now()) {
  const state = createPlatformPolicyState();
  for (const [key, at] of Object.entries(raw?.requests || {})) {
    if (Number(at) > now - SAME_REQUEST_GAP_MS) state.requests[key] = Number(at);
  }
  state.history = Array.isArray(raw?.history)
    ? raw.history.map(Number).filter((at) => at > now - PLATFORM_WINDOW_MS)
    : [];
  if (raw?.pause && Number(raw.pause.failures) > 0)
    state.pause = { failures: Number(raw.pause.failures), until: Number(raw.pause.until) || 0 };
  state.lastAt = Number(raw?.lastAt) || (state.history.length ? Math.max(...state.history) : 0);
  return state;
}

export function getPolicyDenial(state, url, now = Date.now()) {
  if (state.pause && state.pause.until > now)
    return { platformPause: true, retryAfterMs: state.pause.until - now };
  state.history = state.history.filter((at) => at > now - PLATFORM_WINDOW_MS);
  const key = canonicalRequestUrl(url);
  const sameAt = Number(state.requests[key]) || 0;
  if (sameAt && now - sameAt < SAME_REQUEST_GAP_MS)
    return { retryAfterMs: SAME_REQUEST_GAP_MS - (now - sameAt) };
  if (state.lastAt && now - state.lastAt < PLATFORM_GAP_MS)
    return { spacing: true, retryAfterMs: PLATFORM_GAP_MS - (now - state.lastAt) };
  if (state.history.length >= PLATFORM_MAX_REQUESTS)
    return { retryAfterMs: Math.max(1, state.history[0] + PLATFORM_WINDOW_MS - now) };
  return null;
}

export function notePolicyDispatch(state, url, now = Date.now()) {
  state.requests[canonicalRequestUrl(url)] = now;
  state.history = state.history.filter((at) => at > now - PLATFORM_WINDOW_MS);
  state.history.push(now);
  state.lastAt = now;
  for (const [key, at] of Object.entries(state.requests))
    if (Number(at) <= now - PLATFORM_WINDOW_MS) delete state.requests[key];
}

export function applyRiskPause(state, retryAfterMs = 0, now = Date.now()) {
  const failures = Math.min(4, Number(state.pause?.failures || 0) + 1);
  const delay = Math.max(
    Math.min(RISK_MAX_MS, RISK_BASE_MS * 2 ** (failures - 1)),
    Number(retryAfterMs) || 0,
  );
  state.pause = { failures, until: Math.max(Number(state.pause?.until || 0), now + delay) };
  return { ...state.pause, retryAfterMs: state.pause.until - now };
}

export function clearExpiredRiskPause(state, now = Date.now()) {
  if (!state?.pause) return false;
  if (Number(state.pause.until) > now) return false;
  state.pause = null;
  return true;
}
