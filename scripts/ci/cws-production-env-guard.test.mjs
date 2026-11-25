import { describe, expect, it } from "vitest";
import { evaluateProductionEnvGuard, validateTrustedBindings } from "../lib/production-env-guard.mjs";

const prod = {
  WXT_PUBLIC_SUPABASE_URL: "https://exampleproject.supabase.co/",
  WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_live_example",
  WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "prod-client-id.apps.googleusercontent.com",
};

describe("production-env-guard trusted bindings", () => {
  it("rejects dev client equal to production client", () => {
    const r = evaluateProductionEnvGuard({
      wxtPublic: prod,
      localDevClientId: prod.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects wrong supabase host shape", () => {
    const r = evaluateProductionEnvGuard({
      wxtPublic: { ...prod, WXT_PUBLIC_SUPABASE_URL: "http://evil.example/" },
    });
    expect(r.ok).toBe(false);
  });

  it("requires exact trusted match when CWS_REQUIRE_TRUSTED_BINDINGS", () => {
    const ok = validateTrustedBindings(prod, {
      CWS_TRUSTED_SUPABASE_URL: prod.WXT_PUBLIC_SUPABASE_URL,
      CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY: prod.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID: prod.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    }, { requireTrusted: true });
    expect(ok.ok).toBe(true);

    const bad = validateTrustedBindings(prod, {
      CWS_TRUSTED_SUPABASE_URL: "https://other.supabase.co/",
      CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY: prod.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID: prod.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    }, { requireTrusted: true });
    expect(bad.ok).toBe(false);
  });

  it("fails closed when trusted secrets missing on live path", () => {
    const r = evaluateProductionEnvGuard({ wxtPublic: prod, trusted: {}, requireTrusted: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("CWS_TRUSTED"))).toBe(true);
  });
});