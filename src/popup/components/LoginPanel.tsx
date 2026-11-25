import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";

const PANEL_COPY = {
  checking: {
    title: "正在检查登录状态…",
    text: "正在检测雪球 / 微博 / X 的登录痕迹，请稍候。",
    login: false,
    reload: false,
    retry: false,
  },
  "logged-out": {
    title: "请先登录至少一个平台",
    text: "点击下方按钮会打开对应网站的登录页。登录完成后回到本插件点「重新检查」即可。",
    login: true,
    reload: false,
    retry: true,
  },
  unknown: {
    title: "登录状态未知",
    text: "检测到部分登录痕迹，但账号信息尚未就绪。可打开对应网站确认，或点下方重新检查。",
    login: true,
    reload: true,
    retry: true,
  },
  timeout: {
    title: "读取关注列表超时",
    text: "已确认登录，但关注列表超时未返回。可刷新对应网站页面后重试。",
    login: false,
    reload: true,
    retry: true,
  },
} as const;

export function LoginPanel({
  status,
  diagnostics,
  onLoginXueqiu,
  onLoginWeibo,
  onLoginX,
  onReload,
  onRetry,
}: {
  status: string;
  diagnostics: Record<string, unknown> | null;
  onLoginXueqiu: () => void;
  onLoginWeibo: () => void;
  onLoginX: () => void;
  onReload: () => void;
  onRetry: () => void;
}) {
  const copy = PANEL_COPY[status as keyof typeof PANEL_COPY] || PANEL_COPY.unknown;
  const lines: string[] = [];
  if (diagnostics?.line) lines.push(String(diagnostics.line));
  const cookies = diagnostics?.cookies as Record<string, number> | undefined;
  if (cookies) {
    const mark = (name: string) => (cookies[name] ? "有" : "无");
    lines.push(
      "cookie u=" +
        mark("u") +
        " · xq_is_login=" +
        mark("xq_is_login") +
        " · xq_a_token=" +
        mark("xq_a_token"),
    );
  }

  return (
    <Empty className="flex-1 gap-3 border-0 px-6 py-10 md:p-10">
      <EmptyHeader className="gap-3">
        <EmptyMedia
          variant="icon"
          className="mb-0 size-12 rounded-2xl border border-border bg-surface-subtle text-primary"
        >
          <LogIn />
        </EmptyMedia>
        <EmptyTitle className="text-[13px] font-bold">{copy.title}</EmptyTitle>
        <EmptyDescription className="max-w-[300px] text-[11.5px] leading-[1.6]">
          {copy.text}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="gap-3">
        {copy.login ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={onLoginXueqiu}>
              去雪球登录
            </Button>
            <Button type="button" variant="default" onClick={onLoginWeibo}>
              去微博登录
            </Button>
            <Button type="button" variant="default" onClick={onLoginX}>
              去 X 登录
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2">
          {copy.reload ? (
            <Button type="button" onClick={onReload}>
              刷新雪球页面
            </Button>
          ) : null}
          {copy.retry ? (
            <Button type="button" onClick={onRetry}>
              重新检查账号状态
            </Button>
          ) : null}
        </div>
        {lines.length ? (
          <>
            <Separator className="my-1 max-w-[240px]" />
            <pre className="max-w-full overflow-auto rounded-lg bg-surface-subtle px-3 py-2 text-left text-[10px] leading-relaxed text-muted-foreground">
              {lines.join("\n")}
            </pre>
          </>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
