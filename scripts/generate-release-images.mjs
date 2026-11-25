#!/usr/bin/env node
/**
 * Release / store images from release-screenshots/ only (real UI). No fabricated UI.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";
import { resolveScreenshotInputs, screenshotRoots } from "./lib/store-images.mjs";

const version = readPackageVersion();
const outDir = path.join(repoRoot, "dist-artifacts", "store-images");
const sourceDir = path.join(outDir, "source");
const marqueeDir = path.join(outDir, "store-1280x800");
const tileDir = path.join(outDir, "store-440x280");

for (const dir of [outDir, sourceDir, marqueeDir, tileDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const iconPath = path.join(repoRoot, "icons", "icon128.png");
const { manifest, screenshots } = resolveScreenshotInputs();
const provenancePath = manifest?.provenance
  ? path.join(repoRoot, "release-screenshots", manifest.provenance)
  : path.join(repoRoot, "release-screenshots", "public", `v${version}`, "PROVENANCE.json");
const provenance = fs.existsSync(provenancePath)
  ? JSON.parse(fs.readFileSync(provenancePath, "utf8"))
  : null;

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function storeMarqueeFlag(input) {
  if (!manifest?.files?.length) return false;
  const rel = path
    .relative(path.join(repoRoot, "release-screenshots"), input.abs)
    .replace(/\\/g, "/");
  const entry = manifest.files.find((f) => f.path === rel);
  return Boolean(entry?.storeMarquee);
}

async function fitCanvas(inputPath, outPath, width, height) {
  const bg = { r: 248, g: 250, b: 252, alpha: 1 };
  const fitted = await sharp(inputPath)
    .resize(width, height, { fit: "contain", background: bg })
    .png()
    .toBuffer();
  await sharp(fitted).png().toFile(outPath);
}

const assetRecords = [];

async function processScreenshot(input, index) {
  const base = path.basename(input.abs, path.extname(input.abs));
  const meta = await sharp(input.abs).metadata();
  const sourceName = `${String(index + 1).padStart(2, "0")}-${base}.png`;
  const sourceOut = path.join(sourceDir, sourceName);
  await sharp(input.abs).png().toFile(sourceOut);
  const sourceSha = sha256File(sourceOut);

  const record = {
    file: sourceName,
    kind: "ui-screenshot-source",
    source: path.relative(repoRoot, input.abs),
    label: input.label,
    originalWidth: meta.width,
    originalHeight: meta.height,
    sha256: sourceSha,
  };

  const marqueeName = `${String(index + 1).padStart(2, "0")}-${base}-1280x800.png`;
  const marqueeOut = path.join(marqueeDir, marqueeName);
  await fitCanvas(input.abs, marqueeOut, 1280, 800);
  record.marquee1280 = { file: marqueeName, sha256: sha256File(marqueeOut) };

  if (storeMarqueeFlag(input) || index < 4) {
    const tileName = `${String(index + 1).padStart(2, "0")}-${base}-440x280.png`;
    const tileOut = path.join(tileDir, tileName);
    await fitCanvas(input.abs, tileOut, 440, 280);
    record.tile440 = { file: tileName, sha256: sha256File(tileOut) };
  }

  assetRecords.push(record);
  return record;
}

for (let i = 0; i < screenshots.length; i++) {
  await processScreenshot(screenshots[i], i);
}

const iconOut = path.join(outDir, "store-icon-128.png");
await sharp(iconPath).resize(128, 128).png().toFile(iconOut);
assetRecords.push({
  file: "store-icon-128.png",
  kind: "icon",
  source: "icons/icon128.png",
  sha256: sha256File(iconOut),
});

const sums = [];
for (const dir of [sourceDir, marqueeDir, tileDir, outDir]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".png")) continue;
    const full = path.join(dir, name);
    sums.push(`${sha256File(full)}  ${path.relative(outDir, full)}`);
  }
}
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, "utf8");

if (provenance) {
  fs.copyFileSync(provenancePath, path.join(outDir, "PROVENANCE.json"));
}

const roots = screenshotRoots();
const meta = {
  version,
  generatedAt: new Date().toISOString(),
  mode: screenshots.length ? "ui-screenshots" : "placeholder-pending-screenshots",
  screenshotInputRoot: path.relative(repoRoot, roots.SCREENSHOT_ROOT),
  manifestPresent: Boolean(manifest),
  provenance: provenance || null,
  fitPolicy: "contain with #f8fafc letterbox (no stretch)",
  assets: assetRecords,
  pendingRealUi: screenshots.length === 0,
};
if (!screenshots.length) {
  meta.notice =
    "No UI screenshots in release-screenshots/public/ — add PNGs and manifest, then re-run.";
}

fs.writeFileSync(path.join(outDir, "SOURCES.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
console.log("[generate-release-images] OK");
console.log(JSON.stringify({ mode: meta.mode, count: screenshots.length, outDir: path.relative(repoRoot, outDir) }));