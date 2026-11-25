import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWN_PUBLISHED_FLOOR } from './cws-tag-gate.mjs'
import {
  decideHeadCommitMatch,
  decideMasterEventGate,
  decideMasterReleaseGate,
  decideMasterVersionChange,
  decideVerifyOnlyFollowup,
  isZeroSha,
  readWxtVersionAtSha,
} from './cws-master-gate.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const shaA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const shaB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const shaZero = '0'.repeat(40)

describe('decideMasterReleaseGate before sha', () => {
  it('rejects zero before sha (initial push / race)', () => {
    const gate = decideMasterReleaseGate({
      event: 'push',
      branch: 'main',
      packageVersion: '1.8.9',
      previousVersion: '1.8.8',
      manifestVersion: '1.8.9',
      previousManifestVersion: '1.8.8',
      headSha: shaA,
      cnbCommit: shaA,
      beforeSha: shaZero,
    })
    expect(gate.ok).toBe(false)
    expect(gate.code).toBe('MISSING_BEFORE_SHA')
  })
})

describe('decideMasterEventGate', () => {
  it('allows only trusted main/master push', () => {
    expect(decideMasterEventGate({ event: 'push', branch: 'master' }).ok).toBe(true)
    expect(decideMasterEventGate({ event: 'push', branch: 'main' }).ok).toBe(true)
    expect(decideMasterEventGate({ event: 'tag_push', branch: 'master' }).code).toBe('WRONG_EVENT')
    expect(decideMasterEventGate({ event: 'web_trigger', branch: 'master' }).code).toBe('WRONG_EVENT')
    expect(decideMasterEventGate({ event: 'push', branch: 'feat/x' }).code).toBe('WRONG_BRANCH')
    expect(decideMasterEventGate({ event: 'push', branch: 'master', isTag: 'true' }).code).toBe(
      'NOT_A_BRANCH_PUSH',
    )
  })
})

describe('decideMasterVersionChange', () => {
  it('returns VERIFY_ONLY when the version did not increment', () => {
    const decision = decideMasterVersionChange({
      currentVersion: '1.8.3',
      previousVersion: '1.8.3',
      manifestVersion: '1.8.3',
      previousManifestVersion: '1.8.3',
    })
    expect(decision.ok).toBe(true)
    expect(decision.live).toBe(false)
    expect(decision.code).toBe('VERIFY_ONLY')
  })
  it('allows a real increment above the published floor', () => {
    const decision = decideMasterVersionChange({
      currentVersion: '1.8.6',
      previousVersion: '1.8.3',
      manifestVersion: '1.8.6',
      previousManifestVersion: '1.8.3',
      publishedFloor: KNOWN_PUBLISHED_FLOOR,
    })
    expect(decision.ok).toBe(true)
    expect(decision.live).toBe(true)
    expect(decision.code).toBe('VERSION_INCREMENTED')
  })
  it('does not treat a path-only change as a 1.8.5 or 1.8.4 rerelease', () => {
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.5',
        previousVersion: '1.8.5',
        manifestVersion: '1.8.5',
        previousManifestVersion: '1.8.5',
      }).code,
    ).toBe('VERIFY_ONLY')
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.4',
        previousVersion: '1.8.3',
        manifestVersion: '1.8.4',
        previousManifestVersion: '1.8.3',
      }).code,
    ).toBe('NOT_HIGHER_THAN_FLOOR')
  })
  it('rejects missing previous version, regression, and manifest mismatch', () => {
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.6',
        previousVersion: '',
        manifestVersion: '1.8.6',
      }).code,
    ).toBe('CANNOT_COMPARE')
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.3',
        previousVersion: '1.8.5',
        manifestVersion: '1.8.3',
        previousManifestVersion: '1.8.5',
      }).code,
    ).toBe('VERSION_REGRESSION')
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.6',
        previousVersion: '1.8.3',
        manifestVersion: '1.8.5',
        previousManifestVersion: '1.8.3',
      }).code,
    ).toBe('MANIFEST_VERSION_MISMATCH')
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.6',
        previousVersion: '1.8.3',
        manifestVersion: '1.8.6',
        previousManifestVersion: '1.8.2',
      }).code,
    ).toBe('PREVIOUS_MANIFEST_MISMATCH')
    expect(
      decideMasterVersionChange({
        currentVersion: '1.8.6',
        previousVersion: '1.8.3',
        manifestVersion: '1.8.6',
      }).code,
    ).toBe('CANNOT_COMPARE_MANIFEST')
  })
})

describe('decideMasterReleaseGate', () => {
  const base = {
    packageVersion: '1.8.6',
    previousVersion: '1.8.3',
    manifestVersion: '1.8.6',
    previousManifestVersion: '1.8.3',
    event: 'push',
    branch: 'master',
    isTag: 'false',
    headSha: shaA,
    cnbCommit: shaA,
    beforeSha: shaB,
  }
  it('returns READY for an incremented version on master push', () => {
    const decision = decideMasterReleaseGate(base)
    expect(decision.ok).toBe(true)
    expect(decision.code).toBe('READY')
    expect(decision.live).toBe(true)
    expect(decision.version).toBe('1.8.6')
  })
  it('returns VERIFY_ONLY when files changed but the version did not', () => {
    const decision = decideMasterReleaseGate({
      ...base,
      packageVersion: '1.8.3',
      previousVersion: '1.8.3',
      manifestVersion: '1.8.3',
      previousManifestVersion: '1.8.3',
    })
    expect(decision.ok).toBe(true)
    expect(decision.code).toBe('VERIFY_ONLY')
    expect(decision.live).toBe(false)
  })
  it('fail-closed on untrusted events, missing before sha, or unarmed live release', () => {
    expect(decideMasterReleaseGate({ ...base, event: 'tag_push' }).ok).toBe(false)
    expect(isZeroSha(shaZero)).toBe(true)
    expect(decideMasterReleaseGate({ ...base, beforeSha: shaZero }).code).toBe('MISSING_BEFORE_SHA')
    expect(
      decideMasterReleaseGate({ ...base, requireArmed: true, allowLiveRelease: false }).code,
    ).toBe('LIVE_RELEASE_NOT_ARMED')
    expect(decideHeadCommitMatch({ headSha: shaA, cnbCommit: shaB }).code).toBe('COMMIT_MISMATCH')
  })
})

describe('decideVerifyOnlyFollowup', () => {
  it('verifies skip-only when the store already has this version', () => {
    const decision = decideVerifyOnlyFollowup({
      plan: {
        code: 'ALREADY_PENDING',
        action: 'skip',
        skipOnly: { ok: true, code: 'ALREADY_PENDING' },
      },
    })
    expect(decision.ok).toBe(true)
    expect(decision.live).toBe(false)
    expect(decision.code).toBe('SKIP_ONLY_VERIFY')
    expect(decision.planCode).toBe('ALREADY_PENDING')
  })

  it('allows first store upload of the same git version when plan is READY', () => {
    const decision = decideVerifyOnlyFollowup({
      plan: { code: 'READY', action: 'proceed' },
    })
    expect(decision.ok).toBe(true)
    expect(decision.live).toBe(true)
    expect(decision.code).toBe('SAME_VERSION_STORE_READY')
  })

  it('allows publish-only resume when plan says the previous upload succeeded', () => {
    const decision = decideVerifyOnlyFollowup({
      plan: { code: 'RESUME_UPLOAD_SUCCEEDED', action: 'publish-only' },
    })
    expect(decision.ok).toBe(true)
    expect(decision.live).toBe(true)
    expect(decision.code).toBe('SAME_VERSION_PUBLISH_ONLY')
  })

  it('fail-closed when another version is already pending review', () => {
    const decision = decideVerifyOnlyFollowup({
      plan: {
        code: 'OTHER_VERSION_PENDING',
        action: 'fail',
        message: '商店已有待审版本 1.8.5，本地是 1.8.6。不会取消已有审核，也不会覆盖上传',
      },
    })
    expect(decision.ok).toBe(false)
    expect(decision.live).toBe(false)
    expect(decision.code).toBe('OTHER_VERSION_PENDING')
    expect(decision.message).toMatch(/不会取消已有审核/)
  })

  it('fail-closed on same-version rejection and other unsafe store decisions', () => {
    expect(
      decideVerifyOnlyFollowup({
        plan: { code: 'SAME_VERSION_REJECTED', action: 'fail' },
      }).ok,
    ).toBe(false)
    expect(
      decideVerifyOnlyFollowup({
        plan: { code: 'UPLOAD_IN_PROGRESS', action: 'wait-upload' },
      }).ok,
    ).toBe(false)
    expect(decideVerifyOnlyFollowup({ plan: {} }).ok).toBe(false)
  })
})

describe('readWxtVersionAtSha', () => {
  it('resolves productVersion from package.json at historical commit', () => {
    const at = readWxtVersionAtSha({
      repoRoot,
      sha: '13ca1422c1b149b5f1b7a8613d61964bb271a855',
    })
    expect(at.ok).toBe(true)
    expect(at.version).toBe('1.8.9')
  })
})

