/**
 * Lesen 发布标签门禁。只做格式、版本和 commit 校验，不访问商店，不打印密钥。
 * 标签约定：lesen-vX.Y.Z 或兼容 owlivo-vX.Y.Z。
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareChromeVersions, parseChromeVersion } from './cws-lib.mjs';

export const OWLIVO_RELEASE_TAG_RE = /^owlivo-v(\d+\.\d+\.\d+)$/;
export const LESEN_RELEASE_TAG_RE = /^lesen-v(\d+\.\d+\.\d+)$/;
/** 配置型下限（可被 CWS_KNOWN_PUBLISHED_FLOOR 覆盖）；真实送审仍以 live fetchStatus 为准。 */
export const KNOWN_PUBLISHED_FLOOR =
  String(process.env.CWS_KNOWN_PUBLISHED_FLOOR || '').trim() || '1.8.4';
export const RELEASE_TAG_PREFIXES = ['lesen-v', 'owlivo-v'];

export function parseReleaseTag(tagName) {
  const tag = String(tagName || '').trim();
  const matched = tag.match(LESEN_RELEASE_TAG_RE) || tag.match(OWLIVO_RELEASE_TAG_RE);
  if (!matched) {
    return {
      ok: false,
      code: 'INVALID_RELEASE_TAG',
      message: `发布标签必须是 lesen-vX.Y.Z 或 owlivo-vX.Y.Z（例如 lesen-v1.8.9），收到：${tag || '（空）'}`,
    };
  }
  return { ok: true, tag, version: matched[1] };
}

export const parseOwlivoReleaseTag = parseReleaseTag;

export function readPackageVersion(packageJsonPath) {
  const raw = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const version = raw && raw.version != null ? String(raw.version).trim() : '';
  return { name: raw && raw.name ? String(raw.name) : '', version };
}

export function decideTagVersionMatch({
  tagVersion,
  packageVersion,
  manifestVersion = null,
  publishedFloor = KNOWN_PUBLISHED_FLOOR,
} = {}) {
  if (!parseChromeVersion(tagVersion) || !parseChromeVersion(packageVersion)) {
    return fail('INVALID_VERSION', `标签或 package.json 版本无效：tag=${tagVersion} package=${packageVersion}`);
  }
  if (tagVersion !== packageVersion) {
    return fail(
      'TAG_PACKAGE_MISMATCH',
      `标签版本 ${tagVersion} 与 package.json 版本 ${packageVersion} 必须完全一致`,
    );
  }
  if (manifestVersion != null && manifestVersion !== packageVersion) {
    return fail(
      'MANIFEST_VERSION_MISMATCH',
      `manifest 版本 ${manifestVersion} 与 package.json ${packageVersion} 必须完全一致`,
    );
  }
  if (compareChromeVersions(packageVersion, publishedFloor) <= 0) {
    return fail(
      'NOT_HIGHER_THAN_FLOOR',
      `版本 ${packageVersion} 不高于已知已上架下限 ${publishedFloor}，拒绝送审（避免把 1.8.3 或不完整树发到已公开的 ${publishedFloor} 之上失败或重发旧包）`,
    );
  }
  return {
    ok: true,
    code: 'VERSION_OK',
    version: packageVersion,
    message: `版本 ${packageVersion} 与标签一致，且高于已知已上架下限 ${publishedFloor}`,
  };
}

export function decideCiEventGate({ event, isTag = null, allowLiveRelease = false } = {}) {
  const ev = String(event || '').trim();
  const tagLike = ev === 'tag_push' || ev === 'tag';
  if (!tagLike) {
    return fail(
      'WRONG_EVENT',
      `只有发布标签事件可以走标签送审门禁，当前事件是 ${event || '（空）'}。main push 走 master 门禁。`,
    );
  }
  const tagFlag = isTag == null ? '' : String(isTag).trim().toLowerCase();
  if (tagFlag && !['true', '1', 'yes'].includes(tagFlag)) {
    return fail('NOT_A_TAG_BUILD', `CNB_IS_TAG=${isTag}，拒绝在非标签构建里送审`);
  }
  if (!allowLiveRelease) {
    return fail(
      'LIVE_RELEASE_NOT_ARMED',
      '缺少 CWS_ALLOW_LIVE_RELEASE=1。该开关只能由 scripts/ci/owlivo-release.sh 在门禁通过后设置',
    );
  }
  return { ok: true, code: 'EVENT_OK', message: '事件为 tag_push，且已打开正式送审开关' };
}

export function normalizeSha(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(text)) return null;
  return text;
}

export function shasMatch(a, b) {
  const left = normalizeSha(a);
  const right = normalizeSha(b);
  if (!left || !right) return false;
  const n = Math.min(left.length, right.length);
  return n >= 7 && left.slice(0, n) === right.slice(0, n);
}

export function decideCommitIdentity({ headSha, cnbCommit, tagSha } = {}) {
  if (!normalizeSha(headSha) || !normalizeSha(cnbCommit)) {
    return fail('MISSING_COMMIT', '缺少 HEAD 或 CNB_COMMIT，无法确认只使用发布标签指向的 commit');
  }
  if (!shasMatch(headSha, cnbCommit)) {
    return fail(
      'COMMIT_MISMATCH',
      `工作区 HEAD 与 CNB_COMMIT 不一致，拒绝送审（只使用标签指定 commit）`,
    );
  }
  if (!normalizeSha(tagSha)) {
    return fail('MISSING_TAG_SHA', '无法解析发布标签指向的 commit，拒绝送审');
  }
  if (!shasMatch(headSha, tagSha) || !shasMatch(cnbCommit, tagSha)) {
    return fail('TAG_COMMIT_MISMATCH', '发布标签、HEAD 与 CNB_COMMIT 必须指向同一 commit');
  }
  return {
    ok: true,
    code: 'COMMIT_OK',
    sha: normalizeSha(cnbCommit),
    message: 'HEAD、CNB_COMMIT 与标签指向同一 commit',
  };
}

export function decideTagReleaseGate(input = {}) {
  const tag = parseReleaseTag(input.tagName);
  if (!tag.ok) return tag;
  const versions = decideTagVersionMatch({
    tagVersion: tag.version,
    packageVersion: input.packageVersion,
    manifestVersion: input.manifestVersion,
    publishedFloor: input.publishedFloor || KNOWN_PUBLISHED_FLOOR,
  });
  if (!versions.ok) return versions;
  // 预检不要求已打开 CWS_ALLOW_LIVE_RELEASE；该开关只在测试通过后由 release.sh 打开。
  const event = decideCiEventGate({
    event: input.event,
    isTag: input.isTag,
    allowLiveRelease: input.requireArmed ? Boolean(input.allowLiveRelease) : true,
  });
  if (!event.ok) return event;
  if (input.requireArmed && !input.allowLiveRelease) {
    return fail(
      'LIVE_RELEASE_NOT_ARMED',
      '缺少 CWS_ALLOW_LIVE_RELEASE=1。该开关只能由 scripts/ci/owlivo-release.sh 在门禁通过后设置',
    );
  }
  const commit = decideCommitIdentity({
    headSha: input.headSha,
    cnbCommit: input.cnbCommit,
    tagSha: input.tagSha,
  });
  if (!commit.ok) return commit;
  return {
    ok: true,
    code: 'READY',
    tag: tag.tag,
    version: versions.version,
    sha: commit.sha,
    message: `${tag.tag} 门禁通过，允许进入测试/构建与发布流程`,
  };
}

function fail(code, message) {
  return { ok: false, code, message };
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
  if (command !== 'gate') {
    console.error('usage: node scripts/cws-tag-gate.mjs gate --package-json <path> ...');
    return 2;
  }
  const flags = parseArgs(argv.slice(1));
  const packageJsonPath = flags['package-json'];
  if (!packageJsonPath) {
    console.error('缺少 --package-json');
    return 2;
  }
  const pkg = readPackageVersion(packageJsonPath);
  const decision = decideTagReleaseGate({
    tagName: flags.tag,
    packageVersion: pkg.version,
    manifestVersion: flags['manifest-version'] || null,
    publishedFloor: flags.floor || KNOWN_PUBLISHED_FLOOR,
    event: flags.event,
    isTag: flags['is-tag'],
    allowLiveRelease: flags['allow-live-release'] === '1' || flags['allow-live-release'] === 'true',
    requireArmed: flags['require-armed'] === '1' || flags['require-armed'] === 'true',
    headSha: flags['head-sha'],
    cnbCommit: flags['cnb-commit'],
    tagSha: flags['tag-sha'],
  });
  console.log(JSON.stringify({ job: 'lesen-tag-gate', packageName: pkg.name, ...decision }, null, 2));
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
