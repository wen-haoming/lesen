import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compactReleaseLabel,
  detectChangelogStatus,
  parseChangelog,
} from "./changelog";

const changelogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../CHANGELOG.md");

describe("parseChangelog", () => {
  it("reads version headings, dates, and list items without inventing releases", () => {
    const doc = parseChangelog(`# 更新说明

导言第一段。

## 1.8.5 - 2026-11-16（代码版本，正在审核，尚未上架）

说明段落。

- 修复阅读位置。
- 移除小红书信息源。
`);
    expect(doc.title).toBe("更新说明");
    expect(doc.intro).toEqual([{ type: "paragraph", text: "导言第一段。" }]);
    expect(doc.releases).toHaveLength(1);
    expect(doc.releases[0]).toMatchObject({
      version: "1.8.5",
      date: "2026-11-16",
      status: "pending-review",
    });
    expect(doc.releases[0].blocks).toEqual([
      { type: "paragraph", text: "说明段落。" },
      { type: "list", items: ["修复阅读位置。", "移除小红书信息源。"] },
    ]);
    expect(compactReleaseLabel(doc.releases[0])).toBe("1.8.5 · 审核中");
  });

  it("keeps raw HTML as text and does not promote it to structure", () => {
    const doc = parseChangelog(`## 1.0.0 - 2020-01-01

- 正常条目
- <script>alert(1)</script>
- <img src=x onerror=alert(1)>

<p>should stay a paragraph</p>
`);
    expect(doc.releases[0].blocks).toEqual([
      {
        type: "list",
        items: ["正常条目", "<script>alert(1)</script>", "<img src=x onerror=alert(1)>"],
      },
      { type: "paragraph", text: "<p>should stay a paragraph</p>" },
    ]);
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain("<script>alert(1)</script>");
  });

  it("does not treat a published-looking date alone as already shipped", () => {
    expect(detectChangelogStatus("2026-11-16")).toBe("unspecified");
    expect(detectChangelogStatus("2026-11-16（已上架）")).toBe("published");
    expect(compactReleaseLabel({
      version: "1.8.4",
      date: "2026-11-10",
      headingDetail: "2026-11-10",
      status: "unspecified",
      blocks: [],
    })).toBe("1.8.4 · 2026-11-10");
  });

  it("parses the repo CHANGELOG.md as the single source", () => {
    const markdown = readFileSync(changelogPath, "utf8");
    const doc = parseChangelog(markdown);
    expect(doc.releases.map((item) => item.version)).toEqual(["1.8.9", "1.8.8", "1.8.7", "1.8.6", "1.8.5"]);
    expect(doc.releases[0].status).toBe("unspecified");
    expect(doc.releases[0].date).toBe("2026-11-19");
    expect(compactReleaseLabel(doc.releases[0])).toBe("1.8.9 · 2026-11-19");
    const latest = JSON.stringify(doc.releases[0].blocks);
    expect(latest).toContain("微博");
    expect(latest).toContain("独立");
    expect(latest).toContain("更新日志");
    const previous = JSON.stringify(doc.releases[1].blocks);
    expect(doc.releases[1].version).toBe("1.8.8");
    expect(doc.releases[1].date).toBe("2026-11-18");
    expect(previous).toContain("Lesen");
    expect(previous).toContain("莱森");
    expect(previous).toContain("展示名");
    const mid = JSON.stringify(doc.releases[2].blocks);
    expect(doc.releases[2].version).toBe("1.8.7");
    expect(doc.releases[2].date).toBe("2026-11-17");
    expect(mid).toContain("发现页");
    expect(mid).toContain("热搜");
    expect(mid).toContain("关于页");
    const older = JSON.stringify(doc.releases[3].blocks);
    expect(doc.releases[3].version).toBe("1.8.6");
    expect(older).toContain("关于页");
    expect(older).toContain("联系入口");
    expect(older).toContain("更新说明");
    const oldest = JSON.stringify(doc.releases[4].blocks);
    expect(doc.releases[4].version).toBe("1.8.5");
    expect(oldest).toContain("阅读位置");
    expect(oldest).toContain("胶囊");
    expect(oldest).toContain("小红书");
    expect(markdown).not.toMatch(/待审|审核中|尚未上架|公开上架版本仍为/);
    expect(markdown).not.toMatch(/mailto:|cnb\.cool|gitee\.com/);
  });
});
