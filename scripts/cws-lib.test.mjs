import { describe, expect, it } from 'vitest'
import {
  acquireLock,
  compareChromeVersions,
  decideCnbLiveReleaseEvent,
  decideReleaseAction,
  decideSameVersionSkipOnly,
  extractStoreVersions,
  loadDotEnv,
  parseChromeVersion,
  pickCredentials,
  publishRequestBody,
  redactSecrets,
  releaseLock,
} from './cws-lib.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('chrome version compare', () => {
  it('orders dotted integers', () => {
    expect(compareChromeVersions('1.8.2', '1.8.1')).toBe(1)
    expect(compareChromeVersions('1.8.2', '1.8.2')).toBe(0)
    expect(compareChromeVersions('1.9', '1.8.2')).toBe(1)
    expect(compareChromeVersions('1.8.0', '1.8')).toBe(0)
  })
  it('rejects invalid versions', () => {
    expect(parseChromeVersion('1.8.2-beta')).toBeNull()
    expect(() => compareChromeVersions('foo', '1.0')).toThrow()
  })
})

describe('redactSecrets', () => {
  it('redacts tokens and keys without leaking values', () => {
    const out = redactSecrets({
      access_token: '<REDACTED_SECRET>',
      refresh_token: '1//hidden',
      Authorization: 'Bearer <REDACTED_SECRET>',
      version: '1.8.2',
    })
    const text = JSON.stringify(out)
    expect(text).not.toMatch(/ya29/)
    expect(text).not.toMatch(/super-secret/)
    expect(text).not.toMatch(/hidden/)
    expect(out.version).toBe('1.8.2')
    expect(out.access_token).toBe('[redacted]')
  })
  it('redacts tokens inside log strings', () => {
    const text = redactSecrets('Authorization: Bearer ya29.demo-token-value')
    expect(text).toContain('[redacted]')
    expect(text).not.toMatch(/ya29/)
  })
})

function store({ publishedVersion, publishedState = 'PUBLISHED', submittedVersion, submittedState, lastAsyncUploadState, takenDown = false } = {}) {
  return extractStoreVersions({
    takenDown,
    lastAsyncUploadState,
    publishedItemRevisionStatus: publishedVersion
      ? { state: publishedState, distributionChannels: [{ crxVersion: publishedVersion, deployPercentage: 100 }] }
      : undefined,
    submittedItemRevisionStatus: submittedVersion
      ? { state: submittedState, distributionChannels: [{ crxVersion: submittedVersion }] }
      : undefined,
  })
}

describe('decideReleaseAction', () => {
  it('skips when local version is already published (1.8.2 must not be resent)', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.2',
      store: store({ publishedVersion: '1.8.2' }),
    })
    expect(decision.action).toBe('skip')
    expect(decision.code).toBe('ALREADY_PUBLISHED')
    expect(decision.live).toBe(false)
  })

  it('fails on downgrade', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.1',
      store: store({ publishedVersion: '1.8.2' }),
    })
    expect(decision.action).toBe('fail')
    expect(decision.code).toBe('VERSION_DOWNGRADE')
  })

  it('skips when the same version is already pending review', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2', submittedVersion: '1.8.3', submittedState: 'PENDING_REVIEW' }),
    })
    expect(decision.action).toBe('skip')
    expect(decision.code).toBe('ALREADY_PENDING')
  })

  it('skips 1.8.5 when that exact version is already pending, even if local gate would be READY vs 1.8.3/1.8.4', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.5',
      store: store({ publishedVersion: '1.8.4', submittedVersion: '1.8.5', submittedState: 'PENDING_REVIEW' }),
    })
    expect(decision.action).toBe('skip')
    expect(decision.code).toBe('ALREADY_PENDING')
    expect(decision.live).toBe(false)
  })

  it('fails if another version is pending and does not cancel it', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.4',
      store: store({ publishedVersion: '1.8.2', submittedVersion: '1.8.3', submittedState: 'PENDING_REVIEW' }),
    })
    expect(decision.action).toBe('fail')
    expect(decision.code).toBe('OTHER_VERSION_PENDING')
  })

  it('proceeds only when local is higher and nothing is pending', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      zipVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2' }),
    })
    expect(decision.action).toBe('proceed')
    expect(decision.code).toBe('READY')
  })

  it('waits instead of starting a new upload while one is in progress', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2', lastAsyncUploadState: 'IN_PROGRESS' }),
    })
    expect(decision.action).toBe('wait-upload')
  })

  it('does not retry upload after an unknown timeout', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2' }),
      previousUnknown: { phase: 'upload', version: '1.8.3' },
    })
    expect(decision.action).toBe('fail')
    expect(decision.code).toBe('PREVIOUS_UPLOAD_UNKNOWN')
  })

  it('resumes with publish-only after unknown upload if status later shows success', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2', lastAsyncUploadState: 'SUCCEEDED' }),
      previousUnknown: { phase: 'upload', version: '1.8.3' },
    })
    expect(decision.action).toBe('publish-only')
  })

  it('treats unknown publish as already submitted when status is pending', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2', submittedVersion: '1.8.3', submittedState: 'PENDING_REVIEW' }),
      previousUnknown: { phase: 'publish', version: '1.8.3' },
    })
    // Live pending status is enough to skip; do not retry publish.
    expect(decision.action).toBe('skip')
    expect(['ALREADY_PENDING', 'RESUME_ALREADY_SUBMITTED']).toContain(decision.code)
  })

  it('rejects same-version after rejection', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      store: store({ publishedVersion: '1.8.2', submittedVersion: '1.8.3', submittedState: 'REJECTED' }),
    })
    expect(decision.action).toBe('fail')
    expect(decision.code).toBe('SAME_VERSION_REJECTED')
  })

  it('fails when package and zip versions differ', () => {
    const decision = decideReleaseAction({
      localVersion: '1.8.3',
      zipVersion: '1.8.2',
      store: store({ publishedVersion: '1.8.2' }),
    })
    expect(decision.action).toBe('fail')
    expect(decision.code).toBe('VERSION_MISMATCH')
  })
})

describe('publishRequestBody', () => {
  it('uses official auto-publish after review and does not skip review', () => {
    expect(publishRequestBody()).toEqual({ publishType: 'DEFAULT_PUBLISH', skipReview: false })
  })
})

describe('lock and env', () => {
  it('refuses a second lock', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cws-lock-'))
    const lock = path.join(dir, 'cws.lock')
    const first = await acquireLock(lock, { pid: 1 })
    expect(first.ok).toBe(true)
    const second = await acquireLock(lock, { pid: 2 })
    expect(second.ok).toBe(false)
    await releaseLock(lock)
    const third = await acquireLock(lock, { pid: 3 })
    expect(third.ok).toBe(true)
    await releaseLock(lock)
  })

  it('loads env keys without exposing parsing of comments', () => {
    const env = loadDotEnv('# secret\nCWS_CLIENT_ID=abc\nCWS_REFRESH_TOKEN=1//nope\n')
    expect(env.CWS_CLIENT_ID).toBe('abc')
    expect(pickCredentials(env).kind).toBeNull()
    const full = pickCredentials({
      ...env,
      CWS_CLIENT_SECRET: 's',
      CWS_REFRESH_TOKEN: '1//nope',
    })
    expect(full.kind).toBe('oauth')
  })
})

describe('decideCnbLiveReleaseEvent', () => {
  it('does not apply the CNB event restriction locally', () => {
    expect(decideCnbLiveReleaseEvent({}).ok).toBe(true)
    expect(decideCnbLiveReleaseEvent({ event: '' }).code).toBe('LOCAL')
  })

  it('rejects an unarmed CNB event before any upload', () => {
    const d = decideCnbLiveReleaseEvent({ event: 'push', branch: 'master', allowLiveRelease: false })
    expect(d.ok).toBe(false)
    expect(d.code).toBe('NOT_ARMED')
  })

  it('allows armed tag_push and armed master push only', () => {
    expect(decideCnbLiveReleaseEvent({ event: 'tag_push', branch: 'owlivo-v1.8.6', allowLiveRelease: '1' }).ok).toBe(true)
    expect(decideCnbLiveReleaseEvent({ event: 'push', branch: 'master', allowLiveRelease: true }).ok).toBe(true)
    expect(decideCnbLiveReleaseEvent({ event: 'push', branch: 'main', allowLiveRelease: true }).ok).toBe(true)
    const pr = decideCnbLiveReleaseEvent({ event: 'pull_request', branch: 'master', allowLiveRelease: '1' })
    expect(pr.ok).toBe(false)
    expect(pr.code).toBe('EVENT_NOT_ALLOWED')
    const feat = decideCnbLiveReleaseEvent({ event: 'push', branch: 'ci/experiment', allowLiveRelease: '1' })
    expect(feat.ok).toBe(false)
    expect(feat.code).toBe('EVENT_NOT_ALLOWED')
  })
})

describe('decideSameVersionSkipOnly', () => {
  it('allows only same-version store skips', () => {
    expect(decideSameVersionSkipOnly({ action: 'skip', code: 'ALREADY_PENDING' }).ok).toBe(true)
    expect(decideSameVersionSkipOnly({ action: 'skip', code: 'ALREADY_PUBLISHED' }).ok).toBe(true)
    expect(decideSameVersionSkipOnly({ action: 'skip', code: 'ALREADY_STAGED' }).ok).toBe(true)
    expect(decideSameVersionSkipOnly({ action: 'skip', code: 'RESUME_ALREADY_SUBMITTED' }).ok).toBe(true)
  })

  it('refuses upload or publish when the store would not skip this version', () => {
    const proceed = decideSameVersionSkipOnly({ action: 'proceed', code: 'READY' })
    expect(proceed.ok).toBe(false)
    expect(proceed.code).toBe('SKIP_ONLY_REFUSED')
    expect(decideSameVersionSkipOnly({ action: 'fail', code: 'OTHER_VERSION_PENDING' }).ok).toBe(false)
    expect(decideSameVersionSkipOnly({ action: 'skip', code: 'SOMETHING_ELSE' }).ok).toBe(false)
    expect(decideSameVersionSkipOnly({ action: 'publish-only', code: 'RESUME_UPLOAD_SUCCEEDED' }).ok).toBe(false)
  })
})
