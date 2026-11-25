#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";
import { findReleaseSection } from "./lib/changelog-release-notes.mjs";

const errors = [];
const version = readPackageVersion();

const manifestPath = path.join(repoRoot, ".output", "chrome-mv3", "manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version !== version) {
    errors.push(`manifest.json version ${manifest.version} != package.json ${version}`);
  }
} else {
  errors.push(".output/chrome-mv3/manifest.json missing (run pnpm build first for build verification)");
}

const wxtConfig = fs.readFileSync(path.join(repoRoot, "wxt.config.ts"), "utf8");
if (!/version:\s*productVersion/.test(wxtConfig)) {
  errors.push("wxt.config.ts must set manifest.version from package.json productVersion");
}

const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
if (!findReleaseSection(changelog, version)) {
  errors.push(`CHANGELOG.md has no ## ${version} section`);
}

const firstHeading = changelog.match(/^##\s+(\d+\.\d+\.\d+)/m);
if (firstHeading && firstHeading[1] !== version) {
  errors.push(`CHANGELOG.md top release ${firstHeading[1]} != package.json ${version}`);
}

if (errors.length) {
  console.error("[verify-versions] FAILED");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[verify-versions] OK", version);