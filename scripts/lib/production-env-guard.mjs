import { officialPackClientConflict, parseWxtPublicEnvFile } from "./wxt-public-env-bridge.mjs";

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i++) out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return out === 0;
}

export function isGoogleLoginConfigured(supabaseUrl, publishableKey, clientId) {
  return Boolean(
    supabaseUrl && publishableKey && clientId && /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(supabaseUrl.trim()),
  );
}

export function validateTrustedBindings(wxtPublic, trusted, { requireTrusted = false } = {}) {
  const errors = [];
  const supabaseUrl = wxtPublic.WXT_PUBLIC_SUPABASE_URL || "";
  const publishable = wxtPublic.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const prodClient = wxtPublic.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";

  if (!isGoogleLoginConfigured(supabaseUrl, publishable, prodClient)) {
    errors.push(
      "正式 zip 需要有效 WXT_PUBLIC_SUPABASE_URL（https://<ref>.supabase.co/）、WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY、生产 WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
    );
  }

  const trustedUrl = trusted.CWS_TRUSTED_SUPABASE_URL || trusted.WXT_TRUSTED_SUPABASE_URL || "";
  const trustedKey = trusted.CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY || "";
  const trustedClient = trusted.CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID || "";

  if (requireTrusted) {
    if (!trustedUrl || !trustedKey || !trustedClient) {
      errors.push(
        "live 路径必须在 Environment 配置 CWS_TRUSTED_SUPABASE_URL、CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY、CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID（不写入公开仓库）",
      );
    } else {
      if (!timingSafeEqual(supabaseUrl, trustedUrl)) {
        errors.push("WXT_PUBLIC_SUPABASE_URL 与 CWS_TRUSTED_SUPABASE_URL 不一致");
      }
      if (!timingSafeEqual(publishable, trustedKey)) {
        errors.push("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 与受信值不一致");
      }
      if (!timingSafeEqual(prodClient, trustedClient)) {
        errors.push("WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID 与 CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID 不一致");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function evaluateProductionEnvGuard({
  wxtPublic,
  localDevClientId = "",
  trusted = {},
  requireTrusted = false,
}) {
  const errors = [];
  const conflict = officialPackClientConflict(
    wxtPublic.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "",
    localDevClientId,
  );
  if (conflict) errors.push(conflict.split("\n")[0]);

  const binding = validateTrustedBindings(wxtPublic, trusted, { requireTrusted });
  errors.push(...binding.errors);

  return { ok: errors.length === 0, errors };
}

export function loadMergedWxtPublicEnv({ root, readFile }) {
  const names = [".env", ".env.production", ".env.production.local"];
  const merged = {};
  for (const name of names) {
    const file = `${root}/${name}`;
    if (!readFile(file)) continue;
    Object.assign(merged, parseWxtPublicEnvFile(readFile(file)));
  }
  return merged;
}