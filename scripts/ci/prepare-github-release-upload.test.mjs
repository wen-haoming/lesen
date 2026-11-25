import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReleaseSha256SumsFile,
  parsePackageSums,
  prepareGithubReleaseUpload,
  RELEASE_UPLOAD_FILE_COUNT,
  sideloadZipName,
} from "./prepare-github-release-upload.mjs";

describe("prepare-github-release-upload", () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("parsePackageSums picks sideload line only", () => {
    const h = "a".repeat(64);
    const name = "lesen-1.0.0-sideload-chrome-mv3.zip";
    const text = `${"b".repeat(64)}  other.tar.gz\n${h}  ${name}\n`;
    const r = parsePackageSums(text, name);
    expect(r).toEqual({ hash: h, name });
  });

  it("prepareGithubReleaseUpload emits exactly two files with matching sha", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lesen-rel-upload-"));
    tmpDirs.push(root);
    const ver = "9.9.9";
    const name = sideloadZipName(ver);
    const zipPath = path.join(root, name);
    fs.writeFileSync(zipPath, "zip-bytes");
    const dead = "d".repeat(64);
    const realHash = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    fs.writeFileSync(
      path.join(root, "SHA256SUMS.txt"),
      `${dead}  lesen-${ver}-source.tar.gz\n${realHash}  ${name}\n`,
    );
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        version: ver,
        artifacts: [{ file: name, kind: "sideload-zip", sha256: realHash }],
      }),
    );

    const out = path.join(root, "upload");
    const result = prepareGithubReleaseUpload({ distDir: root, version: ver, outDir: out });
    expect(result.files).toHaveLength(RELEASE_UPLOAD_FILE_COUNT);
    expect(fs.readFileSync(path.join(out, "SHA256SUMS.txt"), "utf8")).toBe(
      buildReleaseSha256SumsFile({ hash: realHash, name }),
    );
  });
});