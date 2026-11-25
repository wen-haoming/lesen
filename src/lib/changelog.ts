export type ChangelogBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type ChangelogStatus = "pending-review" | "published" | "unspecified";

export type ChangelogRelease = {
  version: string;
  date: string | null;
  headingDetail: string;
  status: ChangelogStatus;
  blocks: ChangelogBlock[];
};

export type ChangelogDocument = {
  title: string;
  intro: ChangelogBlock[];
  releases: ChangelogRelease[];
};

const VERSION_HEADING = /^##\s+(\d+\.\d+\.\d+)\s*(?:[-–—]\s*(.*))?\s*$/;
const LIST_ITEM = /^\s*[-*]\s+(.*)$/;

export function detectChangelogStatus(detail: string): ChangelogStatus {
  const text = String(detail || "");
  if (/待审|审核中|尚未上架|尚未作为商店公开|未上架/.test(text)) return "pending-review";
  if (/(已上架|已发布)/.test(text) && !/(尚未|未上架|审核)/.test(text)) return "published";
  return "unspecified";
}

export function parseChangelogDate(detail: string): string | null {
  const matched = String(detail || "").match(/(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : null;
}

export function compactReleaseLabel(release: ChangelogRelease): string {
  const parts = [release.version];
  if (release.status === "pending-review") {
    parts.push("审核中");
    return parts.join(" · ");
  }
  if (release.date) parts.push(release.date);
  if (release.status === "published") parts.push("已上架");
  return parts.join(" · ");
}

function flushBlocks(lines: string[]): ChangelogBlock[] {
  const blocks: ChangelogBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const endParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const endList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      endParagraph();
      list.push(item[1].trim());
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}

export function parseChangelog(markdown: string): ChangelogDocument {
  const text = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let title = "";
  const preamble: string[] = [];
  const releases: ChangelogRelease[] = [];
  let current: { version: string; headingDetail: string; lines: string[] } | null = null;

  const finish = () => {
    if (!current) return;
    releases.push({
      version: current.version,
      date: parseChangelogDate(current.headingDetail),
      headingDetail: current.headingDetail,
      status: detectChangelogStatus(current.headingDetail),
      blocks: flushBlocks(current.lines),
    });
    current = null;
  };

  for (const line of lines) {
    const heading = line.match(VERSION_HEADING);
    if (heading) {
      if (!title) {
        const maybeTitle = preamble
          .map((item) => item.trim())
          .find((item) => item.startsWith("# "));
        if (maybeTitle) title = maybeTitle.replace(/^#\s+/, "").trim();
      }
      finish();
      current = {
        version: heading[1],
        headingDetail: (heading[2] || "").trim(),
        lines: [],
      };
      continue;
    }
    if (!current) preamble.push(line);
    else current.lines.push(line);
  }
  finish();

  if (!title) {
    const first = preamble.map((item) => item.trim()).find((item) => item.startsWith("# "));
    title = first ? first.replace(/^#\s+/, "").trim() : "";
  }
  const introSource = preamble.filter((item) => item.trim() !== `# ${title}`);

  return {
    title,
    intro: flushBlocks(introSource),
    releases,
  };
}

export function latestRelease(document: ChangelogDocument): ChangelogRelease | null {
  return document.releases[0] || null;
}
