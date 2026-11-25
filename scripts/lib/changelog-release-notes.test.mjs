import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReleaseSection } from "./changelog-release-notes.mjs";
import { readPackageVersion } from "./read-package-version.mjs";

const changelogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../CHANGELOG.md");

describe("changelog-release-notes.mjs", () => {
  it("extracts the current package version section only from CHANGELOG.md", () => {
    const markdown = readFileSync(changelogPath, "utf8");
    const version = readPackageVersion();
    const notes = findReleaseSection(markdown, version);
    expect(notes).toContain(version);
    expect(notes).toContain("- ");
    expect(findReleaseSection(markdown, "99.0.0")).toBeNull();
  });
});