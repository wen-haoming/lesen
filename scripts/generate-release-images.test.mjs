import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = path.join(root, "dist-artifacts", "store-images", "SOURCES.json");

describe("generate-release-images output", () => {
  it("expects ui-screenshots mode after pipeline run", () => {
    if (!fs.existsSync(sources)) return;
    const meta = JSON.parse(fs.readFileSync(sources, "utf8"));
    expect(meta.mode).toBe("ui-screenshots");
    expect(meta.pendingRealUi).toBe(false);
    expect(meta.assets.length).toBeGreaterThanOrEqual(10);
    expect(meta.fitPolicy).toContain("contain");
  });
});