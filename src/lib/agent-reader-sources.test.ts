import { describe, expect, it } from "vitest";
import { getAgentReaderSources } from "./agent-reader-sources";
import { SQUARE_SOURCES } from "./square-config";

describe("agent reader subscription defaults", () => {
  it("uses only the curated X sources on a fresh install", () => {
    expect(getAgentReaderSources({})).toEqual(SQUARE_SOURCES
      .filter((source) => source.platform === "x")
      .map(({ platform, id, name, avatar }) => ({ platform, id, name, avatar })));
    expect(getAgentReaderSources(null)).toHaveLength(3);
  });

  it("preserves configured sources, including an intentionally empty list", () => {
    expect(getAgentReaderSources({ sources: [] })).toEqual([]);
    const configured = [{ platform: "weibo", id: "123", name: "Configured" }];
    expect(getAgentReaderSources({ sources: configured })).toBe(configured);
  });

  it("uses defaults when the persisted record has no sources property", () => {
    expect(getAgentReaderSources({ settings: {} })).toHaveLength(3);
  });
});
