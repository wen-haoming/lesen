/**
 * Pure helpers mirroring .github/workflows/cws-pipeline.yml job `if` conditions.
 * Used to regression-test event matrices and prevent false-green all-skipped jobs.
 */

/**
 * @param {{
 *   eventName: string;
 *   ref?: string;
 *   repositoryFullName: string;
 *   pushRepositoryFullName?: string;
 *   pullRequestHeadRepoFullName?: string;
 * }} ctx
 */
export function shouldRunPrChecks(ctx) {
  if (ctx.eventName !== "pull_request") return false;
  return ctx.pullRequestHeadRepoFullName === ctx.repositoryFullName;
}

/**
 * @param {{
 *   eventName: string;
 *   ref?: string;
 *   repositoryFullName: string;
 *   pushRepositoryFullName?: string;
 * }} ctx
 */
export function shouldRunMainPush(ctx) {
  if (ctx.eventName !== "push") return false;
  if (ctx.ref !== "refs/heads/main") return false;
  const pushRepo = ctx.pushRepositoryFullName ?? ctx.repositoryFullName;
  return pushRepo === ctx.repositoryFullName;
}

/**
 * @param {{
 *   eventName: string;
 *   ref?: string;
 *   repositoryFullName: string;
 *   pushRepositoryFullName?: string;
 * }} ctx
 */
export function shouldRunTagPush(ctx) {
  if (ctx.eventName !== "push") return false;
  if (!String(ctx.ref || "").startsWith("refs/tags/")) return false;
  const pushRepo = ctx.pushRepositoryFullName ?? ctx.repositoryFullName;
  return pushRepo === ctx.repositoryFullName;
}

/** @deprecated Buggy GitHub expression: object !== string */
export function legacyBrokenRepositoryCompare(repositoryString, eventRepository) {
  return repositoryString === eventRepository;
}