import type { ReactElement } from "react";
import { AppWindow, PanelRight, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShellMode } from "@/lib/shell-mode";
import { cn } from "@/lib/utils";
import { PRODUCT_DISPLAY_NAME } from "@/lib/product-brand";

function RailTip({
  label,
  side,
  children,
}: {
  label: string;
  side: "right" | "top";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionCluster({
  refreshing,
  shellMode,
  syncLabel,
  tipSide,
  actionClass,
  onRefresh,
  onOpenSettings,
  onSwitchSurface,
}: {
  refreshing: boolean;
  shellMode: ShellMode;
  syncLabel: string;
  tipSide: "right" | "top";
  actionClass: string;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onSwitchSurface: () => void;
}) {
  const toSidebar = shellMode !== "sidebar";
  const switchLabel = toSidebar ? "改为侧栏" : "改为弹窗";
  const refreshLabel = syncLabel ? "刷新最新帖子 · " + syncLabel : "刷新最新帖子";
  return (
    <>
      <RailTip label={refreshLabel} side={tipSide}>
        <Button
          variant="ghost"
          size="icon"
          className={actionClass}
          aria-label={refreshLabel}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} strokeWidth={1.75} />
        </Button>
      </RailTip>
      <RailTip label={switchLabel} side={tipSide}>
        <Button
          variant="ghost"
          size="icon"
          className={actionClass}
          aria-label={switchLabel}
          onClick={onSwitchSurface}
        >
          {toSidebar ? (
            <PanelRight className="size-3.5" strokeWidth={1.75} />
          ) : (
            <AppWindow className="size-3.5" strokeWidth={1.75} />
          )}
        </Button>
      </RailTip>
      <RailTip label="设置" side={tipSide}>
        <Button
          variant="ghost"
          size="icon"
          className={actionClass}
          aria-label="打开设置"
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5" strokeWidth={1.75} />
        </Button>
      </RailTip>
    </>
  );
}

/** 竖栏顶部品牌标记 */
function AppMark() {
  return (
    <img
      src="icons/icon32.png"
      width={30}
      height={30}
      alt={PRODUCT_DISPLAY_NAME}
      title={PRODUCT_DISPLAY_NAME}
      className="size-[30px] rounded-[10px] ring-1 ring-rail-border"
      onError={(event) => {
        const el = event.currentTarget;
        if (el.dataset.fallback === "1") return;
        el.dataset.fallback = "1";
        el.src = "icons/icon48.png";
      }}
    />
  );
}

/** popup / 独立窗口：左侧竖栏 */
function VerticalRail(props: {
  refreshing: boolean;
  shellMode: ShellMode;
  syncLabel: string;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onSwitchSurface: () => void;
}) {
  return (
    <TooltipProvider delayDuration={280}>
      <aside
        className="flex w-[52px] shrink-0 flex-col items-center border-r border-rail-border bg-rail"
        aria-label="应用与操作"
        data-orientation="vertical"
      >
        <div className="flex w-full flex-col items-center pt-3.5 pb-3">
          <AppMark />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <ActionCluster
            {...props}
            tipSide="right"
            actionClass="rail-action size-9 rounded-[10px]"
          />
        </div>
      </aside>
    </TooltipProvider>
  );
}

export function SideRail({
  refreshing,
  shellMode,
  syncLabel,
  onRefresh,
  onOpenSettings,
  onSwitchSurface,
}: {
  refreshing: boolean;
  shellMode: ShellMode;
  syncLabel: string;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onSwitchSurface: () => void;
}) {
  return (
    <VerticalRail
      refreshing={refreshing}
      shellMode={shellMode}
      syncLabel={syncLabel}
      onRefresh={onRefresh}
      onOpenSettings={onOpenSettings}
      onSwitchSurface={onSwitchSurface}
    />
  );
}

export function platformTagFrom(isAll: boolean, current: { platform: string } | undefined): string {
  if (isAll) return "聚合";
  return current ? (current.platform === "x" ? "X" : "雪球") : "多源";
}
