#!/usr/bin/env bash
# GitHub main push CWS path (migrated from CNB owlivo-master-release.sh). fail-closed, skipReview=false, no cancel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() { echo "cws-main-release: FAIL $*" >&2; exit 1; }

if [[ "${CWS_ALLOW_LIVE_RELEASE:-}" == "1" ]]; then
  fail "启动时不得预先打开 CWS_ALLOW_LIVE_RELEASE"
fi
if [[ -n "${CWS_MOCK_STATUS:-}" ]]; then
  fail "正式送审不得设置 CWS_MOCK_STATUS"
fi

PIPELINE_LIVE="${CWS_PIPELINE_ENABLED:-false}"
if [[ "$PIPELINE_LIVE" == "true" || "$PIPELINE_LIVE" == "1" ]]; then
  PIPELINE_LIVE=1
else
  PIPELINE_LIVE=0
fi

EVENT="${GITHUB_PIPELINE_EVENT:-${CNB_EVENT:-push}}"
BRANCH="${GITHUB_REF_NAME:-${CNB_BRANCH:-main}}"
HEAD_SHA="$(git rev-parse HEAD)"
CNB_SHA="${GITHUB_SHA:-${CNB_COMMIT:-$HEAD_SHA}}"
BEFORE_SHA="${GITHUB_BEFORE_SHA:-${CNB_BEFORE_SHA:-}}"
MANIFEST_VERSION="$(node -p "require('./package.json').version")"
FLOOR="${CWS_KNOWN_PUBLISHED_FLOOR:-1.8.4}"
REPORT_DIR="${RUNNER_TEMP:-/tmp}/lesen-cws"
mkdir -p "$REPORT_DIR"

has_cws_publish_creds() {
  if [[ -n "${CWS_SERVICE_ACCOUNT_CLIENT_EMAIL:-}" && -n "${CWS_SERVICE_ACCOUNT_PRIVATE_KEY:-}" ]]; then return 0; fi
  if [[ -n "${CWS_CLIENT_ID:-${CHROME_CLIENT_ID:-}}" && -n "${CWS_CLIENT_SECRET:-${CHROME_CLIENT_SECRET:-}}" && -n "${CWS_REFRESH_TOKEN:-${CHROME_REFRESH_TOKEN:-}}" ]]; then return 0; fi
  return 1
}

run_quality_gates() {
  local label="$1"
  echo "$label: pnpm install/compile/test/typecheck"
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
}

echo "cws-main-release: 预检版本门禁"
node scripts/cws-master-gate.mjs gate \
  --package-json package.json \
  --repo "$ROOT" \
  --manifest-version "$MANIFEST_VERSION" \
  --event "$EVENT" \
  --branch "$BRANCH" \
  --is-tag false \
  --head-sha "$HEAD_SHA" \
  --cnb-commit "$CNB_SHA" \
  --before-sha "$BEFORE_SHA" \
  --floor "$FLOOR" | tee "$REPORT_DIR/main-gate.json"

GATE_CODE="$(node -p "JSON.parse(require('fs').readFileSync('$REPORT_DIR/main-gate.json','utf8')).code")"
echo "cws-main-release: gate=${GATE_CODE}"

export GITHUB_PIPELINE_EVENT="$EVENT"
export GITHUB_REF_NAME="$BRANCH"

if [[ "$GATE_CODE" == "VERIFY_ONLY" ]]; then
  if [[ "$PIPELINE_LIVE" != "1" ]]; then
    echo "cws-main-release: pipeline disabled — dry-run plan only"
    node scripts/cws.mjs plan --dry-run --mock-status @scripts/fixtures/cws-store-published-1.8.4.mock.json
    exit 0
  fi
  if ! has_cws_publish_creds; then fail "VERIFY_ONLY 路径需要 CWS 凭据（只读 plan）"; fi
  PLAN_OUT="$REPORT_DIR/cws-plan.json"
  OWLIVO_PLAN_OUT="$PLAN_OUT" node scripts/cws.mjs plan
  node scripts/cws-master-gate.mjs verify-only-followup --plan "$PLAN_OUT" | tee "$REPORT_DIR/verify-only-followup.json"
  FOLLOW_CODE="$(node -p "JSON.parse(require('fs').readFileSync('$REPORT_DIR/verify-only-followup.json','utf8')).code")"
  FOLLOW_LIVE="$(node -p "JSON.parse(require('fs').readFileSync('$REPORT_DIR/verify-only-followup.json','utf8')).live ? '1' : '0'")"
  if [[ "$FOLLOW_CODE" == "SKIP_ONLY_VERIFY" ]]; then
    run_quality_gates "cws-main-release-skip-verify"
    export CWS_SAME_VERSION_SKIP_ONLY=1
    node scripts/cws.mjs release
    exit 0
  fi
  if [[ "$FOLLOW_LIVE" != "1" ]]; then fail "VERIFY_ONLY 后续 ${FOLLOW_CODE} 不允许继续"; fi
  run_quality_gates "cws-main-release-same-version-ready"
  export CWS_ALLOW_LIVE_RELEASE=1
  node scripts/cws.mjs release
  exit 0
fi

if [[ "$GATE_CODE" != "READY" && "$GATE_CODE" != "VERSION_INCREMENTED" ]]; then
  if [[ "$PIPELINE_LIVE" != "1" ]]; then
    echo "cws-main-release: gate blocked (${GATE_CODE}); pipeline disabled — exiting after gate"
    exit 1
  fi
  fail "门禁未通过: ${GATE_CODE}"
fi

if [[ "$PIPELINE_LIVE" != "1" ]]; then
  echo "cws-main-release: version incremented but CWS_PIPELINE_ENABLED!=true — quality + dry-run release"
  run_quality_gates "cws-main-release-dry"
  node scripts/cws.mjs release --dry-run
  exit 0
fi

run_quality_gates "cws-main-release"
export CWS_ALLOW_LIVE_RELEASE=1
node scripts/cws-master-gate.mjs gate \
  --package-json package.json \
  --repo "$ROOT" \
  --manifest-version "$MANIFEST_VERSION" \
  --event "$EVENT" \
  --branch "$BRANCH" \
  --is-tag false \
  --head-sha "$HEAD_SHA" \
  --cnb-commit "$CNB_SHA" \
  --before-sha "$BEFORE_SHA" \
  --floor "$FLOOR" \
  --allow-live-release 1 \
  --require-armed 1 | tee "$REPORT_DIR/main-armed.json"
node scripts/cws.mjs release