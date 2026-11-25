#!/usr/bin/env node
/**
 * Scan build outputs for accidental secrets, env dumps, or local absolute paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const FORBIDDEN = [
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /(?:^|[^a-zA-Z])CWS_CLIENT_SECRET\s*[:=]/i,
  /(?:^|[^a-zA-Z])CHROME_CLIENT_SECRET\s*[:=]/i,
  /(?:^|[^:])\/Users\/[A-Za-z0-9_-]+\//,
  /(?:^|[^:])\/home\/(?:ubuntu|runner|haoming|me)\//,
  /WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*\S{20,}/,
  /WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID\s*=\s*\S{20,}/,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scanText(file, text) {
  const rel = path.relative(root, file);
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      errors.push(`${rel}: matched ${re}`);
      return;
    }
  }
}

const targets = [path.join(root, "dist-artifacts")];
if (process.env.SCAN_BUILD_OUTPUT === "1") {
  targets.push(path.join(root, ".output", "chrome-mv3"));
}

for (const dir of targets) {
  for (const file of walk(dir)) {
  if (!/\.(js|html|css|json|png|txt|zip)$/i.test(file)) continue;
    const buf = fs.readFileSync(file);
    if (file.endsWith(".zip")) {
      if (buf.includes("sb_secret_") || buf.includes("refresh_token")) {
        errors.push(`${path.relative(root, file)}: zip may contain secret markers`);
      }
      continue;
    }
    scanText(file, buf.toString("utf8"));
  }
}

if (errors.length) {
  console.error("[scan-release-artifacts] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[scan-release-artifacts] OK");