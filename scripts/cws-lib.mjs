/**
 * Chrome Web Store publish helpers.
 * Official API (V2): https://developer.chrome.com/docs/webstore/using-api
 * Endpoints confirmed 2026-11-14 from developer.chrome.com (not V1).
 */

export const CWS_DEFAULTS = Object.freeze({
  apiVersion: 'v2',
  publisherId: 'a8852f3f-a8bd-4e01-8d63-2909a4bbd339',
  itemId: 'dakdgplahfkbblfpafdjeipneioajgdf',
  publisherEmail: 'a33949127@gmail.com',
  extensionDirName: 'lesen',
  oauthTokenUrl: 'https://oauth2.googleapis.com/token',
  oauthAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  writeScope: 'https://www.googleapis.com/auth/chromewebstore',
  readonlyScope: 'https://www.googleapis.com/auth/chromewebstore.readonly',
  apiRoot: 'https://chromewebstore.googleapis.com/v2',
  uploadRoot: 'https://chromewebstore.googleapis.com/upload/v2',
});

const SECRET_KEY_RE =
  /^(authorization|access_token|refresh_token|id_token|client_secret|private_key|client_id|api[_-]?key|token)$/i;
const SECRET_VALUE_RE =
  /(ya29\.[A-Za-z0-9._\-]+|1\/\/[A-Za-z0-9_\-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;

export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE_RE, '[redacted]');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

export function safeJson(value) {
  return JSON.stringify(redactSecrets(value), null, 2);
}

/** Chrome extension versions: 1-4 dot-separated integers 0-65535. */
export function parseChromeVersion(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(text)) return null;
  const parts = text.split('.').map((n) => Number(n));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 65535)) return null;
  return parts;
}

export function compareChromeVersions(a, b) {
  const pa = parseChromeVersion(a);
  const pb = parseChromeVersion(b);
  if (!pa || !pb) throw new Error(`Invalid Chrome extension version: ${a} vs ${b}`);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function itemResourceName(publisherId, itemId) {
  return `publishers/${publisherId}/items/${itemId}`;
}

export function cwsUrls(publisherId, itemId) {
  const name = itemResourceName(publisherId, itemId);
  return {
    fetchStatus: `${CWS_DEFAULTS.apiRoot}/${name}:fetchStatus`,
    publish: `${CWS_DEFAULTS.apiRoot}/${name}:publish`,
    upload: `${CWS_DEFAULTS.uploadRoot}/${name}:upload`,
  };
}

function firstCrxVersion(revision) {
  if (!revision) return null;
  const channels = Array.isArray(revision.distributionChannels)
    ? revision.distributionChannels
    : [];
  for (const ch of channels) {
    if (ch && ch.crxVersion) return String(ch.crxVersion);
  }
  return null;
}

export function extractStoreVersions(status) {
  const published = status?.publishedItemRevisionStatus || null;
  const submitted = status?.submittedItemRevisionStatus || null;
  return {
    publishedVersion: firstCrxVersion(published),
    publishedState: published?.state || null,
    submittedVersion: firstCrxVersion(submitted),
    submittedState: submitted?.state || null,
    lastAsyncUploadState: status?.lastAsyncUploadState || null,
    takenDown: Boolean(status?.takenDown),
    warned: Boolean(status?.warned),
    itemId: status?.itemId || null,
  };
}

const IN_PROGRESS = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);
const SUCCESS_UPLOAD = new Set(['SUCCEEDED', 'SUCCESS', 'UPLOAD_SUCCESS']);
const FAILED_UPLOAD = new Set(['FAILED', 'UPLOAD_FAILED']);

export function isUploadInProgress(state) {
  return IN_PROGRESS.has(String(state || ''));
}

export function isUploadSuccess(state) {
  return SUCCESS_UPLOAD.has(String(state || ''));
}

export function isUploadFailed(state) {
  return FAILED_UPLOAD.has(String(state || ''));
}

/**
 * Decide whether a release may upload/publish.
 * Source of truth is live fetchStatus, not a previous local screenshot.
 */
export function decideReleaseAction({
  localVersion,
  zipVersion = null,
  store,
  previousUnknown = null,
} = {}) {
  if (!parseChromeVersion(localVersion)) {
    return fail('INVALID_LOCAL_VERSION', `本地版本无效：${localVersion}`);
  }
  if (zipVersion != null && compareChromeVersions(localVersion, zipVersion) !== 0) {
    return fail(
      'VERSION_MISMATCH',
      `package.json 版本 ${localVersion} 与 ZIP manifest 版本 ${zipVersion} 不一致`,
    );
  }
  if (!store) {
    return fail('MISSING_STORE_STATUS', '缺少商店 fetchStatus，不能判断是否可送审');
  }
  if (store.takenDown) {
    return fail('ITEM_TAKEN_DOWN', '商店标记该商品已被下架，停止自动发布');
  }
  if (isUploadInProgress(store.lastAsyncUploadState)) {
    return {
      action: 'wait-upload',
      code: 'UPLOAD_IN_PROGRESS',
      message: '商店仍有进行中的上传，不得开始新的 upload/publish',
      live: false,
    };
  }

  const version = zipVersion || localVersion;
  const published = store.publishedVersion;
  const submitted = store.submittedVersion;
  const submittedState = store.submittedState;

  if (published && compareChromeVersions(version, published) < 0) {
    return fail(
      'VERSION_DOWNGRADE',
      `本地 ${version} 低于已发布 ${published}，拒绝降版本发布`,
    );
  }
  if (published && compareChromeVersions(version, published) === 0) {
    return skip(
      'ALREADY_PUBLISHED',
      `商店已发布版本就是 ${published}，与本地相同，跳过（不会重发）`,
    );
  }
  if (submitted && submittedState === 'PENDING_REVIEW') {
    if (compareChromeVersions(version, submitted) === 0) {
      return skip(
        'ALREADY_PENDING',
        `版本 ${submitted} 已在待审核，跳过（不会重复 submit）`,
      );
    }
    return fail(
      'OTHER_VERSION_PENDING',
      `商店已有待审版本 ${submitted}，本地是 ${version}。不会取消已有审核，也不会覆盖上传`,
    );
  }
  if (submitted && submittedState === 'STAGED' && compareChromeVersions(version, submitted) === 0) {
    return skip('ALREADY_STAGED', `版本 ${submitted} 已通过审核并暂存，等待手动或自动发布，跳过`);
  }
  if (submitted && submittedState === 'REJECTED' && compareChromeVersions(version, submitted) === 0) {
    return fail(
      'SAME_VERSION_REJECTED',
      `版本 ${version} 已被拒审。官方 upload 要求提升 manifest 版本，不能用同一版本重发`,
    );
  }
  if (previousUnknown && previousUnknown.version === version) {
    if (previousUnknown.phase === 'publish' && submittedState === 'PENDING_REVIEW') {
      return skip(
        'RESUME_ALREADY_SUBMITTED',
        `上次 publish 结果未知，但现在已是待审核 ${version}，视为已送审，不再重复 publish`,
      );
    }
    if (previousUnknown.phase === 'upload' && isUploadSuccess(store.lastAsyncUploadState)) {
      return {
        action: 'publish-only',
        code: 'RESUME_UPLOAD_SUCCEEDED',
        message: `上次 upload 结果未知，现确认上传已成功，只补 publish，不再重复 upload`,
        live: true,
      };
    }
    if (previousUnknown.phase === 'upload' && !isUploadFailed(store.lastAsyncUploadState) && submittedState !== 'PENDING_REVIEW') {
      return fail(
        'PREVIOUS_UPLOAD_UNKNOWN',
        `上次 upload 结果未知且仍无法确认成功或失败，拒绝重复 upload。请先只读查询 status`,
      );
    }
    if (previousUnknown.phase === 'publish' && submittedState !== 'PENDING_REVIEW') {
      return fail(
        'PREVIOUS_PUBLISH_UNKNOWN',
        `上次 publish 结果未知，且当前不是待审核。拒绝重复 publish。请先只读查询 status`,
      );
    }
  }

  if (!published || compareChromeVersions(version, published) > 0) {
    return {
      action: 'proceed',
      code: 'READY',
      message: `本地 ${version} 高于已发布 ${published || '（无）'}，可以上传并提交审核（通过后 DEFAULT_PUBLISH 自动发布）`,
      live: true,
    };
  }
  return fail('UNDECIDABLE', '无法判断版本与商店状态，已停止以免误发');
}

function skip(code, message) {
  return { action: 'skip', code, message, live: false };
}
function fail(code, message) {
  return { action: 'fail', code, message, live: false };
}

export function publishRequestBody() {
  // Official: DEFAULT_PUBLISH = published immediately after approval.
  // skipReview defaults false; never claim a DNR-only skip unless it is true.
  return { publishType: 'DEFAULT_PUBLISH', skipReview: false };
}

export function normalizeUploadState(payload) {
  return payload?.uploadState || payload?.lastAsyncUploadState || null;
}

const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export async function acquireLock(lockPath, { staleMs = DEFAULT_LOCK_STALE_MS, pid = process.pid } = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid, startedAt: new Date().toISOString() }));
    await handle.close();
    return { ok: true, path: lockPath };
  } catch (err) {
    if (err && err.code !== 'EEXIST') throw err;
    let existing = {};
    try {
      existing = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch {
      existing = {};
    }
    const startedAt = existing.startedAt ? Date.parse(existing.startedAt) : NaN;
    const stale = Number.isFinite(startedAt) && Date.now() - startedAt > staleMs;
    if (stale) {
      await fs.unlink(lockPath).catch(() => {});
      return acquireLock(lockPath, { staleMs, pid });
    }
    return {
      ok: false,
      path: lockPath,
      message: `已有发布锁 ${lockPath}（pid ${existing.pid || 'unknown'}），拒绝并行 upload/publish`,
    };
  }
}

export async function releaseLock(lockPath) {
  const fs = await import('node:fs/promises');
  await fs.unlink(lockPath).catch(() => {});
}

export function unknownAttemptRecord({ phase, version, zipSha256, at = new Date().toISOString() }) {
  return { phase, version, zipSha256, at, result: 'UNKNOWN' };
}

export function loadDotEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function pickCredentials(env) {
  const clientId = env.CWS_CLIENT_ID || env.CHROME_CLIENT_ID || '';
  const clientSecret = env.CWS_CLIENT_SECRET || env.CHROME_CLIENT_SECRET || '';
  const refreshToken = env.CWS_REFRESH_TOKEN || env.CHROME_REFRESH_TOKEN || '';
  const saEmail =
    env.CWS_SERVICE_ACCOUNT_CLIENT_EMAIL || env.CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL || '';
  const saKey =
    env.CWS_SERVICE_ACCOUNT_PRIVATE_KEY || env.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const hasOauth = Boolean(clientId && clientSecret && refreshToken);
  const hasSa = Boolean(saEmail && saKey);
  return {
    kind: hasOauth ? 'oauth' : hasSa ? 'service_account' : null,
    clientId,
    clientSecret,
    refreshToken,
    saEmail,
    saKey,
    hasOauth,
    hasSa,
  };
}

export function authMissingMessage() {
  return [
    '缺少 Chrome Web Store API 授权，不能查询或送审。',
    '请使用与 Lesen 用户 Google 登录无关的专用 CWS 发布凭据：GitHub Environment secrets（CWS_* 或 CHROME_* 别名）或本机 gitignored .env.submit（权限 600），不要入库。',
    '官方文档：https://developer.chrome.com/docs/webstore/using-api',
    '最小 scope：写操作用 https://www.googleapis.com/auth/chromewebstore ；只读 status 也可用 chromewebstore.readonly。',
    '本地可运行：node scripts/cws.mjs auth',
    '所需变量：CWS_CLIENT_ID、CWS_CLIENT_SECRET、CWS_REFRESH_TOKEN；或官方 V2 支持的服务账号 CWS_SERVICE_ACCOUNT_CLIENT_EMAIL / CWS_SERVICE_ACCOUNT_PRIVATE_KEY。',
  ].join('\n');
}

export function decidePipelineLiveReleaseEvent({ event, branch, allowLiveRelease } = {}) {
  if (!event) {
    return { ok: true, code: 'LOCAL', message: '本地/未标注 pipeline 事件，不套用受信触发限制' };
  }
  const armed = allowLiveRelease === true || allowLiveRelease === '1' || allowLiveRelease === 'true';
  if (!armed) {
    return {
      ok: false,
      code: 'NOT_ARMED',
      message:
        '未打开 CWS_ALLOW_LIVE_RELEASE=1。实际上传只能在受信 workflow 门禁与质量链通过后由运行器设置。',
    };
  }
  const ev = String(event).trim();
  const br = String(branch || '').trim();
  if (ev === 'tag_push' || ev === 'tag') {
    return { ok: true, code: 'TAG_PUSH', message: '允许已武装的标签送审' };
  }
  if ((ev === 'push' || ev === 'workflow_dispatch') && (br === 'main' || br === 'master')) {
    return { ok: true, code: 'DEFAULT_BRANCH_PUSH', message: '允许已武装的 main/master push 送审' };
  }
  return {
    ok: false,
    code: 'EVENT_NOT_ALLOWED',
    message: `事件 ${event}${branch ? `（${branch}）` : ''} 不允许实际上传，仅发布标签或 main/master push 可送审。`,
  };
}

/** @deprecated 兼容原 CNB 测试命名 */
export const decideCnbLiveReleaseEvent = decidePipelineLiveReleaseEvent;

/** 版本未相对推送前递增时，只允许对「商店已有同一版本」做幂等跳过，禁止 upload/publish。 */
export const SAME_VERSION_SKIP_CODES = new Set([
  'ALREADY_PENDING',
  'ALREADY_PUBLISHED',
  'ALREADY_STAGED',
  'RESUME_ALREADY_SUBMITTED',
]);

export function isTruthyEnv(value) {
  return value === true || value === '1' || value === 'true';
}

export function decideSameVersionSkipOnly({ action, code } = {}) {
  if (action === 'skip' && SAME_VERSION_SKIP_CODES.has(code)) {
    return {
      ok: true,
      code,
      message: `版本未递增，商店决策 ${code}，允许在质量检查后调用 release 以验证幂等跳过，不会 upload/publish`,
    };
  }
  return {
    ok: false,
    code: 'SKIP_ONLY_REFUSED',
    message: `版本未相对推送前递增，且商店决策为 ${code || action || '（空）'}，拒绝 upload/publish（不会为此升版或重传）`,
  };
}
