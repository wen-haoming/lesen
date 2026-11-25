import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { FEED_ALL } from "@/lib/config";
import { mergeAppearance, resolveColorScheme } from "@/lib/appearance";
import { useOwlivoAccount } from "@/hooks/useOwlivoAccount";
import { useReader } from "@/hooks/useReader";
import type { SharedReader } from "./ReaderApp";
import {
  createSubscriptionBackup,
  formatSubscriptionShareText,
  parseSubscriptionBackup,
} from "@/lib/subscription-backup";
import { cn } from "@/lib/utils";
import { HomeBoard } from "./components/HomeBoard";
import { SettingsDialog } from "./components/SettingsDialog";
import { ReaderHeader, initialReaderMode, type ReaderMode } from "./components/ReaderHeader";
import { SquareBoard } from "./components/SquareBoard";

export function HomeApp() {
  const reader = useReader();
  return <SharedHomeApp reader={reader} />;
}

export function SharedHomeApp({ reader }: { reader: SharedReader }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "account" | "data">(
    "appearance",
  );
  const [readerMode, setReaderMode] = useState<ReaderMode>(initialReaderMode);
  const [syncHomeScroll, setSyncHomeScroll] = useState(false);
  const [squareRefreshing, setSquareRefreshing] = useState(false);
  const owlivoAuth = useOwlivoAccount(!reader.state.previewMode);
  const homeRefreshSignatureRef = useRef("");

  useEffect(() => {
    const onBusy = (event: Event) => {
      const detail = (event as CustomEvent<{ busy?: boolean }>).detail;
      setSquareRefreshing(Boolean(detail?.busy));
    };
    window.addEventListener("owlivo:square-busy", onBusy);
    return () => window.removeEventListener("owlivo:square-busy", onBusy);
  }, []);

  useEffect(() => {
    if (reader.state.previewMode || !reader.feedList.length) return;
    const sessionSignature = [
      reader.state.platformSessions.xueqiu,
      reader.state.platformSessions.x,
      reader.state.platformSessions.weibo,
    ].join("|");
    const signature = `${reader.feedList.map((source) => source.key).join(",")}|${sessionSignature}`;
    if (homeRefreshSignatureRef.current === signature) return;
    homeRefreshSignatureRef.current = signature;
    void reader.refresh({ maxAgeMs: 2 * 60 * 1000, feedKey: FEED_ALL });
  }, [
    reader.feedList,
    reader.refresh,
    reader.state.platformSessions,
    reader.state.previewMode,
  ]);

  const exportSubscriptions = useCallback(() => {
    try {
      const backup = createSubscriptionBackup(reader.state.sources);
      const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lesen-subscriptions-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true as const, count: backup.sources.length };
    } catch {
      return { ok: false as const, count: 0, error: "无法生成订阅备份文件" };
    }
  }, [reader.state.sources]);

  const importSubscriptions = useCallback(
    async (file: File) => {
      if (file.size > 1024 * 1024) {
        return { ok: false as const, added: 0, total: 0, error: "备份文件不能超过 1 MB" };
      }
      try {
        const backup = parseSubscriptionBackup(await file.text());
        const result = await reader.importSources(backup.sources);
        return { ...result, imported: backup.sources.length };
      } catch (error) {
        return {
          ok: false as const,
          added: 0,
          total: reader.state.sources.length,
          error: error instanceof Error ? error.message : "无法读取订阅备份",
        };
      }
    },
    [reader.importSources, reader.state.sources.length],
  );

  const copyShareText = useCallback(async () => {
    const text = formatSubscriptionShareText(reader.state.sources);
    if (!text) {
      return { ok: false as const, count: 0, error: "当前还没有可分享的订阅" };
    }
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true as const, count: reader.state.sources.length };
    } catch {
      return { ok: false as const, count: 0, error: "无法写入剪贴板，请手动导出订阅文件" };
    }
  }, [reader.state.sources]);

  const toastTheme = resolveColorScheme(mergeAppearance(reader.state.settings).colorScheme);
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div id="reader-portal" className="pointer-events-none absolute inset-0 z-[60]" />
      <Toaster position="bottom-center" theme={toastTheme} richColors={false} closeButton={false} />
      <ReaderHeader
        mode={readerMode}
        onModeChange={setReaderMode}
        account={owlivoAuth.account}
        onOpenSettings={() => {
          setSettingsSection("appearance");
          setSettingsOpen(true);
        }}
        onOpenAccount={() => {
          setSettingsSection("account");
          setSettingsOpen(true);
        }}
        onRefresh={
          readerMode === "subscriptions"
            ? () => void reader.refresh({ feedKey: FEED_ALL })
            : () => window.dispatchEvent(new Event("owlivo-refresh-square-hot"))
        }
        refreshing={readerMode === "subscriptions" ? reader.state.refreshing : squareRefreshing}
        shellMode={reader.shellMode}
        onSwitchSurface={() => void reader.switchSurface()}
        homeScrollSyncEnabled={readerMode === "subscriptions" ? syncHomeScroll : undefined}
        onToggleHomeScrollSync={
          readerMode === "subscriptions"
            ? () => setSyncHomeScroll((enabled) => !enabled)
            : undefined
        }
      />
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          readerMode === "subscriptions" ? "flex" : "hidden",
        )}
        aria-hidden={readerMode !== "subscriptions"}
      >
        <HomeBoard reader={reader} syncScroll={syncHomeScroll} />
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          readerMode === "square" ? "flex" : "hidden",
        )}
        aria-hidden={readerMode !== "square"}
      >
        <SquareBoard reader={reader} active={readerMode === "square"} />
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={reader.state.settings}
        onChange={reader.updateReaderPrefs}
        onExportSubscriptions={exportSubscriptions}
        onImportSubscriptions={importSubscriptions}
        onCopyShareText={copyShareText}
        initialSection={settingsSection}
      />
    </div>
  );
}
