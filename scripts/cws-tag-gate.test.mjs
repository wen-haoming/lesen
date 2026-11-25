import { describe, expect, it } from 'vitest'
import {
  KNOWN_PUBLISHED_FLOOR,
  decideCiEventGate,
  decideCommitIdentity,
  decideTagReleaseGate,
  decideTagVersionMatch,
  parseOwlivoReleaseTag,
  shasMatch,
} from './cws-tag-gate.mjs'

const shaA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const shaB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('parseOwlivoReleaseTag', () => {
  it('accepts lesen-v and owlivo-v tags', () => {
    expect(parseOwlivoReleaseTag('owlivo-v1.8.5')).toEqual({
      ok: true,
      tag: 'owlivo-v1.8.5',
      version: '1.8.5',
    })
    expect(parseOwlivoReleaseTag('lesen-v1.8.9')).toEqual({
      ok: true,
      tag: 'lesen-v1.8.9',
      version: '1.8.9',
    })
  })
  it('rejects other tag shapes', () => {
    for (const tag of ['v1.8.5', 'owlivo-1.8.5', 'owlivo-v1.8.5-beta', 'owlivo-v1.8', '', 'main']) {
      expect(parseOwlivoReleaseTag(tag).ok).toBe(false)
      expect(parseOwlivoReleaseTag(tag).code).toBe('INVALID_RELEASE_TAG')
    }
  })
})

describe('decideTagVersionMatch', () => {
  it('requires exact tag and package match, and higher than the 1.8.4 floor', () => {
    const ok = decideTagVersionMatch({
      tagVersion: '1.8.5',
      packageVersion: '1.8.5',
      publishedFloor: KNOWN_PUBLISHED_FLOOR,
    })
    expect(ok.ok).toBe(true)
    expect(ok.code).toBe('VERSION_OK')
  })
  it('rejects package/tag mismatch', () => {
    const decision = decideTagVersionMatch({ tagVersion: '1.8.5', packageVersion: '1.8.4' })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('TAG_PACKAGE_MISMATCH')
  })
  it('rejects the current 1.8.3 tree and the live 1.8.4 floor', () => {
    expect(decideTagVersionMatch({ tagVersion: '1.8.3', packageVersion: '1.8.3' }).code).toBe(
      'NOT_HIGHER_THAN_FLOOR',
    )
    expect(decideTagVersionMatch({ tagVersion: '1.8.4', packageVersion: '1.8.4' }).code).toBe(
      'NOT_HIGHER_THAN_FLOOR',
    )
  })
  it('rejects manifest mismatch', () => {
    const decision = decideTagVersionMatch({
      tagVersion: '1.8.5',
      packageVersion: '1.8.5',
      manifestVersion: '1.8.4',
    })
    expect(decision.code).toBe('MANIFEST_VERSION_MISMATCH')
  })
})

describe('event and commit gates', () => {
  it('allows only armed tag_push', () => {
    expect(decideCiEventGate({ event: 'push', allowLiveRelease: true }).ok).toBe(false)
    expect(decideCiEventGate({ event: 'tag_push', allowLiveRelease: false }).code).toBe(
      'LIVE_RELEASE_NOT_ARMED',
    )
    expect(decideCiEventGate({ event: 'tag_push', allowLiveRelease: true }).ok).toBe(true)
  })
  it('requires the tag, HEAD and CNB_COMMIT to be the same sha', () => {
    expect(shasMatch(shaA, shaA.slice(0, 8))).toBe(true)
    expect(
      decideCommitIdentity({ headSha: shaA, cnbCommit: shaA, tagSha: shaA }).ok,
    ).toBe(true)
    expect(
      decideCommitIdentity({ headSha: shaA, cnbCommit: shaB, tagSha: shaA }).code,
    ).toBe('COMMIT_MISMATCH')
    expect(
      decideCommitIdentity({ headSha: shaA, cnbCommit: shaA, tagSha: shaB }).code,
    ).toBe('TAG_COMMIT_MISMATCH')
  })
})

describe('decideTagReleaseGate', () => {
  const base = {
    tagName: 'owlivo-v1.8.5',
    packageVersion: '1.8.5',
    event: 'tag_push',
    isTag: 'true',
    allowLiveRelease: true,
    headSha: shaA,
    cnbCommit: shaA,
    tagSha: shaA,
  }
  it('passes a complete valid tag release', () => {
    const decision = decideTagReleaseGate(base)
    expect(decision.ok).toBe(true)
    expect(decision.code).toBe('READY')
    expect(decision.version).toBe('1.8.5')
  })
  it('fail-closed if any check is missing or wrong', () => {
    expect(decideTagReleaseGate({ ...base, tagName: 'v1.8.5' }).ok).toBe(false)
    expect(decideTagReleaseGate({ ...base, event: 'push' }).ok).toBe(false)
    expect(decideTagReleaseGate({ ...base, allowLiveRelease: false, requireArmed: true }).ok).toBe(false)
    expect(decideTagReleaseGate({ ...base, packageVersion: '1.8.3' }).ok).toBe(false)
  })
})
