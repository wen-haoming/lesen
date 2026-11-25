#!/usr/bin/env bash
# GitHub tag push CWS path (migrated from CNB owlivo-release.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() { echo "cws-tag-release: FAIL $*" >&2; exit 1; }

if [[ "${CWS_ALLOW_LIVE_RELEASE:-}" == "1" ]]; then fail "启动时不得预先打开 CWS_ALLOW_LIVE_RELEASE"; fi
if [[ -n "${CWS_MOCK_STATUS:-}" ]]; then fail "正式送审不得设置 CWS_MOCK_STATUS"; fi

PIPELINE_LIVE=0
if [[ "${CWS_PIPELINE_ENABLED:-}" == "true" || "${CWS_PIPELINE_ENABLED:-}" == "1" ]]; then PIPELINE_LIVE=1; fi

TAG="${GITHUB_REF_NAME:-}"
[[ -n "$TAG" ]] || fail "缺少 GITHUB_REF_NAME"
HEAD_SHA="$(git rev-parse HEAD)"
CNB_SHA="${GITHUB_SHA:-$HEAD_SHA}"
MANIFEST_VERSION="$(node -p "require('./package.json').version")"
FLOOR="${CWS_KNOWN_PUBLISHED_FLOOR:-1.8.4}"

export GITHUB_PIPELINE_EVENT=tag_push
export GITHUB_REF_NAME="$TAG"

echo "cws-tag-release: 标签门禁"
node scripts/cws-tag-gate.mjs gate \
  --package-json package.json \
  --manifest-version "$MANIFEST_VERSION" \
  --tag "$TAG" \
  --event tag_push \
  --is-tag true \
  --head-sha "$HEAD_SHA" \
  --cnb-commit "$CNB_SHA" \
  --tag-sha "$HEAD_SHA" \
  --floor "$FLOOR" || fail "标签门禁未通过"

pnpm install --frozen-lockfile
pnpm compile
pnpm exec vp test run scripts/cws-lib.test.mjs scripts/cws-tag-gate.test.mjs scripts/cws-master-gate.test.mjs
pnpm test
pnpm typecheck

if [[ "$PIPELINE_LIVE" == "1" ]]; then
  node scripts/ci/cws-production-env-guard.mjs
  pnpm exec wxt zip
else
  pnpm build
fi
node scripts/smoke-verify.mjs
node scripts/verify-versions.mjs

if [[ "$PIPELINE_LIVE" != "1" ]]; then
  echo "cws-tag-release: pipeline disabled — dry-run release"
  node scripts/cws.mjs release --dry-run
  exit 0
fi

node scripts/cws-tag-gate.mjs gate \
  --package-json package.json \
  --manifest-version "$MANIFEST_VERSION" \
  --tag "$TAG" \
  --event tag_push \
  --is-tag true \
  --head-sha "$HEAD_SHA" \
  --cnb-commit "$CNB_SHA" \
  --tag-sha "$HEAD_SHA" \
  --floor "$FLOOR" \
  --allow-live-release 1 \
  --require-armed 1

export CWS_ALLOW_LIVE_RELEASE=1
node scripts/cws.mjs release