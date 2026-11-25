import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideReleaseAction, extractStoreVersions } from "./cws-lib.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

describe("cws plan boundaries (mock status)", () => {
  it("skips when same version already published", () => {
    const status = JSON.parse(
      readFileSync(path.join(root, "fixtures/cws-store-published-1.8.4.mock.json"), "utf8"),
    );
    const store = extractStoreVersions(status);
    const d = decideReleaseAction({ localVersion: "1.8.4", store });
    expect(d.action).toBe("skip");
    expect(d.code).toBe("ALREADY_PUBLISHED");
  });

  it("fail-closed when another version is pending", () => {
    const status = JSON.parse(
      readFileSync(path.join(root, "fixtures/cws-other-version-pending.mock.json"), "utf8"),
    );
    const store = extractStoreVersions(status);
    const d = decideReleaseAction({ localVersion: "1.8.9", store });
    expect(d.action).toBe("fail");
    expect(d.code).toBe("OTHER_VERSION_PENDING");
  });
});