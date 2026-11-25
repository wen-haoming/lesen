import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOwlivoAccountInBackground,
  signInWithGoogleInBackground,
  signOutOwlivoAccountInBackground,
} from "./owlivo-auth-runtime";

const account = { id: "user-1", email: null, nickname: "Reader", avatarUrl: null };
const extensionId = "abcdefghijklmnopabcdefghijklmnop";

describe("auth runtime response validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  function mockReply(response: unknown) {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: extensionId,
          lastError: null,
          sendMessage: vi.fn((_message, callback) => callback(response)),
        },
      },
    });
  }

  it("rejects missing, malformed, and status-inconsistent replies", async () => {
    mockReply({ ok: true });
    expect((await signInWithGoogleInBackground()).ok).toBe(false);
    mockReply({ ok: true, status: "signed_in", account: { ...account, access_token: "secret" } });
    expect(await getOwlivoAccountInBackground()).toBeNull();
    mockReply(undefined);
    expect(await getOwlivoAccountInBackground()).toBeNull();
    mockReply({ ok: true });
    expect(await signOutOwlivoAccountInBackground()).toMatchObject({ ok: false });
  });

  it("accepts only token-free account data from a valid background response", async () => {
    mockReply({ ok: true, status: "signed_in", account });
    expect(await getOwlivoAccountInBackground()).toEqual({ status: "signed_in", account });
    expect(await getOwlivoAccountInBackground()).not.toHaveProperty("access_token");
  });
});
