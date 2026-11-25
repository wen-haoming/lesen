import { describe, expect, it, vi } from "vitest";
import {
  handleAuthRuntimeMessage,
  installAuthSessionHooks,
  isTrustedAuthSender,
} from "./owlivo-auth-background";
import type { OwlivoAccount } from "./owlivo-auth";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const popupSender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const account: OwlivoAccount = {
  id: "account-1",
  email: "reader@example.com",
  nickname: "Reader",
  avatarUrl: null,
};

describe("auth runtime handlers", () => {
  it("allows only same-extension popup, sidepanel, and home pages", () => {
    expect(isTrustedAuthSender(popupSender, extensionId)).toBe(true);
    expect(
      isTrustedAuthSender(
        { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel.html` },
        extensionId,
      ),
    ).toBe(true);
    expect(
      isTrustedAuthSender(
        { id: extensionId, url: `chrome-extension://${extensionId}/home.html` },
        extensionId,
      ),
    ).toBe(true);
    expect(isTrustedAuthSender({ id: "other", url: popupSender.url }, extensionId)).toBe(false);
    expect(
      isTrustedAuthSender({ id: extensionId, url: "https://example.com/popup.html" }, extensionId),
    ).toBe(false);
    expect(
      isTrustedAuthSender(
        { id: extensionId, url: `chrome-extension://${extensionId}/options.html` },
        extensionId,
      ),
    ).toBe(false);
    expect(
      isTrustedAuthSender(
        { id: extensionId, url: `chrome-extension://evil/popup.html` },
        extensionId,
      ),
    ).toBe(false);
  });

  it("shares one login operation across concurrent trusted requests and returns no token", async () => {
    let resolveLogin!: (value: { ok: true; account: OwlivoAccount }) => void;
    const signIn = vi.fn(
      () =>
        new Promise<{ ok: true; account: OwlivoAccount }>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    const getAccount = vi.fn(async () => ({ status: "signed_in" as const, account }));
    const dependencies = { signIn, getAccount };
    const first = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      dependencies,
    );
    const second = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      dependencies,
    );
    await Promise.resolve();
    expect(signIn).toHaveBeenCalledTimes(1);
    resolveLogin({ ok: true, account });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.response).toEqual({ ok: true, account });
    expect(secondResult.response).toEqual({ ok: true, account });
    expect(JSON.stringify(firstResult.response)).not.toMatch(/access_token|id_token|refresh_token/);
  });

  it("returns failures when post-login account lookup rejects", async () => {
    const result = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      {
        signIn: async () => ({ ok: true, account }),
        getAccount: async () => {
          throw new Error("account lookup failed");
        },
      },
    );
    expect(result.handled).toBe(true);
    expect(result.response).toMatchObject({
      ok: false,
      reason: "failed",
      message: "account lookup failed",
    });
  });

  it("waits for an in-flight sign-in before sign-out and shares identical requests", async () => {
    let finishLogin!: (value: { ok: true; account: OwlivoAccount }) => void;
    const order: string[] = [];
    const signIn = vi.fn(() =>
      new Promise<{ ok: true; account: OwlivoAccount }>((resolve) => {
        finishLogin = resolve;
      }).then((value) => {
        order.push("sign-in");
        return value;
      }),
    );
    const signOut = vi.fn(async () => {
      order.push("sign-out");
      return { ok: true as const };
    });
    const getAccount = vi.fn(async () => ({ status: "signed_in" as const, account }));
    const deps = { signIn, signOut, getAccount, handleSignedOut: vi.fn(async () => []) };
    const login = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    const loginDuplicate = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    const logout = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-out" },
      popupSender,
      extensionId,
      deps,
    );
    const logoutDuplicate = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-out" },
      popupSender,
      extensionId,
      deps,
    );
    await Promise.resolve();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    finishLogin({ ok: true, account });
    await Promise.all([login, loginDuplicate, logout, logoutDuplicate]);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["sign-in", "sign-out"]);
    expect(deps.handleSignedOut).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate identical actions across an intervening opposite intent", async () => {
    const seen: string[] = [];
    let finishFirst!: (value: { ok: true; account: OwlivoAccount }) => void;
    const signIn = vi.fn(() => {
      seen.push("sign-in-start");
      if (signIn.mock.calls.length > 1) return Promise.resolve({ ok: true as const, account });
      return new Promise<{ ok: true; account: OwlivoAccount }>((resolve) => {
        finishFirst = resolve;
      });
    });
    const signOut = vi.fn(async () => {
      seen.push("sign-out");
      return { ok: true as const };
    });
    const getAccount = vi.fn(async () => ({ status: "signed_in" as const, account }));
    const deps = { signIn, signOut, getAccount, handleSignedOut: vi.fn(async () => []) };
    const firstLogin = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    const logout = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-out" },
      popupSender,
      extensionId,
      deps,
    );
    const secondLogin = handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    await Promise.resolve();
    expect(signIn).toHaveBeenCalledTimes(1);
    finishFirst({ ok: true, account });
    const results = await Promise.all([firstLogin, logout, secondLogin]);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["sign-in-start", "sign-out", "sign-in-start"]);
    expect(results.every((item) => (item.response as { ok: boolean }).ok)).toBe(true);
  });

  it("retries a failed mutation and rejects unknown or malformed auth messages", async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({ ok: true as const, account });
    const deps = {
      signIn,
      getAccount: vi.fn(async () => ({ status: "signed_in" as const, account })),
    };
    const failed = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    expect(failed.response).toMatchObject({ ok: false });
    const retried = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      deps,
    );
    expect(retried.response).toEqual({ ok: true, account });
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(
      await handleAuthRuntimeMessage({ type: "owlivo-auth:surprise" }, popupSender, extensionId),
    ).toEqual({ handled: false });
    expect(
      await handleAuthRuntimeMessage(
        { type: "owlivo-auth:sign-in" },
        { id: extensionId, url: "https://evil.invalid" },
        extensionId,
        deps,
      ),
    ).toMatchObject({ handled: true, response: { ok: false } });
  });

  it("returns failures when sign-out rejects", async () => {
    const result = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-out" },
      popupSender,
      extensionId,
      {
        signOut: async () => {
          throw new Error("sign-out failed");
        },
      },
    );
    expect(result.handled).toBe(true);
    expect(result.response).toMatchObject({ ok: false, message: "sign-out failed" });
  });

  it("runs sign-out cleanup inside the shared sync queue without nested queueing", async () => {
    const events: string[] = [];
    const result = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-out" },
      popupSender,
      extensionId,
      {
        enqueueSync: async (operation) => {
          events.push("queue-start");
          const value = await operation();
          events.push("queue-end");
          return value;
        },
        signOut: async () => ({ ok: true }),
        handleSignedOut: async () => {
          events.push("cleanup");
          return [];
        },
      },
    );
    expect(result.response).toEqual({ ok: true, personaRestored: true });
    expect(events).toEqual(["queue-start", "cleanup", "queue-end"]);
  });

  it("serializes account deletion and guest cleanup, rejecting wrong-account and failed deletes", async () => {
    const enqueueSync = vi.fn(async (operation: () => Promise<unknown>) => operation());
    const deleteAccount = vi.fn(async () => ({ ok: true as const }));
    const handleSignedOut = vi.fn(async () => []);
    const wrongAccount = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:delete-account", userId: "account-1" },
      popupSender,
      extensionId,
      {
        enqueueSync,
        getAccount: async () => ({ status: "signed_in", account: { ...account, id: "account-2" } }),
        deleteAccount,
        handleSignedOut,
      },
    );
    expect(wrongAccount.response).toMatchObject({ ok: false });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(handleSignedOut).not.toHaveBeenCalled();

    const failed = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:delete-account", userId: "account-1" },
      popupSender,
      extensionId,
      {
        enqueueSync,
        getAccount: async () => ({ status: "signed_in", account }),
        deleteAccount: async () => ({ ok: false as const, message: "delete denied" }),
        handleSignedOut,
      },
    );
    expect(failed.response).toMatchObject({ ok: false, message: "delete denied" });
    expect(handleSignedOut).not.toHaveBeenCalled();

    const deleted = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:delete-account", userId: "account-1" },
      popupSender,
      extensionId,
      {
        enqueueSync,
        getAccount: async () => ({ status: "signed_in", account }),
        deleteAccount: async () => ({ ok: true as const }),
        handleSignedOut,
      },
    );
    expect(deleted.response).toEqual({ ok: true, personaRestored: true });
    expect(handleSignedOut).toHaveBeenCalledTimes(1);
    expect(enqueueSync).toHaveBeenCalledTimes(3);
  });

  it("keeps interactive sign-in on the auth queue only", async () => {
    const enqueueSync = vi.fn(async (operation: () => Promise<unknown>) => operation());
    const result = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      popupSender,
      extensionId,
      {
        enqueueSync,
        signIn: async () => ({ ok: true, account }),
        getAccount: async () => ({ status: "signed_in", account }),
      },
    );
    expect(result.response).toEqual({ ok: true, account });
    expect(enqueueSync).not.toHaveBeenCalled();
  });

  it("does not claim unrelated runtime messages", async () => {
    const result = await handleAuthRuntimeMessage(
      { type: "another-feature:ping" },
      popupSender,
      extensionId,
    );
    expect(result).toEqual({ handled: false });
  });

  it("returns false synchronously for unrelated messages from the installed listener", () => {
    const addListener = vi.fn();
    const previousChrome = (globalThis as { chrome?: unknown }).chrome;
    const storageArea = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
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
        storage: { local: storageArea, session: storageArea },
      },
    });
    try {
      installAuthSessionHooks();
      const listener = addListener.mock.calls[0][0] as (
        message: unknown,
        sender: typeof popupSender,
        sendResponse: (value: unknown) => void,
      ) => boolean;
      expect(listener({ type: "another-feature:ping" }, popupSender, vi.fn())).toBe(false);
      expect(listener({ type: "owlivo-auth:sign-out" }, popupSender, vi.fn())).toBe(true);
    } finally {
      if (previousChrome === undefined) delete (globalThis as { chrome?: unknown }).chrome;
      else
        Object.defineProperty(globalThis, "chrome", { configurable: true, value: previousChrome });
    }
  });

  it("rejects untrusted sign-in requests without starting OAuth", async () => {
    const signIn = vi.fn();
    const result = await handleAuthRuntimeMessage(
      { type: "owlivo-auth:sign-in" },
      { id: extensionId, url: "https://example.com/popup.html" },
      extensionId,
      { signIn },
    );
    expect(result.handled).toBe(true);
    expect(result.response).toMatchObject({ ok: false });
    expect(signIn).not.toHaveBeenCalled();
  });
});
