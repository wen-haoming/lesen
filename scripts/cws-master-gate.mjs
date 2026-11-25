/**
 * Lesen main 版本变更门禁（迁移自原 CNB master 语义）。
 * 只有受信 main push，且当前与推送前的 package.json、manifest 版本都一致，
 * 并且该版本相对推送前 SHA 递增时，
 * 才允许进入正式送审。仅路径变化、版本未递增时，本模块返回 VERIFY_ONLY；是否进入送审由
 * owlivo-master-release.sh 结合只读 plan 的 decideVerifyOnlyFollowup 决定（商店已是本版本则只验证跳过；
 * 商店尚未接收本版本且 plan 为 READY 时可在质量门禁后进入发布流程；其它版本在审则 fail-closed）。
 * 本模块不访问商店、不打印密钥；商店幂等与待审冲突由 cws.mjs 的 live fetchStatus 处理。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareChromeVersions, decideSameVersionSkipOnly, parseChromeVersion } from './cws-lib.mjs';
import { KNOWN_PUBLISHED_FLOOR, normalizeSha, readPackageVersion, shasMatch } from './cws-tag-gate.mjs';

export { KNOWN_PUBLISHED_FLOOR, normalizeSha, readPackageVersion, shasMatch };

const ZERO_SHA = '0'.repeat(40);
const PACKAGE_REL = 'package.json';
const WXT_REL = 'wxt.config.ts';

export function readWxtVersionFromText(text) {
  const direct = String(text || '').match(/\bversion:\s*"(\d+\.\d+\.\d+)"/);
  if (direct) return direct[1];
  if (/version:\s*productVersion/.test(text || '')) {
    return '';
  }
  return '';
}

export function readGitTextAtSha({ repoRoot, sha, filePath }) {
  if (isZeroSha(sha) || !normalizeSha(sha)) {
    return { ok: false, text: '', error: 'invalid sha' };
  }
  try {
    const raw = execFileSync('git', ['show', `${sha}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, text: raw };
  } catch {
    return { ok: false, text: '', error: 'git show failed' };
  }
}

export function readCurrentManifestVersion({ repoRoot, packageVersion } = {}) {
  const full = path.join(repoRoot, WXT_REL);
  const text = readFileSync(full, 'utf8');
  const direct = readWxtVersionFromText(text);
  if (direct) return direct;
  if (/version:\s*productVersion/.test(text) && packageVersion) return packageVersion;
  return '';
}

export function readWxtVersionAtSha({ repoRoot, sha, filePath = WXT_REL } = {}) {
  const file = readGitTextAtSha({ repoRoot, sha, filePath });
  if (!file.ok) return { ok: false, version: null, error: file.error };
  const version = readWxtVersionFromText(file.text);
  if (version) return { ok: true, version };
  if (/version:\s*productVersion/.test(file.text)) {
    const pkg = readPackageVersionAtSha({ repoRoot, sha });
    if (pkg.ok) return { ok: true, version: pkg.version };
  }
  return { ok: false, version: null, error: 'empty version' };
}

export function isZeroSha(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.length > 0 && /^0+$/.test(text);
}

export function fail(code, message) {
  return { ok: false, live: false, code, message };
}

export function decideMasterEventGate({ event, branch, isTag = null } = {}) {
  if (event !== 'push') {
    return fail(
      'WRONG_EVENT',
      `main 版本送审只允许受信 push，当前事件是 ${event || '（空）'}。标签请走 tag 门禁。`,
    );
  }
  const br = String(branch || '').trim();
  if (br !== 'main' && br !== 'master') {
    return fail('WRONG_BRANCH', `只允许默认分支 main/master，当前 branch=${branch || '（空）'}`);
  }
  const tagFlag = isTag == null ? '' : String(isTag).trim().toLowerCase();
  if (tagFlag && ['true', '1', 'yes'].includes(tagFlag)) {
    return fail('NOT_A_BRANCH_PUSH', `CNB_IS_TAG=${isTag}，拒绝把标签构建当作 master 版本送审`);
  }
  return { ok: true, live: false, code: 'EVENT_OK', message: '事件为受信 master push' };
}

export function decideHeadCommitMatch({ headSha, cnbCommit } = {}) {
  if (!normalizeSha(headSha) || !normalizeSha(cnbCommit)) {
    return fail('MISSING_COMMIT', '缺少 HEAD 或 CNB_COMMIT，无法确认使用的是推送指定 commit');
  }
  if (!shasMatch(headSha, cnbCommit)) {
    return fail('COMMIT_MISMATCH', '工作区 HEAD 与 CNB_COMMIT 不一致，拒绝送审');
  }
  return {
    ok: true,
    live: false,
    code: 'COMMIT_OK',
    sha: normalizeSha(cnbCommit),
    message: 'HEAD 与 CNB_COMMIT 指向同一 commit',
  };
}

export function decideMasterVersionChange({
  currentVersion,
  previousVersion,
  manifestVersion = null,
  previousManifestVersion = null,
  publishedFloor = KNOWN_PUBLISHED_FLOOR,
} = {}) {
  if (!parseChromeVersion(currentVersion)) {
    return fail('INVALID_VERSION', `当前 package.json 版本无效：${currentVersion || '（空）'}`);
  }
  if (manifestVersion == null || manifestVersion === '') {
    return fail('MISSING_MANIFEST_VERSION', '缺少当前 wxt.config.ts 版本，拒绝送审');
  }
  if (manifestVersion !== currentVersion) {
    return fail(
      'MANIFEST_VERSION_MISMATCH',
      `当前 wxt.config.ts 版本 ${manifestVersion} 与 package.json ${currentVersion} 必须完全一致`,
    );
  }
  if (previousVersion == null || previousVersion === '') {
    return fail(
      'CANNOT_COMPARE',
      '无法读取推送前 commit 的 package.json 版本，拒绝自动送审（避免把路径变更误当成发版）',
    );
  }
  if (!parseChromeVersion(previousVersion)) {
    return fail('INVALID_PREVIOUS_VERSION', `推送前 package.json 版本无效：${previousVersion}`);
  }
  if (previousManifestVersion == null || previousManifestVersion === '') {
    return fail(
      'CANNOT_COMPARE_MANIFEST',
      '无法读取推送前 commit 的 wxt.config.ts 版本，拒绝自动送审',
    );
  }
  if (previousManifestVersion !== previousVersion) {
    return fail(
      'PREVIOUS_MANIFEST_MISMATCH',
      `推送前 wxt.config.ts 版本 ${previousManifestVersion} 与 package.json ${previousVersion} 必须完全一致`,
    );
  }
  if (compareChromeVersions(currentVersion, previousVersion) < 0) {
    return fail(
      'VERSION_REGRESSION',
      `版本从 ${previousVersion} 降到 ${currentVersion}，拒绝送审`,
    );
  }
  if (compareChromeVersions(currentVersion, previousVersion) === 0) {
    return {
      ok: true,
      live: false,
      code: 'VERIFY_ONLY',
      version: currentVersion,
      previousVersion,
      message: `版本未递增（仍为 ${currentVersion}），只验证不上传、不送审`,
    };
  }
  if (compareChromeVersions(currentVersion, publishedFloor) <= 0) {
    return fail(
      'NOT_HIGHER_THAN_FLOOR',
      `版本虽从 ${previousVersion} 升到 ${currentVersion}，但未高于已知已上架下限 ${publishedFloor}，拒绝送审（避免重发或覆盖 ${publishedFloor}）`,
    );
  }
  return {
    ok: true,
    live: true,
    code: 'VERSION_INCREMENTED',
    version: currentVersion,
    previousVersion,
    message: `版本从 ${previousVersion} 递增到 ${currentVersion}，高于已知已上架下限 ${publishedFloor}，允许在测试通过后进入发布流程`,
  };
}

export function decideMasterReleaseGate(input = {}) {
  const event = decideMasterEventGate({
    event: input.event,
    branch: input.branch,
    isTag: input.isTag,
  });
  if (!event.ok) return event;
  const commit = decideHeadCommitMatch({
    headSha: input.headSha,
    cnbCommit: input.cnbCommit,
  });
  if (!commit.ok) return commit;
  if (isZeroSha(input.beforeSha) || !normalizeSha(input.beforeSha)) {
    return fail(
      'MISSING_BEFORE_SHA',
      '缺少有效的推送前 SHA（github.event.before / CNB_BEFORE_SHA）。全 0 或空值无法判断版本是否递增，拒绝自动送审',
    );
  }
  const versions = decideMasterVersionChange({
    currentVersion: input.packageVersion,
    previousVersion: input.previousVersion,
    manifestVersion: input.manifestVersion,
    previousManifestVersion: input.previousManifestVersion,
    publishedFloor: input.publishedFloor || KNOWN_PUBLISHED_FLOOR,
  });
  if (!versions.ok) return versions;
  if (versions.code === 'VERIFY_ONLY') {
    return {
      ...versions,
      sha: commit.sha,
      beforeSha: normalizeSha(input.beforeSha),
    };
  }
  if (input.requireArmed && !input.allowLiveRelease) {
    return fail(
      'LIVE_RELEASE_NOT_ARMED',
      '缺少 CWS_ALLOW_LIVE_RELEASE=1。该开关只能由 scripts/ci/owlivo-master-release.sh 在版本递增且测试通过后设置',
    );
  }
  return {
    ok: true,
    live: true,
    code: 'READY',
    version: versions.version,
    previousVersion: versions.previousVersion,
    sha: commit.sha,
    beforeSha: normalizeSha(input.beforeSha),
    message: versions.message,
  };
}

export function readPackageVersionAtSha({ repoRoot, sha, filePath = PACKAGE_REL } = {}) {
  if (isZeroSha(sha) || !normalizeSha(sha)) {
    return { ok: false, version: null, error: 'invalid sha' };
  }
  try {
    const raw = execFileSync('git', ['show', `${sha}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(raw);
    const version = parsed && parsed.version != null ? String(parsed.version).trim() : '';
    if (!version) return { ok: false, version: null, error: 'empty version' };
    return { ok: true, version };
  } catch (error) {
    return { ok: false, version: null, error: 'git show failed' };
  }
}


/**
 * 版本未相对 CNB_BEFORE_SHA 递增时的后续动作。
 * 不升版、不撤审、不绕过其它版本待审。商店尚未接收本版本且 plan 为 READY 时，允许在质量门禁后进入正式送审。
 */
export function decideVerifyOnlyFollowup({ plan } = {}) {
  const decision = plan && typeof plan === 'object' ? plan : {};
  const skipOnly =
    decision.skipOnly && typeof decision.skipOnly === 'object'
      ? decision.skipOnly
      : decideSameVersionSkipOnly(decision);
  if (skipOnly && skipOnly.ok) {
    return {
      ok: true,
      live: false,
      code: 'SKIP_ONLY_VERIFY',
      planCode: skipOnly.code,
      message: `商店已对本版本幂等跳过（${skipOnly.code}），只验证跳过，不 upload、不送审`,
    };
  }
  const planCode = String(decision.code || (skipOnly && skipOnly.code) || '');
  if (planCode === 'READY') {
    return {
      ok: true,
      live: true,
      code: 'SAME_VERSION_STORE_READY',
      planCode,
      message:
        '版本号相对推送前未递增，但商店尚未接收本版本且只读 plan 为 READY。质量门禁通过后进入正式送审流程（不升版、不撤审、不绕过商店冲突门禁）',
    };
  }
  if (planCode === 'RESUME_UPLOAD_SUCCEEDED' && decision.action === 'publish-only') {
    return {
      ok: true,
      live: true,
      code: 'SAME_VERSION_PUBLISH_ONLY',
      planCode,
      message:
        '版本号相对推送前未递增，但只读 plan 为补 publish。质量门禁通过后进入发布流程（不再重复 upload）',
    };
  }
  if (planCode === 'OTHER_VERSION_PENDING') {
    return {
      ok: false,
      live: false,
      code: 'OTHER_VERSION_PENDING',
      planCode,
      message:
        decision.message ||
        '商店已有其它版本待审。不会取消已有审核，也不会覆盖上传。请待在审版本过审后官方重新构建本作业，不要再 push 同一 HEAD，也不要升版本',
    };
  }
  return {
    ok: false,
    live: false,
    code: planCode || 'VERIFY_ONLY_UNSAFE',
    planCode: planCode || '',
    message:
      decision.message ||
      `版本未递增且商店决策为 ${planCode || '未知'}，拒绝 upload/publish（不会为此升版、撤审或重传）`,
  };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (command === 'verify-only-followup') {
    const flags = parseArgs(argv.slice(1));
    const planPath = flags.plan || flags['plan-json'];
    if (!planPath) {
      console.error('usage: node scripts/cws-master-gate.mjs verify-only-followup --plan <plan.json>');
      return 2;
    }
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    const decision = decideVerifyOnlyFollowup({ plan });
    console.log(JSON.stringify({ job: 'lesen-verify-only-followup', ...decision }, null, 2));
    return decision.ok ? 0 : 1;
  }
  if (command !== 'gate') {
    console.error('usage: node scripts/cws-master-gate.mjs gate --package-json package.json ...');
    console.error('       node scripts/cws-master-gate.mjs verify-only-followup --plan <plan.json>');
    return 2;
  }
  const flags = parseArgs(argv.slice(1));
  const packageJsonPath = flags['package-json'];
  if (!packageJsonPath) {
    console.error('缺少 --package-json');
    return 2;
  }
  const pkg = readPackageVersion(packageJsonPath);
  let previousVersion = flags['previous-version'] || '';
  let previousManifestVersion = flags['previous-manifest-version'] || '';
  if (flags['before-sha'] && flags.repo) {
    if (!previousVersion) {
      const fromGit = readPackageVersionAtSha({
        repoRoot: flags.repo,
        sha: flags['before-sha'],
        filePath: flags['previous-path'] || PACKAGE_REL,
      });
      previousVersion = fromGit.ok ? fromGit.version : '';
    }
    if (!previousManifestVersion) {
      const fromWxt = readWxtVersionAtSha({
        repoRoot: flags.repo,
        sha: flags['before-sha'],
        filePath: flags['previous-wxt-path'] || WXT_REL,
      });
      previousManifestVersion = fromWxt.ok ? fromWxt.version : '';
    }
  }
  const manifestVersion =
    flags['manifest-version'] ||
    (flags.repo ? readCurrentManifestVersion({ repoRoot: flags.repo, packageVersion: pkg.version }) : '') ||
    null;
  const decision = decideMasterReleaseGate({
    packageVersion: pkg.version,
    previousVersion,
    manifestVersion,
    previousManifestVersion,
    publishedFloor: flags.floor || KNOWN_PUBLISHED_FLOOR,
    event: flags.event,
    branch: flags.branch,
    isTag: flags['is-tag'],
    allowLiveRelease: flags['allow-live-release'] === '1' || flags['allow-live-release'] === 'true',
    requireArmed: flags['require-armed'] === '1' || flags['require-armed'] === 'true',
    headSha: flags['head-sha'],
    cnbCommit: flags['cnb-commit'],
    beforeSha: flags['before-sha'],
  });
  console.log(JSON.stringify({ job: 'lesen-main-gate', packageName: pkg.name, ...decision }, null, 2));
  if (decision.code === 'VERIFY_ONLY') return 0;
  return decision.ok ? 0 : 1;
}

const thisFile = fileURLToPath(import.meta.url);
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(thisFile);
  } catch {
    return path.resolve(process.argv[1]) === thisFile;
  }
}
if (isMainModule()) {
  process.exit(main());
}
