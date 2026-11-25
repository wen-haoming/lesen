import { describe, expect, it } from "vitest";
import { resolveScreenshotInputs, screenshotRoots } from "./store-images.mjs";
import path from "node:path";
import fs from "node:fs";

describe("store-images inputs", () => {
  it("exposes release-screenshots directory entry points", () => {
    const { SCREENSHOT_ROOT, PUBLIC_DIR } = screenshotRoots();
    expect(fs.existsSync(SCREENSHOT_ROOT)).toBe(true);
    expect(fs.existsSync(PUBLIC_DIR)).toBe(true);
    expect(fs.existsSync(path.join(SCREENSHOT_ROOT, "README.md"))).toBe(true);
  });

  it("returns empty screenshots until public pack is committed", () => {
    const { screenshots } = resolveScreenshotInputs();
    expect(screenshots).toEqual([]);
  });
});