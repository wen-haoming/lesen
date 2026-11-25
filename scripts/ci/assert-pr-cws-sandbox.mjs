#!/usr/bin/env node
/** Ensures PR jobs stay offline: no live flags, no publisher creds. */
const forbiddenPresent = [
  "CWS_ALLOW_LIVE_RELEASE",
  "CWS_MOCK_STATUS",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CHROME_CLIENT_SECRET",
  "CHROME_REFRESH_TOKEN",
].filter((k) => {
  const v = process.env[k];
  return v === "1" || (v && String(v).trim().length > 8);
});

const enabled = process.env.CWS_PIPELINE_ENABLED;
if (enabled === "true" || enabled === "1") {
  console.error("[assert-pr-cws-sandbox] CWS_PIPELINE_ENABLED must not be true on pull_request");
  process.exit(1);
}

if (forbiddenPresent.length) {
  console.error("[assert-pr-cws-sandbox] forbidden env on PR:", forbiddenPresent.join(", "));
  process.exit(1);
}

console.log("[assert-pr-cws-sandbox] OK");