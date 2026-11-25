import { useState, type ReactNode } from "react";
import {
  AppWindow,
  ChevronRight,
  Columns3,
  Ellipsis,
  Link2,
  LogIn,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OwlivoAccount } from "@/lib/owlivo-auth";
import type { ShellMode } from "@/lib/shell-mode";
import { cn } from "@/lib/utils";

export type ReaderMode = "subscriptions" | "square";

export function initialReaderMode(): ReaderMode {
  return new URLSearchParams(location.search).get("view") === "square" ? "square" : "subscriptions";
}

const headerIconButtonClass =
  "size-8 rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[0.96]";

function surfaceSwitchCopy(shellMode?: ShellMode): {
  label: string;
  toPopup: boolean;
} {
  if (shellMode === "sidebar") return { label: "切换为弹窗", toPopup: true };
  if (shellMode === "home") return { label: "打开侧栏", toPopup: false };
  return { label: "切换为侧栏", toPopup: false };
}

function OptionsMenu({
  account,
  onOpenAccount,
  onOpenHome,
  onSwitchSurface,
  shellMode,
}: {
  account?: OwlivoAccount | null;
  onOpenAccount: () => void;
  onOpenHome?: () => void;
  onSwitchSurface?: () => void;
  shellMode?: ShellMode;
}) {
  const [open, setOpen] = useState(false);
  const runAction = (action: () => void) => {
    setOpen(false);
    action();
  };

  const showOpenHome = Boolean(onOpenHome && shellMode !== "home");
  const showSwitchSurface = Boolean(onSwitchSurface);
  const hasSecondaryActions = showOpenHome || showSwitchSurface;
  const surfaceCopy = surfaceSwitchCopy(shellMode);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(headerIconButtonClass, open && "bg-accent text-foreground")}
          aria-label="更多操作"
          aria-expanded={open}
          title={account ? `更多操作（已登录：${account.nickname}）` : "更多操作"}
        >
          <Ellipsis className="size-4" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 rounded-xl border border-border/90 bg-popover p-1.5 text-popover-foreground shadow-[0_8px_24px_-6px_rgba(15,23,42,0.14),0_2px_6px_-2px_rgba(15,23,42,0.06)] dark:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.48)]"
      >
        {account ? (
          <button
            type="button"
            className="group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            title="管理账号与订阅同步"
            onClick={() => runAction(onOpenAccount)}
          >
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                width={28}
                height={28}
                referrerPolicy="no-referrer"
                className="size-7 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/15"
              />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
                {account.nickname.slice(0, 1)}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[12px] font-medium leading-[1.25] text-popover-foreground">
                  {account.nickname}
                </span>
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-primary">
                  已登录
                </span>
              </span>
              {account.email ? (
                <span className="mt-0.5 block truncate text-[10.5px] leading-[1.25] text-muted-foreground">
                  {account.email}
                </span>
              ) : null}
            </span>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
              strokeWidth={1.75}
            />
          </button>
        ) : (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-popover-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            title="登录账号，可保存订阅数据并跨设备同步"
            onClick={() => runAction(onOpenAccount)}
          >
            <span className="flex items-center gap-2.5">
              <LogIn className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="font-medium">账号登录</span>
            </span>
            <span className="text-[10.5px] text-muted-foreground">同步订阅</span>
          </button>
        )}

        {hasSecondaryActions ? <div className="my-1 h-px bg-border/70" role="separator" /> : null}

        {showOpenHome && onOpenHome ? (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-popover-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => runAction(onOpenHome)}
          >
            <Columns3 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span>打开多列首页</span>
          </button>
        ) : null}

        {showSwitchSurface && onSwitchSurface ? (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-popover-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => runAction(onSwitchSurface)}
          >
            {surfaceCopy.toPopup ? (
              <AppWindow className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            ) : (
              <PanelRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
            <span>{surfaceCopy.label}</span>
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function ReaderHeader({
  mode,
  onModeChange,
  onOpenSettings,
  onOpenAccount,
  onOpenHome,
  onRefresh,
  refreshing = false,
  shellMode,
  onSwitchSurface,
  homeScrollSyncEnabled,
  onToggleHomeScrollSync,
  searchActive,
  onToggleSearch,
  account,
  children,
}: {
  mode: ReaderMode;
  onModeChange: (mode: ReaderMode) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenHome?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  shellMode?: ShellMode;
  onSwitchSurface?: () => void;
  homeScrollSyncEnabled?: boolean;
  onToggleHomeScrollSync?: () => void;
  searchActive?: boolean;
  onToggleSearch?: () => void;
  account?: OwlivoAccount | null;
  children?: ReactNode;
}) {
  const showSearchButton = Boolean(onToggleSearch && mode === "subscriptions");
  const hasViewActions = Boolean(
    children || showSearchButton || onRefresh || onToggleHomeScrollSync,
  );

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background px-4">
      <nav className="flex h-full items-center gap-5" aria-label="阅读模式">
        {(
          [
            ["subscriptions", "订阅"],
            ["square", "广场"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className={cn(
              "relative h-full px-0.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
              mode === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {mode === value ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-foreground" />
            ) : null}
          </button>
        ))}
      </nav>
      <div className="flex items-center gap-1">
        {children}
        {showSearchButton && onToggleSearch ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(headerIconButtonClass, searchActive && "bg-accent text-foreground")}
            aria-label={searchActive ? "收起搜索" : "搜索帖子"}
            aria-pressed={searchActive}
            title={searchActive ? "收起搜索 (⌘K)" : "搜索帖子 (⌘K)"}
            onClick={onToggleSearch}
          >
            <Search className="size-4" strokeWidth={1.75} />
          </Button>
        ) : null}
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={headerIconButtonClass}
            aria-label={mode === "square" ? "刷新广场" : "刷新订阅"}
            title={mode === "square" ? "刷新广场" : "刷新订阅"}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} strokeWidth={1.75} />
          </Button>
        ) : null}
        {onToggleHomeScrollSync ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              headerIconButtonClass,
              homeScrollSyncEnabled && "bg-accent text-foreground",
            )}
            aria-label={homeScrollSyncEnabled ? "关闭三列同步滚动" : "开启三列同步滚动"}
            role="switch"
            aria-checked={homeScrollSyncEnabled}
            title={homeScrollSyncEnabled ? "关闭三列同步滚动" : "开启三列同步滚动"}
            onClick={onToggleHomeScrollSync}
          >
            <Link2 className="size-4" strokeWidth={1.75} />
          </Button>
        ) : null}
        {hasViewActions ? (
          <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border/80" />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={headerIconButtonClass}
          aria-label="打开设置"
          title="设置"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" strokeWidth={1.75} />
        </Button>
        <OptionsMenu
          account={account}
          onOpenAccount={onOpenAccount}
          onOpenHome={onOpenHome}
          onSwitchSurface={onSwitchSurface}
          shellMode={shellMode}
        />
      </div>
    </header>
  );
}
