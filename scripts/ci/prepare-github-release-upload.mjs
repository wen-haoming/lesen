#!/usr/bin/env node
/**
 * Copy a minimal, user-facing GitHub Release upload set from dist-artifacts/.
 * Store screenshots and CI drill metadata stay in Actions artifacts only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion } from "../lib/read-package-version.mjs";

export const RELEASE_UPLOAD_FILE_COUNT = 2;
export const RELEASE_SHA256SUMS_NAME = "SHA256SUMS.txt";

export function sideloadZipName(version) {
  return `lesen-${version}-sideload-chrome-mv3.zip`;
}

export function parsePackageSums(text, sideloadName) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([a-f0-9]{64})\s{2,}(.+)$/.exec(line);
    if (m && m[2] === sideloadName) return { hash: m[1], name: m[2] };
  }
  return null;
}

export function buildReleaseSha256SumsFile({ hash, name }) {
  return `${hash}  ${name}\n`;
}

/**
 * @param {{ distDir: string, version?: string, outDir: string }} opts
 * @returns {{ files: string[], sideloadSha256: string }}
 */
export function prepareGithubReleaseUpload({ distDir, version, outDir }) {
  const ver = version || readPackageVersion();
  const sideloadName = sideloadZipName(ver);
  const sideloadPath = path.join(distDir, sideloadName);
  const manifestPath = path.join(distDir, "manifest.json");
  const sumsPath = path.join(distDir, "SHA256SUMS.txt");

  if (!fs.existsSync(sideloadPath)) {
    throw new Error(`Missing sideload zip: ${sideloadPath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${distDir}`);
  }
  if (!fs.existsSync(sumsPath)) {
    throw new Error(`Missing package SHA256SUMS.txt in ${distDir}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sideloadEntry = manifest.artifacts?.find((a) => a.kind === "sideload-zip");
  if (!sideloadEntry || sideloadEntry.file !== sideloadName) {
    throw new Error(`manifest.json missing sideload-zip entry for ${sideloadName}`);
  }

  const parsed = parsePackageSums(fs.readFileSync(sumsPath, "utf8"), sideloadName);
  if (!parsed) {
    throw new Error(`Package SHA256SUMS.txt has no line for ${sideloadName}`);
  }
  if (parsed.hash !== sideloadEntry.sha256) {
    throw new Error(`SHA256 mismatch: manifest ${sideloadEntry.sha256} vs sums ${parsed.hash}`);
  }

  const liveHash = createHash("sha256")
    .update(fs.readFileSync(sideloadPath))
    .digest("hex");
  if (liveHash !== sideloadEntry.sha256) {
    throw new Error(`Sideload zip on disk hash ${liveHash} != manifest ${sideloadEntry.sha256}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const uploadZip = path.join(outDir, sideloadName);
  const uploadSums = path.join(outDir, RELEASE_SHA256SUMS_NAME);
  fs.copyFileSync(sideloadPath, uploadZip);
  fs.writeFileSync(uploadSums, buildReleaseSha256SumsFile(parsed), "utf8");

  const files = fs.readdirSync(outDir).filter((n) => fs.statSync(path.join(outDir, n)).isFile()).sort();
  if (files.length !== RELEASE_UPLOAD_FILE_COUNT) {
    throw new Error(`Expected ${RELEASE_UPLOAD_FILE_COUNT} upload files, got ${files.length}: ${files.join(", ")}`);
  }
  if (files[0] !== RELEASE_SHA256SUMS_NAME || files[1] !== sideloadName) {
    throw new Error(`Unexpected upload file names: ${files.join(", ")}`);
  }

  return { files, sideloadSha256: liveHash };
}

function main() {
  const distDir = process.argv[2] || path.join(process.cwd(), "dist-artifacts");
  const outDir = process.argv[3] || path.join(process.cwd(), "upload");
  const result = prepareGithubReleaseUpload({ distDir, outDir });
  console.log("[prepare-github-release-upload] OK", JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e?.message || e));
    process.exit(1);
  }
}