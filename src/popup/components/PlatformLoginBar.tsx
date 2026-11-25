import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PlatformLoginStatus, PlatformSessions } from "@/lib/platform-session";
import { shouldShowLoginCta } from "@/lib/platform-session";

function statusText(status: PlatformLoginStatus): string {
  if (status === "checking") return "检测中";
  if (status === "logged-in") return "已登录";
  if (status === "logged-out") return "未登录";
  if (status === "error") return "检测失败";
  return "状态未知";
}

export function PlatformLoginBar({
  sessions,
  onOpenXueqiu,
  onOpenX,
  onOpenWeibo,
  onRecheck,
}: {
  sessions: PlatformSessions;
  onOpenXueqiu: () => void;
  onOpenX: () => void;
  onOpenWeibo: () => void;
  onRecheck: () => void;
}) {
  const showXueqiu = shouldShowLoginCta(sessions.xueqiu);
  const showX = shouldShowLoginCta(sessions.x);
  const showWeibo = shouldShowLoginCta(sessions.weibo);
  const checking =
    sessions.xueqiu === "checking" ||
    sessions.x === "checking" ||
    sessions.weibo === "checking";
  if (!showXueqiu && !showX && !showWeibo && !checking) return null;

  return (
    <Alert
      className="shrink-0 rounded-none border-x-0 border-t-0 border-b border-border bg-muted px-3 py-2"
      role="status"
      aria-live="polite"
      data-testid="platform-login-bar"
    >
      <AlertTitle className="mb-0 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-foreground-soft">
        <span>登录状态</span>
        <span className="font-normal">雪球 · {statusText(sessions.xueqiu)}</span>
        <span className="font-normal">微博 · {statusText(sessions.weibo)}</span>
        <span className="font-normal">X · {statusText(sessions.x)}</span>
        {checking ? <span className="font-normal text-muted-foreground">正在检测…</span> : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {showXueqiu ? (
            <Button type="button" variant="default" size="sm" onClick={onOpenXueqiu}>
              去雪球登录
            </Button>
          ) : null}
          {showWeibo ? (
            <Button type="button" variant="default" size="sm" onClick={onOpenWeibo}>
              去微博登录
            </Button>
          ) : null}
          {showX ? (
            <Button type="button" variant="default" size="sm" onClick={onOpenX}>
              去 X 登录
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onRecheck}>
            重新检测
          </Button>
        </span>
      </AlertTitle>
      <AlertDescription className="mt-1 text-[10.5px] leading-[1.55]">
        在官网登录后回到本插件会自动重新检测。不收集 Cookie 值，也不提供手工粘贴 Cookie。雪球 /
        微博依赖登录读取关注与时间线；X 登录后仍可用推荐列表与搜索订阅。
      </AlertDescription>
    </Alert>
  );
}
