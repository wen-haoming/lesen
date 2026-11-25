import { describe, expect, it } from "vitest";
import type { FeedSource } from "./config";
import {
  applyCloudEntriesToSources,
  confirmFirstMerge,
  createPendingOp,
  declineFirstMerge,
  enqueueAccountOp,
  flushPendingOps,
  handleSignedIn,
  handleSignedOut,
  parsePersona,
  resolvePendingAfterResult,
  subscriptionKey,
  toSyncMetadata,
  uniqueSources,
  applyPendingOpsToSources,
  applyLocalSubscriptionChange,
  currentRevisionFor,
  accountSourcesKey,
  accountSyncKey,
  parseSources,
  SUBSCRIPTION_PERSONA_KEY,
  type SubscriptionCloudApi,
  type SubscriptionEntry,
  type SubscriptionStorage,
} from "./subscription-sync";

function memoryStorage(
  initial: Record<string, unknown> = {},
): SubscriptionStorage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const key of keys) if (key in data) out[key] = data[key];
      return out;
    },
    async set(values) {
      Object.assign(data, values);
    },
  };
}

function memoryApi(
  seed: SubscriptionEntry[] = [],
): SubscriptionCloudApi & { rows: SubscriptionEntry[] } {
  const rows = [...seed];
  const seenOps = new Set<string>();
  return {
    rows,
    async listChanges(sinceRevision) {
      return rows.filter((row) => row.revision > sinceRevision);
    },
    async applyChange(op) {
      if (seenOps.has(op.opId)) {
        const entry = rows.find(
          (row) => row.platform === op.platform && row.author_id === op.authorId,
        );
        return { status: "ok", idempotent: true, entry };
      }
      const index = rows.findIndex(
        (row) => row.platform === op.platform && row.author_id === op.authorId,
      );
      if (index < 0) {
        if (op.op === "patch_meta") return { status: "missing" };
        const entry: SubscriptionEntry = {
          platform: op.platform,
          author_id: op.authorId,
          display_name: op.displayName,
          avatar_url: op.avatarUrl,
          deleted_at: op.op === "unsubscribe" ? "2026-11-13T12:00:00.000Z" : null,
          revision: 1,
        };
        rows.push(entry);
        seenOps.add(op.opId);
        return { status: "ok", entry };
      }
      const current = rows[index];
      if (op.baseRevision !== current.revision) return { status: "conflict", entry: current };
      if (op.op === "subscribe") {
        if (current.deleted_at && !op.allowResurrect)
          return { status: "tombstone", entry: current };
        const entry: SubscriptionEntry = {
          ...current,
          display_name: op.displayName || current.display_name,
          avatar_url: op.avatarUrl || current.avatar_url,
          deleted_at: null,
          revision: current.revision + 1,
        };
        rows[index] = entry;
        seenOps.add(op.opId);
        return { status: "ok", entry };
      }
      if (op.op === "unsubscribe") {
        const entry: SubscriptionEntry = {
          ...current,
          deleted_at: current.deleted_at || "2026-11-13T12:00:00.000Z",
          revision: current.revision + 1,
        };
        rows[index] = entry;
        seenOps.add(op.opId);
        return { status: "ok", entry };
      }
      if (current.deleted_at) return { status: "tombstone", entry: current };
      const entry: SubscriptionEntry = {
        ...current,
        display_name: op.displayName || current.display_name,
        avatar_url: op.avatarUrl || current.avatar_url,
        revision: current.revision + 1,
      };
      rows[index] = entry;
      seenOps.add(op.opId);
      return { status: "ok", entry };
    },
    async mergeLocal(items) {
      let added = 0;
      let skipped_existing = 0;
      let skipped_tombstone = 0;
      let skipped_invalid = 0;
      for (const item of items) {
        if (!item.platform || !item.author_id) {
          skipped_invalid += 1;
          continue;
        }
        const found = rows.find(
          (row) => row.platform === item.platform && row.author_id === item.author_id,
        );
        if (found) {
          if (found.deleted_at) skipped_tombstone += 1;
          else skipped_existing += 1;
          continue;
        }
        rows.push({
          platform: item.platform,
          author_id: item.author_id,
          display_name: item.display_name,
          avatar_url: item.avatar_url,
          deleted_at: null,
          // Match the hosted RPC: a newly inserted row starts at revision 1,
          // which may be lower than lastPulledRevision from older cloud items.
          revision: 1,
        });
        added += 1;
      }
      return { added, skipped_existing, skipped_tombstone, skipped_invalid };
    },
  };
}

describe("subscription metadata", () => {
  it("keeps only platform, stable author id and display fields, and strips tokens", () => {
    const source = {
      platform: "weibo",
      id: "1234567890",
      name: "作者",
      avatar: "https://example.com/a.png",
      sessionToken: "should-not-sync",
    } as unknown as FeedSource;
    expect(toSyncMetadata(source)).toEqual({
      platform: "weibo",
      authorId: "1234567890",
      displayName: "作者",
      avatarUrl: "https://example.com/a.png",
    });
    expect(JSON.stringify(toSyncMetadata(source))).not.toContain("sessionToken");
    expect(
      toSyncMetadata({ platform: "x", id: "ELONMUSK", avatar: "javascript:alert(1)" }),
    ).toEqual({
      platform: "x",
      authorId: "elonmusk",
      displayName: "",
      avatarUrl: "",
    });
  });

  it("deduplicates by platform and stable author id", () => {
    expect(
      uniqueSources([
        { platform: "x", id: "Example", name: "One" },
        { platform: "x", id: "example", name: "Two" },
        { platform: "xueqiu", id: "123", name: "XQ" },
      ]),
    ).toEqual([
      { platform: "x", id: "example", name: "One" },
      { platform: "xueqiu", id: "123", name: "XQ" },
    ]);
  });
});

describe("cloud to local apply and conflicts", () => {
  it("applies incremental changes and honors tombstones so old snapshots cannot resurrect", () => {
    const current: FeedSource[] = [
      { platform: "x", id: "keep", name: "Keep" },
      { platform: "x", id: "gone", name: "Gone" },
    ];
    const next = applyCloudEntriesToSources(current, [
      {
        platform: "x",
        author_id: "gone",
        display_name: "Gone",
        avatar_url: "",
        deleted_at: "2026-11-13T12:00:00.000Z",
        revision: 4,
      },
      {
        platform: "xueqiu",
        author_id: "123",
        display_name: "New",
        avatar_url: "",
        deleted_at: null,
        revision: 5,
      },
    ]);
    expect(next).toEqual([
      { platform: "x", id: "keep", name: "Keep" },
      { platform: "xueqiu", id: "123", name: "New" },
    ]);
  });

  it("keeps a local avatar when a signed-in cloud row has empty metadata", () => {
    const next = applyCloudEntriesToSources(
      [{
        platform: "xueqiu",
        id: "123456",
        name: "本机昵称",
        avatar: "https://xavatar.imedao.com/community/local.jpg",
      }],
      [{
        platform: "xueqiu",
        author_id: "123456",
        display_name: "",
        avatar_url: "",
        deleted_at: null,
        revision: 8,
      }],
    );
    expect(next).toEqual([{
      platform: "xueqiu",
      id: "123456",
      name: "本机昵称",
      avatar: "https://xavatar.imedao.com/community/local.jpg",
    }]);
  });

  it("drops stale subscribe ops when the cloud already has a tombstone", () => {
    const op = createPendingOp({
      op: "subscribe",
      source: { platform: "x", id: "gone", name: "Old snapshot" },
      baseRevision: 1,
      allowResurrect: false,
      opId: "00000000-0000-4000-8000-000000000001",
    })!;
    expect(
      resolvePendingAfterResult(op, {
        status: "tombstone",
        entry: {
          platform: "x",
          author_id: "gone",
          display_name: "Gone",
          avatar_url: "",
          deleted_at: "2026-11-13T12:00:00.000Z",
          revision: 4,
        },
      }),
    ).toEqual({ action: "drop" });
  });

  it("retries an explicit user resubscribe against the current revision", () => {
    const op = createPendingOp({
      op: "subscribe",
      source: { platform: "x", id: "gone", name: "Again" },
      baseRevision: 1,
      allowResurrect: true,
      opId: "00000000-0000-4000-8000-000000000002",
    })!;
    expect(
      resolvePendingAfterResult(op, {
        status: "conflict",
        entry: {
          platform: "x",
          author_id: "gone",
          display_name: "Gone",
          avatar_url: "",
          deleted_at: "2026-11-13T12:00:00.000Z",
          revision: 4,
        },
      }),
    ).toEqual({ action: "conflict-retry", nextBaseRevision: 4 });
  });
});

describe("account partition, first merge, and retries", () => {
  it("does not auto-upload guest subscriptions on sign-in and keeps them until confirm", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "guest" },
      sources: [{ platform: "xueqiu", id: "1247347556", name: "大道无形我有型" }],
    });
    const api = memoryApi();
    const result = await handleSignedIn("user-a", api, storage);
    expect(result.merge).toBe("needed");
    expect(result.guestCount).toBe(1);
    expect(api.rows).toEqual([]);
    expect(storage.data.sources).toEqual([
      { platform: "xueqiu", id: "1247347556", name: "大道无形我有型" },
    ]);
    expect(parsePersona(storage.data["owlivo:subscription-persona"])).toEqual({ kind: "guest" });
    expect(storage.data["owlivo:sources:guest"]).toEqual([
      { platform: "xueqiu", id: "1247347556", name: "大道无形我有型" },
    ]);
  });

  it("first merge inserts only missing items and never overwrites or resurrects", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
      "owlivo:sources:guest": [
        { platform: "x", id: "new", name: "Local New" },
        { platform: "x", id: "keep", name: "Should Not Overwrite" },
        { platform: "x", id: "dead", name: "Should Not Resurrect" },
      ],
    });
    const api = memoryApi([
      {
        platform: "x",
        author_id: "keep",
        display_name: "Cloud Name",
        avatar_url: "",
        deleted_at: null,
        revision: 2,
      },
      {
        platform: "x",
        author_id: "dead",
        display_name: "Dead",
        avatar_url: "",
        deleted_at: "2026-11-13T11:00:00.000Z",
        revision: 3,
      },
    ]);
    const { sources, result } = await confirmFirstMerge("user-a", api, storage);
    expect(result).toEqual({
      added: 1,
      skipped_existing: 1,
      skipped_tombstone: 1,
      skipped_invalid: 0,
    });
    expect(sources.map((s) => s.id).sort()).toEqual(["keep", "new"]);
    expect(sources.find((s) => s.id === "keep")?.name).toBe("Cloud Name");
    expect(sources.some((s) => s.id === "dead")).toBe(false);
    expect(storage.data["owlivo:sources:guest"]).toEqual([]);
  });

  it("an empty guest list does not wipe cloud subscriptions", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "guest" },
      sources: [],
    });
    const api = memoryApi([
      {
        platform: "x",
        author_id: "cloud",
        display_name: "Cloud",
        avatar_url: "",
        deleted_at: null,
        revision: 7,
      },
    ]);
    const signedIn = await handleSignedIn("user-a", api, storage);
    expect(signedIn.merge).toBe("idle");
    expect(signedIn.sources).toEqual([{ platform: "x", id: "cloud", name: "Cloud" }]);
    const merged = await confirmFirstMerge("user-a", api, storage);
    expect(merged.result.added).toBe(0);
    expect(merged.sources).toEqual([{ platform: "x", id: "cloud", name: "Cloud" }]);
    expect(api.rows).toHaveLength(1);
  });

  it("does not carry account A subscriptions onto account B, and sign-out must not delete cloud", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "guest" },
      sources: [],
    });
    const apiA = memoryApi([
      {
        platform: "x",
        author_id: "aaa",
        display_name: "A",
        avatar_url: "",
        deleted_at: null,
        revision: 1,
      },
    ]);
    const signedA = await handleSignedIn("user-a", apiA, storage);
    expect(signedA.merge).toBe("idle");
    expect(signedA.sources).toEqual([{ platform: "x", id: "aaa", name: "A" }]);

    const apiB = memoryApi([
      {
        platform: "x",
        author_id: "bbb",
        display_name: "B",
        avatar_url: "",
        deleted_at: null,
        revision: 1,
      },
    ]);
    const switched = await handleSignedIn("user-b", apiB, storage);
    expect(switched.sources).toEqual([{ platform: "x", id: "bbb", name: "B" }]);
    expect(switched.sources.some((s) => s.id === "aaa")).toBe(false);
    expect(storage.data["owlivo:sources:account:user-a"]).toEqual([
      { platform: "x", id: "aaa", name: "A" },
    ]);
    expect(apiA.rows).toHaveLength(1);
    expect(apiB.rows.map((row) => row.author_id)).toEqual(["bbb"]);

    const guest = await handleSignedOut(storage);
    expect(guest).toEqual([]);
    expect(storage.data.sources).toEqual([]);
    expect(parsePersona(storage.data["owlivo:subscription-persona"])).toEqual({ kind: "guest" });
    expect(storage.data["owlivo:sources:account:user-a"]).toEqual([
      { platform: "x", id: "aaa", name: "A" },
    ]);
    expect(storage.data["owlivo:sources:account:user-b"]).toEqual([
      { platform: "x", id: "bbb", name: "B" },
    ]);
    expect(apiA.rows).toHaveLength(1);
    expect(apiB.rows).toHaveLength(1);
  });

  it("keeps a declined merge local-only and still loads the account cloud list", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "guest" },
      sources: [{ platform: "x", id: "local", name: "Local" }],
    });
    const api = memoryApi([
      {
        platform: "x",
        author_id: "cloud",
        display_name: "Cloud",
        avatar_url: "",
        deleted_at: null,
        revision: 1,
      },
    ]);
    await handleSignedIn("user-a", api, storage);
    const declined = await declineFirstMerge("user-a", storage);
    expect(declined).toEqual([{ platform: "x", id: "cloud", name: "Cloud" }]);
    expect(api.rows.map((row) => row.author_id)).toEqual(["cloud"]);
    expect(storage.data["owlivo:sources:guest"]).toEqual([
      { platform: "x", id: "local", name: "Local" },
    ]);
    expect(storage.data.sources).toEqual([{ platform: "x", id: "cloud", name: "Cloud" }]);
  });

  it("retries a queued unsubscribe after a conflict instead of applying a stale snapshot upsert", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
    });
    const api = memoryApi([
      {
        platform: "x",
        author_id: "keep",
        display_name: "Keep",
        avatar_url: "",
        deleted_at: null,
        revision: 3,
      },
    ]);
    const op = createPendingOp({
      op: "unsubscribe",
      source: { platform: "x", id: "keep", name: "Keep" },
      baseRevision: 1,
      allowResurrect: false,
      opId: "00000000-0000-4000-8000-000000000003",
    })!;
    await enqueueAccountOp("user-a", op, storage);
    const state = await flushPendingOps("user-a", api, storage);
    expect(state.pending).toEqual([]);
    expect(api.rows[0]?.deleted_at).toBeTruthy();
    expect(api.rows[0]?.revision).toBe(4);
  });

  it("is idempotent when the same pending op is flushed twice", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
    });
    const api = memoryApi();
    const op = createPendingOp({
      op: "subscribe",
      source: { platform: "weibo", id: "1001", name: "微博用户" },
      baseRevision: 0,
      allowResurrect: true,
      opId: "00000000-0000-4000-8000-000000000004",
    })!;
    await enqueueAccountOp("user-a", op, storage);
    await flushPendingOps("user-a", api, storage);
    await enqueueAccountOp("user-a", op, storage);
    await flushPendingOps("user-a", api, storage);
    expect(api.rows).toHaveLength(1);
    expect(api.rows[0]?.revision).toBe(1);
    expect(subscriptionKey("weibo", "1001")).toBe("weibo:1001");
  });

  it("keeps a just-added weibo source when conflict-retry beats a lagging incremental pull", async () => {
    const storage = memoryStorage({
      "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
      sources: [
        { platform: "xueqiu", id: "1247347556", name: "大道" },
        { platform: "weibo", id: "1734741902", name: "微博用户", avatar: "https://tvax4.sinaimg.cn/a.jpg" },
      ],
      [accountSourcesKey("user-a")]: [{ platform: "xueqiu", id: "1247347556", name: "大道" }],
      [accountSyncKey("user-a")]: {
        userId: "user-a",
        lastPulledRevision: 9,
        pending: [],
        merge: "confirmed",
        revisions: { "xueqiu:1247347556": 9 },
      },
    });
    const api = memoryApi([
      {
        platform: "xueqiu",
        author_id: "1247347556",
        display_name: "大道",
        avatar_url: "",
        deleted_at: null,
        revision: 9,
      },
      {
        platform: "weibo",
        author_id: "1734741902",
        display_name: "旧名",
        avatar_url: "",
        deleted_at: null,
        revision: 2,
      },
    ]);
    const applied = await applyLocalSubscriptionChange(
      "subscribe",
      {
        platform: "weibo",
        id: "1734741902",
        name: "微博用户",
        avatar: "https://tvax4.sinaimg.cn/a.jpg",
      },
      true,
      "user-a",
      storage,
      api,
    );
    expect(applied).toBe(true);
    const sources = storage.data.sources as FeedSource[];
    expect(sources.some((item) => item.platform === "weibo" && item.id === "1734741902")).toBe(
      true,
    );
    const account = storage.data[accountSourcesKey("user-a")] as FeedSource[];
    expect(account.some((item) => item.platform === "weibo" && item.id === "1734741902")).toBe(
      true,
    );
  });

  it("simulates a reinstall by pulling the account list into empty local storage", async () => {
    const api = memoryApi([
      {
        platform: "xueqiu",
        author_id: "1247347556",
        display_name: "大道无形我有型",
        avatar_url: "",
        deleted_at: null,
        revision: 9,
      },
    ]);
    const reinstalled = memoryStorage({
      "owlivo:subscription-persona": { kind: "guest" },
      sources: [],
    });
    const result = await handleSignedIn("user-a", api, reinstalled);
    expect(result.merge).toBe("idle");
    expect(result.sources).toEqual([
      { platform: "xueqiu", id: "1247347556", name: "大道无形我有型" },
    ]);
  });
});

it("does not merge unsupported guest sources or leak local extra tokens", async () => {
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "guest" },
    sources: [
      {
        platform: "legacy_removed",
        id: "AbC123",
        name: "作者",
        avatar: "https://example.com/a.png",
        secretToken: "should-not-sync",
      },
      { platform: "weibo", id: "1234567890", name: "微博作者", secretToken: "should-not-sync" },
    ],
  });
  const payloads: unknown[] = [];
  const api = memoryApi();
  const original = api.mergeLocal.bind(api);
  api.mergeLocal = async (items) => {
    payloads.push(items);
    return original(items);
  };
  const signed = await handleSignedIn("user-a", api, storage);
  expect(signed.merge).toBe("needed");
  expect(storage.data.sources).toEqual([{ platform: "weibo", id: "1234567890", name: "微博作者" }]);
  const { sources, result } = await confirmFirstMerge("user-a", api, storage);
  expect(result.added).toBe(1);
  expect(JSON.stringify(payloads)).not.toContain("should-not-sync");
  expect(JSON.stringify(payloads)).not.toContain("secretToken");
  expect(JSON.stringify(payloads)).not.toContain("legacy_removed");
  expect(sources.map((item) => item.platform)).toEqual(["weibo"]);
  expect(sources.find((item) => item.id === "1234567890")?.name).toBe("微博作者");
});

it("confirms the latest working guest list, not a stale guest snapshot", async () => {
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "guest" },
    sources: [{ platform: "x", id: "one", name: "One" }],
  });
  const api = memoryApi();
  await handleSignedIn("user-a", api, storage);
  storage.data.sources = [
    { platform: "x", id: "one", name: "One" },
    { platform: "x", id: "two", name: "Two" },
  ];
  const { result, sources } = await confirmFirstMerge("user-a", api, storage);
  expect(result.added).toBe(2);
  expect(sources.map((item) => item.id).sort()).toEqual(["one", "two"]);
});

it("full-pulls after first merge so a revision-1 insert is not missed when lastPulled is already high", async () => {
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "guest" },
    sources: [{ platform: "x", id: "new", name: "Local New" }],
    [accountSyncKey("user-a")]: {
      userId: "user-a",
      lastPulledRevision: 9,
      pending: [],
      merge: "needed",
      revisions: { "x:keep": 9 },
    },
    "owlivo:sources:account:user-a": [{ platform: "x", id: "keep", name: "Cloud Name" }],
  });
  const api = memoryApi([
    {
      platform: "x",
      author_id: "keep",
      display_name: "Cloud Name",
      avatar_url: "",
      deleted_at: null,
      revision: 9,
    },
  ]);
  const { sources, result } = await confirmFirstMerge("user-a", api, storage);
  expect(result.added).toBe(1);
  expect(api.rows.find((row) => row.author_id === "new")?.revision).toBe(1);
  expect(sources.map((item) => item.id).sort()).toEqual(["keep", "new"]);
});

it("does not let a later pull resurrect an offline unsubscribe still in the pending queue", async () => {
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
    sources: [],
    "owlivo:sources:account:user-a": [],
  });
  const api = memoryApi([
    {
      platform: "x",
      author_id: "keep",
      display_name: "Keep",
      avatar_url: "",
      deleted_at: null,
      revision: 3,
    },
  ]);
  await handleSignedIn("user-a", api, storage);
  expect(await currentRevisionFor("user-a", { platform: "x", id: "keep" }, storage)).toBe(3);
  const op = createPendingOp({
    op: "unsubscribe",
    source: { platform: "x", id: "keep", name: "Keep" },
    baseRevision: await currentRevisionFor("user-a", { platform: "x", id: "keep" }, storage),
    allowResurrect: false,
    opId: "00000000-0000-4000-8000-000000000005",
  })!;
  await enqueueAccountOp("user-a", op, storage);
  // A sign-in/settings refresh must keep the local unsubscribe visible even
  // before the queued op has been flushed to the cloud.
  const signed = await handleSignedIn("user-a", api, storage);
  expect(signed.sources.some((item) => item.id === "keep")).toBe(false);
  expect(api.rows[0]?.deleted_at).toBeNull();
  const overlay = applyPendingOpsToSources([{ platform: "x", id: "keep", name: "Keep" }], [op]);
  expect(overlay).toEqual([]);
});

it("recovers a full cloud list when the local account cache is empty but lastPulledRevision is stale", async () => {
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "guest" },
    sources: [],
    [accountSyncKey("user-a")]: {
      userId: "user-a",
      lastPulledRevision: 9,
      pending: [],
      merge: "idle",
      revisions: {},
    },
  });
  const api = memoryApi([
    {
      platform: "x",
      author_id: "old",
      display_name: "Old",
      avatar_url: "",
      deleted_at: null,
      revision: 2,
    },
    {
      platform: "x",
      author_id: "new",
      display_name: "New",
      avatar_url: "",
      deleted_at: null,
      revision: 9,
    },
  ]);
  const result = await handleSignedIn("user-a", api, storage);
  expect(result.sources.map((item) => item.id).sort()).toEqual(["new", "old"]);
});

it("keeps a locally added source when account cloud sync finishes after the add", async () => {
  const existing: FeedSource = { platform: "x", id: "existing", name: "Existing" };
  const added: FeedSource = {
    platform: "xueqiu",
    id: "123456",
    name: "刚添加的用户",
    avatar: "https://example.com/avatar.png",
  };
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "account", userId: "user-a" },
    sources: [existing],
    "owlivo:sources:account:user-a": [existing],
  });
  const api = memoryApi([
    {
      platform: "x",
      author_id: "existing",
      display_name: "Existing",
      avatar_url: "",
      deleted_at: null,
      revision: 1,
    },
  ]);
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const inFlight = new Promise<void>((resolve) => (release = resolve));
  const listChanges = api.listChanges.bind(api);
  api.listChanges = async (revision) => {
    markStarted();
    await inFlight;
    return listChanges(revision);
  };

  const syncing = handleSignedIn("user-a", api, storage);
  await started;
  storage.data.sources = [existing, added];
  release();

  const result = await syncing;
  expect(result.sources).toContainEqual(added);
  expect(storage.data.sources).toContainEqual(added);
  expect(storage.data["owlivo:sources:account:user-a"]).toContainEqual(added);
});

it("rechecks guest sources before deciding whether cloud initialization needs a merge", async () => {
  const added: FeedSource = {
    platform: "weibo",
    id: "1234567890",
    name: "新作者",
    avatar: "https://example.com/weibo-avatar.png",
  };
  const storage = memoryStorage({
    "owlivo:subscription-persona": { kind: "guest" },
    sources: [],
  });
  const api = memoryApi();
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const inFlight = new Promise<void>((resolve) => (release = resolve));
  const listChanges = api.listChanges.bind(api);
  api.listChanges = async (revision) => {
    markStarted();
    await inFlight;
    return listChanges(revision);
  };

  const syncing = handleSignedIn("user-a", api, storage);
  await started;
  storage.data.sources = [added];
  release();

  const result = await syncing;
  expect(result.merge).toBe("needed");
  expect(result.sources).toEqual([added]);
  expect(storage.data.sources).toEqual([added]);
  expect(storage.data["owlivo:sources:guest"]).toEqual([
    {
      platform: "weibo",
      id: added.id,
      name: added.name,
      avatar: added.avatar,
    },
  ]);
});


describe("unsupported platform filtering and idle flush guard", () => {
  it("does not let unsupported cloud rows reappear in local sources", () => {
    const current = [
      { platform: "xueqiu", id: "1001", name: "雪球" },
      { platform: "legacy_removed", id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "旧平台" },
    ] as unknown as FeedSource[];
    const next = applyCloudEntriesToSources(current, [
      {
        platform: "legacy_removed" as never,
        author_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        display_name: "云端旧平台",
        avatar_url: "",
        deleted_at: null,
        revision: 9,
      },
      {
        platform: "weibo",
        author_id: "2002",
        display_name: "微博",
        avatar_url: "",
        deleted_at: null,
        revision: 10,
      },
    ]);
    expect(next.map((source) => source.platform + ":" + source.id)).toEqual([
      "xueqiu:1001",
      "weibo:2002",
    ]);
  });

  it("strips unsupported platforms from parseSources while keeping supported platforms", () => {
    expect(
      parseSources([
        { platform: "x", id: "abc", name: "X" },
        { platform: "legacy_removed", id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "旧平台" },
        { platform: "weibo", id: "9", name: "微博" },
      ]).map((source) => source.platform),
    ).toEqual(["x", "weibo"]);
  });

  it("short-circuits flushPendingOps with zero cloud calls when pending queue is empty", async () => {
    let calls = 0;
    const api = memoryApi([
      {
        platform: "xueqiu",
        author_id: "1001",
        display_name: "雪球作者",
        avatar_url: "",
        deleted_at: null,
        revision: 3,
      },
    ]);
    const originalList = api.listChanges.bind(api);
    api.listChanges = async (...args) => {
      calls += 1;
      return originalList(...args);
    };
    const storage = memoryStorage({
      [SUBSCRIPTION_PERSONA_KEY]: { kind: "account", userId: "user-1" },
      [accountSourcesKey("user-1")]: [{ platform: "xueqiu", id: "1001", name: "雪球作者" }],
      sources: [{ platform: "xueqiu", id: "1001", name: "雪球作者" }],
      [accountSyncKey("user-1")]: {
        hasCompletedBootstrap: true,
        lastPulledRevision: 3,
        revisions: { "xueqiu:1001": 3 },
        pending: [],
        firstMergePending: false,
      },
    });
    const result = await flushPendingOps("user-1", api, storage);
    expect(calls).toBe(0);
    expect(result.pending).toEqual([]);
    expect(storage.data.sources).toEqual([{ platform: "xueqiu", id: "1001", name: "雪球作者" }]);
  });
});
