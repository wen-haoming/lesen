import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  legacyBrokenRepositoryCompare,
  shouldRunMainPush,
  shouldRunPrChecks,
  shouldRunTagPush,
} from "./cws-pipeline-job-gates.mjs";

const repo = "wen-haoming/lesen";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/cws-pipeline.yml"), "utf8");

describe("cws-pipeline job gates", () => {
  it("does not use broken github.repository == github.event.repository on push jobs", () => {
    expect(workflow).not.toMatch(
      /github\.repository\s*==\s*github\.event\.repository(?!\.)/
    );
    expect(workflow).toMatch(/github\.event\.repository\.full_name\s*==\s*github\.repository/);
  });

  it("legacy push compare always false when event.repository is an object", () => {
    const broken = legacyBrokenRepositoryCompare(repo, { full_name: repo });
    expect(broken).toBe(false);
    expect(shouldRunMainPush({
      eventName: "push",
      ref: "refs/heads/main",
      repositoryFullName: repo,
      pushRepositoryFullName: repo,
    })).toBe(true);
  });

  it("PR matrix: same-repo runs, fork skips", () => {
    expect(
      shouldRunPrChecks({
        eventName: "pull_request",
        repositoryFullName: repo,
        pullRequestHeadRepoFullName: repo,
      })
    ).toBe(true);
    expect(
      shouldRunPrChecks({
        eventName: "pull_request",
        repositoryFullName: repo,
        pullRequestHeadRepoFullName: "attacker/fork",
      })
    ).toBe(false);
    expect(shouldRunPrChecks({ eventName: "push", repositoryFullName: repo })).toBe(false);
  });

  it("main push matrix", () => {
    expect(
      shouldRunMainPush({
        eventName: "push",
        ref: "refs/heads/main",
        repositoryFullName: repo,
        pushRepositoryFullName: repo,
      })
    ).toBe(true);
    expect(
      shouldRunMainPush({
        eventName: "push",
        ref: "refs/heads/cursor/foo",
        repositoryFullName: repo,
        pushRepositoryFullName: repo,
      })
    ).toBe(false);
    expect(shouldRunTagPush({
      eventName: "push",
      ref: "refs/heads/main",
      repositoryFullName: repo,
      pushRepositoryFullName: repo,
    })).toBe(false);
  });

  it("tag push matrix", () => {
    expect(
      shouldRunTagPush({
        eventName: "push",
        ref: "refs/tags/lesen-v1.8.9",
        repositoryFullName: repo,
        pushRepositoryFullName: repo,
      })
    ).toBe(true);
    expect(
      shouldRunTagPush({
        eventName: "push",
        ref: "refs/tags/v1.0.0",
        repositoryFullName: repo,
        pushRepositoryFullName: repo,
      })
    ).toBe(true);
    expect(shouldRunPrChecks({
      eventName: "pull_request",
      repositoryFullName: repo,
      pullRequestHeadRepoFullName: repo,
    })).toBe(true);
    expect(
      shouldRunMainPush({
        eventName: "push",
        ref: "refs/tags/lesen-v1.8.9",
        repositoryFullName: repo,
        pushRepositoryFullName: repo,
      })
    ).toBe(false);
  });

  it("mutual exclusion: exactly one job for trusted main push vs tag", () => {
    const mainCtx = {
      eventName: "push",
      ref: "refs/heads/main",
      repositoryFullName: repo,
      pushRepositoryFullName: repo,
    };
    const tagCtx = {
      eventName: "push",
      ref: "refs/tags/lesen-v1.8.10",
      repositoryFullName: repo,
      pushRepositoryFullName: repo,
    };
    expect(shouldRunMainPush(mainCtx)).toBe(true);
    expect(shouldRunTagPush(mainCtx)).toBe(false);
    expect(
      shouldRunPrChecks({
        eventName: "pull_request",
        repositoryFullName: repo,
        pullRequestHeadRepoFullName: repo,
      })
    ).toBe(true);
    expect(shouldRunPrChecks({ eventName: "pull_request", repositoryFullName: repo, pullRequestHeadRepoFullName: "evil/fork" })).toBe(false);
    expect(shouldRunMainPush(tagCtx)).toBe(false);
    expect(shouldRunTagPush(tagCtx)).toBe(true);
  });
});