import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fallbackPickerTab, feedKey, type FeedSource } from "@/lib/config";
import { shortCount } from "@/lib/format";
import {
  buildDefaultXPickerList,
  filterXSuggestions,
  mergeXSearchResults,
  type XSuggestion,
} from "@/lib/x-suggestions";
import type { PlatformSessions } from "@/lib/platform-session";
import { peekSourceInput } from "@/lib/source-input";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { PlatformLogo } from "./PlatformLogo";

type Candidate = {
  id: string;
  name?: string;
  avatar?: string;
  followers?: number;
  verified?: boolean;
};

/** 添加来源面板支持的平台；App 拼输入时需要同一份枚举 */
export type PickerPlatform = "xueqiu" | "x" | "weibo";
const PICKER_PLATFORMS = ["xueqiu", "weibo", "x"] as const satisfies readonly PickerPlatform[];
type PendingPick = Candidate & { platform: PickerPlatform };

function platformLabel(platform: PickerPlatform): string {
  if (platform === "x") return "X";
  if (platform === "weibo") return "微博";
  return "雪球";
}

export type AddSourcePanelProps = {
  active: boolean;
  sources: FeedSource[];
  following: Array<{ id: string; name: string; avatar?: string }>;
  status: string;
  platformSessions: PlatformSessions;
  initialTab?: PickerPlatform;
  variant?: "dialog" | "page";
  className?: string;
  onAdopt: (candidate: {
    platform: PickerPlatform;
    id: string;
    name?: string;
    avatar?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onSelectSubscribed: (feedKey: string) => void;
  /** 取消订阅：从信息源里移除该用户 */
  onRemoveSubscribed: (feedKey: string) => Promise<void> | void;
  onSearchX: (query: string) => Promise<{ ok: boolean; users: Candidate[]; error?: string }>;
  onSearchUsers: (
    platform: "xueqiu" | "weibo",
    query: string,
  ) => Promise<{ ok: boolean; users: Candidate[]; error?: string }>;
  onLoadXFollowing: (force?: boolean) => Promise<{ ok: boolean; users: Candidate[]; reason?: string }>;
  onLoadWeiboFollowing: (force?: boolean) => Promise<{ ok: boolean; users: Candidate[]; reason?: string }>;
  onLoginXueqiu: () => void;
  onLoginX: () => void;
  onLoginWeibo: () => void;
  onRetry: () => void;
  onRefreshPlatform?: (platform: PickerPlatform) => void;
  onImportSubscriptions?: (
    file: File,
  ) => Promise<{ ok: boolean; added: number; total: number; error?: string }>;
  onDismiss?: () => void;
};

function sessionHint(status: string): string {
  if (status === "checking") return "正在检测登录状态…";
  if (status === "logged-in") return "已登录";
  if (status === "logged-out") return "未登录";
  if (status === "error") return "检测失败";
  return "状态未知";
}

function FollowingList({
  search,
  onSearchChange,
  placeholder,
  searchLabel,
  listLabel,
  searchDisabled,
  listClassName,
  children,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  searchLabel: string;
  listLabel: string;
  searchDisabled?: boolean;
  listClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <Input
        type="search"
        value={search}
        placeholder={placeholder}
        aria-label={searchLabel}
        spellCheck={false}
        autoComplete="off"
        disabled={searchDisabled}
        className="shrink-0"
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div
        role="listbox"
        aria-label={listLabel}
        aria-multiselectable="true"
        className={cn(
          "reader-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-border bg-surface py-1",
          listClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function StateEmpty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="gap-2 border-0 px-3 py-6 md:p-6">
      <EmptyHeader className="gap-2">
        <EmptyTitle className="text-xs font-semibold">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="text-[11px] leading-[1.6]">{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children ? <EmptyContent className="gap-2">{children}</EmptyContent> : null}
    </Empty>
  );
}

export function AddSourcePanel({
  active,
  sources,
  following,
  status,
  platformSessions,
  initialTab = "x",
  variant = "dialog",
  className,
  onAdopt,
  onSelectSubscribed,
  onRemoveSubscribed,
  onSearchX,
  onSearchUsers,
  onLoadXFollowing,
  onLoadWeiboFollowing,
  onLoginXueqiu,
  onLoginX: _onLoginX,
  onLoginWeibo,
  onRetry,
  onRefreshPlatform,
  onImportSubscriptions,
  onDismiss,
}: AddSourcePanelProps) {
  const [tab, setTab] = useState<PickerPlatform>(fallbackPickerTab(initialTab));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remoteUsers, setRemoteUsers] = useState<Candidate[]>([]);
  const [remotePlatform, setRemotePlatform] = useState<PickerPlatform | "">("");
  const [xFollowing, setXFollowing] = useState<Candidate[]>([]);
  const [xFollowState, setXFollowState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [xFollowReason, setXFollowReason] = useState("");
  const [xFollowReload, setXFollowReload] = useState(0);
  const [weiboFollowing, setWeiboFollowing] = useState<Candidate[]>([]);
  const [weiboFollowState, setWeiboFollowState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [weiboFollowReason, setWeiboFollowReason] = useState("");
  const [weiboFollowReload, setWeiboFollowReload] = useState(0);
  const [pending, setPending] = useState<PendingPick[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [importingList, setImportingList] = useState(false);
  const [removingKey, setRemovingKey] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  // 已成功加载过的 reload 标记：切回 tab 时复用列表，不重复请求
  const xFetchedReloadRef = useRef<number | null>(null);
  const weiboFetchedReloadRef = useRef<number | null>(null);
  const xHasListRef = useRef(false);
  const weiboHasListRef = useRef(false);
  const isPage = variant === "page";
  const followingEnabled = false;

  const subscribed = useMemo(() => new Set(sources.map((s) => feedKey(s))), [sources]);
  const subscribedLower = useMemo(
    () => new Set(sources.map((s) => feedKey(s).toLowerCase())),
    [sources],
  );
  const pendingKeys = useMemo(
    () => new Set(pending.map((row) => feedKey({ platform: row.platform, id: row.id }))),
    [pending],
  );

  const subscribedX = useMemo(() => sources.filter((s) => s.platform === "x"), [sources]);
  const subscribedXueqiu = useMemo(
    () => sources.filter((s) => s.platform === "xueqiu"),
    [sources],
  );
  const subscribedWeibo = useMemo(
    () => sources.filter((s) => s.platform === "weibo"),
    [sources],
  );
  const defaultX = useMemo(() => buildDefaultXPickerList(subscribedX), [subscribedX]);
  const subscribedXIds = useMemo(
    () => new Set(subscribedX.map((person) => String(person.id).toLowerCase())),
    [subscribedX],
  );
  const subscribedXueqiuIds = useMemo(
    () => new Set(subscribedXueqiu.map((person) => String(person.id).toLowerCase())),
    [subscribedXueqiu],
  );
  const subscribedWeiboIds = useMemo(
    () => new Set(subscribedWeibo.map((person) => String(person.id))),
    [subscribedWeibo],
  );
  const xFollowingRows = useMemo(
    () =>
      xFollowing.filter(
        (person) => person.id && !subscribedXIds.has(String(person.id).toLowerCase()),
      ),
    [subscribedXIds, xFollowing],
  );
  const weiboFollowingRows = useMemo(
    () =>
      weiboFollowing.filter((person) => person.id && !subscribedWeiboIds.has(String(person.id))),
    [subscribedWeiboIds, weiboFollowing],
  );
  const weiboSearchRows = useMemo(() => {
    const raw = search.trim();
    const q = raw.toLowerCase();
    const pool = [
      ...subscribedWeibo.map((s) => ({
        id: String(s.id),
        name: String(s.name || s.id),
        avatar: s.avatar,
      })),
      ...weiboFollowingRows,
      ...(remotePlatform === "weibo" ? remoteUsers : []),
    ];
    if (!q) return pool;
    const filtered = pool.filter(
      (p) => String(p.name || "").toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q),
    );
    const spec = peekSourceInput(raw);
    if (!("error" in spec) && spec.platform === "weibo") {
      const exists = filtered.some((p) => String(p.id) === spec.id);
      if (!exists) {
        filtered.unshift({
          id: spec.id,
          name: "微博用户 " + spec.id,
          avatar: "",
        });
      }
    }
    return filtered;
  }, [remotePlatform, remoteUsers, search, subscribedWeibo, weiboFollowingRows]);
  const xueqiuFollowingRows = useMemo(() => {
    const rows = following.filter((p) => p && p.id && p.name);
    return [...rows]
      .filter((p) => !subscribedXueqiuIds.has(String(p.id).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [following, subscribedXueqiuIds]);

  const xueqiuSearchRows = useMemo(() => {
    const raw = search.trim();
    const q = raw.toLowerCase();
    const pool = [
      ...subscribedXueqiu.map((s) => ({
        id: String(s.id),
        name: String(s.name || s.id),
        avatar: s.avatar,
      })),
      ...xueqiuFollowingRows,
      ...(remotePlatform === "xueqiu" ? remoteUsers : []),
    ];
    if (!q) return pool;
    const filtered = pool.filter(
      (p) => String(p.name || "").toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q),
    );
    const spec = peekSourceInput(raw);
    if (!("error" in spec) && spec.platform === "xueqiu") {
      const exists = filtered.some((p) => String(p.id) === spec.id);
      if (!exists) filtered.unshift({ id: spec.id, name: "雪球用户 " + spec.id, avatar: "" });
    }
    return filtered;
  }, [remotePlatform, remoteUsers, search, subscribedXueqiu, xueqiuFollowingRows]);

  useEffect(() => {
    if (!active) return;
    setTab(fallbackPickerTab(initialTab || (status === "logged-in" ? "xueqiu" : "x")));
    setSearch("");
    setRemoteUsers([]);
    setRemotePlatform("");
    setError("");
    setPending([]);
    setConfirming(false);
    setRemovingKey("");
    // 重新打开面板时允许各平台再拉一次；同一次打开内切 tab 不重复请求
    xFetchedReloadRef.current = null;
    weiboFetchedReloadRef.current = null;
    xHasListRef.current = false;
    weiboHasListRef.current = false;
    setXFollowState("idle");
    setWeiboFollowState("idle");
    // 仅在弹窗打开/切换初始 tab 时重置，避免刷新登录态把当前平台切回首页
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialTab]);

  useEffect(() => {
    if (!followingEnabled || !active || tab !== "x") return;
    // 已读过且用户没点「重新获取」时，切回 X 直接复用
    if (xFetchedReloadRef.current === xFollowReload) return;
    let cancelled = false;
    const force = xFollowReload > 0;
    if (!xHasListRef.current || force) setXFollowState("loading");
    void onLoadXFollowing(force).then((result) => {
      if (cancelled) return;
      const users = Array.isArray(result.users) ? result.users : [];
      if (!result.ok && !users.length) {
        setXFollowReason(result.reason || "");
        setXFollowState("error");
        return;
      }
      setXFollowing(users);
      setXFollowReason(result.reason || "");
      setXFollowState("ready");
      xFetchedReloadRef.current = xFollowReload;
      xHasListRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [active, tab, onLoadXFollowing, xFollowReload]);

  useEffect(() => {
    if (!followingEnabled || !active || tab !== "weibo") return;
    // 会话还在检测中时先不拉关注，避免把后续已登录状态卡在 NOT_LOGGED_IN / ACCOUNT_UNKNOWN
    if (platformSessions.weibo === "checking") return;
    // 已读过且用户没点「重新获取」时，切回微博直接复用，不再请求
    if (weiboFetchedReloadRef.current === weiboFollowReload) return;
    let cancelled = false;
    const force = weiboFollowReload > 0;
    if (!weiboHasListRef.current || force) setWeiboFollowState("loading");
    void onLoadWeiboFollowing(force).then((result) => {
      if (cancelled) return;
      const users = Array.isArray(result.users) ? result.users : [];
      // 请求失败且没拿到数据时保留原有列表，避免切换 tab 后清空
      if (!result.ok && !users.length) {
        setWeiboFollowReason(result.reason || "");
        setWeiboFollowState("error");
        return;
      }
      setWeiboFollowing(users);
      setWeiboFollowReason(result.reason || "");
      setWeiboFollowState("ready");
      weiboFetchedReloadRef.current = weiboFollowReload;
      weiboHasListRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [active, tab, onLoadWeiboFollowing, weiboFollowReload, platformSessions.weibo]);

  useEffect(() => {
    if (!active) return;
    const q = search.trim();
    if (!q) {
      setRemoteUsers([]);
      setRemotePlatform("");
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      const request = tab === "x" ? onSearchX(q) : onSearchUsers(tab, q);
      void request.then((result) => {
        setLoading(false);
        setRemoteUsers(result.users);
        setRemotePlatform(tab);
        setError(result.ok === false ? result.error || "搜索服务暂不可用" : "");
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [active, onSearchUsers, onSearchX, search, tab]);

  const xSearchMerged = useMemo(() => {
    const q = search.trim();
    if (!q) return [] as XSuggestion[];
    const localPool = [...defaultX.subscribed, ...defaultX.suggestions];
    const localHits = filterXSuggestions(localPool, q);
    return mergeXSearchResults(localHits, remoteUsers);
  }, [search, defaultX, remoteUsers]);

  const isSubscribed = (platform: PickerPlatform, id: string) => {
    const key = feedKey({ platform, id });
    return subscribed.has(key) || subscribedLower.has(key.toLowerCase());
  };

  const togglePending = (candidate: Candidate, platform: PickerPlatform) => {
    const key = feedKey({ platform, id: candidate.id });
    if (isSubscribed(platform, candidate.id)) {
      onSelectSubscribed(key);
      return;
    }
    setPending((prev) => {
      const exists = prev.some(
        (row) => feedKey({ platform: row.platform, id: row.id }) === key,
      );
      if (exists) return prev.filter((row) => feedKey({ platform: row.platform, id: row.id }) !== key);
      return [
        ...prev,
        {
          platform,
          id: String(candidate.id),
          name: candidate.name,
          avatar: candidate.avatar,
          followers: candidate.followers,
          verified: candidate.verified,
        },
      ];
    });
  };

  const removePending = (key: string) => {
    setPending((prev) =>
      prev.filter((row) => feedKey({ platform: row.platform, id: row.id }) !== key),
    );
  };

  const confirmPending = async () => {
    if (!pending.length || confirming) return;
    setConfirming(true);
    const queue = [...pending];
    const failed: PendingPick[] = [];
    for (const row of queue) {
      const result = await onAdopt({
        platform: row.platform,
        id: String(row.id),
        name: row.name,
        avatar: row.avatar,
      });
      if (!result.ok) failed.push(row);
    }
    setConfirming(false);
    if (failed.length) {
      setPending(failed);
      return;
    }
    setPending([]);
    onDismiss?.();
  };

  const removeRow = async (key: string) => {
    if (removingKey) return;
    setRemovingKey(key);
    try {
      await onRemoveSubscribed(key);
    } finally {
      setRemovingKey("");
    }
  };

  const renderRow = (candidate: Candidate, platform: PickerPlatform) => {
    const key = feedKey({ platform, id: candidate.id });
    const added = isSubscribed(platform, candidate.id);
    const selected = pendingKeys.has(key);
    const meta =
      platform === "x"
        ? "@" +
          candidate.id +
          (candidate.followers ? " · " + shortCount(candidate.followers) + " 粉丝" : "")
        : platformLabel(platform) +
          " · " +
          candidate.id +
          (candidate.followers ? " · " + shortCount(candidate.followers) + " 粉丝" : "");
    const label = candidate.name || candidate.id;
    // 已订阅的行不能整体当按钮用：里面还要放取消订阅按钮，按钮不能嵌套。
    if (added) {
      const removing = removingKey === key;
      return (
        <div
          key={key}
          data-subscribed="true"
          className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-2 pr-1.5 transition-colors hover:bg-surface-subtle"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            disabled={removing}
            onClick={() => onSelectSubscribed(key)}
            aria-label={`打开 ${label} 的信息流`}
          >
            <span className="size-[30px] shrink-0">
              <Avatar name={label} avatar={candidate.avatar} platform={platform} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{label}</span>
              <span className="block truncate text-[10.5px] text-muted-foreground">{meta}</span>
            </span>
          </button>
          <button
            type="button"
            disabled={confirming || removing}
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-surface-subtle px-1.5 text-[10px] font-semibold leading-[1.45] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
            onClick={() => void removeRow(key)}
            aria-label={`取消订阅 ${label}`}
          >
            {removing ? "移除中…" : "取消订阅"}
          </button>
        </div>
      );
    }
    return (
      <Button
        key={key}
        type="button"
        variant="ghost"
        role="option"
        aria-selected={selected}
        disabled={confirming}
        className={cn(
          "h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left font-normal",
          selected && "bg-surface-subtle",
        )}
        onClick={() => togglePending(candidate, platform)}
      >
        <span className="size-[30px] shrink-0">
          <Avatar
            name={label}
            avatar={candidate.avatar}
            platform={platform}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{label}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">{meta}</span>
        </span>
        <Badge variant={selected ? "default" : "secondary"} className="shrink-0 text-[10.5px]">
          {selected ? "已选" : "+ 选择"}
        </Badge>
      </Button>
    );
  };

  const xqSession = platformSessions.xueqiu;
  const xueqiuChecking = false;
  const xueqiuNeedsLogin = false;
  const xueqiuUnknown = false;
  const weiboSession = platformSessions.weibo;
  const weiboNeedsLogin = false;
  const weiboChecking = false;
  const weiboUnknown = false;

  const refreshPlatform = (platform: PickerPlatform) => {
    if (onRefreshPlatform) {
      onRefreshPlatform(platform);
    } else if (platform === "xueqiu") {
      onRetry();
    }
    if (platform === "x") setXFollowReload((value) => value + 1);
    else if (platform === "weibo") setWeiboFollowReload((value) => value + 1);
  };

  const isPlatformRefreshing = (platform: PickerPlatform): boolean => {
    if (platform === "x") return xFollowState === "loading";
    if (platform === "weibo") return weiboFollowState === "loading";
    return platformSessions.xueqiu === "checking" || status === "checking";
  };

  const renderPlatformRefreshButton = (platform: PickerPlatform) => {
    const busy = isPlatformRefreshing(platform);
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || confirming}
        className="ml-auto h-6 px-2 text-[10.5px]"
        onClick={() => refreshPlatform(platform)}
      >
        {busy ? "获取中…" : "重新获取"}
      </Button>
    );
  };

  let pickerBody: ReactNode;
  if (!search.trim() && !followingEnabled) {
    const activeSubscribed =
      tab === "xueqiu"
        ? subscribedXueqiu
        : tab === "weibo"
          ? subscribedWeibo
          : subscribedX;
    pickerBody = (
      <div className="flex flex-col gap-0.5">
        {activeSubscribed.length ? (
          <>
            <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
              已订阅 · {activeSubscribed.length}
            </div>
            {activeSubscribed.map((s) => renderRow(s, tab))}
          </>
        ) : null}
        {tab === "x" && defaultX.suggestions.length ? (
          <>
            <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
              热门推荐
            </div>
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {defaultX.suggestions.slice(0, 6).map((person) => renderRow(person, "x"))}
            </div>
          </>
        ) : null}
        <StateEmpty
          title="搜索公开用户开始"
          description={
            tab === "xueqiu"
              ? "输入昵称、用户 ID，或粘贴 xueqiu.com/u/主页链接。"
              : tab === "weibo"
                ? "输入昵称、用户 ID，或粘贴 weibo.com/u/主页链接。"
                : "输入用户名、@用户名，或粘贴 X 主页链接。"
          }
        />
      </div>
    );
  } else if (tab === "xueqiu") {
    if (search.trim()) {
      pickerBody = xueqiuSearchRows.length ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
            公开搜索结果 · {xueqiuSearchRows.length}
          </div>
          {xueqiuSearchRows.slice(0, 200).map((p) => renderRow(p, "xueqiu"))}
        </div>
      ) : (
        <StateEmpty
          title={loading ? "正在搜索公开用户" : "没有匹配的公开用户"}
          description={error || "可粘贴雪球主页链接或用户 ID。"}
        />
      );
    } else if (xueqiuChecking) {
      pickerBody = (
        <StateEmpty title="正在检测雪球登录" description="登录后可读取关注列表。">
          <Button type="button" onClick={() => refreshPlatform("xueqiu")}>
            重新检查
          </Button>
        </StateEmpty>
      );
    } else if (xueqiuNeedsLogin) {
      pickerBody = (
        <StateEmpty
          title="请先登录雪球"
          description={`登录后才能读取关注列表。状态：${sessionHint(xqSession)}`}
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={onLoginXueqiu}>
              去雪球登录
            </Button>
            <Button type="button" onClick={() => refreshPlatform("xueqiu")}>
              重新检查
            </Button>
          </div>
        </StateEmpty>
      );
    } else if (xueqiuUnknown) {
      pickerBody = (
        <StateEmpty
          title="雪球登录状态未知"
          description="可能是网络或页面未就绪，不代表未登录。可重试或前往雪球确认。"
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={onLoginXueqiu}>
              去雪球登录
            </Button>
            <Button type="button" onClick={() => refreshPlatform("xueqiu")}>
              重新检查
            </Button>
          </div>
        </StateEmpty>
      );
    } else {
      pickerBody = (
        <div className="flex flex-col gap-0.5">
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2 py-1 text-[10.5px] text-muted-foreground">
            <span>雪球 · {sessionHint(xqSession)}</span>
            {renderPlatformRefreshButton("xueqiu")}
          </div>
          {subscribedXueqiu.length ? (
            <>
              <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
                已订阅 · {subscribedXueqiu.length}
              </div>
              {subscribedXueqiu.map((s) => renderRow(s, "xueqiu"))}
            </>
          ) : null}
          <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
            我的关注 · {xueqiuFollowingRows.length}
          </div>
          {xueqiuFollowingRows.slice(0, 200).map((p) => renderRow(p, "xueqiu"))}
          {!xueqiuFollowingRows.length ? (
            <StateEmpty title="暂无雪球关注">
              <EmptyDescription className="text-[11px] leading-[1.6]">
                平台登录已关闭。直接搜索公开雪球用户，或粘贴用户主页链接即可添加。
              </EmptyDescription>
            </StateEmpty>
          ) : null}
        </div>
      );
    }
  } else if (tab === "weibo") {
    if (search.trim()) {
      pickerBody = weiboSearchRows.length ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
            公开搜索结果 · {weiboSearchRows.length}
          </div>
          {weiboSearchRows.slice(0, 200).map((p) => renderRow(p, "weibo"))}
        </div>
      ) : (
        <StateEmpty
          title={loading ? "正在搜索公开用户" : "没有匹配的公开用户"}
          description={error || "也可粘贴 weibo.com/u/用户ID 主页链接。"}
        />
      );
    } else if (weiboChecking) {
      pickerBody = (
        <StateEmpty title="正在检测微博登录" description="登录后可读取关注列表。">
          <Button type="button" onClick={() => refreshPlatform("weibo")}>
            重新检查
          </Button>
        </StateEmpty>
      );
    } else if (weiboNeedsLogin) {
      pickerBody = (
        <StateEmpty
          title="请先登录微博"
          description={`登录后才能读取关注列表。状态：${sessionHint(weiboSession)}`}
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={onLoginWeibo}>
              去微博登录
            </Button>
            <Button type="button" onClick={() => refreshPlatform("weibo")}>
              重新检查
            </Button>
          </div>
        </StateEmpty>
      );
    } else if (weiboUnknown) {
      pickerBody = (
        <StateEmpty
          title="微博登录状态未知"
          description="可能是网络或页面未就绪，不代表未登录。可重试或前往微博确认。"
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={onLoginWeibo}>
              去微博登录
            </Button>
            <Button type="button" onClick={() => refreshPlatform("weibo")}>
              重新检查
            </Button>
          </div>
        </StateEmpty>
      );
    } else {
      const followHint =
        weiboFollowReason === "NOT_LOGGED_IN"
          ? "平台登录已关闭。直接搜索公开微博用户，或粘贴公开主页链接即可添加。"
          : weiboFollowReason === "NO_SELF_UID"
            ? "已检测到登录痕迹，但未能识别当前账号。点上方「重新获取」再试一次。"
            : "没有读到微博关注列表。点上方「重新获取」再试一次。";
      pickerBody = (
        <div className="flex flex-col gap-0.5">
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2 py-1 text-[10.5px] text-muted-foreground">
            <span>微博 · {sessionHint(weiboSession)}</span>
            {weiboFollowState === "loading" ? <span>· 正在读取关注</span> : null}
            {renderPlatformRefreshButton("weibo")}
          </div>
          {subscribedWeibo.length ? (
            <>
              <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
                已订阅 · {subscribedWeibo.length}
              </div>
              {subscribedWeibo.map((s) => renderRow(s, "weibo"))}
            </>
          ) : null}
          <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
            我的关注 · {weiboFollowState === "ready" ? weiboFollowingRows.length : "…"}
          </div>
          {weiboFollowState === "loading" && !weiboFollowingRows.length ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : null}
          {weiboFollowingRows.slice(0, 200).map((person) => renderRow(person, "weibo"))}
          {weiboFollowState !== "loading" && !weiboFollowingRows.length ? (
            <div className="px-3 py-3 text-[11px] leading-[1.6] text-muted-foreground">
              <p>{followHint}</p>
            </div>
          ) : null}
        </div>
      );
    }
  } else if (search.trim()) {
    if (loading && !xSearchMerged.length) {
      pickerBody = (
        <div className="flex flex-col gap-2 p-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      );
    } else if (!xSearchMerged.length) {
      pickerBody = <StateEmpty title={error || "未找到相关 X 账号"} />;
    } else {
      pickerBody = (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
            搜索结果 · {xSearchMerged.length} 位{loading ? " · 远端搜索中" : ""}
          </div>
          {xSearchMerged.map((u) => renderRow(u, "x"))}
          {error ? (
            <Alert className="mx-2 my-1 border-0 bg-transparent px-0 py-1">
              <AlertDescription className="text-[10.5px]">{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      );
    }
  } else {
    const followHint =
      xFollowReason === "NOT_LOGGED_IN"
        ? "平台登录已关闭。直接搜索公开 X 用户，或输入 @用户名即可添加。"
        : xFollowReason === "RATE_LIMITED"
          ? "X 暂时限制了关注列表，稍后再试。"
          : "没有读到 X 关注列表。";
    pickerBody = (
      <div className="flex flex-col gap-0.5">
        <div className="mb-1 flex flex-wrap items-center gap-2 px-2 py-1 text-[10.5px] text-muted-foreground">
          <span>X · {sessionHint(platformSessions.x)}</span>
          {xFollowState === "loading" ? <span>· 正在读取关注</span> : null}
          {renderPlatformRefreshButton("x")}
        </div>
        {subscribedX.length ? (
          <>
            <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
              已订阅 · {subscribedX.length}
            </div>
            {subscribedX.map((s) => renderRow(s, "x"))}
          </>
        ) : null}
        <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
          热门推荐
        </div>
        <div className="grid grid-cols-2 gap-0.5 px-0.5">
          {defaultX.suggestions.slice(0, 6).map((person) => renderRow(person, "x"))}
        </div>
        <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
          我的关注 · {xFollowState === "ready" ? xFollowingRows.length : "…"}
        </div>
        {xFollowState === "loading" && !xFollowingRows.length ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : null}
        {xFollowingRows.map((person) => renderRow(person, "x"))}
        {xFollowState !== "loading" && !xFollowingRows.length ? (
          <div className="px-3 py-3 text-[11px] leading-[1.6] text-muted-foreground">
            <p>{followHint}</p>
            {xFollowState === "error" && xFollowReason !== "NOT_LOGGED_IN" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => refreshPlatform("x")}
              >
                重新读取
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const searchDisabled = confirming;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isPage ? "gap-2.5 px-4 pb-4 pt-1" : "gap-2.5",
        className,
      )}
    >
      {isPage ? (
        <div className="shrink-0 space-y-1">
          <h2 className="text-[13px] font-semibold tracking-[-0.01em]">选择要订阅的用户</h2>
          <p className="text-[11px] leading-[1.55] text-muted-foreground">
            不需要平台账号登录；搜索公开用户并添加查看。Google 登录只用于同步订阅列表。
          </p>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as PickerPlatform);
          setSearch("");
        }}
        className="flex min-h-0 flex-1 flex-col gap-2.5"
      >
        <TabsList className="picker-tabs grid h-9 w-full shrink-0 grid-cols-3 rounded-[10px] bg-muted p-[3px]">
            {PICKER_PLATFORMS.map((platform) => (
              <TabsTrigger
                key={platform}
                value={platform}
                title={platformLabel(platform)}
                className="gap-1.5 px-0 text-[11px] font-semibold"
              >
                <PlatformLogo platform={platform} className="size-[13px]" />
                <span className="truncate">{platformLabel(platform)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        <FollowingList
          search={search}
          onSearchChange={setSearch}
          placeholder={
            tab === "x"
              ? "搜索更多 X 账号（如 karpathy）"
              : tab === "weibo"
                ? "搜索微博公开用户昵称 / ID，或粘贴主页链接"

                  : "搜索雪球公开用户昵称 / ID"
          }
          searchLabel={
            tab === "x"
              ? "搜索更多 X 账号"
              : tab === "weibo"
                ? "搜索微博关注"
                : "搜索雪球关注"
          }
          listLabel={
            tab === "x"
              ? "可选 X 用户"
              : tab === "weibo"
                ? "可选微博用户"
                : "可选雪球用户"
          }
          searchDisabled={searchDisabled}
          listClassName={isPage ? undefined : "min-h-[280px]"}
        >
          {pending.length ? (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
                已选 · {pending.length}
              </div>
              {pending.map((row) => {
                const key = feedKey({ platform: row.platform, id: row.id });
                const label = row.name || row.id;
                const meta =
                  row.platform === "x"
                    ? "@" + row.id
                    : platformLabel(row.platform) + " · " + row.id;
                return (
                  <div
                    key={key}
                    className="flex w-full items-center gap-1.5 rounded-lg bg-surface-subtle py-1.5 pl-2 pr-1.5"
                  >
                    <span className="size-[30px] shrink-0">
                      <Avatar name={label} avatar={row.avatar} platform={row.platform} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{label}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {meta}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={confirming}
                      className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-surface px-1.5 text-[10px] font-semibold leading-[1.45] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => removePending(key)}
                      aria-label={`取消选择 ${label}`}
                    >
                      取消选择
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {pickerBody}
        </FollowingList>
      </Tabs>

      <div className={cn("flex shrink-0 gap-2", isPage ? "justify-stretch" : "justify-end")}>
        <Button
          type="button"
          variant="default"
          disabled={!pending.length || confirming || importingList}
          className={isPage ? "flex-1" : undefined}
          onClick={() => void confirmPending()}
        >
          {confirming
            ? "添加中…"
            : pending.length
              ? `确认添加 ${pending.length} 人`
              : "确认添加"}
        </Button>
        {isPage && onImportSubscriptions ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={confirming || importingList}
              onClick={() => importInputRef.current?.click()}
            >
              {importingList ? "导入中…" : "导入清单"}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="导入订阅清单 JSON"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setImportingList(true);
                setError("");
                void onImportSubscriptions(file).then((result) => {
                  setImportingList(false);
                  if (!result.ok) {
                    setError(result.error || "导入订阅清单失败");
                  } else if (!result.added) {
                    setError("清单中没有新的可导入订阅");
                  }
                  input.value = "";
                });
              }}
            />
          </>
        ) : null}
        {!isPage ? (
          <Button type="button" disabled={confirming} onClick={() => onDismiss?.()}>
            关闭
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AddSourceDialog({
  open,
  onOpenChange,
  sources,
  following,
  status,
  platformSessions,
  initialTab = "x",
  onAdopt,
  onSelectSubscribed,
  onRemoveSubscribed,
  onSearchX,
  onSearchUsers,
  onLoadXFollowing,
  onLoadWeiboFollowing,
  onLoginXueqiu,
  onLoginX,
  onLoginWeibo,
  onRetry,
  onRefreshPlatform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: FeedSource[];
  following: Array<{ id: string; name: string; avatar?: string }>;
  status: string;
  platformSessions: PlatformSessions;
  initialTab?: PickerPlatform;
  onAdopt: (candidate: {
    platform: PickerPlatform;
    id: string;
    name?: string;
    avatar?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onSelectSubscribed: (feedKey: string) => void;
  onRemoveSubscribed: (feedKey: string) => Promise<void> | void;
  onSearchX: (query: string) => Promise<{ ok: boolean; users: Candidate[]; error?: string }>;
  onSearchUsers: (
    platform: "xueqiu" | "weibo",
    query: string,
  ) => Promise<{ ok: boolean; users: Candidate[]; error?: string }>;
  onLoadXFollowing: (force?: boolean) => Promise<{ ok: boolean; users: Candidate[]; reason?: string }>;
  onLoadWeiboFollowing: (force?: boolean) => Promise<{ ok: boolean; users: Candidate[]; reason?: string }>;
  onLoginXueqiu: () => void;
  onLoginX: () => void;
  onLoginWeibo: () => void;
  onRetry: () => void;
  onRefreshPlatform?: (platform: PickerPlatform) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[4%] h-[min(92%,680px)] max-h-[min(92%,680px)] overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>选择要订阅的用户</DialogTitle>
          <DialogDescription>
            点击列表多选后再确认添加。支持搜索雪球、微博与 X 公开用户。
          </DialogDescription>
        </DialogHeader>

        <AddSourcePanel
          active={open}
          sources={sources}
          following={following}
          status={status}
          platformSessions={platformSessions}
          initialTab={initialTab}
          variant="dialog"
          onAdopt={onAdopt}
          onSelectSubscribed={onSelectSubscribed}
          onRemoveSubscribed={onRemoveSubscribed}
          onSearchX={onSearchX}
          onSearchUsers={onSearchUsers}
          onLoadXFollowing={onLoadXFollowing}
          onLoadWeiboFollowing={onLoadWeiboFollowing}
          onLoginXueqiu={onLoginXueqiu}
          onLoginX={onLoginX}
          onLoginWeibo={onLoginWeibo}
          onRetry={onRetry}
          onRefreshPlatform={onRefreshPlatform}
          onDismiss={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
