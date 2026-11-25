import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RuntimeRequestContext } from "@/popup/ReaderApp";
import { sendRuntime } from "@/lib/chrome-api";
import {
  createWeiboTopicClient,
  emptyWeiboTopic,
  type WeiboTopicResult,
} from "@/lib/weibo-topic-state";

const EMPTY = emptyWeiboTopic();
type Sender = (message: Record<string, unknown>) => Promise<WeiboTopicResult>;
const weiboTopicClients = new WeakMap<Sender, ReturnType<typeof createWeiboTopicClient>>();

function getWeiboTopicClient(sender: Sender) {
  let client = weiboTopicClients.get(sender);
  if (!client) {
    client = createWeiboTopicClient(sender);
    weiboTopicClients.set(sender, client);
  }
  return client;
}

export function useWeiboTopic({
  word,
  active,
  previewMode,
}: {
  word: string;
  active: boolean;
  previewMode: boolean;
}) {
  const runtimeRequest = useContext(RuntimeRequestContext);
  const client = useMemo(
    () => getWeiboTopicClient((runtimeRequest || sendRuntime) as Sender),
    [runtimeRequest],
  );
  const resources = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const resource = previewMode ? EMPTY : resources[word] || EMPTY;
  const [, setClock] = useState(0);
  const lastRequestedWordRef = useRef("");

  useEffect(() => {
    if (!active || previewMode || !word) return;
    const isInitialWord = !lastRequestedWordRef.current;
    lastRequestedWordRef.current = word;
    const cached = client.getSnapshot()[word];
    if (isInitialWord || cached?.attempted) {
      void client.load(word, { active: true });
      return;
    }
    const timer = window.setTimeout(() => {
      void client.load(word, { active: true });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [word, active, previewMode, client]);

  useEffect(() => {
    if (!active || previewMode || resource.retryAt <= Date.now()) return;
    const timer = window.setTimeout(
      () => setClock((clock) => clock + 1),
      resource.retryAt - Date.now() + 1,
    );
    return () => window.clearTimeout(timer);
  }, [active, previewMode, resource.retryAt]);

  return {
    resource,
    refresh: () => client.load(word, { active: active && !previewMode, force: true }),
    loadMore: () => client.load(word, { active: active && !previewMode, more: true }),
  };
}
