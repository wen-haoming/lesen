import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  COLOR_SCHEME_OPTIONS,
  READING_FONT_OPTIONS,
  READING_SIZE_OPTIONS,
  THEME_STYLE_OPTIONS,
  matchPrefersDark,
  mergeAppearance,
  resolveColorScheme,
  type ColorScheme,
  type ReadingFont,
  type ReadingSize,
  type ThemeStyle,
} from "@/lib/appearance";
import type { DisplayDensity, Settings } from "@/hooks/useReader";
import { cn } from "@/lib/utils";
import { ANALYTICS_BUILD_ENABLED } from "@/lib/analytics-config";
import { AccountSettings } from "@/popup/components/AccountSettings";
import {
  OWLIVO_CONTACT_LABEL,
  OWLIVO_CONTACT_URL,
  OWLIVO_PRIVACY_URL,
} from "@/lib/product-contact";
import { PRODUCT_DISPLAY_NAME } from "@/lib/product-brand";

/** 分段开关采用凹槽底轨 + 浮起卡片胶囊，不用大块饱和主题色涂满按钮。 */
const segmentedTrackClass = "grid gap-1 rounded-[9px] border border-border/70 bg-muted p-[3px]";
const segmentedItemBaseClass =
  "h-[26px] rounded-[6px] border border-transparent px-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const segmentedItemActiveClass =
  "border-border bg-card font-semibold text-foreground dark:border-input dark:bg-secondary";

const SETTINGS_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "account", label: "账号与同步" },
  { id: "data", label: "备份与隐私" },
  { id: "about", label: "关于" },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onExportSubscriptions,
  onImportSubscriptions,
  onCopyShareText,
  onOpenHome,
  initialSection = "appearance",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: {
    analyticsConsent?: boolean;
    surface?: "popup" | "sidebar";
    themeStyle?: ThemeStyle;
    colorScheme?: ColorScheme;
    readingFont?: ReadingFont;
    readingSize?: ReadingSize;
    density?: DisplayDensity;
    translateX?: boolean;
  }) => void;
  onExportSubscriptions: () => { ok: boolean; count: number; error?: string };
  onImportSubscriptions: (
    file: File,
  ) => Promise<{ ok: boolean; added: number; total: number; error?: string }>;
  onCopyShareText?: () => Promise<{ ok: boolean; count: number; error?: string }>;
  onOpenHome?: () => void;
  initialSection?: SettingsSection;
}) {
  const appearance = mergeAppearance(settings);
  const [prefersDark, setPrefersDark] = useState(() => matchPrefersDark());
  const [importing, setImporting] = useState(false);
  const [backupNote, setBackupNote] = useState("");
  const [backupFailed, setBackupFailed] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<SettingsSection>("appearance");

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection, open]);
  const jumpedToMerge = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setPrefersDark(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSection(initialSection);
    jumpedToMerge.current = false;
  }, [initialSection, open]);

  const activeScheme = resolveColorScheme(appearance.colorScheme, prefersDark);

  function selectSection(next: SettingsSection, focus = false) {
    setSection(next);
    if (focus) {
      document.getElementById(`settings-tab-${next}`)?.focus();
    }
  }

  function onSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectSection(SETTINGS_SECTIONS[(index + 1) % SETTINGS_SECTIONS.length].id, true);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectSection(
        SETTINGS_SECTIONS[(index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length].id,
        true,
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectSection(SETTINGS_SECTIONS[0].id, true);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selectSection(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id, true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(94%,640px)] gap-0 overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 px-3.5 pb-2 pt-3.5">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription className="sr-only">按外观、账号与同步、备份与隐私、关于分组。</DialogDescription>
        </DialogHeader>
        <div className="shrink-0 px-3.5 pb-2" role="tablist" aria-label="设置分组">
          <div className={cn(segmentedTrackClass, "grid-cols-4")}>
            {SETTINGS_SECTIONS.map((item, index) => {
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${item.id}`}
                  tabIndex={selected ? 0 : -1}
                  className={cn(segmentedItemBaseClass, selected && segmentedItemActiveClass)}
                  onClick={() => selectSection(item.id)}
                  onKeyDown={(event) => onSectionKeyDown(event, index)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="reader-scrollbar min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5">
          <div
            id="settings-panel-appearance"
            role="tabpanel"
            aria-labelledby="settings-tab-appearance"
            hidden={section !== "appearance"}
          >
            {onOpenHome ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-border/70 bg-muted/30 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-foreground">多列首页</p>
                  <p className="mt-0.5 text-[10px] leading-[1.45] text-muted-foreground">
                    在新标签页按雪球、X、微博分列浏览已订阅作者的动态。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 shrink-0 rounded-[7px] px-2.5 text-[11px]"
                  onClick={onOpenHome}
                >
                  打开首页
                </Button>
              </div>
            ) : null}
            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">阅读配色</legend>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="主题风格">
                {THEME_STYLE_OPTIONS.map((item) => {
                  const selected = appearance.themeStyle === item.value;
                  const palette = activeScheme === "dark" ? item.dark : item.light;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={item.label + " · " + item.hint}
                      title={item.label + " · " + item.hint}
                      style={{
                        backgroundColor: palette.bg,
                        color: palette.fg,
                        borderColor: selected ? palette.accent : palette.border,
                        boxShadow: selected ? `inset 0 0 0 1px ${palette.accent}` : "none",
                      }}
                      className={cn(
                        "group relative flex h-[42px] items-center justify-between gap-1.5 overflow-hidden rounded-[10px] border px-2.5 text-left transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        selected ? "" : "opacity-92 hover:opacity-100",
                      )}
                      onClick={() => {
                        if (!selected) onChange({ themeStyle: item.value });
                      }}
                    >
                      <span className="relative flex min-w-0 flex-col">
                        <span className="truncate text-[11.5px] font-semibold leading-[1.2] tracking-[0.01em]">
                          {item.label}
                        </span>
                        <span
                          className="mt-0.5 truncate text-[9.5px] leading-[1.15]"
                          style={{ color: palette.muted }}
                        >
                          {item.hint}
                        </span>
                      </span>
                      <span
                        className="relative flex shrink-0 flex-col items-end gap-1"
                        aria-hidden="true"
                      >
                        <span className="text-[13px] font-semibold leading-none tracking-[-0.02em]">
                          Aa
                        </span>
                        <span
                          className="h-[2.5px] w-3 rounded-full"
                          style={{ backgroundColor: palette.accent }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">明暗模式</legend>
              <div
                className={cn(segmentedTrackClass, "grid-cols-3")}
                role="radiogroup"
                aria-label="明暗模式"
              >
                {COLOR_SCHEME_OPTIONS.map((item) => {
                  const selected = appearance.colorScheme === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(segmentedItemBaseClass, selected && segmentedItemActiveClass)}
                      onClick={() => {
                        if (!selected) onChange({ colorScheme: item.value });
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
                跟随系统时与浏览器的浅色/深色偏好保持一致。
              </p>
            </fieldset>

            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">阅读字体</legend>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="阅读字体">
                {READING_FONT_OPTIONS.map((item) => {
                  const selected = appearance.readingFont === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={item.label + " · " + item.hint}
                      title={item.label + " · " + item.hint}
                      style={{
                        fontFamily: item.stack,
                        borderColor: selected ? "var(--primary)" : "var(--border)",
                        boxShadow: selected ? "inset 0 0 0 1px var(--primary)" : "none",
                        backgroundColor: selected ? "var(--muted)" : undefined,
                      }}
                      className={cn(
                        "flex h-[44px] flex-col items-start justify-center gap-0.5 rounded-[10px] border px-2.5 text-left transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        selected ? "" : "bg-background/50 hover:bg-muted/40",
                      )}
                      onClick={() => {
                        if (!selected) onChange({ readingFont: item.value });
                      }}
                    >
                      <span className="text-[12px] font-semibold leading-[1.15] tracking-[0.01em] text-foreground">
                        {item.label}
                      </span>
                      <span className="truncate text-[9.5px] leading-[1.15] text-muted-foreground">
                        {item.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
                使用本机已安装的免费字体。若未安装霞鹜文楷等，会自动回退到系统楷体或宋体。
              </p>
            </fieldset>

            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">整体尺寸</legend>
              <div
                className={cn(segmentedTrackClass, "grid-cols-4")}
                role="radiogroup"
                aria-label="整体尺寸"
              >
                {READING_SIZE_OPTIONS.map((item) => {
                  const selected = appearance.readingSize === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={item.hint}
                      className={cn(segmentedItemBaseClass, selected && segmentedItemActiveClass)}
                      onClick={() => {
                        if (!selected) onChange({ readingSize: item.value });
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
                同步缩放正文、时间与界面基础字号。
              </p>
            </fieldset>

            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">排版密度</legend>
              <div
                className={cn(segmentedTrackClass, "grid-cols-3")}
                role="radiogroup"
                aria-label="排版密度"
              >
                {(
                  [
                    { value: "compact" as const, label: "紧凑" },
                    { value: "comfortable" as const, label: "舒适" },
                    { value: "spacious" as const, label: "舒展" },
                  ] as const
                ).map((item) => {
                  const selected = (settings.density || "comfortable") === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(segmentedItemBaseClass, selected && segmentedItemActiveClass)}
                      onClick={() => {
                        if (!selected) onChange({ density: item.value });
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">打开形态</legend>
              <div
                className={cn(segmentedTrackClass, "grid-cols-2")}
                role="radiogroup"
                aria-label="打开形态"
              >
                {(
                  [
                    { value: "popup" as const, label: "弹窗" },
                    { value: "sidebar" as const, label: "侧栏" },
                  ] as const
                ).map((item) => {
                  const selected =
                    (settings.surface === "popup" ? "popup" : "sidebar") === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(segmentedItemBaseClass, selected && segmentedItemActiveClass)}
                      onClick={() => {
                        if (!selected) onChange({ surface: item.value });
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
                只保留一种。点击扩展图标打开，再点一次收起。
              </p>
            </fieldset>

            <fieldset className="mb-1 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">阅读辅助</legend>
              <label className="flex items-start gap-2 rounded-[10px] border border-border bg-background/50 p-2.5 text-[11px] leading-[1.5]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={settings.translateX !== false}
                  onChange={(event) => onChange({ translateX: event.currentTarget.checked })}
                />
                <span>自动将英文帖子翻译为中文（可单条切换原文）。</span>
              </label>
            </fieldset>
          </div>

          <div
            id="settings-panel-account"
            role="tabpanel"
            aria-labelledby="settings-tab-account"
            hidden={section !== "account"}
          >
            <AccountSettings
              onMergeNeeded={(needed) => {
                if (needed && open && !jumpedToMerge.current) {
                  jumpedToMerge.current = true;
                  setSection("account");
                }
              }}
            />
          </div>

          <div
            id="settings-panel-data"
            role="tabpanel"
            aria-labelledby="settings-tab-data"
            hidden={section !== "data"}
          >
            <fieldset className="mb-3 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">
                本机订阅备份
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing}
                  onClick={() => {
                    const result = onExportSubscriptions();
                    setBackupFailed(!result.ok);
                    setBackupNote(
                      result.ok
                        ? `已导出 ${result.count} 个订阅，请妥善保存该文件`
                        : result.error || "导出失败",
                    );
                  }}
                >
                  导出订阅
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing}
                  onClick={() => backupInputRef.current?.click()}
                >
                  {importing ? "导入中…" : "导入订阅"}
                </Button>
              </div>
              {onCopyShareText ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing}
                  className="mt-1.5 w-full"
                  onClick={() => {
                    void onCopyShareText().then((result) => {
                      setBackupFailed(!result.ok);
                      setBackupNote(
                        result.ok
                          ? `已复制 ${result.count} 个订阅的分享文案，可直接发给朋友或社区`
                          : result.error || "复制失败",
                      );
                    });
                  }}
                >
                  复制清单分享文案
                </Button>
              ) : null}
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label={`选择 ${PRODUCT_DISPLAY_NAME} 订阅备份文件`}
                onChange={(event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (!file) return;
                  setImporting(true);
                  setBackupNote("");
                  void onImportSubscriptions(file).then((result) => {
                    setImporting(false);
                    setBackupFailed(!result.ok);
                    setBackupNote(
                      result.ok
                        ? result.added
                          ? `已导入 ${result.added} 个订阅，当前共 ${result.total} 个`
                          : "备份中的订阅已全部存在"
                        : result.error || "导入失败",
                    );
                    input.value = "";
                  });
                }}
              />
              <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
                导出的是本机订阅列表 JSON，不含
                Cookie、帖子缓存或页面令牌。重装后可再导入该文件。这与云端账号同步不是同一件事，不能当作已验收的云端重装恢复。
              </p>
              {backupNote ? (
                <p
                  className={cn(
                    "mt-1 text-[10.5px] leading-[1.4]",
                    backupFailed ? "text-destructive" : "text-muted-foreground",
                  )}
                  role="status"
                >
                  {backupNote}
                </p>
              ) : null}
            </fieldset>

            <fieldset className="mb-1 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">
                使用统计与隐私
              </legend>
              <label className="flex items-start gap-2 rounded-[10px] border border-border bg-background/50 p-2.5 text-[11px] leading-[1.5]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={ANALYTICS_BUILD_ENABLED && settings.analyticsConsent !== false}
                  onChange={(event) => onChange({ analyticsConsent: event.currentTarget.checked })}
                  disabled={!ANALYTICS_BUILD_ENABLED}
                />
                <span>允许发送匿名使用事件与可归类错误。</span>
              </label>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[10.5px] leading-[1.4] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  统计范围与隐私说明
                </summary>
                <p className="mt-1 text-[10.5px] leading-[1.4] text-muted-foreground">
                  只使用本机随机安装标识，不收集账号、帖子、搜索词、登录凭据或原帖链接；可随时关闭。
                  {ANALYTICS_BUILD_ENABLED
                    ? "当前版本已配置接收端，默认开启，关闭后不再发送。"
                    : "当前版本尚未配置接收端，不会发送统计数据。"}{" "}
                  <a
                    className="underline underline-offset-2"
                    href={OWLIVO_PRIVACY_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    隐私政策
                  </a>
                </p>
              </details>
            </fieldset>
          </div>

          <div
            id="settings-panel-about"
            role="tabpanel"
            aria-labelledby="settings-tab-about"
            hidden={section !== "about"}
          >
            <div className="mb-3 rounded-[10px] border border-border/70 bg-muted/30 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-foreground">联系方式</p>
              <p className="mt-1 text-[10.5px] leading-[1.55] text-muted-foreground">
                电子邮件
              </p>
              <a
                className="mt-0.5 inline-block text-[11px] font-medium text-foreground underline underline-offset-2"
                href={OWLIVO_CONTACT_URL}
              >
                {OWLIVO_CONTACT_LABEL}
              </a>
            </div>
            <fieldset className="mb-1 min-w-0 border-0 p-0">
              <legend className="mb-1.5 text-[11px] font-semibold text-foreground">文档</legend>
              <ul className="flex flex-col gap-1.5 text-[11px] leading-[1.5]">
                <li>
                  <a
                    className="font-medium text-foreground underline underline-offset-2"
                    href="/changelog.html"
                    target="_blank"
                    rel="noopener"
                  >
                    查看更新日志
                  </a>
                </li>
                <li>
                  <span className="block text-[10.5px] text-muted-foreground">隐私政策</span>
                  <a
                    className="break-all underline underline-offset-2"
                    href={OWLIVO_PRIVACY_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {OWLIVO_PRIVACY_URL}
                  </a>
                </li>
              </ul>
            </fieldset>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
