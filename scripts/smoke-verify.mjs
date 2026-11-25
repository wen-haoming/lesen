#!/usr/bin/env node
/**
 * 构建后静态校验（WXT 版）：校验 .output/chrome-mv3 的 manifest 路径存在、
 * 产物无 eval、CSP 未放宽、图标尺寸正确、通知去重逻辑未被回退。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, ".output", "chrome-mv3");
const errors = [];

// 确保源 icons 含精确尺寸 PNG（与 public/icons 一致）
await import(pathToFileURL(path.join(root, "scripts", "generate-icons.mjs")).href);

function fail(msg) {
  errors.push(msg);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a png");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

if (!fs.existsSync(dist)) fail(".output/chrome-mv3 missing (run `wxt build` first)");
const manifestPath = path.join(dist, "manifest.json");
if (!fs.existsSync(manifestPath)) fail("manifest.json missing");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (manifest.version !== pkgVersion) {
  fail(`manifest version ${manifest.version} != package.json ${pkgVersion}`);
}
const expectedCsp =
  "script-src 'self'; object-src 'self'; img-src 'self' https: data:; media-src 'self' https:";
if (manifest.content_security_policy?.extension_pages !== expectedCsp) {
  fail("CSP changed or missing: " + String(manifest.content_security_policy?.extension_pages));
}

const requiredPerms = ["storage", "scripting", "cookies", "notifications", "alarms", "sidePanel", "declarativeNetRequest"];
// declarativeNetRequest is restricted to setting platform request headers for Weibo API/media requests.
for (const p of requiredPerms) {
  if (!manifest.permissions?.includes(p)) fail("missing permission: " + p);
}
const allowedPerms = new Set(requiredPerms);
const optionalPerms = new Set(["identity"]);
for (const p of manifest.permissions || []) {
  if (!allowedPerms.has(p) && !optionalPerms.has(p)) fail("permission expanded: " + p);
}
const hosts = manifest.host_permissions || [];
for (const host of hosts) {
  if (/service_role|sb_secret_/i.test(host)) fail("host permission looks like a secret");
}

if (manifest.side_panel?.default_path !== "sidepanel.html") {
  fail("side_panel.default_path missing or wrong: " + String(manifest.side_panel?.default_path));
}

if (/未读/.test(String(manifest.description || ""))) {
  fail("manifest description still mentions 未读");
}

const resourcePaths = new Set();
resourcePaths.add(manifest.background?.service_worker);
resourcePaths.add(manifest.action?.default_popup);
resourcePaths.add(manifest.side_panel?.default_path);
for (const icon of Object.values(manifest.icons || {})) resourcePaths.add(icon);
for (const icon of Object.values(manifest.action?.default_icon || {})) resourcePaths.add(icon);
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) resourcePaths.add(js);
}

for (const rel of resourcePaths) {
  if (!rel) continue;
  const abs = path.join(dist, rel);
  if (!fs.existsSync(abs)) fail("manifest resource missing: " + rel);
}

const expectedIcons = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};
for (const [size, rel] of Object.entries(expectedIcons)) {
  if (manifest.icons?.[size] !== rel) fail("manifest.icons." + size + " missing or wrong");
  if (manifest.action?.default_icon?.[size] !== rel)
    fail("action.default_icon." + size + " missing or wrong");
  const abs = path.join(dist, rel);
  if (!fs.existsSync(abs)) {
    fail("icon missing: " + rel);
    continue;
  }
  try {
    const dim = readPngSize(abs);
    if (dim.width !== Number(size) || dim.height !== Number(size)) {
      fail(rel + " size is " + dim.width + "x" + dim.height + ", expected " + size + "x" + size);
    }
  } catch {
    fail(rel + " is not a valid PNG");
  }
}

// content scripts：必须同时存在 MAIN 与 ISOLATED 两个 world
const worlds = new Set((manifest.content_scripts || []).map((cs) => cs.world));
if (!worlds.has("MAIN")) fail("content_scripts missing MAIN world (page-bridge)");
if (!worlds.has("ISOLATED")) fail("content_scripts missing ISOLATED world (content)");

const popupHtmlPath = path.join(dist, "popup.html");
if (fs.existsSync(popupHtmlPath)) {
  const popupHtml = fs.readFileSync(popupHtmlPath, "utf8");
  if (/<script(?![^>]*src=)[^>]*>/i.test(popupHtml)) {
    fail("popup.html contains inline script");
  }
  if (/\beval\s*\(/.test(popupHtml)) fail("popup.html contains eval");
  if (/demoTools|DemoSwitcher/.test(popupHtml)) {
    fail("popup.html must not embed demo tools");
  }
} else {
  fail("popup.html missing");
}

const sidepanelHtmlPath = path.join(dist, "sidepanel.html");
if (fs.existsSync(sidepanelHtmlPath)) {
  const sidepanelHtml = fs.readFileSync(sidepanelHtmlPath, "utf8");
  if (/<script(?![^>]*src=)[^>]*>/i.test(sidepanelHtml)) {
    fail("sidepanel.html contains inline script");
  }
  if (/\beval\s*\(/.test(sidepanelHtml)) fail("sidepanel.html contains eval");
} else {
  fail("sidepanel.html missing");
}

const bgPath = path.join(dist, "background.js");
if (fs.existsSync(bgPath)) {
  const bg = fs.readFileSync(bgPath, "utf8");
  if (!/icons\/icon128\.png/.test(bg)) fail("notification fallback icon128 missing in background");
} else {
  fail("background.js missing");
}

// 通知去重逻辑校验改在源码级做：WXT 产物 minify 会抹掉函数名，
// 产物文本断言不可靠；源码 background-main.js 是唯一可信来源。
const bgSrcPath = path.join(root, "src", "lib", "background-main.js");
if (fs.existsSync(bgSrcPath)) {
  const src = fs.readFileSync(bgSrcPath, "utf8");
  const start = src.indexOf("async function checkUpdates");
  const end = src.indexOf("chrome.alarms.onAlarm");
  const slice = start >= 0 && end > start ? src.slice(start, end) : "";
  const codeOnly = slice.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (!slice) fail("checkUpdates function not found in background-main.js");
  if (/authorReadAt/.test(codeOnly)) {
    fail("checkUpdates executable code still references authorReadAt");
  }
  if (!/notifyState/.test(codeOnly)) {
    fail("checkUpdates should use notifyState for dedupe");
  }
} else {
  fail("src/lib/background-main.js missing");
}

const files = walk(dist).filter((f) => /\.(js|html|css|json)$/.test(f));
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(dist, file);
  if (/\beval\s*\(/.test(text) && !file.endsWith("smoke-verify.mjs")) {
    fail("eval( found in " + rel);
  }
  if (/new\s+Function\s*\(/.test(text)) {
    fail("new Function( found in " + rel);
  }
  if (/X-Debug-Session-Id/i.test(text)) {
    fail("X-Debug-Session-Id found in " + rel);
  }
  if (/https?:\/\/(?:127\.0\.0\.1|localhost)(?!:9999\b)/i.test(text)) {
    fail("local debug request found in " + rel);
  }
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) {
    fail("secret API key material found in " + rel);
  }
  if (/xiaohongshu|webpackChunkxhs_pc_web|xhscdn/i.test(text)) {
    fail("retired xiaohongshu code/host residue found in " + rel);
  }
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  for (const token of text.match(jwtPattern) || []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (payload && payload.role === "service_role") fail("service_role key material found in " + rel);
    } catch {}
  }
}

if (errors.length) {
  console.error("[smoke-verify] FAILED");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[smoke-verify] OK");
console.log(" Chrome load path:", dist);
