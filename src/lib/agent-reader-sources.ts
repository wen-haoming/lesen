import type { FeedSource } from "./config";
import { SQUARE_SOURCES } from "./square-config";

export type PersistedAgentReaderSources = { sources?: unknown } | null | undefined;

const DEFAULT_AGENT_READER_SOURCES: FeedSource[] = SQUARE_SOURCES
  .filter((source) => source.platform === "x")
  .map(({ platform, id, name, avatar }) => ({ platform, id, name, avatar }));

/**
 * Seed only a first-run agent-reader install. A persisted sources array, including
 * an empty one, is an explicit user choice and must be kept as-is.
 */
export function getAgentReaderSources(persisted: PersistedAgentReaderSources): FeedSource[] {
  if (persisted && Array.isArray(persisted.sources)) return persisted.sources as FeedSource[];
  return DEFAULT_AGENT_READER_SOURCES.map((source) => ({ ...source }));
}
