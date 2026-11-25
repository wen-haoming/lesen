import { parseChangelog, type ChangelogRelease } from "./changelog";

export function findReleaseByVersion(markdown: string, version: string): ChangelogRelease | null {
  const doc = parseChangelog(markdown);
  return doc.releases.find((r) => r.version === version) ?? null;
}

export function formatReleaseNotesMarkdown(release: ChangelogRelease): string {
  const lines: string[] = [`## ${release.version}${release.date ? ` - ${release.date}` : ""}`, ""];
  for (const block of release.blocks) {
    if (block.type === "paragraph") {
      lines.push(block.text, "");
    } else if (block.type === "list") {
      for (const item of block.items) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

export function releaseNotesForVersion(markdown: string, version: string): string | null {
  const release = findReleaseByVersion(markdown, version);
  if (!release) return null;
  return formatReleaseNotesMarkdown(release);
}