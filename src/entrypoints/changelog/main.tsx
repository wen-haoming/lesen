import { createRoot } from "react-dom/client";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import { bootstrapAppearance } from "@/lib/appearance";
import { parseChangelog, type ChangelogBlock } from "@/lib/changelog";
import { PRODUCT_DISPLAY_NAME } from "@/lib/product-brand";
import "@/styles/globals.css";

const changelog = parseChangelog(changelogMarkdown);

function ChangelogBlocks({ blocks }: { blocks: ChangelogBlock[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, index) =>
        block.type === "list" ? (
          <ul key={index} className="list-disc space-y-2 pl-5">
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
          </ul>
        ) : (
          <p key={index}>{block.text}</p>
        ),
      )}
    </div>
  );
}

function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10 sm:px-8 sm:py-14">
      <header className="border-b border-border pb-5">
        <p className="text-sm font-medium text-muted-foreground">{PRODUCT_DISPLAY_NAME}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{changelog.title}</h1>
      </header>
      {changelog.releases.map((release, index) => (
        <section className="border-b border-border py-5 last:border-b-0" key={`${release.version}-${index}`}>
          <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tabular-nums">{release.version}</h2>
            {release.date && (
              <time className="text-xs tabular-nums text-muted-foreground" dateTime={release.date}>
                {release.date}
              </time>
            )}
          </div>
          <ChangelogBlocks blocks={release.blocks} />
        </section>
      ))}
    </main>
  );
}

bootstrapAppearance();

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");
createRoot(root).render(<ChangelogPage />);
