#!/usr/bin/env node
/**
 * After `pnpm build` (and optional `pnpm exec wxt zip` for store zip), produce:
 * - lesen-<version>-unpacked.tar.gz   (sideload / QA)
 * - lesen-<version>-source.tar.gz     (git archive)
 * - lesen-<version>-chrome-store.zip  (only when present — official production pack)
 * - SHA256SUMS.txt
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";

const version = readPackageVersion();
const outDir = path.join(repoRoot, "dist-artifacts");
const unpackedDir = path.join(repoRoot, ".output", "chrome-mv3");

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: repoRoot, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with ${res.status}`);
  }
}

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(unpackedDir)) {
  console.error("Missing .output/chrome-mv3 — run pnpm build first");
  process.exit(1);
}

const unpackedArchive = path.join(outDir, `lesen-${version}-unpacked.tar.gz`);
run("tar", ["-czf", unpackedArchive, "-C", path.join(repoRoot, ".output"), "chrome-mv3"]);

const sourceArchive = path.join(outDir, `lesen-${version}-source.tar.gz`);
run("git", ["archive", "--format=tar.gz", "-o", sourceArchive, "HEAD"]);

const sums = [];
const entries = [
  { name: path.basename(unpackedArchive), path: unpackedArchive, kind: "unpacked" },
  { name: path.basename(sourceArchive), path: sourceArchive, kind: "source" },
];

const zipCandidates = fs
  .readdirSync(path.join(repoRoot, ".output"))
  .filter((name) => name.endsWith(".zip"))
  .map((name) => path.join(repoRoot, ".output", name));

let storeZip = null;
for (const candidate of zipCandidates) {
  if (candidate.includes("chrome")) {
    storeZip = path.join(outDir, `lesen-${version}-chrome-store.zip`);
    fs.copyFileSync(candidate, storeZip);
    entries.push({ name: path.basename(storeZip), path: storeZip, kind: "chrome-store" });
    break;
  }
}

for (const entry of entries) {
  sums.push(`${sha256File(entry.path)}  ${entry.name}`);
}

const sumsPath = path.join(outDir, "SHA256SUMS.txt");
fs.writeFileSync(sumsPath, sums.join("\n") + "\n", "utf8");

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  artifacts: entries.map((e) => ({
    file: e.name,
    kind: e.kind,
    sha256: sha256File(e.path),
  })),
  chromeStoreZipIncluded: Boolean(storeZip),
  notes: storeZip
    ? "chrome-store zip is an official production pack when built with production WXT_PUBLIC_* and wxt zip."
    : "No chrome-store zip in this run (expected for default local/CI build without production secrets).",
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log("[package-artifacts] OK");
console.log(JSON.stringify(manifest, null, 2));