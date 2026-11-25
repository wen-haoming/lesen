import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RuntimeRequestContext } from "@/popup/ReaderApp";
import { sendRuntime } from "@/lib/chrome-api";
import {
  createXueqiuHotClient,
  createXueqiuTopicClient,
  emptyXueqiuHot,
  emptyXueqiuTopic,
  type XueqiuHotResult,
  type XueqiuTopicResult,
} from "@/lib/xueqiu-topic-state";

const EMPTY_HOT = emptyXueqiuHot();
const EMPTY_TOPIC = emptyXueqiuTopic();

type HotSender = (message: Record<string, unknown>) => Promise<XueqiuHotResult>;
type TopicSender = (message: Record<string, unknown>) => Promise<XueqiuTopicResult>;

const xueqiuHotClients = new WeakMap<HotSender, ReturnType<typeof createXueqiuHotClient>>();
const xueqiuTopicClients = new WeakMap<TopicSender, ReturnType<typeof createXueqiuTopicClient>>();

function getXueqiuHotClient(sender: HotSender) {
  let client = xueqiuHotClients.get(sender);
  if (!client) {
    client = createXueqiuHotClient(sender);
    xueqiuHotClients.set(sender, client);
  }
  return client;
}

function getXueqiuTopicClient(sender: TopicSender) {
  let client = xueqiuTopicClients.get(sender);
  if (!client) {
    client = createXueqiuTopicClient(sender);
    xueqiuTopicClients.set(sender, client);
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

export function useXueqiuHot({ active, previewMode }: { active: boolean; previewMode: boolean }) {
  const runtimeRequest = useContext(RuntimeRequestContext);
  const hotClient = useMemo(
    () => getXueqiuHotClient((runtimeRequest || sendRuntime) as HotSender),
    [runtimeRequest],
  );
  const snapshot = useSyncExternalStore(
    hotClient.subscribe,
    hotClient.getSnapshot,
    hotClient.getSnapshot,
  );
  const enabled = active && !previewMode;
  const resource = previewMode ? EMPTY_HOT : snapshot;
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

export function useXueqiuTopic({
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
    () => getXueqiuTopicClient((runtimeRequest || sendRuntime) as TopicSender),
    [runtimeRequest],
  );
  const resources = useSyncExternalStore(
    topicClient.subscribe,
    topicClient.getSnapshot,
    topicClient.getSnapshot,
  );
  const enabled = active && !previewMode;
  const resource = previewMode ? EMPTY_TOPIC : resources[word] || EMPTY_TOPIC;
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
    }, 160);
    return () => window.clearTimeout(timer);
  }, [word, enabled, topicClient]);

  useCooldownClock(resource.retryAt, enabled);
  return {
    resource,
    refresh: () => topicClient.load(word, { active: enabled, force: true }),
    loadMore: () => topicClient.load(word, { active: enabled, more: true }),
  };
}
