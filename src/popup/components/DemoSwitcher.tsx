import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEMO_MODES, type DemoMode } from "@/lib/preview-mock";

export function DemoSwitcher({
  current,
  onChange,
}: {
  current: DemoMode;
  onChange: (mode: DemoMode) => void;
}) {
  return (
    <div
      className="shrink-0 border-b border-border bg-muted/60 px-2 py-1.5"
      role="toolbar"
      aria-label="演示状态切换"
    >
      <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        演示数据 · 切换状态（仅预览，不写 storage）
      </div>
      <ToggleGroup
        type="single"
        value={current}
        onValueChange={(value) => {
          if (!value) return;
          onChange(value as DemoMode);
        }}
        spacing={1}
        size="sm"
        className="flex flex-wrap justify-start"
      >
        {DEMO_MODES.map((mode) => (
          <ToggleGroupItem
            key={mode.id}
            value={mode.id}
            aria-label={mode.label}
            className="h-6 rounded-md border border-border px-2 text-[10.5px] font-semibold data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {mode.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
