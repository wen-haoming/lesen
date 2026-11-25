#!/usr/bin/env node
/**
 * Fail closed when CI claimed an artifact drill but did not produce real outputs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist-artifacts");
const storeImages = path.join(dist, "store-images");
const sourcesPath = path.join(storeImages, "SOURCES.json");
const manifestPath = path.join(root, "release-screenshots", "manifest.json");

function fail(msg) {
  console.error(`[assert-release-artifact-drill] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(dist)) {
  fail("missing dist-artifacts/ — run package-artifacts + generate-release-images first");
}

const unpacked = fs.readdirSync(dist).some((n) => /-unpacked\.tar\.gz$/i.test(n));
if (!unpacked) {
  fail("missing *-unpacked.tar.gz in dist-artifacts/");
}

if (!fs.existsSync(sourcesPath)) {
  fail("missing dist-artifacts/store-images/SOURCES.json");
}

const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
if (sources.mode !== "ui-screenshots") {
  fail(`SOURCES.json mode must be ui-screenshots, got ${sources.mode}`);
}
if (sources.pendingRealUi) {
  fail("SOURCES.json pendingRealUi must be false");
}
if (!Array.isArray(sources.assets) || sources.assets.length < 10) {
  fail("expected >= 10 ui screenshot assets in SOURCES.json");
}

const marqueeDir = path.join(storeImages, "store-1280x800");
if (!fs.existsSync(marqueeDir) || fs.readdirSync(marqueeDir).filter((n) => n.endsWith(".png")).length < 10) {
  fail("missing store-1280x800 PNG outputs");
}

if (fs.existsSync(manifestPath) && !sources.manifestPresent) {
  fail("release-screenshots/manifest.json present but SOURCES.json manifestPresent is false");
}

const sums = path.join(dist, "store-images", "SHA256SUMS.txt");
if (!fs.existsSync(sums)) {
  fail("missing store-images/SHA256SUMS.txt");
}

console.log("[assert-release-artifact-drill] OK");