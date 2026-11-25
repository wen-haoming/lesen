import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETE_NOTICE,
  GOOGLE_LOGIN_SCOPES,
  LOCAL_DATA_LOGIN_HINT,
  LOCAL_DATA_NOTICE,
  isAllowedSupabaseUrl,
  isAuthConfigured,
  isGoogleLoginConfigured,
  isGoogleOAuthClientId,
  isPublishableKey,
  supabaseHostPermissions,
} from "./owlivo-auth-config";
import {
  buildGoogleIdTokenAuthUrl,
  classifyIdentityError,
  createAuthNonce,
  hashAuthNonceForGoogle,
  createChromeAuthStorage,
  mapAuthUser,
  parseIdTokenFromRedirect,
} from "./owlivo-auth";

function jwtWith(payload: Record<string, unknown>): string {
  const encode = (value: string) =>
    btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${encode(JSON.stringify({ alg: "none", typ: "JWT" }))}.${encode(JSON.stringify(payload))}.sig`;
}

describe("owlivo auth config", () => {
  it("accepts only this project's HTTPS Supabase URL", () => {
    expect(isAllowedSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(true);
    expect(isAllowedSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/")).toBe(true);
    expect(isAllowedSupabaseUrl("https://other.supabase.co")).toBe(false);
    expect(isAllowedSupabaseUrl("http://abcdefghijklmnopqrst.supabase.co")).toBe(false);
    expect(isAllowedSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/auth")).toBe(false);
    expect(isAllowedSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/?x=1")).toBe(false);
  });

  it("accepts publishable keys and rejects secret or service_role material", () => {
    expect(isPublishableKey("sb_publishable_examplekey_123")).toBe(true);
    expect(isPublishableKey("sb_secret_examplekey_123")).toBe(false);
    expect(
      isPublishableKey(jwtWith({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon" })),
    ).toBe(true);
    expect(
      isPublishableKey(jwtWith({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "service_role" })),
    ).toBe(false);
    expect(isPublishableKey(jwtWith({ iss: "supabase", ref: "other", role: "anon" }))).toBe(false);
    expect(
      isAuthConfigured(
        "https://abcdefghijklmnopqrst.supabase.co",
        jwtWith({ ref: "abcdefghijklmnopqrst", role: "service_role" }),
      ),
    ).toBe(false);
  });

  it("requires a Google Chrome OAuth client id before login can be offered as ready", () => {
    expect(isGoogleOAuthClientId("123-abc.apps.googleusercontent.com")).toBe(true);
    expect(isGoogleOAuthClientId("not-a-client")).toBe(false);
    expect(
      isGoogleLoginConfigured(
        "https://abcdefghijklmnopqrst.supabase.co",
        "sb_publishable_examplekey_123",
        "",
      ),
    ).toBe(false);
    expect(
      supabaseHostPermissions("https://abcdefghijklmnopqrst.supabase.co"),
    ).toEqual(["https://abcdefghijklmnopqrst.supabase.co/*"]);
    expect(supabaseHostPermissions("https://evil.example")).toEqual([]);
  });

  it("keeps the local-data wording accurate and never claims full cloud backup or 'no login means no data'", () => {
    expect(LOCAL_DATA_NOTICE).toContain("订阅列表");
    expect(LOCAL_DATA_NOTICE).not.toMatch(/全部数据|全量云备份|已做云备份/);
    expect(LOCAL_DATA_LOGIN_HINT).toContain("不登录也会保留本机数据");
    expect(LOCAL_DATA_LOGIN_HINT).toContain("不会上传第三方登录凭证");
    expect(LOCAL_DATA_LOGIN_HINT).not.toMatch(/不登录就不保留|已经同步|已全量云备份/);
    expect(ACCOUNT_DELETE_NOTICE).toContain("不会删除本机订阅");
    expect(GOOGLE_LOGIN_SCOPES).toEqual(["openid", "email", "profile"]);
  });
});

describe("owlivo auth helpers", () => {
  it("classifies Chrome identity cancel and failure messages", () => {
    expect(classifyIdentityError("The user did not approve access.")).toBe("cancelled");
    expect(classifyIdentityError("canceled")).toBe("cancelled");
    expect(classifyIdentityError("Authorization page could not be loaded.")).toBe("failed");
  });

  it("parses the Google id_token from an extension redirect", () => {
    expect(
      parseIdTokenFromRedirect("https://abcdef.chromiumapp.org/#id_token=abc.def.ghi&state=1"),
    ).toBe("abc.def.ghi");
    expect(parseIdTokenFromRedirect("https://abcdef.chromiumapp.org/?id_token=abc.def.ghi")).toBe(
      "abc.def.ghi",
    );
    expect(parseIdTokenFromRedirect("https://abcdef.chromiumapp.org/#error=access_denied")).toBe(
      null,
    );
    expect(parseIdTokenFromRedirect(undefined)).toBe(null);
  });

  it("builds a minimal-scope Google id_token URL for launchWebAuthFlow", () => {
    const href = buildGoogleIdTokenAuthUrl({
      clientId: "123-abc.apps.googleusercontent.com",
      redirectUri: "https://dakdgplahfkbblfpafdjeipneioajgdf.chromiumapp.org/",
      nonce: "nonce-value",
    });
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("123-abc.apps.googleusercontent.com");
    expect(url.searchParams.get("response_type")).toBe("id_token");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://dakdgplahfkbblfpafdjeipneioajgdf.chromiumapp.org/",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBe("nonce-value");
    expect(url.searchParams.get("access_type")).toBeNull();
  });

  it("maps only display fields from the Auth user and ignores authorization metadata", () => {
    expect(
      mapAuthUser({
        id: "user-1",
        email: "reader@example.com",
        user_metadata: { full_name: "  温浩明  ", avatar_url: "https://example.com/a.png", role: "admin" },
      }),
    ).toEqual({
      id: "user-1",
      email: "reader@example.com",
      nickname: "温浩明",
      avatarUrl: "https://example.com/a.png",
    });
    expect(mapAuthUser({ id: "user-2", email: "only@example.com", user_metadata: {} })).toEqual({
      id: "user-2",
      email: "only@example.com",
      nickname: "only",
      avatarUrl: null,
    });
  });

  it("persists Auth session strings in chrome.storage without touching other keys", async () => {
    const data: Record<string, unknown> = { "owlivo:subscriptions": [{ id: "keep-me" }] };
    const area = {
      get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(data, value);
      }),
      remove: vi.fn(async (key: string) => {
        delete data[key];
      }),
    };
    const storage = createChromeAuthStorage(area);
    await storage.setItem("owlivo-auth", '{"access_token":"x"}');
    expect(await storage.getItem("owlivo-auth")).toBe('{"access_token":"x"}');
    await storage.removeItem("owlivo-auth");
    expect(await storage.getItem("owlivo-auth")).toBeNull();
    expect(data["owlivo:subscriptions"]).toEqual([{ id: "keep-me" }]);
  });

  it("creates a url-safe nonce", () => {
    const nonce = createAuthNonce(32, () => Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce).not.toMatch(/[+/=]/);
  });

  it("hashes the raw nonce as SHA-256 hex for Google and keeps the raw value for signInWithIdToken", async () => {
    const hashed = await hashAuthNonceForGoogle("nonce-value");
    expect(hashed).toBe("efb4e26c3deb3dd5e04408769d1b6b371ae1e7acbe1e32332550b06f784780f2");
    expect(hashed).not.toBe("nonce-value");
    const href = buildGoogleIdTokenAuthUrl({
      clientId: "123-abc.apps.googleusercontent.com",
      redirectUri: "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/",
      nonce: hashed,
    });
    expect(new URL(href).searchParams.get("nonce")).toBe(hashed);
  });
});
