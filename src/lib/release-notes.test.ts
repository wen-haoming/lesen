import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReleaseByVersion, releaseNotesForVersion } from "./release-notes";
import { readPackageVersion } from "./read-package-version";

const changelogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../CHANGELOG.md");

describe("releaseNotesForVersion", () => {
  it("extracts notes only for versions present in CHANGELOG.md", () => {
    const markdown = readFileSync(changelogPath, "utf8");
    const version = readPackageVersion();
    const notes = releaseNotesForVersion(markdown, version);
    expect(notes).not.toBeNull();
    expect(notes).toContain(version);
    expect(notes).toContain("微博");
    expect(releaseNotesForVersion(markdown, "9.9.9")).toBeNull();
  });

  it("does not invent content for unknown versions", () => {
    const markdown = readFileSync(changelogPath, "utf8");
    expect(findReleaseByVersion(markdown, "1.8.5")?.blocks.some((b) => b.type === "list")).toBe(true);
    expect(findReleaseByVersion(markdown, "0.0.1")).toBeNull();
  });
});