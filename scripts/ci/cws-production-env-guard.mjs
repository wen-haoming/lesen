#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWxtPublicEnvFile } from "../lib/wxt-public-env-bridge.mjs";
import { evaluateProductionEnvGuard } from "../lib/production-env-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return {};
  return parseWxtPublicEnvFile(fs.readFileSync(file, "utf8"));
}

const merged = { ...loadEnv(".env"), ...loadEnv(".env.production"), ...loadEnv(".env.production.local") };
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("WXT_PUBLIC_") && value) merged[key] = value;
}

const trusted = {
  CWS_TRUSTED_SUPABASE_URL: process.env.CWS_TRUSTED_SUPABASE_URL || "",
  CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY: process.env.CWS_TRUSTED_SUPABASE_PUBLISHABLE_KEY || "",
  CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID: process.env.CWS_TRUSTED_GOOGLE_OAUTH_CLIENT_ID || "",
};
const requireTrusted =
  process.env.CWS_REQUIRE_TRUSTED_BINDINGS === "1" || process.env.CWS_REQUIRE_TRUSTED_BINDINGS === "true";

const result = evaluateProductionEnvGuard({
  wxtPublic: merged,
  localDevClientId: loadEnv(".env.local").WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "",
  trusted,
  requireTrusted,
});

if (!result.ok) {
  console.error("[cws-production-env-guard] FAIL");
  for (const e of result.errors) console.error(" -", e);
  process.exit(1);
}
console.log("[cws-production-env-guard] OK", requireTrusted ? "(trusted bindings verified)" : "(structure only)");