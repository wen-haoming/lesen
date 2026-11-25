import { type FeedSource, type Platform } from "./config";
import { storageGet, storageSet } from "./chrome-api";
import { getOwlivoAuthClient } from "./owlivo-auth";
import {
  notifyLocalSubscriptionChange,
  type SubscriptionOpType,
} from "./subscription-sync-runtime";

export { notifyLocalSubscriptionChange, type SubscriptionOpType };

export const SUBSCRIPTION_PERSONA_KEY = "owlivo:subscription-persona";
export const SUBSCRIPTION_GUEST_SOURCES_KEY = "owlivo:sources:guest";
export const SUBSCRIPTION_SYNC_ALARM = "owlivo-subscription-sync";

const PLATFORMS = new Set<Platform>(["xueqiu", "x", "weibo"]);

export type SubscriptionPersona = { kind: "guest" } | { kind: "account"; userId: string };

export type SubscriptionPendingOp = {
  opId: string;
  op: SubscriptionOpType;
  platform: Platform;
  authorId: string;
  displayName: string;
  avatarUrl: string;
  baseRevision: number;
  allowResurrect: boolean;
  enqueuedAt: string;
  attempts: number;
};

export type SubscriptionMergeState = "idle" | "needed" | "confirmed" | "declined";

export type AccountSyncState = {
  userId: string;
  lastPulledRevision: number;
  pending: SubscriptionPendingOp[];
  merge: SubscriptionMergeState;
  lastError?: string;
  /** Per-item server revision, keyed by platform:author_id. */
  revisions: Record<string, number>;
};

export type SubscriptionEntry = {
  platform: Platform;
  author_id: string;
  display_name: string;
  avatar_url: string;
  deleted_at: string | null;
  revision: number;
};

export type ApplyChangeResult = {
  status: "ok" | "conflict" | "tombstone" | "missing";
  idempotent?: boolean;
  entry?: SubscriptionEntry;
};

export type MergeLocalResult = {
  added: number;
  skipped_existing: number;
  skipped_tombstone: number;
  skipped_invalid: number;
};

export type SubscriptionCloudApi = {
  listChanges(sinceRevision: number): Promise<SubscriptionEntry[]>;
  applyChange(op: SubscriptionPendingOp): Promise<ApplyChangeResult>;
  mergeLocal(
    items: Array<{
      platform: Platform;
      author_id: string;
      display_name: string;
      avatar_url: string;
    }>,
  ): Promise<MergeLocalResult>;
};

export type SubscriptionStorage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

export function accountSourcesKey(userId: string): string {
  return `owlivo:sources:account:${userId}`;
}

export function accountSyncKey(userId: string): string {
  return `owlivo:subscription-sync:${userId}`;
}

export function normalizeAuthorId(platform: Platform, id: string): string {
  const value = String(id || "")
    .trim()
    .slice(0, 200);
  if (platform === "x") return value.toLowerCase();
  return value;
}

export function subscriptionKey(platform: Platform, authorId: string): string {
  return `${platform}:${normalizeAuthorId(platform, authorId)}`.toLowerCase();
}

export function toSyncMetadata(source: FeedSource): {
  platform: Platform;
  authorId: string;
  displayName: string;
  avatarUrl: string;
} | null {
  const platform = source.platform;
  if (!PLATFORMS.has(platform)) return null;
  const authorId = normalizeAuthorId(platform, source.id);
  if (!authorId) return null;
  const displayName = String(source.name || "")
    .trim()
    .slice(0, 200);
  const rawAvatar = String(source.avatar || "")
    .trim()
    .slice(0, 1000);
  const avatarUrl =
    /^https:\/\//i.test(rawAvatar) || /^\/?(?:fixtures|icons)\//i.test(rawAvatar) ? rawAvatar : "";
  return { platform, authorId, displayName, avatarUrl };
}

export function sourcesFromEntries(entries: SubscriptionEntry[]): FeedSource[] {
  return entries
    .filter((entry) => !entry.deleted_at && PLATFORMS.has(entry.platform))
    .map((entry) => {
      const source: FeedSource = { platform: entry.platform, id: entry.author_id };
      if (entry.display_name) source.name = entry.display_name;
      if (entry.avatar_url) source.avatar = entry.avatar_url;
      return source;
    });
}

export function uniqueSources(sources: FeedSource[]): FeedSource[] {
  const seen = new Set<string>();
  const out: FeedSource[] = [];
  for (const source of sources) {
    const meta = toSyncMetadata(source);
    if (!meta) continue;
    const key = subscriptionKey(meta.platform, meta.authorId);
    if (seen.has(key)) continue;
    seen.add(key);
    const next: FeedSource = { platform: meta.platform, id: meta.authorId };
    if (meta.displayName) next.name = meta.displayName;
    if (meta.avatarUrl) next.avatar = meta.avatarUrl;
    out.push(next);
  }
  return out;
}

export function uniqueLocalSources(sources: FeedSource[]): FeedSource[] {
  return uniqueSources(sources);
}

export function withLocalOnlyFields(_current: FeedSource[], next: FeedSource[]): FeedSource[] {
  return uniqueLocalSources(next);
}

export function applyPendingOpsToSources(
  sources: FeedSource[],
  pending: SubscriptionPendingOp[],
): FeedSource[] {
  const map = new Map<string, FeedSource>();
  for (const source of uniqueLocalSources(sources)) {
    const meta = toSyncMetadata(source);
    if (!meta) continue;
    map.set(subscriptionKey(meta.platform, meta.authorId), source);
  }
  for (const op of pending) {
    const key = subscriptionKey(op.platform, op.authorId);
    if (op.op === "unsubscribe") {
      map.delete(key);
      continue;
    }
    if (op.op === "subscribe" || op.op === "patch_meta") {
      if (op.op === "patch_meta" && !map.has(key)) continue;
      const prev = map.get(key);
      const source: FeedSource = { platform: op.platform, id: op.authorId };
      if (op.displayName) source.name = op.displayName;
      else if (prev?.name) source.name = prev.name;
      if (op.avatarUrl) source.avatar = op.avatarUrl;
      else if (prev?.avatar) source.avatar = prev.avatar;
      map.set(key, source);
    }
  }
  return [...map.values()];
}

function parseRevisions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const revision = Number(raw);
    if (key && Number.isFinite(revision) && revision >= 0) out[key] = revision;
  }
  return out;
}

function revisionsFromEntries(
  current: Record<string, number>,
  entries: SubscriptionEntry[],
  replace: boolean,
): Record<string, number> {
  const next: Record<string, number> = replace ? {} : { ...current };
  for (const entry of entries) {
    next[subscriptionKey(entry.platform, entry.author_id)] = entry.revision;
  }
  return next;
}

export function applyCloudEntriesToSources(
  current: FeedSource[],
  entries: SubscriptionEntry[],
): FeedSource[] {
  const map = new Map<string, FeedSource>();
  for (const source of uniqueSources(current)) {
    const meta = toSyncMetadata(source);
    if (!meta) continue;
    map.set(subscriptionKey(meta.platform, meta.authorId), source);
  }
  const ordered = [...entries].sort((a, b) => a.revision - b.revision);
  for (const entry of ordered) {
    const key = subscriptionKey(entry.platform, entry.author_id);
    if (!PLATFORMS.has(entry.platform)) {
      map.delete(key);
      continue;
    }
    if (entry.deleted_at) {
      map.delete(key);
      continue;
    }
    const previous = map.get(key);
    const source: FeedSource = { platform: entry.platform, id: entry.author_id };
    if (entry.display_name || previous?.name) source.name = entry.display_name || previous?.name;
    if (entry.avatar_url || previous?.avatar) source.avatar = entry.avatar_url || previous?.avatar;
    map.set(key, source);
  }
  return [...map.values()];
}

function sourceMetadataChanged(a: FeedSource, b: FeedSource): boolean {
  return (
    String(a.name || "") !== String(b.name || "") ||
    String(a.avatar || "") !== String(b.avatar || "")
  );
}

/** Preserve local edits that landed while a cloud pull was in flight. */
function mergeConcurrentLocalSources(
  beforePull: FeedSource[],
  latestLocal: FeedSource[],
  cloudView: FeedSource[],
): FeedSource[] {
  const before = new Map<string, FeedSource>();
  const latest = new Map<string, FeedSource>();
  const merged = new Map<string, FeedSource>();
  const keyOf = (source: FeedSource) => {
    const meta = toSyncMetadata(source);
    return meta ? subscriptionKey(meta.platform, meta.authorId) : "";
  };
  for (const source of uniqueLocalSources(beforePull)) {
    const key = keyOf(source);
    if (key) before.set(key, source);
  }
  for (const source of uniqueLocalSources(latestLocal)) {
    const key = keyOf(source);
    if (key) latest.set(key, source);
  }
  for (const source of uniqueLocalSources(cloudView)) {
    const key = keyOf(source);
    if (key) merged.set(key, source);
  }

  for (const [key, source] of before) {
    const current = latest.get(key);
    if (!current) {
      merged.delete(key);
    } else if (sourceMetadataChanged(source, current)) {
      merged.set(key, current);
    }
  }
  for (const [key, source] of latest) {
    if (!before.has(key)) merged.set(key, source);
  }
  return [...merged.values()];
}

export function resolvePendingAfterResult(
  op: SubscriptionPendingOp,
  result: ApplyChangeResult,
): { action: "drop" | "retry" | "conflict-retry"; nextBaseRevision?: number } {
  if (result.status === "ok") return { action: "drop" };
  if (result.status === "missing") return { action: "drop" };
  if (result.status === "tombstone") {
    if (op.op === "subscribe" && !op.allowResurrect) return { action: "drop" };
    if (op.op === "subscribe" && op.allowResurrect && result.entry) {
      return { action: "conflict-retry", nextBaseRevision: result.entry.revision };
    }
    return { action: "drop" };
  }
  if (result.status === "conflict" && result.entry) {
    if (op.op === "subscribe" && result.entry.deleted_at && !op.allowResurrect) {
      return { action: "drop" };
    }
    return { action: "conflict-retry", nextBaseRevision: result.entry.revision };
  }
  return { action: "retry" };
}

export function emptySyncState(userId: string): AccountSyncState {
  return { userId, lastPulledRevision: 0, pending: [], merge: "idle", revisions: {} };
}

export function parsePersona(value: unknown): SubscriptionPersona {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.kind === "account" && typeof rec.userId === "string" && rec.userId) {
      return { kind: "account", userId: rec.userId };
    }
  }
  return { kind: "guest" };
}

export function parseSyncState(userId: string, value: unknown): AccountSyncState {
  const base = emptySyncState(userId);
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const rec = value as Record<string, unknown>;
  const lastPulledRevision = Number(rec.lastPulledRevision || 0);
  const merge = rec.merge;
  const pending = Array.isArray(rec.pending) ? rec.pending : [];
  return {
    userId,
    lastPulledRevision: Number.isFinite(lastPulledRevision) ? Math.max(0, lastPulledRevision) : 0,
    merge:
      merge === "needed" || merge === "confirmed" || merge === "declined" || merge === "idle"
        ? merge
        : "idle",
    lastError: typeof rec.lastError === "string" ? rec.lastError : undefined,
    revisions: parseRevisions(rec.revisions),
    pending: pending.filter((item): item is SubscriptionPendingOp => {
      if (!item || typeof item !== "object") return false;
      const op = item as SubscriptionPendingOp;
      return Boolean(op.opId && PLATFORMS.has(op.platform) && op.authorId && op.op);
    }),
  };
}

export function parseSources(value: unknown): FeedSource[] {
  if (!Array.isArray(value)) return [];
  return uniqueLocalSources(value as FeedSource[]);
}

function chromeStorage(): SubscriptionStorage {
  return {
    async get(keys) {
      return (await storageGet(keys)) || {};
    },
    async set(values) {
      await storageSet(values);
    },
  };
}

export async function readPersona(
  storage: SubscriptionStorage = chromeStorage(),
): Promise<SubscriptionPersona> {
  const data = await storage.get([SUBSCRIPTION_PERSONA_KEY]);
  return parsePersona(data[SUBSCRIPTION_PERSONA_KEY]);
}

export function createPendingOp(input: {
  op: SubscriptionOpType;
  source: FeedSource;
  baseRevision: number;
  allowResurrect: boolean;
  now?: string;
  opId?: string;
}): SubscriptionPendingOp | null {
  const meta = toSyncMetadata(input.source);
  if (!meta) return null;
  return {
    opId: input.opId || crypto.randomUUID(),
    op: input.op,
    platform: meta.platform,
    authorId: meta.authorId,
    displayName: meta.displayName,
    avatarUrl: meta.avatarUrl,
    baseRevision: input.baseRevision,
    allowResurrect: input.allowResurrect,
    enqueuedAt: input.now || new Date().toISOString(),
    attempts: 0,
  };
}

export async function enqueueAccountOp(
  userId: string,
  op: SubscriptionPendingOp,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<AccountSyncState> {
  const key = accountSyncKey(userId);
  const data = await storage.get([key]);
  const state = parseSyncState(userId, data[key]);
  if (!state.pending.some((item) => item.opId === op.opId)) state.pending.push(op);
  await storage.set({ [key]: state });
  return state;
}

function sameSourcesList(a: FeedSource[], b: FeedSource[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].platform !== b[i].platform ||
      a[i].id !== b[i].id ||
      String(a[i].name || "") !== String(b[i].name || "") ||
      String(a[i].avatar || "") !== String(b[i].avatar || "")
    ) {
      return false;
    }
  }
  return true;
}

async function persistAccountSources(
  userId: string,
  sources: FeedSource[],
  storage: SubscriptionStorage,
  alsoWorkingList: boolean,
  retainFrom: FeedSource[] = sources,
): Promise<void> {
  const localized = uniqueLocalSources(withLocalOnlyFields(retainFrom, sources));
  const accountKey = accountSourcesKey(userId);
  const existing = await storage.get(alsoWorkingList ? [accountKey, "sources"] : [accountKey]);
  const values: Record<string, unknown> = {};
  if (
    !Object.prototype.hasOwnProperty.call(existing, accountKey) ||
    !sameSourcesList(parseSources(existing[accountKey]), localized)
  ) {
    values[accountKey] = localized;
  }
  if (
    alsoWorkingList &&
    (!Object.prototype.hasOwnProperty.call(existing, "sources") ||
      !sameSourcesList(parseSources(existing.sources), localized))
  ) {
    values.sources = localized;
  }
  if (Object.keys(values).length > 0) {
    await storage.set(values);
  }
}

export async function pullAccountSubscriptions(
  userId: string,
  api: SubscriptionCloudApi,
  storage: SubscriptionStorage = chromeStorage(),
  options?: { full?: boolean },
): Promise<{ sources: FeedSource[]; state: AccountSyncState }> {
  const syncKey = accountSyncKey(userId);
  const sourceKey = accountSourcesKey(userId);
  const data = await storage.get([syncKey, sourceKey]);
  const state = parseSyncState(userId, data[syncKey]);
  const cached = parseSources(data[sourceKey]);
  const full = Boolean(options?.full) || cached.length === 0;
  const since = full ? 0 : state.lastPulledRevision;
  const entries = await api.listChanges(since);
  const merged = withLocalOnlyFields(
    cached,
    applyCloudEntriesToSources(full ? [] : cached, entries),
  );
  const maxRevision = entries.reduce(
    (max, entry) => Math.max(max, entry.revision),
    full ? 0 : state.lastPulledRevision,
  );
  const nextState: AccountSyncState = {
    ...state,
    lastPulledRevision: maxRevision,
    revisions: revisionsFromEntries(state.revisions, entries, full),
    lastError: undefined,
  };
  await storage.set({
    [syncKey]: nextState,
    [sourceKey]: merged,
  });
  return { sources: merged, state: nextState };
}

/**
 * Apply results can include rows whose per-row revision is still below
 * lastPulledRevision. Incremental listChanges would miss them, so fold the
 * returned entry into the account cache immediately.
 */
async function absorbApplyEntry(
  userId: string,
  entry: SubscriptionEntry | undefined,
  storage: SubscriptionStorage,
): Promise<void> {
  if (!entry) return;
  const sourceKey = accountSourcesKey(userId);
  const syncKey = accountSyncKey(userId);
  const data = await storage.get([sourceKey, syncKey]);
  const cached = parseSources(data[sourceKey]);
  const merged = withLocalOnlyFields(cached, applyCloudEntriesToSources(cached, [entry]));
  const state = parseSyncState(userId, data[syncKey]);
  await storage.set({
    [sourceKey]: merged,
    [syncKey]: {
      ...state,
      revisions: {
        ...state.revisions,
        [subscriptionKey(entry.platform, entry.author_id)]: entry.revision,
      },
    },
  });
}

export async function flushPendingOps(
  userId: string,
  api: SubscriptionCloudApi,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<AccountSyncState> {
  const initialData = await storage.get([accountSyncKey(userId)]);
  const initialState = parseSyncState(userId, initialData[accountSyncKey(userId)]);
  if (initialState.pending.length === 0) {
    return initialState;
  }
  const pulled = await pullAccountSubscriptions(userId, api, storage);
  let state = pulled.state;
  const remaining: SubscriptionPendingOp[] = [];
  for (const op of state.pending) {
    if (!PLATFORMS.has(op.platform)) continue;
    try {
      const result = await api.applyChange(op);
      const resolved = resolvePendingAfterResult(op, result);
      await absorbApplyEntry(userId, result.entry, storage);
      if (resolved.action === "drop") continue;
      if (resolved.action === "conflict-retry" && resolved.nextBaseRevision != null) {
        const retried: SubscriptionPendingOp = {
          ...op,
          baseRevision: resolved.nextBaseRevision,
          attempts: op.attempts + 1,
        };
        const second = await api.applyChange(retried);
        await absorbApplyEntry(userId, second.entry || result.entry, storage);
        if (second.status === "ok") continue;
        remaining.push({ ...retried, attempts: retried.attempts + 1 });
        continue;
      }
      remaining.push({ ...op, attempts: op.attempts + 1 });
    } catch (error) {
      remaining.push({
        ...op,
        attempts: op.attempts + 1,
      });
      state = {
        ...state,
        lastError: error instanceof Error ? error.message : "同步失败，将稍后重试。",
      };
    }
  }
  const latest = await pullAccountSubscriptions(userId, api, storage);
  const nextState: AccountSyncState = {
    ...latest.state,
    pending: remaining,
    lastError: remaining.length ? state.lastError : undefined,
  };
  await storage.set({ [accountSyncKey(userId)]: nextState });
  return nextState;
}

export async function handleSignedIn(
  userId: string,
  api: SubscriptionCloudApi,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<{ sources: FeedSource[]; merge: SubscriptionMergeState; guestCount: number }> {
  const data = await storage.get([
    SUBSCRIPTION_PERSONA_KEY,
    "sources",
    SUBSCRIPTION_GUEST_SOURCES_KEY,
    accountSourcesKey(userId),
    accountSyncKey(userId),
  ]);
  const previous = parsePersona(data[SUBSCRIPTION_PERSONA_KEY]);
  const working = parseSources(data.sources);
  let guest = parseSources(data[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  if (previous.kind === "guest") {
    if (Object.prototype.hasOwnProperty.call(data, "sources")) guest = uniqueSources(working);
    await storage.set({ [SUBSCRIPTION_GUEST_SOURCES_KEY]: guest });
  } else if (previous.kind === "account" && previous.userId !== userId) {
    if (Object.prototype.hasOwnProperty.call(data, "sources")) {
      await storage.set({ [accountSourcesKey(previous.userId)]: working });
    }
  }

  const pulled = await pullAccountSubscriptions(userId, api, storage);
  // Adding/removing a source can happen while listChanges is in flight. Read
  // the working list again before committing the cloud view, instead of writing
  // the snapshot captured before the network request.
  const latest = await storage.get(["sources", SUBSCRIPTION_GUEST_SOURCES_KEY]);
  const hasLatestWorking = Object.prototype.hasOwnProperty.call(latest, "sources");
  const latestWorking = hasLatestWorking ? parseSources(latest.sources) : working;
  if (previous.kind === "guest") {
    guest = hasLatestWorking
      ? uniqueSources(latestWorking)
      : parseSources(latest[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  }

  let state = pulled.state;
  if (state.merge !== "confirmed" && state.merge !== "declined") {
    state = { ...state, merge: guest.length > 0 ? "needed" : "idle" };
  }
  if (state.merge === "needed") {
    // Keep showing unowned local subscriptions and stay on the guest persona so
    // nothing is uploaded until the user confirms against the visible Google account.
    await storage.set({
      [SUBSCRIPTION_PERSONA_KEY]: { kind: "guest" } satisfies SubscriptionPersona,
      [accountSyncKey(userId)]: state,
      [accountSourcesKey(userId)]: pulled.sources,
      [SUBSCRIPTION_GUEST_SOURCES_KEY]: guest,
      sources: latestWorking,
    });
    return { sources: latestWorking, merge: state.merge, guestCount: guest.length };
  }
  const sameAccount = previous.kind === "account" && previous.userId === userId;
  const retainFrom = sameAccount ? latestWorking : parseSources(data[accountSourcesKey(userId)]);
  const cloudView = withLocalOnlyFields(
    retainFrom,
    applyPendingOpsToSources(pulled.sources, state.pending),
  );
  const view = sameAccount
    ? mergeConcurrentLocalSources(working, latestWorking, cloudView)
    : cloudView;
  const patch: Record<string, unknown> = {
    [SUBSCRIPTION_PERSONA_KEY]: { kind: "account", userId } satisfies SubscriptionPersona,
    [accountSyncKey(userId)]: state,
  };
  if (
    !Object.prototype.hasOwnProperty.call(data, accountSourcesKey(userId)) ||
    !sameSourcesList(parseSources(data[accountSourcesKey(userId)]), view)
  ) {
    patch[accountSourcesKey(userId)] = view;
  }
  if (!hasLatestWorking || !sameSourcesList(latestWorking, view)) {
    patch.sources = view;
  }
  await storage.set(patch);
  if (state.merge === "confirmed" && state.pending.length > 0) {
    const flushed = await flushPendingOps(userId, api, storage);
    const latestAfterFlush = await storage.get([accountSourcesKey(userId), "sources"]);
    const flushedView = withLocalOnlyFields(
      parseSources(latestAfterFlush.sources) || view,
      applyPendingOpsToSources(parseSources(latestAfterFlush[accountSourcesKey(userId)]), flushed.pending),
    );
    await persistAccountSources(userId, flushedView, storage, true, flushedView);
    return { sources: flushedView, merge: flushed.merge, guestCount: guest.length };
  }
  return { sources: view, merge: state.merge, guestCount: guest.length };
}

export async function confirmFirstMerge(
  userId: string,
  api: SubscriptionCloudApi,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<{ sources: FeedSource[]; result: MergeLocalResult }> {
  const data = await storage.get([
    SUBSCRIPTION_PERSONA_KEY,
    "sources",
    SUBSCRIPTION_GUEST_SOURCES_KEY,
    accountSyncKey(userId),
  ]);
  const persona = parsePersona(data[SUBSCRIPTION_PERSONA_KEY]);
  const working = parseSources(data.sources);
  const guest = parseSources(data[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  const stateNow = parseSyncState(userId, data[accountSyncKey(userId)]);
  const mergeFrom =
    (stateNow.merge === "needed" || persona.kind === "guest") &&
    Object.prototype.hasOwnProperty.call(data, "sources")
      ? working
      : guest;
  const items = mergeFrom
    .map((source) => toSyncMetadata(source))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      platform: item.platform,
      author_id: item.authorId,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
    }));
  const result = await api.mergeLocal(items);
  const state = { ...stateNow, merge: "confirmed" as const };
  await storage.set({
    [SUBSCRIPTION_PERSONA_KEY]: { kind: "account", userId } satisfies SubscriptionPersona,
    [accountSyncKey(userId)]: state,
    [SUBSCRIPTION_GUEST_SOURCES_KEY]: [],
  });
  // Full pull is required: newly inserted rows start at revision 1 and can be
  // lower than lastPulledRevision from older cloud items.
  const pulled = await pullAccountSubscriptions(userId, api, storage, { full: true });
  const view = withLocalOnlyFields(
    mergeFrom,
    applyPendingOpsToSources(pulled.sources, pulled.state.pending),
  );
  await persistAccountSources(userId, view, storage, true, view);
  await flushPendingOps(userId, api, storage);
  const latest = await storage.get([accountSourcesKey(userId)]);
  return {
    sources: withLocalOnlyFields(view, parseSources(latest[accountSourcesKey(userId)])),
    result,
  };
}

export async function readMergePrompt(
  userId: string,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<{ needed: boolean; guestCount: number; guest: FeedSource[] }> {
  const data = await storage.get([accountSyncKey(userId), SUBSCRIPTION_GUEST_SOURCES_KEY]);
  const state = parseSyncState(userId, data[accountSyncKey(userId)]);
  const guest = parseSources(data[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  return { needed: state.merge === "needed" && guest.length > 0, guestCount: guest.length, guest };
}

export async function declineFirstMerge(
  userId: string,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<FeedSource[]> {
  const key = accountSyncKey(userId);
  const sourceKey = accountSourcesKey(userId);
  const data = await storage.get([
    key,
    sourceKey,
    "sources",
    SUBSCRIPTION_PERSONA_KEY,
    SUBSCRIPTION_GUEST_SOURCES_KEY,
  ]);
  const persona = parsePersona(data[SUBSCRIPTION_PERSONA_KEY]);
  const working = parseSources(data.sources);
  const guest =
    persona.kind === "guest" && Object.prototype.hasOwnProperty.call(data, "sources")
      ? working
      : parseSources(data[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  const state = { ...parseSyncState(userId, data[key]), merge: "declined" as const };
  const cloud = withLocalOnlyFields(parseSources(data[sourceKey]), parseSources(data[sourceKey]));
  await storage.set({
    [SUBSCRIPTION_PERSONA_KEY]: { kind: "account", userId } satisfies SubscriptionPersona,
    [key]: state,
    [SUBSCRIPTION_GUEST_SOURCES_KEY]: guest,
    [sourceKey]: cloud,
    sources: cloud,
  });
  return cloud;
}

export async function handleSignedOut(
  storage: SubscriptionStorage = chromeStorage(),
): Promise<FeedSource[]> {
  const data = await storage.get([
    SUBSCRIPTION_PERSONA_KEY,
    "sources",
    SUBSCRIPTION_GUEST_SOURCES_KEY,
  ]);
  const persona = parsePersona(data[SUBSCRIPTION_PERSONA_KEY]);
  const guest = parseSources(data[SUBSCRIPTION_GUEST_SOURCES_KEY]);
  const values: Record<string, unknown> = {
    [SUBSCRIPTION_PERSONA_KEY]: { kind: "guest" } satisfies SubscriptionPersona,
    sources: guest,
  };
  if (persona.kind === "account")
    values[accountSourcesKey(persona.userId)] = parseSources(data.sources);
  await storage.set(values);
  return guest;
}

export async function currentRevisionFor(
  userId: string,
  source: FeedSource,
  storage: SubscriptionStorage = chromeStorage(),
): Promise<number> {
  const meta = toSyncMetadata(source);
  const data = await storage.get([accountSyncKey(userId)]);
  const state = parseSyncState(userId, data[accountSyncKey(userId)]);
  if (!meta) return 0;
  return state.revisions[subscriptionKey(meta.platform, meta.authorId)] || 0;
}

function asEntry(value: unknown): SubscriptionEntry | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const platform = String(rec.platform || "") as Platform;
  const authorId = normalizeAuthorId(platform, String(rec.author_id || rec.authorId || ""));
  if (!PLATFORMS.has(platform) || !authorId) return null;
  return {
    platform,
    author_id: authorId,
    display_name: String(rec.display_name || rec.displayName || "").slice(0, 200),
    avatar_url: String(rec.avatar_url || rec.avatarUrl || "").slice(0, 1000),
    deleted_at: rec.deleted_at ? String(rec.deleted_at) : null,
    revision: Number(rec.revision || 0),
  };
}

export function createSupabaseSubscriptionApi(): SubscriptionCloudApi | null {
  const supabase = getOwlivoAuthClient();
  if (!supabase) return null;
  return {
    async listChanges(sinceRevision) {
      const { data, error } = await supabase
        .from("subscription_entries")
        .select("platform,author_id,display_name,avatar_url,deleted_at,revision")
        .gt("revision", sinceRevision)
        .order("revision", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map(asEntry).filter((item): item is SubscriptionEntry => Boolean(item));
    },
    async applyChange(op) {
      const { data, error } = await supabase.rpc("apply_subscription_change", {
        p_platform: op.platform,
        p_author_id: op.authorId,
        p_op: op.op,
        p_base_revision: op.baseRevision,
        p_op_id: op.opId,
        p_display_name: op.displayName,
        p_avatar_url: op.avatarUrl,
        p_allow_resurrect: op.allowResurrect,
      });
      if (error) throw new Error(error.message);
      const rec = (data || {}) as ApplyChangeResult;
      return {
        status: rec.status,
        idempotent: rec.idempotent,
        entry: asEntry(rec.entry) || undefined,
      };
    },
    async mergeLocal(items) {
      const { data, error } = await supabase.rpc("merge_local_subscriptions", { p_items: items });
      if (error) throw new Error(error.message);
      const rec = (data || {}) as Record<string, unknown>;
      return {
        added: Number(rec.added || 0),
        skipped_existing: Number(rec.skipped_existing || 0),
        skipped_tombstone: Number(rec.skipped_tombstone || 0),
        skipped_invalid: Number(rec.skipped_invalid || 0),
      };
    },
  };
}

export async function applyLocalSubscriptionChange(
  op: SubscriptionOpType,
  source: FeedSource,
  allowResurrect: boolean,
  expectedUserId: string,
  storage: SubscriptionStorage = chromeStorage(),
  api: SubscriptionCloudApi | null = createSupabaseSubscriptionApi(),
): Promise<boolean> {
  const persona = await readPersona(storage);
  if (persona.kind !== "account" || persona.userId !== expectedUserId) return false;
  const pending = createPendingOp({
    op,
    source,
    baseRevision: await currentRevisionFor(persona.userId, source, storage),
    allowResurrect,
  });
  if (!pending) return false;

  const currentPersona = await readPersona(storage);
  if (currentPersona.kind !== "account" || currentPersona.userId !== expectedUserId) return false;
  await enqueueAccountOp(persona.userId, pending, storage);
  // Reflect the pending change in the working list immediately. A background
  // account pull may still be using the previous cloud snapshot, but it must
  // never make a newly added source disappear from the UI in the meantime.
  const workingData = await storage.get(["sources"]);
  const working = parseSources(workingData.sources);
  const pendingApplied = applyPendingOpsToSources(working, [pending]);
  await storage.set({ sources: pendingApplied });
  if (api) {
    try {
      const state = await flushPendingOps(persona.userId, api, storage);
      const latest = await storage.get([accountSourcesKey(persona.userId), "sources"]);
      const workingLatest = parseSources(latest.sources);
      const accountLatest = parseSources(latest[accountSourcesKey(persona.userId)]);
      const pendingMerged = applyPendingOpsToSources(accountLatest, state.pending);
      // Keep concurrent local adds even when incremental pull missed a low-revision
      // cloud row after conflict-retry cleared the pending op.
      const view = withLocalOnlyFields(
        workingLatest,
        mergeConcurrentLocalSources(accountLatest, workingLatest, pendingMerged),
      );
      const beforeWritePersona = await readPersona(storage);
      if (beforeWritePersona.kind === "account" && beforeWritePersona.userId === expectedUserId) {
        await persistAccountSources(persona.userId, view, storage, true, view);
      }
    } catch {
      // Offline or transient errors stay queued for alarm retry.
    }
  }
  return true;
}
