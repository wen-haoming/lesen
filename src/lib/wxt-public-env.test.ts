import { describe, expect, it } from "vitest";
import {
  isOfficialZipCommand,
  mergeWxtPublicEnvFiles,
  officialPackClientConflict,
  parseWxtPublicEnvFile,
  publicEnvFileNames,
} from "./wxt-public-env";

describe("wxt public env loading", () => {
  it("lists Vite-style files so mode-local can override .env.local", () => {
    expect(publicEnvFileNames("production")).toEqual([
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ]);
  });

  it("lets later files override earlier files, while existing process.env wins", () => {
    const parsed = parseWxtPublicEnvFile(`
# comment
WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=111-dev.apps.googleusercontent.com
IGNORED=no
WXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
`);
    expect(parsed.IGNORED).toBeUndefined();
    expect(parsed.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID).toBe("111-dev.apps.googleusercontent.com");

    const merged = mergeWxtPublicEnvFiles(
      [
        { WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "111-dev.apps.googleusercontent.com", WXT_PUBLIC_A: "from-local" },
        { WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: "222-prod.apps.googleusercontent.com", WXT_PUBLIC_B: "from-prod" },
      ],
      { WXT_PUBLIC_A: "from-shell" },
    );
    expect(merged.WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID).toBe("222-prod.apps.googleusercontent.com");
    expect(merged.WXT_PUBLIC_A).toBe("from-shell");
    expect(merged.WXT_PUBLIC_B).toBe("from-prod");
  });

  it("detects official zip commands and refuses packing the dev Google client", () => {
    expect(isOfficialZipCommand(["node", "wxt", "zip"], undefined)).toBe(true);
    expect(isOfficialZipCommand(["node", "wxt", "build"], "build")).toBe(false);
    expect(isOfficialZipCommand(["node", "wxt", "build"], "zip")).toBe(true);
    expect(
      officialPackClientConflict(
        "111-dev.apps.googleusercontent.com",
        "111-dev.apps.googleusercontent.com",
      ),
    ).toMatch(/dev Google OAuth client/);
    expect(
      officialPackClientConflict(
        "222-prod.apps.googleusercontent.com",
        "111-dev.apps.googleusercontent.com",
      ),
    ).toBeNull();
  });
});
