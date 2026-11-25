import { DemoSwitcher } from "./DemoSwitcher";
import type { DemoMode } from "@/lib/preview-mock";

/** 仅开发预览：角标 + 可选工具条。生产构建不应引用本模块。 */
export function DevPreviewChrome({
  demoMode,
  showTools,
  onChange,
}: {
  demoMode: DemoMode;
  showTools: boolean;
  onChange: (mode: DemoMode) => void;
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute right-2 bottom-2 z-[80] rounded border border-border bg-secondary/95 px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground"
        role="status"
      >
        演示数据
      </div>
      {showTools ? (
        <div className="absolute bottom-0 left-0 right-0 z-[80] max-h-[88px] overflow-y-auto border-t border-border bg-background/95">
          <DemoSwitcher current={demoMode} onChange={onChange} />
        </div>
      ) : null}
    </>
  );
}
