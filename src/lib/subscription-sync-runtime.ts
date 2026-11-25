import type { FeedSource } from "./config";
import { storageGet } from "./chrome-api";

export type SubscriptionOpType = "subscribe" | "unsubscribe" | "patch_meta";
export type PreparedSync = { merge: "idle" | "needed" | "confirmed" | "declined"; guestCount: number; sources: FeedSource[] };
export type MergeResult = { added: number; sources: FeedSource[]; count: number };

type RuntimeResult = { ok: true; [key: string]: unknown } | { ok: false; reason?: string; error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSources(value: unknown): value is FeedSource[] {
  return Array.isArray(value) && value.every((source) => {
    if (!isRecord(source)) return false;
    return typeof source.platform === "string" && typeof source.id === "string";
  });
}

function sendSyncMessage<T>(
  type: string,
  extra: Record<string, unknown>,
  validate: (response: unknown) => T | null,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: `owlivo-subscription-sync:${type}`, ...extra }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(validate(response));
      });
    } catch {
      resolve(null);
    }
  });
}

function result(response: unknown): RuntimeResult | null {
  return isRecord(response) && typeof response.ok === "boolean" ? response as RuntimeResult : null;
}

export async function prepareSubscriptionSyncInBackground(): Promise<PreparedSync | null> {
  const response = result(await sendSyncMessage("prepare", {}, (value) => value));
  if (!response || response.ok !== true || !isSources(response.sources) ||
      !["idle", "needed", "confirmed", "declined"].includes(String(response.merge)) ||
      typeof response.guestCount !== "number" || !Number.isFinite(response.guestCount)) return null;
  return {
    merge: response.merge as PreparedSync["merge"],
    guestCount: response.guestCount,
    sources: response.sources,
  };
}

export async function confirmFirstMergeInBackground(userId: string): Promise<MergeResult | null> {
  const response = result(await sendSyncMessage("confirm-merge", { userId }, (value) => value));
  if (!response || response.ok !== true || !isSources(response.sources) ||
      typeof response.added !== "number" || !Number.isFinite(response.added) ||
      typeof response.count !== "number" || !Number.isFinite(response.count)) return null;
  return { added: response.added, sources: response.sources, count: response.count };
}

export async function declineFirstMergeInBackground(userId: string): Promise<boolean> {
  const response = result(await sendSyncMessage("decline-merge", { userId }, (value) => value));
  return Boolean(response?.ok === true);
}

export async function notifyLocalSubscriptionChange(
  op: SubscriptionOpType,
  source: FeedSource,
  allowResurrect: boolean,
): Promise<void> {
  try {
    const raw = (await storageGet(["owlivo:subscription-persona"])) || {};
    const persona = raw["owlivo:subscription-persona"];
    if (!isRecord(persona) || persona.kind !== "account" || typeof persona.userId !== "string" || !persona.userId) {
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "owlivo-subscription-sync:local-change",
            op,
            source,
            allowResurrect,
            expectedUserId: persona.userId,
          },
          () => {
            void chrome.runtime.lastError;
            resolve();
          },
        );
      } catch {
        resolve();
      }
    });
  } catch {
    // Local subscription changes are best-effort; queued offline work retries later.
  }
}
