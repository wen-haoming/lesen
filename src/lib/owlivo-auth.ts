import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  GOOGLE_LOGIN_SCOPES,
  isAuthConfigured,
  isGoogleLoginConfigured,
  readAuthPublicEnv,
} from "./owlivo-auth-config";

export type OwlivoAccount = {
  id: string;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
};

export type OwlivoAuthStatus = "unconfigured" | "needs_google_client" | "signed_out" | "signed_in";

export type OwlivoSignInResult =
  | { ok: true; account: OwlivoAccount }
  | {
      ok: false;
      reason: "cancelled" | "failed" | "unconfigured" | "needs_google_client";
      message: string;
    };

export type OwlivoDeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "failed" | "unconfigured" | "not_signed_in"; message: string };

const AUTH_STORAGE_KEY = "owlivo-auth";
const DELETE_ACCOUNT_FUNCTION = "delete-account";

type ChromeAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function createChromeAuthStorage(
  area: Pick<chrome.storage.StorageArea, "get" | "set" | "remove"> = chrome.storage.local,
): ChromeAuthStorage {
  return {
    async getItem(key: string) {
      const got = await area.get(key);
      const value = got[key];
      return typeof value === "string" ? value : null;
    },
    async setItem(key: string, value: string) {
      await area.set({ [key]: value });
    },
    async removeItem(key: string) {
      await area.remove(key);
    },
  };
}

export function classifyIdentityError(message: string): "cancelled" | "failed" {
  const text = String(message || "").toLowerCase();
  if (
    text.includes("cancel") ||
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("did not approve") ||
    text.includes("user rejected") ||
    text.includes("access denied") ||
    text.includes("the user closed")
  ) {
    return "cancelled";
  }
  return "failed";
}

export function parseIdTokenFromRedirect(redirectedTo: string | undefined | null): string | null {
  if (!redirectedTo) return null;
  try {
    const url = new URL(redirectedTo);
    const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("id_token");
    if (fromHash) return fromHash;
    return url.searchParams.get("id_token");
  } catch {
    return null;
  }
}

export function buildGoogleIdTokenAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  /** SHA-256 hex digest of the raw nonce later passed to signInWithIdToken. */
  nonce: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", GOOGLE_LOGIN_SCOPES.join(" "));
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("prompt", "select_account");
  return url.href;
}

export function createAuthNonce(
  bytes = 32,
  random: (size: number) => Uint8Array = (size) => {
    const out = new Uint8Array(size);
    crypto.getRandomValues(out);
    return out;
  },
): string {
  const raw = random(bytes);
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** SHA-256 hex digest for the Google auth request. Pass the raw nonce to signInWithIdToken. */
export async function hashAuthNonceForGoogle(
  nonce: string,
  digest: (data: BufferSource) => Promise<ArrayBuffer> = (data) =>
    crypto.subtle.digest("SHA-256", data),
): Promise<string> {
  const hashBuffer = await digest(new TextEncoder().encode(nonce));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function mapAuthUser(user: Pick<User, "id" | "email" | "user_metadata">): OwlivoAccount {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const nicknameFromMeta = [metadata.full_name, metadata.name, metadata.preferred_username]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  const email = user.email && user.email.trim() ? user.email.trim() : null;
  const avatar =
    (typeof metadata.avatar_url === "string" && metadata.avatar_url) ||
    (typeof metadata.picture === "string" && metadata.picture) ||
    null;
  return {
    id: user.id,
    email,
    nickname: nicknameFromMeta || (email ? email.split("@")[0] : "已登录用户"),
    avatarUrl: avatar,
  };
}

export function accountFromSession(session: Session | null): OwlivoAccount | null {
  return session?.user ? mapAuthUser(session.user) : null;
}

function publicEnv() {
  return readAuthPublicEnv(import.meta.env as unknown as Record<string, string | undefined>);
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!chrome.identity?.launchWebAuthFlow) {
      reject(Object.assign(new Error("当前环境不支持扩展登录流程"), { code: "failed" as const }));
      return;
    }
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectedTo) => {
      const errorMessage = chrome.runtime.lastError?.message;
      if (errorMessage) {
        reject(
          Object.assign(new Error(errorMessage), { code: classifyIdentityError(errorMessage) }),
        );
        return;
      }
      if (!redirectedTo) {
        reject(Object.assign(new Error("已取消登录"), { code: "cancelled" as const }));
        return;
      }
      resolve(redirectedTo);
    });
  });
}

let client: SupabaseClient | null = null;

export function getOwlivoAuthClient(): SupabaseClient | null {
  const { url, publishableKey } = publicEnv();
  if (!isAuthConfigured(url, publishableKey)) return null;
  if (client) return client;
  client = createClient(url, publishableKey, {
    auth: {
      storage: createChromeAuthStorage(),
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}

export function getOwlivoAuthBuildState(): {
  status: Exclude<OwlivoAuthStatus, "signed_in">;
  configured: boolean;
  googleReady: boolean;
} {
  const env = publicEnv();
  const configured = isAuthConfigured(env.url, env.publishableKey);
  const googleReady = isGoogleLoginConfigured(env.url, env.publishableKey, env.googleClientId);
  if (!configured) return { status: "unconfigured", configured, googleReady };
  if (!googleReady) return { status: "needs_google_client", configured, googleReady };
  return { status: "signed_out", configured, googleReady };
}

export async function getOwlivoAccount(): Promise<{
  status: OwlivoAuthStatus;
  account: OwlivoAccount | null;
}> {
  const build = getOwlivoAuthBuildState();
  const supabase = getOwlivoAuthClient();
  if (!supabase) return { status: build.status, account: null };
  const { data, error } = await supabase.auth.getSession();
  if (error) return { status: build.googleReady ? "signed_out" : build.status, account: null };
  const account = accountFromSession(data.session);
  if (account) return { status: "signed_in", account };
  return { status: build.googleReady ? "signed_out" : build.status, account: null };
}

export async function refreshOwlivoAuthSession(): Promise<OwlivoAccount | null> {
  const supabase = getOwlivoAuthClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return accountFromSession(data.session);
}

export async function signInWithGoogle(): Promise<OwlivoSignInResult> {
  const env = publicEnv();
  const build = getOwlivoAuthBuildState();
  const supabase = getOwlivoAuthClient();
  if (!supabase || build.status === "unconfigured") {
    return { ok: false, reason: "unconfigured", message: "托管登录尚未完成本地公开配置。" };
  }
  if (!build.googleReady) {
    return {
      ok: false,
      reason: "needs_google_client",
      message:
        "Google 登录还需要在 Google Cloud 创建 Chrome 扩展 OAuth 客户端，并登记到 Supabase Google 提供方。",
    };
  }
  try {
    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = createAuthNonce();
    const hashedNonce = await hashAuthNonceForGoogle(nonce);
    const authUrl = buildGoogleIdTokenAuthUrl({
      clientId: env.googleClientId,
      redirectUri,
      nonce: hashedNonce,
    });
    const redirectedTo = await launchWebAuthFlow(authUrl);
    const idToken = parseIdTokenFromRedirect(redirectedTo);
    if (!idToken) {
      return { ok: false, reason: "failed", message: "登录回调里没有可用的身份令牌。" };
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      nonce,
    });
    if (error) return { ok: false, reason: "failed", message: error.message || "登录未能完成。" };
    const account = accountFromSession(data.session);
    if (!account)
      return { ok: false, reason: "failed", message: "登录已返回，但没有可用的账号信息。" };
    return { ok: true, account };
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败。";
    const reason =
      (error as { code?: "cancelled" | "failed" }).code || classifyIdentityError(message);
    return { ok: false, reason, message };
  }
}

export async function signOutOwlivoAccount(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const supabase = getOwlivoAuthClient();
  if (!supabase) return { ok: false, message: "托管登录尚未配置。" };
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { ok: false, message: error.message || "退出失败。" };
  return { ok: true };
}

export async function deleteOwlivoAccount(
  expectedUserId?: string,
): Promise<OwlivoDeleteAccountResult> {
  const supabase = getOwlivoAuthClient();
  if (!supabase) return { ok: false, reason: "unconfigured", message: "托管登录尚未配置。" };
  const { data, error: sessionError } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (sessionError || !accessToken) {
    return { ok: false, reason: "not_signed_in", message: "当前没有可删除的登录会话。" };
  }
  if (expectedUserId && data.session?.user.id !== expectedUserId) {
    return { ok: false, reason: "not_signed_in", message: "当前登录账号已变化，请刷新后重试。" };
  }
  const { error } = await supabase.functions.invoke(DELETE_ACCOUNT_FUNCTION, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    return {
      ok: false,
      reason: "failed",
      message: "云端账号未能删除。本机订阅和阅读数据未被改动。",
    };
  }
  await supabase.auth.signOut({ scope: "local" });
  return { ok: true };
}
