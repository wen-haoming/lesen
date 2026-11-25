import { describe, expect, it } from "vitest";
import {
  applyRiskPause,
  canonicalRequestUrl,
  clearExpiredRiskPause,
  createPlatformPolicyState,
  getPolicyDenial,
  hydratePlatformPolicy,
  inspectRisk,
  notePolicyDispatch,
} from "./platform-request-risk";

describe("authenticated platform request risk policy", () => {
  it("canonicalizes cache busters and enforces the same-URL cooldown even after force intent", () => {
    const state = createPlatformPolicyState();
    const first = "https://xueqiu.com/user/current.json?_=100";
    expect(canonicalRequestUrl(first)).toBe(
      canonicalRequestUrl("https://xueqiu.com/user/current.json?_=200"),
    );
    notePolicyDispatch(state, first, 10_000);
    expect(
      getPolicyDenial(state, "https://xueqiu.com/user/current.json?_=300", 10_001)?.retryAfterMs,
    ).toBe(9_999);
  });

  it("counts every dispatch in a shared author-agnostic budget", () => {
    const state = createPlatformPolicyState();
    for (let i = 0; i < 20; i++)
      notePolicyDispatch(state, `https://xueqiu.com/timeline?page=${i}`, 100_000 + i * 3_000);
    expect(getPolicyDenial(state, "https://xueqiu.com/timeline?page=21", 157_000)).toBeTruthy();
    expect(state.history).toHaveLength(20);
  });

  it("persists history and active/exhausted penalty failure count across worker restarts", () => {
    const state = createPlatformPolicyState();
    notePolicyDispatch(state, "https://weibo.com/a", 100_000);
    const pause = applyRiskPause(state, 0, 100_000);
    const restarted = hydratePlatformPolicy(
      { requests: state.requests, history: state.history, pause },
      101_000,
    );
    expect(getPolicyDenial(restarted, "https://weibo.com/b", 101_000)?.platformPause).toBe(true);
    const afterCooldown = hydratePlatformPolicy(
      { requests: state.requests, history: state.history, pause },
      pause.until + 1,
    );
    expect(applyRiskPause(afterCooldown, 0, pause.until + 1).failures).toBe(2);
    expect(getPolicyDenial(afterCooldown, "https://weibo.com/b", 102_000)).toBeTruthy();
  });

  it("merges duplicate concurrent work by canonical URL", async () => {
    const inflight = new Map<string, Promise<number>>();
    const run = (url: string) => {
      const key = canonicalRequestUrl(url);
      const existing = inflight.get(key);
      if (existing) return { request: existing, resolve: () => { } };
      let resolve!: (value: number) => void;
      const request = new Promise<number>((done) => {
        resolve = done;
      });
      inflight.set(key, request);
      return { request, resolve };
    };
    const first = run("https://xueqiu.com/a?_=1");
    const second = run("https://xueqiu.com/a?_=2");
    expect(second.request).toBe(first.request);
    first.resolve(1);
    await expect(second.request).resolves.toBe(1);
  });

  it("recognizes risk/WAF and Retry-After but not ordinary post text", () => {
    expect(inspectRisk(403, "denied")?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, '{"error_code":300011,"msg":"blocked"}')?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, "<html>captcha</html>", { get: () => "120" })?.retryAfterMs).toBe(
      120_000,
    );
    expect(inspectRisk(200, '{"statuses":[{"text":"验证码在这句话里，但帖子正常"}]}')).toBeNull();
    expect(inspectRisk(200, '{"text":"CAPTCHA and _waf_ are mentioned in a normal post; 安全验证 too"}')).toBeNull();
    expect(inspectRisk(200, '{"statuses":[{"text":"请求过于频繁 / too many requests / RATE_LIMITED"}]}')).toBeNull();
    expect(inspectRisk(200, "请求过于频繁，请稍后再试")?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, "RATE_LIMITED: too many requests")?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, '{"message":"验证码"}')?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, '{"message":"风控要求访问验证"}')?.retryAfterMs).toBe(0);
    expect(inspectRisk(200, '<html><body>normal weibo homepage</body></html>')).toBeNull();
    expect(inspectRisk(200, '<html><body>captcha verification</body></html>')).not.toBeNull();
    expect(inspectRisk(403, 'denied', { get: () => "Wed, 21 Oct 2030 07:28:00 GMT" }, Date.parse("Wed, 21 Oct 2030 07:00:00 GMT"))?.retryAfterMs).toBe(28 * 60 * 1000);
    expect(inspectRisk(403, 'denied', { get: () => "invalid-date" })?.retryAfterMs).toBe(0);
  });

  it("never clears a platform pause on late success and respects server delay", () => {
    const state = createPlatformPolicyState();
    const pause = applyRiskPause(state, 12 * 60 * 1000, 1_000);
    expect(pause.until).toBe(12 * 60 * 1000 + 1_000);
    const lateSuccess = { ok: true };
    expect(lateSuccess.ok).toBe(true);
    expect(getPolicyDenial(state, "https://weibo.com/next", 2_000)?.platformPause).toBe(true);
  });

  it("clears expired risk failure streak only after cooldown has elapsed", () => {
    const state = createPlatformPolicyState();
    const pause = applyRiskPause(state, 0, 10_000);
    expect(clearExpiredRiskPause(state, pause.until - 1)).toBe(false);
    expect(state.pause.failures).toBe(1);
    expect(clearExpiredRiskPause(state, pause.until + 1)).toBe(true);
    expect(state.pause).toBeNull();
  });

  it("stops queued requests after an earlier task records risk", () => {
    const state = createPlatformPolicyState();
    applyRiskPause(state, 0, 50_000);
    expect(getPolicyDenial(state, "https://xueqiu.com/queued", 50_001)?.platformPause).toBe(true);
  });
});
