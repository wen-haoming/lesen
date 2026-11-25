#!/usr/bin/env node
/**
 * Upload (and optionally submit) a store zip to Chrome Web Store.
 * Requires OAuth refresh token with chrome.webstore scope — never run on pull_request.
 */
import fs from "node:fs";
import path from "node:path";
import chromeWebstoreUpload from "chrome-webstore-upload";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";

const extensionId = process.env.CHROME_EXTENSION_ID || "dakdgplahfkbblfpafdjeipneioajgdf";
const clientId = process.env.CHROME_CLIENT_ID;
const clientSecret = process.env.CHROME_CLIENT_SECRET;
const refreshToken = process.env.CHROME_REFRESH_TOKEN;
const publish = process.env.CWS_PUBLISH === "true";

const required = { clientId, clientSecret, refreshToken };
for (const [key, value] of Object.entries(required)) {
  if (!value) {
    console.error(`Missing secret env: ${key === "clientId" ? "CHROME_CLIENT_ID" : key === "clientSecret" ? "CHROME_CLIENT_SECRET" : "CHROME_REFRESH_TOKEN"}`);
    process.exit(2);
  }
}

const version = readPackageVersion();
const zipPath =
  process.argv[2] ||
  path.join(repoRoot, "dist-artifacts", `lesen-${version}-chrome-store.zip`);

if (!fs.existsSync(zipPath)) {
  console.error(`Store zip not found: ${zipPath}`);
  process.exit(1);
}

const store = chromeWebstoreUpload({
  extensionId,
  clientId,
  clientSecret,
  refreshToken,
});

const zip = fs.readFileSync(zipPath);

console.log(`[cws] uploading ${path.basename(zipPath)} to extension ${extensionId}`);
const uploadResult = await store.uploadExisting(zip);
console.log("[cws] upload OK", uploadResult);

if (publish) {
  console.log("[cws] submitting for review (publish)");
  const publishResult = await store.publish();
  console.log("[cws] publish requested", publishResult);
} else {
  console.log("[cws] upload only — draft not auto-submitted (set CWS_PUBLISH=true to submit)");
}