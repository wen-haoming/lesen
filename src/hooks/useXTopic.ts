import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RuntimeRequestContext } from "@/popup/ReaderApp";
import { sendRuntime } from "@/lib/chrome-api";
import {
  createXHotClient,
  createXTopicClient,
  emptyXHot,
  emptyXTopic,
  type XHotResult,
  type XTopicResult,
} from "@/lib/x-topic-state";

const EMPTY_HOT = emptyXHot();
const EMPTY_TOPIC = emptyXTopic();

type HotSender = (message: Record<string, unknown>) => Promise<XHotResult>;
type TopicSender = (message: Record<string, unknown>) => Promise<XTopicResult>;

const xHotClients = new WeakMap<HotSender, ReturnType<typeof createXHotClient>>();
const xTopicClients = new WeakMap<TopicSender, ReturnType<typeof createXTopicClient>>();

function getXHotClient(sender: HotSender) {
  let client = xHotClients.get(sender);
  if (!client) {
    client = createXHotClient(sender);
    xHotClients.set(sender, client);
  }
  return client;
}

function getXTopicClient(sender: TopicSender) {
  let client = xTopicClients.get(sender);
  if (!client) {
    client = createXTopicClient(sender);
    xTopicClients.set(sender, client);
  }
  return client;
}

function useCooldownClock(retryAt: number, active: boolean) {
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!active || retryAt <= Date.now()) return;
    const timer = window.setTimeout(() => setClock((clock) => clock + 1), retryAt - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [active, retryAt]);
}

export function useXHot({ active, previewMode }: { active: boolean; previewMode: boolean }) {
  const runtimeRequest = useContext(RuntimeRequestContext);
  const hotClient = useMemo(
    () => getXHotClient((runtimeRequest || sendRuntime) as HotSender),
    [runtimeRequest],
  );
  const snapshot = useSyncExternalStore(
    hotClient.subscribe,
    hotClient.getSnapshot,
    hotClient.getSnapshot,
  );
  const resource = previewMode ? EMPTY_HOT : snapshot;
  const enabled = active && !previewMode;
  useEffect(() => {
    if (enabled) void hotClient.load({ active: true });
  }, [enabled, hotClient]);
  useCooldownClock(resource.retryAt, enabled);
  return {
    resource,
    refresh: () => hotClient.load({ active: enabled, force: true }),
    getSnapshot: hotClient.getSnapshot,
  };
}

export function useXTopic({
  word,
  active,
  previewMode,
}: {
  word: string;
  active: boolean;
  previewMode: boolean;
}) {
  const runtimeRequest = useContext(RuntimeRequestContext);
  const topicClient = useMemo(
    () => getXTopicClient((runtimeRequest || sendRuntime) as TopicSender),
    [runtimeRequest],
  );
  const resources = useSyncExternalStore(
    topicClient.subscribe,
    topicClient.getSnapshot,
    topicClient.getSnapshot,
  );
  const resource = previewMode ? EMPTY_TOPIC : resources[word] || EMPTY_TOPIC;
  const enabled = active && !previewMode;
  const lastRequestedWordRef = useRef("");

  useEffect(() => {
    if (!enabled || !word) return;
    const isInitialWord = !lastRequestedWordRef.current;
    lastRequestedWordRef.current = word;
    const cached = topicClient.getSnapshot()[word];
    if (isInitialWord || cached?.attempted) {
      void topicClient.load(word, { active: true });
      return;
    }
    const timer = window.setTimeout(() => {
      void topicClient.load(word, { active: true });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [word, enabled, topicClient]);

  useCooldownClock(resource.retryAt, enabled);
  return {
    resource,
    refresh: () => topicClient.load(word, { active: enabled, force: true }),
    loadMore: () => topicClient.load(word, { active: enabled, more: true }),
  };
}
