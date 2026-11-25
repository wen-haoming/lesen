import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./read-package-version.mjs";

const SCREENSHOT_ROOT = path.join(repoRoot, "release-screenshots");
const PUBLIC_DIR = path.join(SCREENSHOT_ROOT, "public");
const INCOMING_DIR = path.join(SCREENSHOT_ROOT, "incoming");
const MANIFEST_PATH = path.join(SCREENSHOT_ROOT, "manifest.json");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function screenshotRoots() {
  return { SCREENSHOT_ROOT, PUBLIC_DIR, INCOMING_DIR, MANIFEST_PATH };
}

function isImageFile(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function walkImages(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkImages(full));
    else if (entry.isFile() && isImageFile(entry.name)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function loadScreenshotManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function resolveScreenshotInputs() {
  const manifest = loadScreenshotManifest();
  const resolved = [];

  if (manifest?.files?.length) {
    for (const item of manifest.files) {
      if (item.role === "screenshot" || item.role === "marquee" || !item.role) {
        const rel = String(item.path || "");
        const abs = path.resolve(SCREENSHOT_ROOT, rel);
        if (!abs.startsWith(SCREENSHOT_ROOT)) continue;
        if (fs.existsSync(abs) && isImageFile(abs)) {
          resolved.push({ abs, label: item.label || path.basename(abs), fromManifest: true });
        }
      }
    }
  }

  if (!resolved.length) {
    const candidates = [...walkImages(PUBLIC_DIR), ...walkImages(INCOMING_DIR)];
    for (const abs of candidates) {
      resolved.push({ abs, label: path.basename(abs), fromManifest: false });
    }
  }

  return { manifest, screenshots: resolved };
}