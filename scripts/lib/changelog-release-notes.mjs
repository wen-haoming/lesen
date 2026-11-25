/**
 * Minimal CHANGELOG extractor (aligned with src/lib/changelog.ts headings).
 */

const VERSION_HEADING = /^##\s+(\d+\.\d+\.\d+)\s*(?:[-–—]\s*(.*))?\s*$/;
const LIST_ITEM = /^\s*[-*]\s+(.*)$/;

export function findReleaseSection(markdown, version) {
  const lines = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  let inSection = false;
  const body = [];
  for (const raw of lines) {
    const heading = raw.match(VERSION_HEADING);
    if (heading) {
      if (inSection) break;
      if (heading[1] === version) {
        inSection = true;
        continue;
      }
      continue;
    }
    if (inSection) body.push(raw);
  }
  if (!inSection) return null;
  return formatSection(version, body);
}

function formatSection(version, bodyLines) {
  const lines = [`## ${version}`, ""];
  for (const raw of bodyLines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      lines.push("");
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) lines.push(`- ${item[1].trim()}`);
    else lines.push(line.trim());
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}