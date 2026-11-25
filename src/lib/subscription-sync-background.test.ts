import { afterEach, describe, expect, it, vi } from "vitest";
import { installSubscriptionSyncHooks } from "./subscription-sync-background";
import { resetSubscriptionSyncQueueForTests } from "./subscription-sync-queue";
import { getOwlivoAccount } from "./owlivo-auth";
import {
  createSupabaseSubscriptionApi,
  handleSignedIn,
  handleSignedOut,
  readMergePrompt,
} from "./subscription-sync";

vi.mock("./owlivo-auth", () => ({ getOwlivoAccount: vi.fn() }));
vi.mock("./owlivo-auth-background", () => ({
  isTrustedAuthSender: (sender: { id?: string; url?: string }, runtimeId?: string) =>
    sender.id === runtimeId &&
    typeof sender.url === "string" &&
    sender.url.startsWith(`chrome-extension://${runtimeId}/`),
}));
vi.mock("./subscription-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subscription-sync")>();
  return {
    ...actual,
    confirmFirstMerge: vi.fn(),
    createSupabaseSubscriptionApi: vi.fn(),
    declineFirstMerge: vi.fn(),
    flushPendingOps: vi.fn(),
    handleSignedIn: vi.fn(),
    handleSignedOut: vi.fn(),
    applyLocalSubscriptionChange: vi.fn().mockResolvedValue(true),
    readMergePrompt: vi.fn(),
  };
});

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

describe("subscription sync runtime gate", () => {
  afterEach(() => {
    resetSubscriptionSyncQueueForTests();
    vi.resetAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  function install() {
    const addListener = vi.fn();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: extensionId,
          onMessage: { addListener },
          onStartup: { addListener: vi.fn() },
          onInstalled: { addListener: vi.fn() },
        },
        alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      },
    });
    installSubscriptionSyncHooks();
    return addListener.mock.calls[0][0] as (
      message: unknown,
      sender: { id?: string; url?: string },
      sendResponse: (response: unknown) => void,
    ) => boolean | void;
  }

  it("does not claim unknown or untrusted actions and responds to trusted allowlisted requests", async () => {
    vi.mocked(getOwlivoAccount).mockResolvedValue({ status: "signed_out", account: null } as never);
    vi.mocked(createSupabaseSubscriptionApi).mockReturnValue(null);
    const listener = install();
    const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
    expect(listener({ type: "owlivo-subscription-sync:future-action" }, sender, vi.fn())).toBe(
      false,
    );
    const untrustedResponse = vi.fn();
    expect(
      listener(
        { type: "owlivo-subscription-sync:flush" },
        { id: extensionId, url: "https://example.com" },
        untrustedResponse,
      ),
    ).toBe(false);
    expect(untrustedResponse).toHaveBeenCalledWith({ ok: false, reason: "UNAUTHORIZED" });
    expect(listener({ type: "owlivo-subscription-sync:sign-out" }, sender, vi.fn())).toBe(true);
  });

  it("serializes a deferred real storage pull before logout and rejects account changes", async () => {
    let finishPull!: (value: { merge: "idle"; sources: []; guestCount: 0 }) => void;
    vi.mocked(getOwlivoAccount).mockResolvedValue({
      status: "signed_in",
      account: { id: "user-a", email: null, nickname: "A", avatarUrl: null },
    } as never);
    vi.mocked(createSupabaseSubscriptionApi).mockReturnValue({} as never);
    vi.mocked(handleSignedIn).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPull = resolve as typeof finishPull;
        }) as never,
    );
    vi.mocked(readMergePrompt).mockResolvedValue({ needed: false, guestCount: 0, guest: [] });
    vi.mocked(handleSignedOut).mockResolvedValue([]);
    vi.mocked(getOwlivoAccount)
      .mockResolvedValueOnce({ status: "signed_out", account: null } as never)
      .mockResolvedValue({
        status: "signed_in",
        account: { id: "user-a", email: null, nickname: "A", avatarUrl: null },
      } as never);

    const listener = install();
    const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
    const prepared = vi.fn();
    listener({ type: "owlivo-subscription-sync:prepare" }, sender, prepared);
    await vi.waitFor(() => expect(handleSignedIn).toHaveBeenCalledTimes(1));
    const signedOut = vi.fn();
    listener({ type: "owlivo-subscription-sync:sign-out" }, sender, signedOut);
    expect(handleSignedOut).not.toHaveBeenCalled();
    finishPull({ merge: "idle", sources: [], guestCount: 0 });
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledWith({ ok: true, sources: [] }));
    expect(handleSignedOut).toHaveBeenCalledTimes(1);
  });

  it("rejects a local change bound to the wrong account", async () => {
    vi.mocked(getOwlivoAccount).mockResolvedValue({
      status: "signed_in",
      account: { id: "user-b", email: null, nickname: "B", avatarUrl: null },
    } as never);
    const listener = install();
    const response = vi.fn();
    listener(
      {
        type: "owlivo-subscription-sync:local-change",
        op: "subscribe",
        source: { platform: "x", id: "someone" },
        allowResurrect: true,
        expectedUserId: "user-a",
      },
      { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` },
      response,
    );
    await vi.waitFor(() =>
      expect(response).toHaveBeenCalledWith({ ok: false, reason: "ACCOUNT_CHANGED" }),
    );
  });

  it("rejects a local change when the expected account lookup fails", async () => {
    vi.mocked(getOwlivoAccount).mockRejectedValue(new Error("auth unavailable"));
    const listener = install();
    const response = vi.fn();
    listener(
      {
        type: "owlivo-subscription-sync:local-change",
        op: "subscribe",
        source: { platform: "x", id: "someone" },
        allowResurrect: true,
        expectedUserId: "user-a",
      },
      { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` },
      response,
    );
    await vi.waitFor(() =>
      expect(response).toHaveBeenCalledWith({ ok: false, error: "auth unavailable" }),
    );
  });
});
