import { PRODUCT_DISPLAY_NAME } from "./product-brand";
/** Owlivo hosted Auth 的公开配置校验。不读取、不接受 service_role。 */

// Synthetic placeholder. Set this to YOUR project ref before enabling optional self-hosted login.
export const OWLIVO_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
export const OWLIVO_SUPABASE_URL = `https://${OWLIVO_SUPABASE_PROJECT_REF}.supabase.co`;

export const GOOGLE_LOGIN_SCOPES = ["openid", "email", "profile"] as const;

export const LOCAL_DATA_NOTICE =
  `登录后可把订阅列表同步到当前 ${PRODUCT_DISPLAY_NAME} 账号；阅读记录、时间线、个人设置以及雪球、微博或 X 的登录凭证仍只留在本机。未同步的订阅在卸载或清理后可能丢失。`;

export const LOCAL_DATA_LOGIN_HINT =
  "登录是可选的，不登录也会保留本机数据。首次把本机订阅合并到账号前会先显示当前 Google 账号并请你确认；不会上传第三方登录凭证，也不能把已登录理解为已做全部数据的云备份。";

export const ACCOUNT_DELETE_NOTICE =
  `删除的是 ${PRODUCT_DISPLAY_NAME} 云端登录账号，不会删除本机订阅、时间线、设置或阅读缓存，也不会清除第三方平台 Cookie。`;

export function isAllowedSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== `${OWLIVO_SUPABASE_PROJECT_REF}.supabase.co`) return false;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return false;
    return true;
  } catch {
    return false;
  }
}

export function supabaseHostPermissions(url: string): string[] {
  if (!isAllowedSupabaseUrl(url)) return [];
  return [`https://${OWLIVO_SUPABASE_PROJECT_REF}.supabase.co/*`];
}

function decodeJwtPayload(token: string): { role?: unknown; ref?: unknown } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as { role?: unknown; ref?: unknown };
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function isPublishableKey(key: string): boolean {
  const value = String(key || "").trim();
  if (!value) return false;
  if (value.startsWith("sb_secret_") || value.startsWith("sk_")) return false;
  if (value.startsWith("sb_publishable_")) return value.length > "sb_publishable_".length;
  const payload = decodeJwtPayload(value);
  if (!payload) return false;
  return payload.role === "anon" && payload.ref === OWLIVO_SUPABASE_PROJECT_REF;
}

export function isGoogleOAuthClientId(clientId: string): boolean {
  const value = String(clientId || "").trim();
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(value);
}

export function isAuthConfigured(url: string, key: string): boolean {
  return isAllowedSupabaseUrl(url) && isPublishableKey(key);
}

export function isGoogleLoginConfigured(url: string, key: string, clientId: string): boolean {
  return isAuthConfigured(url, key) && isGoogleOAuthClientId(clientId);
}

export function readAuthPublicEnv(source: Record<string, string | undefined>): {
  url: string;
  publishableKey: string;
  googleClientId: string;
} {
  return {
    url: String(source.WXT_PUBLIC_SUPABASE_URL || "").trim(),
    publishableKey: String(source.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim(),
    googleClientId: String(source.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "").trim(),
  };
}
