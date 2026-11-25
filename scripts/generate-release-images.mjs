#!/usr/bin/env node
/**
 * Release / store images: real UI from release-screenshots/ only.
 * No fabricated product UI. Fallback: repo icon + optional CHANGELOG version card.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";
import { findReleaseSection } from "./lib/changelog-release-notes.mjs";
import { resolveScreenshotInputs, screenshotRoots } from "./lib/store-images.mjs";

const version = readPackageVersion();
const outDir = path.join(repoRoot, "dist-artifacts", "store-images");
fs.mkdirSync(outDir, { recursive: true });

const iconPath = path.join(repoRoot, "icons", "icon128.png");
if (!fs.existsSync(iconPath)) {
  console.error("icons/icon128.png missing");
  process.exit(1);
}

const { manifest, screenshots } = resolveScreenshotInputs();
const assetRecords = [];

async function copyScreenshot(input, index) {
  const baseName = `screenshot-${String(index + 1).padStart(2, "0")}-${path.basename(input.abs, path.extname(input.abs))}.png`;
  const outPath = path.join(outDir, baseName);
  await sharp(input.abs).png().toFile(outPath);
  assetRecords.push({
    file: baseName,
    kind: "ui-screenshot",
    source: path.relative(repoRoot, input.abs),
    label: input.label,
  });
  return outPath;
}

async function writeIcon() {
  const outPath = path.join(outDir, "store-icon-128.png");
  await sharp(iconPath).resize(128, 128).png().toFile(outPath);
  assetRecords.push({ file: "store-icon-128.png", kind: "icon", source: "icons/icon128.png" });
  return outPath;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeVersionCard() {
  const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const section = findReleaseSection(changelog, version) || "";
  const bullets = section
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .slice(0, 4);
  const bulletSvg = bullets.length
    ? bullets
        .map((b, i) => `<text x="48" y="${160 + i * 32}" font-size="20" fill="#334155" font-family="system-ui,sans-serif">${escapeXml(b)}</text>`)
        .join("\n")
    : `<text x="48" y="160" font-size="20" fill="#64748b" font-family="system-ui,sans-serif">见 CHANGELOG.md</text>`;

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="880" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="48" y="72" font-size="32" font-weight="700" fill="#0f172a" font-family="system-ui,sans-serif">Lesen · 莱森 v${escapeXml(version)}</text>
  <text x="48" y="108" font-size="16" fill="#64748b" font-family="system-ui,sans-serif">版本说明卡（非产品界面截图）</text>
  ${bulletSvg}
</svg>`);
  const outPath = path.join(outDir, "version-card-changelog.png");
  await sharp(svg).png().toFile(outPath);
  assetRecords.push({
    file: "version-card-changelog.png",
    kind: "version-card",
    source: `CHANGELOG.md#${version}`,
  });
  return outPath;
}

for (let i = 0; i < screenshots.length; i++) {
  await copyScreenshot(screenshots[i], i);
}
await writeIcon();
await writeVersionCard();

const roots = screenshotRoots();
const meta = {
  version,
  generatedAt: new Date().toISOString(),
  mode: screenshots.length ? "ui-screenshots" : "placeholder-pending-screenshots",
  screenshotInputRoot: path.relative(repoRoot, roots.SCREENSHOT_ROOT),
  manifestPresent: Boolean(manifest),
  assets: assetRecords,
  pendingRealUi: screenshots.length === 0,
  instructions:
    "Add sanitized PNGs under release-screenshots/public/ (see release-screenshots/README.md). Re-run pnpm release:images.",
};
if (!screenshots.length) {
  meta.notice =
    "No UI screenshots in release-screenshots/public/ or incoming/ — only icon + changelog version card were emitted.";
}

fs.writeFileSync(path.join(outDir, "SOURCES.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
console.log("[generate-release-images] OK");
console.log(JSON.stringify(meta, null, 2));