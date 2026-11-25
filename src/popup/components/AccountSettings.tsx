import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ACCOUNT_DELETE_NOTICE,
  LOCAL_DATA_LOGIN_HINT,
  LOCAL_DATA_NOTICE,
} from "@/lib/owlivo-auth-config";
import type { OwlivoAccount, OwlivoAuthStatus } from "@/lib/owlivo-auth";
import {
  deleteOwlivoAccountInBackground,
  getOwlivoAccountInBackground,
  signInWithGoogleInBackground,
  signOutOwlivoAccountInBackground,
} from "@/lib/owlivo-auth-runtime";
import {
  confirmFirstMergeInBackground,
  declineFirstMergeInBackground,
  prepareSubscriptionSyncInBackground,
} from "@/lib/subscription-sync-runtime";
import { invalidateActionsForIdentityChange } from "@/lib/account-settings-lifecycle";
import { cn } from "@/lib/utils";
import { PRODUCT_DISPLAY_NAME } from "@/lib/product-brand";

function statusMessage(status: OwlivoAuthStatus): string {
  if (status === "unconfigured") return "云端登录尚未完成项目公开配置，当前不可用。";
  if (status === "needs_google_client") {
    return "Google 登录还差外部 OAuth 客户端配置，完成后才可实际登录。";
  }
  return "";
}

export function AccountSettings({
  onMergeNeeded,
}: {
  onMergeNeeded?: (needed: boolean) => void;
} = {}) {
  const [status, setStatus] = useState<OwlivoAuthStatus>("unconfigured");
  const [account, setAccount] = useState<OwlivoAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeNeeded, setMergeNeeded] = useState(false);
  const [mergeCount, setMergeCount] = useState(0);
  const [copiedId, setCopiedId] = useState(false);
  const mountedRef = useRef(false);
  const refreshGeneration = useRef(0);
  const refreshRunning = useRef(false);
  const refreshQueued = useRef(false);
  const actionGeneration = useRef(0);
  const identityRef = useRef<{ id: string | null; status: OwlivoAuthStatus }>({
    id: null,
    status: "unconfigured",
  });
  const onMergeNeededRef = useRef(onMergeNeeded);
  onMergeNeededRef.current = onMergeNeeded;

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    refreshQueued.current = true;
    if (refreshRunning.current) return;
    refreshRunning.current = true;
    try {
      while (refreshQueued.current && mountedRef.current) {
        refreshQueued.current = false;
        const generation = ++refreshGeneration.current;
        const next = await getOwlivoAccountInBackground();
        if (!mountedRef.current || generation !== refreshGeneration.current) continue;
        if (!next) {
          setFailed(true);
          setNote("无法从后台读取账号状态，请稍后重试。");
          continue;
        }
        const nextIdentity = { id: next.account?.id ?? null, status: next.status };
        const identityChanged =
          identityRef.current.id !== nextIdentity.id ||
          identityRef.current.status !== nextIdentity.status;
        if (identityChanged) {
          identityRef.current = invalidateActionsForIdentityChange(
            identityRef.current,
            nextIdentity,
            () => {
              actionGeneration.current++;
            },
            () => setBusy(false),
          );
          setNote("");
          setFailed(false);
          setConfirmDelete(false);
          setMergeNeeded(false);
          setMergeCount(0);
          setCopiedId(false);
          onMergeNeededRef.current?.(false);
        }
        setStatus(next.status);
        setAccount(next.account);
        if (!next.account) {
          setMergeNeeded(false);
          setMergeCount(0);
          onMergeNeededRef.current?.(false);
          continue;
        }
        const userId = next.account.id;
        try {
          const prepared = await prepareSubscriptionSyncInBackground();
          if (!prepared) throw new Error("无法准备订阅同步，请稍后重试。");
          const prompt = { needed: prepared.merge === "needed", guestCount: prepared.guestCount };
          const latest = await getOwlivoAccountInBackground();
          if (
            !mountedRef.current ||
            generation !== refreshGeneration.current ||
            latest?.account?.id !== userId
          )
            continue;
          setMergeNeeded(prompt.needed);
          setMergeCount(prompt.guestCount);
          onMergeNeededRef.current?.(prompt.needed);
          if (prepared.merge === "needed") {
            setNote(
              `当前 Google 账号是 ${next.account.nickname}${next.account.email ? `（${next.account.email}）` : ""}。有 ${prompt.guestCount} 个本机订阅尚未合并到此账号。确认后只会上传订阅列表，不会上传第三方登录凭证、文章或阅读记录。`,
            );
          }
        } catch (error) {
          if (!mountedRef.current || generation !== refreshGeneration.current) continue;
          setFailed(true);
          setNote(
            error instanceof Error ? error.message : "订阅同步准备失败，请稍后重试。本机订阅仍在。",
          );
          onMergeNeededRef.current?.(false);
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setFailed(true);
        setNote(error instanceof Error ? error.message : "无法读取账号状态，请稍后重试。");
      }
    } finally {
      refreshRunning.current = false;
      if (refreshQueued.current && mountedRef.current) queueMicrotask(() => void refresh());
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const refreshIfAuthChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes["owlivo-auth"]) {
        refreshGeneration.current++;
        void refresh().catch(() => undefined);
      }
    };
    if (typeof chrome !== "undefined") chrome.storage?.onChanged?.addListener(refreshIfAuthChanged);
    void refresh().catch(() => undefined);
    return () => {
      mountedRef.current = false;
      refreshGeneration.current++;
      actionGeneration.current++;
      if (typeof chrome !== "undefined")
        chrome.storage?.onChanged?.removeListener(refreshIfAuthChanged);
    };
  }, [refresh]);

  const canSignIn = status === "signed_out";
  const showGoogleSetup = status === "needs_google_client" || status === "unconfigured";

  async function copyUserId(userId: string) {
    const generation = actionGeneration.current;
    try {
      await navigator.clipboard.writeText(userId);
      if (!mountedRef.current || generation !== actionGeneration.current) return;
      setCopiedId(true);
      window.setTimeout(() => {
        if (mountedRef.current && generation === actionGeneration.current) setCopiedId(false);
      }, 1600);
    } catch {
      if (!mountedRef.current || generation !== actionGeneration.current) return;
      setCopiedId(false);
      setFailed(true);
      setNote("无法复制用户 ID。");
    }
  }

  const accountStatus = account
    ? mergeNeeded
      ? `有 ${mergeCount} 个本机订阅待确认后才能合并到此账号。`
      : "已登录。只会同步订阅列表，不会自动上传未确认的本机订阅。"
    : statusMessage(status) || `可选使用 Google 登录 ${PRODUCT_DISPLAY_NAME} 账号，用于识别你的身份。`;

  return (
    <div className="min-w-0">
      {account ? (
        <div className="flex items-start gap-2 rounded-[10px] border border-border bg-background/50 p-2.5">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="mt-0.5 h-7 w-7 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
              {account.nickname.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-semibold leading-[1.3] text-foreground">
              {account.nickname}
            </p>
            {account.email ? (
              <p className="truncate text-[10.5px] leading-[1.4] text-muted-foreground">
                {account.email}
              </p>
            ) : (
              <p className="text-[10.5px] leading-[1.4] text-muted-foreground">
                此账号未提供邮箱。
              </p>
            )}
            <p className="mt-0.5 text-[10.5px] leading-[1.4] text-muted-foreground">
              {accountStatus}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-[10.5px] leading-[1.4] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                账号详情
              </summary>
              <div className="mt-1 flex items-start gap-1.5">
                <p className="min-w-0 flex-1 break-all text-[10px] leading-[1.4] text-muted-foreground">
                  用户 ID：{account.id}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => void copyUserId(account.id)}
                  aria-label="复制用户 ID"
                >
                  {copiedId ? "已复制" : "复制"}
                </Button>
              </div>
            </details>
          </div>
        </div>
      ) : (
        <p className="text-[10.5px] leading-[1.4] text-muted-foreground">{accountStatus}</p>
      )}

      {account && mergeNeeded ? (
        <div className="mt-2 rounded-[10px] border border-border bg-background p-2.5">
          <p className="text-[10.5px] leading-[1.4] text-foreground">
            将 {mergeCount} 个本机未归属订阅合并到这个 Google
            账号的订阅列表。不会覆盖云端已有项，也不会上传 Cookie 或令牌。
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!account) return;
                const userId = account.id;
                const generation = ++actionGeneration.current;
                setBusy(true);
                void confirmFirstMergeInBackground(userId)
                  .then(async (result) => {
                    if (!result) throw new Error("后台未能确认合并，请检查当前账号后重试。");
                    const latest = await getOwlivoAccountInBackground();
                    if (
                      !mountedRef.current ||
                      generation !== actionGeneration.current ||
                      latest?.account?.id !== userId
                    )
                      return;
                    setFailed(false);
                    setMergeNeeded(false);
                    setMergeCount(0);
                    onMergeNeededRef.current?.(false);
                    setNote(`已合并 ${result.added} 个本机订阅到当前账号。云端原有订阅未被覆盖。`);
                  })
                  .catch((error: unknown) => {
                    if (!mountedRef.current || generation !== actionGeneration.current) return;
                    setFailed(true);
                    setNote(error instanceof Error ? error.message : "合并失败，请稍后重试。");
                  })
                  .finally(() => {
                    if (mountedRef.current && generation === actionGeneration.current)
                      setBusy(false);
                  });
              }}
            >
              确认合并订阅
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!account) return;
                const userId = account.id;
                const generation = ++actionGeneration.current;
                setBusy(true);
                void declineFirstMergeInBackground(userId)
                  .then(async (declined) => {
                    if (!declined) throw new Error("后台未能暂不合并，请检查当前账号后重试。");
                    const latest = await getOwlivoAccountInBackground();
                    if (
                      !mountedRef.current ||
                      generation !== actionGeneration.current ||
                      latest?.account?.id !== userId
                    )
                      return;
                    setMergeNeeded(false);
                    onMergeNeededRef.current?.(false);
                    setNote("已暂不合并。本机订阅仍留在游客列表，当前显示此账号的云端订阅。");
                    void refresh();
                  })
                  .catch((error: unknown) => {
                    if (!mountedRef.current || generation !== actionGeneration.current) return;
                    setFailed(true);
                    setNote(error instanceof Error ? error.message : "暂不合并操作失败。");
                  })
                  .finally(() => {
                    if (mountedRef.current && generation === actionGeneration.current)
                      setBusy(false);
                  });
              }}
            >
              暂不合并
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-2">
        {account ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => {
              const generation = ++actionGeneration.current;
              setBusy(true);
              setConfirmDelete(false);
              setNote("");
              void signOutOwlivoAccountInBackground()
                .then((result) => {
                  if (!mountedRef.current || generation !== actionGeneration.current) return;
                  setFailed(!result.ok);
                  if (result.ok) {
                    setMergeNeeded(false);
                    setMergeCount(0);
                    onMergeNeededRef.current?.(false);
                    setNote("已退出登录。本机订阅和阅读数据仍在，云端订阅列表不会被删除。");
                    void refresh();
                  } else {
                    setNote(result.message);
                  }
                })
                .catch((error: unknown) => {
                  if (!mountedRef.current || generation !== actionGeneration.current) return;
                  setFailed(true);
                  setNote(error instanceof Error ? error.message : "退出登录失败，请稍后重试。");
                })
                .finally(() => {
                  if (mountedRef.current && generation === actionGeneration.current) setBusy(false);
                });
            }}
          >
            退出登录
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || showGoogleSetup}
            onClick={() => {
              const generation = ++actionGeneration.current;
              setBusy(true);
              setConfirmDelete(false);
              setNote("");
              void signInWithGoogleInBackground()
                .then((result) => {
                  if (!mountedRef.current || generation !== actionGeneration.current) return;
                  if (result.ok) {
                    setFailed(false);
                    setNote(
                      "已登录。若有本机未归属订阅，会先显示当前 Google 账号并请你确认是否合并；只会同步订阅列表。",
                    );
                    void refresh();
                    return;
                  }
                  setFailed(true);
                  if (result.reason === "cancelled") setNote("已取消登录。");
                  else setNote(result.message);
                })
                .catch((error: unknown) => {
                  if (!mountedRef.current || generation !== actionGeneration.current) return;
                  setFailed(true);
                  setNote(error instanceof Error ? error.message : "登录失败，请稍后重试。");
                })
                .finally(() => {
                  if (mountedRef.current && generation === actionGeneration.current) setBusy(false);
                });
            }}
          >
            {busy ? "正在登录…" : "使用 Google 登录"}
          </Button>
        )}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[10.5px] leading-[1.4] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          同步范围说明
        </summary>
        <p className="mt-1 text-[10.5px] leading-[1.4] text-muted-foreground">
          {LOCAL_DATA_NOTICE}
          {LOCAL_DATA_LOGIN_HINT}
        </p>
      </details>

      {canSignIn || account ? null : (
        <p className="mt-1.5 text-[10.5px] leading-[1.4] text-muted-foreground">
          这与已完成的 Supabase 管理授权不是同一件事；还需要在 Google Cloud 创建「Chrome
          扩展」类型的 OAuth 客户端，并把客户端 ID 登记到该项目的 Google 登录提供方。
        </p>
      )}

      {note ? (
        <p
          className={cn(
            "mt-1.5 text-[10.5px] leading-[1.4]",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
          role="status"
        >
          {note}
        </p>
      ) : null}

      {account ? (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="text-[11px] font-semibold text-foreground">删除云端账号</p>
          <p className="mt-1 text-[10.5px] leading-[1.4] text-muted-foreground">
            {ACCOUNT_DELETE_NOTICE}
          </p>
          {confirmDelete ? (
            <p className="mt-1 text-[10.5px] leading-[1.4] text-destructive" role="status">
              再点一次「确认删除账号」才会删除云端账号。此操作与退出登录不同。
            </p>
          ) : null}
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setFailed(false);
                  setNote(ACCOUNT_DELETE_NOTICE + "再点一次确认删除云端账号。");
                  return;
                }
                const userId = account.id;
                const generation = ++actionGeneration.current;
                setBusy(true);
                void deleteOwlivoAccountInBackground(userId)
                  .then((result) => {
                    if (!mountedRef.current || generation !== actionGeneration.current) return;
                    setConfirmDelete(false);
                    setFailed(!result.ok);
                    setNote(
                      result.ok ? "云端账号已删除。本机订阅和阅读数据仍在。" : result.message,
                    );
                    if (result.ok) {
                      setMergeNeeded(false);
                      setMergeCount(0);
                      onMergeNeededRef.current?.(false);
                      void refresh();
                    }
                  })
                  .catch((error: unknown) => {
                    if (!mountedRef.current || generation !== actionGeneration.current) return;
                    setFailed(true);
                    setNote(error instanceof Error ? error.message : "删除账号失败，请稍后重试。");
                  })
                  .finally(() => {
                    if (mountedRef.current && generation === actionGeneration.current)
                      setBusy(false);
                  });
              }}
            >
              {confirmDelete ? "确认删除账号" : "删除云端账号"}
            </Button>
            {confirmDelete ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(false);
                  setNote("");
                }}
              >
                取消
              </Button>
            ) : (
              <span className="self-center text-[10px] leading-[1.3] text-muted-foreground">
                与退出登录分开，需再次确认。
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
