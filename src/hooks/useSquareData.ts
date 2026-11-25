import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { RuntimeRequestContext } from "@/popup/ReaderApp";
import { sendRuntime } from "@/lib/chrome-api";
import {
  createSquareClient,
  DEMO_WEIBO_HOT_ITEMS,
  emptySquareResource,
  WEIBO_HOT_RESOURCE,
  type SquareResult,
} from "@/lib/square-data";

type Sender = (message: Record<string, unknown>) => Promise<SquareResult>;
const squareClients = new WeakMap<Sender, ReturnType<typeof createSquareClient>>();

function getSquareClient(sender: Sender) {
  let client = squareClients.get(sender);
  if (!client) {
    client = createSquareClient(sender);
    squareClients.set(sender, client);
  }
  return client;
}

export function useSquareData({
  resourceKeys,
  active,
  previewMode,
}: {
  resourceKeys: string[];
  active: boolean;
  previewMode: boolean;
}) {
  const runtimeRequest = useContext(RuntimeRequestContext);
  const client = useMemo(
    () => getSquareClient((runtimeRequest || sendRuntime) as Sender),
    [runtimeRequest],
  );
  const resources = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const [, setClock] = useState(0);
  const previewResources = useMemo(
    () =>
      Object.fromEntries(
        resourceKeys.map((key) => [
          key,
          {
            ...emptySquareResource(),
            attempted: true,
            items: key === WEIBO_HOT_RESOURCE ? DEMO_WEIBO_HOT_ITEMS : [],
          },
        ]),
      ),
    [resourceKeys],
  );

  useEffect(() => {
    if (!active || previewMode) return;
    for (const key of resourceKeys) void client.load(key, { active: true });
  }, [active, previewMode, resourceKeys, client]);

  const retryAt = Math.min(
    ...resourceKeys
      .map((key) => resources[key]?.retryAt || 0)
      .filter((at) => at > Date.now()),
  );
  useEffect(() => {
    if (!active || previewMode || !Number.isFinite(retryAt)) return;
    const timer = window.setTimeout(() => setClock((clock) => clock + 1), retryAt - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [active, previewMode, retryAt]);

  const refresh = useCallback(async () => {
    if (!active || previewMode) return;
    await Promise.all(resourceKeys.map((key) => client.load(key, { active: true, force: true })));
  }, [active, client, previewMode, resourceKeys]);

  return {
    resources: previewMode ? previewResources : resources,
    refresh,
    getSnapshot: client.getSnapshot,
  };
}
