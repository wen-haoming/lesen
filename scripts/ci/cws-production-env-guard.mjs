#!/usr/bin/env node
/**
 * Refuses official store pack without production WXT_PUBLIC_* (not dev .env.local client).
 * Does not print secret values. CWS publisher OAuth is separate from product Google OAuth.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWxtPublicEnvFile, officialPackClientConflict } from "../lib/wxt-public-env-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return {};
  return parseWxtPublicEnvFile(fs.readFileSync(file, "utf8"));
}

function isGoogleLoginConfigured(supabaseUrl, publishableKey, clientId) {
  return Boolean(
    supabaseUrl &&
      publishableKey &&
      clientId &&
      /^https:\/\//.test(supabaseUrl),
  );
}

const merged = { ...loadEnv(".env"), ...loadEnv(".env.production"), ...loadEnv(".env.production.local") };
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("WXT_PUBLIC_") && value) merged[key] = value;
}

const supabaseUrl = merged.WXT_PUBLIC_SUPABASE_URL || "";
const publishable = merged.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const prodClient = merged.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";
const localDev = loadEnv(".env.local").WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";

const errors = [];
if (!isGoogleLoginConfigured(supabaseUrl, publishable, prodClient)) {
  errors.push(
    "正式 zip 需要 WXT_PUBLIC_SUPABASE_URL、WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY、生产 WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
  );
}
const conflict = officialPackClientConflict(prodClient, localDev);
if (conflict) errors.push(conflict.split("\n")[0]);

if (errors.length) {
  console.error("[cws-production-env-guard] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[cws-production-env-guard] OK");