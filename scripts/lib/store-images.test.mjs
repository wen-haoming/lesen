import { describe, expect, it } from "vitest";
import { resolveScreenshotInputs, screenshotRoots } from "./store-images.mjs";
import path from "node:path";
import fs from "node:fs";

describe("store-images inputs", () => {
  it("exposes release-screenshots directory entry points", () => {
    const { SCREENSHOT_ROOT, PUBLIC_DIR } = screenshotRoots();
    expect(fs.existsSync(SCREENSHOT_ROOT)).toBe(true);
    expect(fs.existsSync(PUBLIC_DIR)).toBe(true);
  });

  it("loads v1.8.9 public T-11 screenshots from manifest", () => {
    const { screenshots, manifest } = resolveScreenshotInputs();
    expect(manifest?.version).toBe("1.8.9");
    expect(screenshots.length).toBe(10);
    expect(screenshots[0].abs).toContain("01-homeboard-redacted.png");
    expect(fs.existsSync(path.join(screenshotRoots().SCREENSHOT_ROOT, "public/v1.8.9/PROVENANCE.json"))).toBe(true);
  });
});