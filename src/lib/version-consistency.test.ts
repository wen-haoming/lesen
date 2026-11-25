import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReleaseByVersion } from "./release-notes";
import { readPackageVersion } from "./read-package-version";
import { PRODUCT_VERSION } from "./product-version";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("version single source", () => {
  it("package.json matches wxt manifest version and latest CHANGELOG heading", () => {
    const version = readPackageVersion();
    const wxtConfig = readFileSync(path.join(root, "wxt.config.ts"), "utf8");
    expect(wxtConfig).toMatch(/version:\s*productVersion/);
    const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    const latest = findReleaseByVersion(changelog, version);
    expect(latest).not.toBeNull();
    expect(latest?.version).toBe(version);
  });

  it("build-time PRODUCT_VERSION matches package.json when define is set", () => {
    const version = readPackageVersion();
    if (PRODUCT_VERSION !== "0.0.0-dev") {
      expect(PRODUCT_VERSION).toBe(version);
    }
  });
});