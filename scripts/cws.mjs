#!/usr/bin/env node
/**
 * Owlivo Chrome Web Store CLI. Official CWS API v2 only.
 * Used by GitHub Actions cws-pipeline (tag / main) and local runs.
 *
 *   node scripts/cws.mjs help
 *   node scripts/cws.mjs status
 *   node scripts/cws.mjs plan
 *   node scripts/cws.mjs release --dry-run
 *   node scripts/cws.mjs release
 *   node scripts/cws.mjs auth
 *   node scripts/cws.mjs pack --dry-run
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  CWS_DEFAULTS,
  acquireLock,
  authMissingMessage,
  compareChromeVersions,
  cwsUrls,
  decideCnbLiveReleaseEvent,
  decideReleaseAction,
  decideSameVersionSkipOnly,
  extractStoreVersions,
  isTruthyEnv,
  isUploadFailed,
  isUploadInProgress,
  isUploadSuccess,
  loadDotEnv,
  normalizeUploadState,
  pickCredentials,
  publishRequestBody,
  redactSecrets,
  releaseLock,
  safeJson,
  unknownAttemptRecord,
} from './cws-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const USAGE = `Lesen Chrome Web Store 发布工具（官方 API v2）

用法:
  node scripts/cws.mjs <命令> [选项]

命令:
  help              显示本说明
  status            只读查询商店已发布/待审版本（不上传、不送审）
  plan              只读 fetchStatus 后给出 decideReleaseAction（不上传、不送审）
  pack              预检并打包 ZIP（可用 --dry-run 只预检）
  release           检查、按需打包、上传并提交审核；通过后 DEFAULT_PUBLISH 自动发布
  auth              完成本地 OAuth（浏览器同意/2FA 需本人操作），写入 .env.submit

选项:
  --dry-run         不做实际上传/送审，只跑预检、版本比较和（若已授权）只读 status
  --skip-pack       使用已有 ZIP，不调用 wxt zip
  --zip <path>      指定 ZIP 路径
  --mock-status <json|@file>  用模拟 fetchStatus，不访问商店（测试用）
  --help, -h        显示本说明

默认商品: ${CWS_DEFAULTS.itemId}
默认发布者: ${CWS_DEFAULTS.publisherId}
日常送审（版本号高于商店已发布，且无待审冲突时）请用 release，不要加 --dry-run。
商店状态以 live fetchStatus 为准。已知 2026-11-16 已公开 1.8.4，不高于该下限的版本会被拒绝。
在 CNB 里，只有 scripts/ci/owlivo-release.sh（tag_push）或 owlivo-master-release.sh 在门禁通过后才会打开实际上传。
同版本已待审或已发布时，必须在 upload 之前幂等跳过，包括 master 上版本递增的 READY 门禁，以及版本未递增但商店已是该版本时由 CWS_SAME_VERSION_SKIP_ONLY=1 验证的跳过（此时不得 upload）。
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { dryRun: false, skipPack: false, zip: null, mockStatus: null, help: false };
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--skip-pack') flags.skipPack = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--zip') flags.zip = args[++i];
    else if (a === '--mock-status') flags.mockStatus = args[++i];
    else if (a.startsWith('--')) throw new Error(`未知选项：${a}`);
    else positionals.push(a);
  }
  return { command: positionals[0] || 'help', flags };
}

function log(...parts) {
  console.log(...parts);
}

function logError(...parts) {
  console.error(...parts);
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function chmod600(p) {
  await fs.chmod(p, 0o600).catch(() => {});
}

async function loadEnv() {
  const env = { ...process.env };
  const envFile = path.join(ROOT, '.env.submit');
  if (await fileExists(envFile)) {
    const parsed = loadDotEnv(await fs.readFile(envFile, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (env[k] == null || env[k] === '') env[k] = v;
    }
  }
  return env;
}

function publisherAndItem(env) {
  return {
    publisherId: env.CWS_PUBLISHER_ID || env.CHROME_PUBLISHER_ID || CWS_DEFAULTS.publisherId,
    itemId: env.CWS_EXTENSION_ID || env.CHROME_EXTENSION_ID || CWS_DEFAULTS.itemId,
  };
}

async function readPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

async function readZipManifestVersion(zipPath) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', zipPath, 'manifest.json'], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const man = JSON.parse(stdout);
    return man.version || null;
  } catch {
    // fallback: python zipfile
    const py = `
import json, zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    print(json.loads(z.read('manifest.json')).get('version',''))
`;
    const { stdout } = await execFileAsync('python3', ['-c', py, zipPath]);
    return stdout.trim() || null;
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function defaultZipPath(version) {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const base = String(pkg.name || 'lesen').trim() || 'lesen';
  const candidates = [
    path.join(ROOT, '.output', `${base}-${version}-chrome.zip`),
    path.join(ROOT, '.output', `lesen-${version}-chrome.zip`),
    path.join(ROOT, '.output', `owlivo-${version}-chrome.zip`),
  ];
  const existing = await Promise.all(
    candidates.map(async (candidate) => ((await fileExists(candidate)) ? candidate : null)),
  );
  return existing.find(Boolean) || candidates[0];
}

function pipelineEventContext(env) {
  return {
    event: env.GITHUB_PIPELINE_EVENT || env.CNB_EVENT || '',
    branch: env.GITHUB_REF_NAME || env.CNB_BRANCH || '',
  };
}

function isPipelineContext(env) {
  return Boolean(env.GITHUB_PIPELINE_EVENT || env.CNB_EVENT);
}

async function runCommand(command, args, { cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

function statePath() {
  return path.join(ROOT, '.output', 'cws-release-state.json');
}

function lockPath() {
  return path.join(ROOT, '.output', 'cws-release.lock');
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(record) {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  const safe = redactSecrets(record);
  await fs.writeFile(statePath(), JSON.stringify(safe, null, 2) + '\n');
}

async function loadMockStatus(spec) {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    return JSON.parse(await fs.readFile(spec.slice(1), 'utf8'));
  }
  return JSON.parse(spec);
}

async function signServiceAccountJwt(email, privateKey, scope) {
  const crypto = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: email,
      scope,
      aud: CWS_DEFAULTS.oauthTokenUrl,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  const key = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  const signature = sign.sign(key, 'base64url');
  return `${data}.${signature}`;
}

async function fetchAccessToken(creds, { readonly = false } = {}) {
  const scope = readonly && !creds.hasOauth === false ? CWS_DEFAULTS.writeScope : CWS_DEFAULTS.writeScope;
  // Prefer write scope when we have write creds so one token covers status+release.
  const usedScope = creds.hasOauth || creds.hasSa ? CWS_DEFAULTS.writeScope : CWS_DEFAULTS.readonlyScope;
  void scope;
  if (creds.hasOauth) {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(CWS_DEFAULTS.oauthTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) {
      throw new Error(`刷新 access token 失败：HTTP ${res.status} ${safeJson(json)}`);
    }
    return json.access_token;
  }
  if (creds.hasSa) {
    const assertion = await signServiceAccountJwt(creds.saEmail, creds.saKey, usedScope);
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const res = await fetch(CWS_DEFAULTS.oauthTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) {
      throw new Error(`服务账号换 token 失败：HTTP ${res.status} ${safeJson(json)}`);
    }
    return json.access_token;
  }
  throw new Error(authMissingMessage());
}

async function apiJson(url, { method = 'GET', token, body, headers = {}, dryRun = false, label }) {
  if (dryRun) {
    log(`[dry-run] 跳过 ${method} ${label || url}`);
    return { dryRun: true };
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(`${label || url} 失败：HTTP ${res.status} ${safeJson(json)}`);
  }
  return json;
}

async function fetchStatus({ token, publisherId, itemId, mock, dryRun }) {
  if (mock) return mock;
  if (!token) throw new Error(authMissingMessage());
  const urls = cwsUrls(publisherId, itemId);
  return apiJson(urls.fetchStatus, { token, label: 'fetchStatus', dryRun: false });
}

async function cmdStatus(flags, env) {
  const { publisherId, itemId } = publisherAndItem(env);
  const mock = await loadMockStatus(flags.mockStatus);
  let status;
  if (mock) {
    status = mock;
    log('使用 --mock-status，未访问商店。');
  } else {
    const creds = pickCredentials(env);
    if (!creds.kind) {
      logError(authMissingMessage());
      return 2;
    }
    const token = await fetchAccessToken(creds, { readonly: true });
    status = await fetchStatus({ token, publisherId, itemId, mock: null });
  }
  const versions = extractStoreVersions(status);
  log('商品', itemId);
  log('发布者', publisherId);
  log('只读状态', safeJson(versions));
  return 0;
}

async function writePlanFile(payload, env) {
  const out = env.OWLIVO_PLAN_OUT;
  if (!out) return;
  await fs.writeFile(out, `${safeJson(payload)}\n`, 'utf8');
  log('已写入 plan', out);
}

async function cmdPlan(flags, env) {
  if (isPipelineContext(env) && flags.mockStatus) {
    logError('CNB 环境的 plan 不得使用 --mock-status');
    return 1;
  }
  const pre = await precheck(env);
  if (pre.issues.length) {
    logError(pre.issues.join('\n'));
    return 1;
  }
  const { publisherId, itemId } = pre;
  const mock = await loadMockStatus(flags.mockStatus);
  let storeStatus;
  if (mock) {
    storeStatus = mock;
    log('使用 --mock-status，未访问商店。');
  } else {
    const creds = pickCredentials(env);
    if (!creds.kind) {
      logError(authMissingMessage());
      return 2;
    }
    const token = await fetchAccessToken(creds, { readonly: true });
    storeStatus = await fetchStatus({ token, publisherId, itemId, mock: null });
  }
  const store = extractStoreVersions(storeStatus);
  const decision = decideReleaseAction({
    localVersion: pre.version,
    zipVersion: null,
    store,
    previousUnknown: null,
  });
  const payload = {
    job: 'owlivo-cws-plan',
    localVersion: pre.version,
    itemId,
    publisherId,
    store,
    action: decision.action,
    code: decision.code,
    message: decision.message,
    skipOnly: decideSameVersionSkipOnly(decision),
  };
  log('商品', itemId);
  log('发布者', publisherId);
  log('只读状态', safeJson(store));
  log('发布决策', safeJson({ action: decision.action, code: decision.code, message: decision.message }));
  log('同版本跳过校验', safeJson(payload.skipOnly));
  await writePlanFile(payload, env);
  return 0;
}

async function precheck(env) {
  const version = await readPackageVersion();
  const { publisherId, itemId } = publisherAndItem(env);
  const issues = [];
  if (!version) issues.push('package.json 缺少 version');
  const pkgName = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).name;
  if (!pkgName) issues.push('package.json 缺少 name');
  return { version, publisherId, itemId, issues };
}

async function ensureZip({ version, flags, skipBecauseDryRunPack }) {
  const zipPath = flags.zip ? path.resolve(flags.zip) : await defaultZipPath(version);
  if (flags.skipPack || (skipBecauseDryRunPack && (await fileExists(zipPath)))) {
    if (!(await fileExists(zipPath))) throw new Error(`找不到 ZIP：${zipPath}`);
    const zipVersion = await readZipManifestVersion(zipPath);
    const sha = await sha256File(zipPath);
    log('使用已有 ZIP', zipPath, 'manifest', zipVersion, 'sha256', sha);
    return { zipPath, zipVersion, sha };
  }
  if (await fileExists(zipPath)) {
    const existingVersion = await readZipManifestVersion(zipPath);
    if (existingVersion && compareChromeVersions(existingVersion, version) === 0) {
      // Do not silently overwrite a same-version store package during local dry-run / accidental pack.
      if (flags.dryRun) {
        const sha = await sha256File(zipPath);
        log(`[dry-run] 不覆盖已有同版本包 ${zipPath}（${existingVersion}）`);
        return { zipPath, zipVersion: existingVersion, sha };
      }
    }
  }
  if (flags.dryRun) {
    log('[dry-run] 跳过 wxt zip，避免覆盖已有商店包');
    return { zipPath, zipVersion: null, sha: null, skipped: true };
  }
  log('开始打包 wxt zip');
  await runCommand('pnpm', ['zip']);
  if (!(await fileExists(zipPath))) throw new Error(`打包后仍没有 ${zipPath}`);
  const zipVersion = await readZipManifestVersion(zipPath);
  const sha = await sha256File(zipPath);
  log('打包完成', zipPath, 'manifest', zipVersion, 'sha256', sha);
  return { zipPath, zipVersion, sha };
}

async function pollUpload({ token, publisherId, itemId, timeoutMs = 10 * 60 * 1000 }) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const status = await fetchStatus({ token, publisherId, itemId });
    last = status;
    const state = status.lastAsyncUploadState;
    log('upload poll', state || '(no lastAsyncUploadState)');
    if (isUploadSuccess(state)) return { ok: true, status };
    if (isUploadFailed(state)) return { ok: false, status, error: 'UPLOAD_FAILED' };
    if (!isUploadInProgress(state) && state && state !== 'UPLOAD_STATE_UNSPECIFIED' && state !== 'NOT_FOUND') {
      // unexpected terminal
      return { ok: false, status, error: state };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, status: last, error: 'UPLOAD_TIMEOUT_UNKNOWN' };
}

async function cmdRelease(flags, env) {
  if (!flags.dryRun && isPipelineContext(env) && flags.mockStatus) {
    logError('正式送审不得使用 --mock-status');
    return 1;
  }
  const pre = await precheck(env);
  if (pre.issues.length) {
    logError(pre.issues.join('\n'));
    return 1;
  }
  log('本地 package.json 版本', pre.version);
  log('商品', pre.itemId, '发布者', pre.publisherId);

  const creds = pickCredentials(env);
  const mock = await loadMockStatus(flags.mockStatus);
  if (!mock && !creds.kind) {
    logError(authMissingMessage());
    return 2;
  }

  const skipOnly = isTruthyEnv(env.CWS_SAME_VERSION_SKIP_ONLY);
  let token = null;
  if (!mock && creds.kind) {
    if (flags.dryRun || skipOnly) {
      // dry-run 与「仅验证同版本跳过」都只用只读 token，即使后续判断失误也不能 upload。
      token = await fetchAccessToken(creds, { readonly: true });
    } else {
      token = await fetchAccessToken(creds);
    }
  }

  const storeStatus = await fetchStatus({
    token,
    publisherId: pre.publisherId,
    itemId: pre.itemId,
    mock,
  });
  const store = extractStoreVersions(storeStatus);
  log('商店状态', safeJson(store));

  const prev = await readState();
  const previousUnknown =
    prev && prev.result === 'UNKNOWN' && prev.version === pre.version
      ? { phase: prev.phase, version: prev.version }
      : null;

  // Pack only if the gate might proceed, or if a zip was explicitly provided.
  let zipMeta = { zipPath: flags.zip || (await defaultZipPath(pre.version)), zipVersion: null, sha: null };
  const early = decideReleaseAction({
    localVersion: pre.version,
    zipVersion: null,
    store,
    previousUnknown,
  });
  if (skipOnly) {
    const only = decideSameVersionSkipOnly(early);
    if (!only.ok) {
      logError(`失败：${only.code} ${only.message}`);
      return 1;
    }
  }
  if (early.action === 'skip') {
    log(`跳过：${early.code} ${early.message}`);
    return 0;
  }
  if (early.action === 'fail') {
    logError(`失败：${early.code} ${early.message}`);
    return 1;
  }

  // 同版本跳过已在上面返回。真正可能 upload/publish 时才校验 CNB 事件。
  if (!flags.dryRun && isPipelineContext(env)) {
    const pipe = pipelineEventContext(env);
    const ev = decideCnbLiveReleaseEvent({
      event: pipe.event,
      branch: pipe.branch,
      allowLiveRelease: env.CWS_ALLOW_LIVE_RELEASE,
    });
    if (!ev.ok) {
      logError(ev.message);
      return 1;
    }
  }

  if (early.action === 'wait-upload') {
    if (flags.dryRun) {
      log(`[dry-run] ${early.code} ${early.message}`);
      return 0;
    }
    log(early.message);
    const polled = await pollUpload({
      token,
      publisherId: pre.publisherId,
      itemId: pre.itemId,
    });
    if (polled.error === 'UPLOAD_TIMEOUT_UNKNOWN') {
      await writeState(unknownAttemptRecord({ phase: 'upload', version: pre.version, zipSha256: null }));
      logError('等待上次上传超时，结果未知，不开始新的 upload/publish');
      return 3;
    }
    if (!polled.ok) {
      logError('上次上传失败', polled.error);
      return 1;
    }
  }

  if (early.action !== 'publish-only') {
    zipMeta = await ensureZip({
      version: pre.version,
      flags,
      skipBecauseDryRunPack: flags.dryRun,
    });
    if (zipMeta.zipVersion) {
      const afterZip = decideReleaseAction({
        localVersion: pre.version,
        zipVersion: zipMeta.zipVersion,
        store,
        previousUnknown,
      });
      if (afterZip.action === 'skip') {
        log(`跳过：${afterZip.code} ${afterZip.message}`);
        return 0;
      }
      if (afterZip.action === 'fail') {
        logError(`失败：${afterZip.code} ${afterZip.message}`);
        return 1;
      }
    } else if (!flags.dryRun) {
      logError('ZIP 中读不到 manifest.version');
      return 1;
    }
  }

  if (flags.dryRun) {
    log(`[dry-run] 若真正执行，将 ${early.action === 'publish-only' ? '只调用 publish' : 'upload 然后 publish'}（publishType=DEFAULT_PUBLISH, skipReview=false）`);
    log('[dry-run] 未对线上执行 upload 或 publish。');
    return 0;
  }

  const lock = await acquireLock(lockPath());
  if (!lock.ok) {
    logError(lock.message);
    return 4;
  }
  try {
    const urls = cwsUrls(pre.publisherId, pre.itemId);
    if (early.action !== 'publish-only') {
      await writeState(
        unknownAttemptRecord({
          phase: 'upload',
          version: pre.version,
          zipSha256: zipMeta.sha,
        }),
      );
      const zipBuf = await fs.readFile(zipMeta.zipPath);
      let uploadRes;
      try {
        uploadRes = await apiJson(urls.upload, {
          method: 'POST',
          token,
          body: zipBuf,
          headers: { 'Content-Type': 'application/zip' },
          label: 'upload',
        });
      } catch (err) {
        await writeState({
          phase: 'upload',
          version: pre.version,
          zipSha256: zipMeta.sha,
          at: new Date().toISOString(),
          result: 'FAILED',
          error: String(err.message || err),
        });
        throw err;
      }
      log('upload 响应', safeJson(uploadRes));
      const uploadState = normalizeUploadState(uploadRes);
      if (isUploadInProgress(uploadState) || !uploadState) {
        const polled = await pollUpload({
          token,
          publisherId: pre.publisherId,
          itemId: pre.itemId,
        });
        if (polled.error === 'UPLOAD_TIMEOUT_UNKNOWN') {
          await writeState(
            unknownAttemptRecord({ phase: 'upload', version: pre.version, zipSha256: zipMeta.sha }),
          );
          logError('upload 超时且结果未知，不调用 publish，也不重试 upload');
          return 3;
        }
        if (!polled.ok) {
          await writeState({
            phase: 'upload',
            version: pre.version,
            zipSha256: zipMeta.sha,
            at: new Date().toISOString(),
            result: 'FAILED',
            error: polled.error,
          });
          logError('upload 失败', polled.error);
          return 1;
        }
      } else if (isUploadFailed(uploadState)) {
        await writeState({
          phase: 'upload',
          version: pre.version,
          zipSha256: zipMeta.sha,
          at: new Date().toISOString(),
          result: 'FAILED',
          error: uploadState,
        });
        logError('upload 失败', uploadState);
        return 1;
      }
    }

    await writeState(
      unknownAttemptRecord({
        phase: 'publish',
        version: pre.version,
        zipSha256: zipMeta.sha,
      }),
    );
    const publishRes = await apiJson(urls.publish, {
      method: 'POST',
      token,
      body: JSON.stringify(publishRequestBody()),
      headers: { 'Content-Type': 'application/json' },
      label: 'publish',
    });
    log('publish 响应', safeJson(publishRes));
    const after = extractStoreVersions(
      await fetchStatus({ token, publisherId: pre.publisherId, itemId: pre.itemId }),
    );
    log('送审后状态', safeJson(after));
    await writeState({
      phase: 'publish',
      version: pre.version,
      zipSha256: zipMeta.sha,
      at: new Date().toISOString(),
      result: 'SUBMITTED',
      submittedState: after.submittedState,
    });
    if (after.submittedState && after.submittedState !== 'PENDING_REVIEW' && after.submittedState !== 'PUBLISHED' && after.submittedState !== 'STAGED') {
      logError(`publish 后状态异常：${after.submittedState}`);
      return 1;
    }
    log('已提交审核。审核由 Google 被动完成；通过后按 DEFAULT_PUBLISH 自动上架。请确认开发者账号已开启“发布/暂存”邮件通知。');
    return 0;
  } finally {
    await releaseLock(lockPath());
  }
}

async function cmdPack(flags, env) {
  const pre = await precheck(env);
  if (pre.issues.length) {
    logError(pre.issues.join('\n'));
    return 1;
  }
  const zip = await ensureZip({ version: pre.version, flags, skipBecauseDryRunPack: flags.dryRun });
  log(safeJson({ version: pre.version, ...zip }));
  return 0;
}

async function cmdAuth(env) {
  const credsFile = path.join(ROOT, '.env.submit');
  const existing = pickCredentials(env);
  if (!existing.clientId || !existing.clientSecret) {
    logError(
      [
        '还没有专用发布 OAuth 客户端。不要复用 Owlivo 用户登录客户端。',
        '请先按官方文档创建 Google Cloud 项目、启用 Chrome Web Store API，并建立 OAuth 客户端：',
        'https://developer.chrome.com/docs/webstore/using-api',
        '建议应用类型使用 Desktop / 带 http://127.0.0.1 回调的客户端，授权账号必须是发布者 a33949127@gmail.com。',
        '把 CWS_CLIENT_ID 与 CWS_CLIENT_SECRET 写入本机 .env.submit（chmod 600）后，再运行 node scripts/cws.mjs auth。',
        '浏览器里的账号选择、同意与 2FA 必须本人完成，代理不会代点，也不会代点新条款。',
      ].join('\n'),
    );
    return 2;
  }
  const http = await import('node:http');
  const port = 53682;
  const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
  const state = String(Math.random()).slice(2);
  const authUrl = new URL(CWS_DEFAULTS.oauthAuthUrl);
  authUrl.searchParams.set('client_id', existing.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CWS_DEFAULTS.writeScope);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  log('请在浏览器中用发布者账号 a33949127@gmail.com 打开下面的地址并完成同意（含 2FA）。我不会代为点击。');
  log(String(authUrl));
  return await new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.pathname !== '/oauth2/callback') {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        if (url.searchParams.get('state') !== state) {
          throw new Error('OAuth state 不匹配');
        }
        const code = url.searchParams.get('code');
        if (!code) throw new Error('没有 authorization code');
        const body = new URLSearchParams({
          code,
          client_id: existing.clientId,
          client_secret: existing.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });
        const tokenRes = await fetch(CWS_DEFAULTS.oauthTokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const json = await tokenRes.json();
        if (!tokenRes.ok || !json.refresh_token) {
          throw new Error(`换 token 失败：HTTP ${tokenRes.status} ${safeJson(json)}`);
        }
        const prev = (await fileExists(credsFile)) ? await fs.readFile(credsFile, 'utf8') : '';
        const lines = [
          '# Owlivo CWS 发布凭据。不要提交到 Git。与扩展用户登录 OAuth 分离。',
          `CWS_PUBLISHER_ID=${CWS_DEFAULTS.publisherId}`,
          `CWS_EXTENSION_ID=${CWS_DEFAULTS.itemId}`,
          `CWS_CLIENT_ID=${existing.clientId}`,
          `CWS_CLIENT_SECRET=${existing.clientSecret}`,
          `CWS_REFRESH_TOKEN=${json.refresh_token}`,
        ];
        // Preserve unrelated keys already present.
        const parsed = loadDotEnv(prev);
        const keep = [];
        for (const [k, v] of Object.entries(parsed)) {
          if (!['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'].includes(k)) {
            keep.push(`${k}=${v}`);
          }
        }
        await fs.writeFile(credsFile, lines.concat(keep).join('\n') + '\n', { mode: 0o600 });
        await chmod600(credsFile);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('授权完成，可以关闭此窗口。刷新令牌已写入本机 .env.submit，不会出现在仓库里。');
        log('已将 refresh token 写入 .env.submit（权限 600）。不会打印令牌。');
        server.close();
        resolve(0);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('授权失败。请看终端说明。');
        logError(String(err.message || err));
        server.close();
        resolve(1);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      log(`本机回调监听 ${redirectUri} ，等待你在浏览器完成授权。`);
    });
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    logError(err.message);
    log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (parsed.flags.help || parsed.command === 'help') {
    log(USAGE);
    return;
  }
  const env = await loadEnv();
  try {
    if (parsed.command === 'status') process.exitCode = await cmdStatus(parsed.flags, env);
    else if (parsed.command === 'plan') process.exitCode = await cmdPlan(parsed.flags, env);
    else if (parsed.command === 'release') process.exitCode = await cmdRelease(parsed.flags, env);
    else if (parsed.command === 'pack') process.exitCode = await cmdPack(parsed.flags, env);
    else if (parsed.command === 'auth') process.exitCode = await cmdAuth(env);
    else {
      logError(`未知命令：${parsed.command}`);
      log(USAGE);
      process.exitCode = 1;
    }
  } catch (err) {
    logError(redactSecrets(String(err && err.stack ? err.stack : err)));
    process.exitCode = 1;
  }
}

await main();
