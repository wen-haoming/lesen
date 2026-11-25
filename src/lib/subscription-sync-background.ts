import type { FeedSource } from "./config";
import { storageGet } from "./chrome-api";
import { getOwlivoAccount } from "./owlivo-auth";
import { isTrustedAuthSender } from "./owlivo-auth-background";
import { enqueueSubscriptionSync } from "./subscription-sync-queue";
import {
  SUBSCRIPTION_SYNC_ALARM,
  accountSyncKey,
  applyLocalSubscriptionChange,
  confirmFirstMerge,
  createSupabaseSubscriptionApi,
  declineFirstMerge,
  flushPendingOps,
  handleSignedIn,
  handleSignedOut,
  parseSyncState,
  readMergePrompt,
  type SubscriptionOpType,
} from "./subscription-sync";

const IDLE_SYNC_PERIOD_MINUTES = 10;
const RETRY_SYNC_DELAY_MINUTES = 1;
const LOCAL_CHANGE_FLUSH_DEBOUNCE_MS = 1200;

let flushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function ensureSyncAlarm(hasPending = false): void {
  if (!chrome.alarms?.create) return;
  if (hasPending) {
    chrome.alarms.create(SUBSCRIPTION_SYNC_ALARM, {
      delayInMinutes: RETRY_SYNC_DELAY_MINUTES,
      periodInMinutes: IDLE_SYNC_PERIOD_MINUTES,
    });
    return;
  }
  if (typeof chrome.alarms.get === "function") {
    chrome.alarms.get(SUBSCRIPTION_SYNC_ALARM, (existing) => {
      if (!existing) {
        chrome.alarms.create(SUBSCRIPTION_SYNC_ALARM, { periodInMinutes: IDLE_SYNC_PERIOD_MINUTES });
      }
    });
    return;
  }
  chrome.alarms.create(SUBSCRIPTION_SYNC_ALARM, { periodInMinutes: IDLE_SYNC_PERIOD_MINUTES });
}

async function hasPendingAccountOps(userId: string): Promise<boolean> {
  try {
    const data = (await storageGet([accountSyncKey(userId)])) || {};
    return parseSyncState(userId, data[accountSyncKey(userId)]).pending.length > 0;
  } catch {
    return false;
  }
}

function scheduleDebouncedFlush(): void {
  if (flushDebounceTimer !== null) clearTimeout(flushDebounceTimer);
  flushDebounceTimer = setTimeout(() => {
    flushDebounceTimer = null;
    void enqueueSubscriptionSync(async () => {
      const { account } = await getOwlivoAccount();
      const api = createSupabaseSubscriptionApi();
      if (!account || !api) return;
      const prompt = await readMergePrompt(account.id);
      if (prompt.needed) return;
      const flushed = await flushPendingOps(account.id, api);
      ensureSyncAlarm((flushed?.pending?.length || 0) > 0);
    }).catch((error) => reportFailure("subscription sync debounced flush", error));
  }, LOCAL_CHANGE_FLUSH_DEBOUNCE_MS);
}

async function syncIfSignedIn(): Promise<void> {
  await enqueueSubscriptionSync(async () => {
    const { account } = await getOwlivoAccount();
    const api = createSupabaseSubscriptionApi();
    if (!account || !api) {
      if (!account && typeof chrome.alarms?.clear === "function") {
        chrome.alarms.clear(SUBSCRIPTION_SYNC_ALARM);
      }
      return;
    }
    await handleSignedIn(account.id, api);
    const prompt = await readMergePrompt(account.id);
    if (!prompt.needed && (await hasPendingAccountOps(account.id))) {
      await flushPendingOps(account.id, api);
    }
    ensureSyncAlarm(await hasPendingAccountOps(account.id));
  });
}
const PREFIX = "owlivo-subscription-sync:";
const ACTIONS = new Set([
  "sign-out",
  "prepare",
  "confirm-merge",
  "decline-merge",
  "flush",
  "local-change",
]);
function actionFrom(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== "string" || !type.startsWith(PREFIX)) return null;
  const action = type.slice(PREFIX.length);
  return ACTIONS.has(action) ? action : null;
}
function userIdFrom(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const userId = (message as { userId?: unknown }).userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}
type LocalChange = {
  op: SubscriptionOpType;
  source: FeedSource;
  allowResurrect: boolean;
  expectedUserId: string;
};
function localChangeFrom(message: unknown): LocalChange | null {
  if (!message || typeof message !== "object") return null;
  const value = message as Record<string, unknown>;
  const source = value.source;
  if (
    !(value.op === "subscribe" || value.op === "unsubscribe" || value.op === "patch_meta") ||
    typeof value.allowResurrect !== "boolean" ||
    typeof value.expectedUserId !== "string" ||
    !value.expectedUserId ||
    !source ||
    typeof source !== "object" ||
    Array.isArray(source)
  )
    return null;
  const item = source as Record<string, unknown>;
  if (typeof item.platform !== "string" || typeof item.id !== "string") return null;
  if (
    (value.op === "unsubscribe" && value.allowResurrect) ||
    (value.op === "subscribe" && !value.allowResurrect)
  )
    return null;
  return {
    op: value.op,
    source: source as FeedSource,
    allowResurrect: value.allowResurrect,
    expectedUserId: value.expectedUserId,
  };
}
function reportFailure(label: string, error: unknown): void {
  console.warn(`[${label}]`, error);
}
export function installSubscriptionSyncHooks(): void {
  ensureSyncAlarm(false);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SUBSCRIPTION_SYNC_ALARM)
      void syncIfSignedIn().catch((error) => reportFailure("subscription sync alarm", error));
  });
  chrome.runtime.onStartup.addListener(() => {
    void syncIfSignedIn().catch((error) => reportFailure("subscription sync startup", error));
  });
  chrome.runtime.onInstalled.addListener(() => {
    void syncIfSignedIn().catch((error) => reportFailure("subscription sync install", error));
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = actionFrom(message);
    if (!action) return false;
    if (!isTrustedAuthSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, reason: "UNAUTHORIZED" });
      return false;
    }
    const localChange = action === "local-change" ? localChangeFrom(message) : null;
    const expectedUserId =
      action === "local-change"
        ? localChange?.expectedUserId
        : action === "confirm-merge" || action === "decline-merge"
          ? userIdFrom(message)
          : null;
    if (
      (action === "local-change" && !localChange) ||
      ((action === "confirm-merge" || action === "decline-merge") && !expectedUserId)
    ) {
      sendResponse({ ok: false, reason: "INVALID_REQUEST" });
      return false;
    }
    void enqueueSubscriptionSync(async () => {
      try {
        if (action === "sign-out") {
          if (flushDebounceTimer !== null) {
            clearTimeout(flushDebounceTimer);
            flushDebounceTimer = null;
          }
          if (typeof chrome.alarms?.clear === "function") {
            chrome.alarms.clear(SUBSCRIPTION_SYNC_ALARM);
          }
          const sources = await handleSignedOut();
          sendResponse({ ok: true, sources });
          return;
        }
        const { account } = await getOwlivoAccount();
        if (!account) {
          sendResponse({ ok: false, reason: "NOT_SIGNED_IN" });
          return;
        }
        if (expectedUserId && account.id !== expectedUserId) {
          sendResponse({ ok: false, reason: "ACCOUNT_CHANGED" });
          return;
        }
        ensureSyncAlarm(false);
        if (action === "local-change") {
          const applied = await applyLocalSubscriptionChange(
            localChange!.op,
            localChange!.source,
            localChange!.allowResurrect,
            localChange!.expectedUserId,
            undefined,
            null,
          );
          if (applied) scheduleDebouncedFlush();
          sendResponse({ ok: applied, ...(applied ? {} : { reason: "PERSONA_CHANGED" }) });
          return;
        }
        const api = createSupabaseSubscriptionApi();
        if (!api) {
          sendResponse({ ok: false, reason: "SYNC_UNAVAILABLE" });
          return;
        }
        if (action === "prepare") {
          const prepared = await handleSignedIn(account.id, api);
          const prompt = await readMergePrompt(account.id);
          sendResponse({
            ok: true,
            merge: prepared.merge,
            guestCount: prompt.guestCount,
            sources: prepared.sources,
          });
          return;
        }
        if (action === "confirm-merge") {
          const result = await confirmFirstMerge(account.id, api);
          sendResponse({
            ok: true,
            added: result.result.added,
            sources: result.sources,
            count: result.sources.length,
          });
          return;
        }
        if (action === "decline-merge") {
          await declineFirstMerge(account.id);
          sendResponse({ ok: true });
          return;
        }
        if (action === "flush") {
          const flushed = await flushPendingOps(account.id, api);
          ensureSyncAlarm((flushed?.pending?.length || 0) > 0);
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, reason: "UNKNOWN" });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "同步失败" });
      }
    }).catch((error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "同步失败" }),
    );
    return true;
  });
  void syncIfSignedIn().catch((error) => reportFailure("subscription sync initial", error));
}
