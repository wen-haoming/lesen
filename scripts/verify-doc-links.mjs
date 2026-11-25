#!/usr/bin/env node
/**
 * Check relative links in README*.md and key docs resolve to files in repo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "README.md",
  "README.en.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/RELEASE_DOWNLOADS.md",
  "release-screenshots/README.md",
];

const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
const errors = [];

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const dir = path.dirname(filePath);
  let m;
  while ((m = linkRe.exec(text))) {
    let href = m[1].trim();
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
    href = href.split("#")[0];
    if (!href) continue;
    const resolved = path.resolve(dir, href);
    if (!fs.existsSync(resolved)) {
      errors.push(`${path.relative(root, filePath)}: broken link ${m[1]}`);
    }
  }
}

for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    errors.push(`missing doc ${rel}`);
    continue;
  }
  checkFile(full);
}

if (errors.length) {
  console.error("[verify-doc-links] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[verify-doc-links] OK");