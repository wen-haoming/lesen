import {
  deleteOwlivoAccount,
  getOwlivoAccount,
  getOwlivoAuthClient,
  refreshOwlivoAuthSession,
  signInWithGoogle,
  signOutOwlivoAccount,
} from "./owlivo-auth";
import {
  createSupabaseSubscriptionApi,
  flushPendingOps,
  handleSignedIn,
  handleSignedOut,
  readMergePrompt,
} from "./subscription-sync";
import { enqueueSubscriptionSync } from "./subscription-sync-queue";

const AUTH_REFRESH_ALARM = "owlivo-auth-refresh";
const AUTH_RUNTIME_PREFIX = "owlivo-auth:";
export async function refreshPersistedAuthSession(): Promise<void> {
  if (getOwlivoAuthClient()) await refreshOwlivoAuthSession();
}
function reportAuthBackgroundFailure(error: unknown): void {
  console.warn("[auth session refresh]", error);
}
function startSubscriptionSyncAfterSignIn(userId: string): void {
  void enqueueSubscriptionSync(async () => {
    const api = createSupabaseSubscriptionApi();
    if (!api) return;
    const prepared = await handleSignedIn(userId, api);
    const prompt = await readMergePrompt(userId);
    // 有游客订阅时交给首页设置里的合并确认；没有待确认内容就直接冲刷队列。
    if (prepared.merge !== "needed" && !prompt.needed) await flushPendingOps(userId, api);
  }).catch(reportAuthBackgroundFailure);
}
export function isTrustedAuthSender(
  sender: Pick<chrome.runtime.MessageSender, "id" | "url">,
  runtimeId = chrome.runtime.id,
): boolean {
  if (!runtimeId || sender.id !== runtimeId || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === runtimeId &&
      ["/popup.html", "/sidepanel.html", "/home.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}
type AuthAction = "account" | "sign-in" | "sign-out" | "delete-account";
type MutationAction = Exclude<AuthAction, "account">;
type AuthActionResult =
  | {
      ok: true;
      account?: Awaited<ReturnType<typeof getOwlivoAccount>>["account"];
      personaRestored?: true;
    }
  | { ok: false; reason?: string; message: string };
let mutationTail: Promise<void> = Promise.resolve();
let lastQueuedMutation: { action: MutationAction; promise: Promise<AuthActionResult> } | null =
  null;
function actionForMessage(message: unknown): AuthAction | null {
  const type =
    message && typeof message === "object" ? (message as { type?: unknown }).type : undefined;
  switch (type) {
    case `${AUTH_RUNTIME_PREFIX}account`:
      return "account";
    case `${AUTH_RUNTIME_PREFIX}sign-in`:
      return "sign-in";
    case `${AUTH_RUNTIME_PREFIX}sign-out`:
      return "sign-out";
    case `${AUTH_RUNTIME_PREFIX}delete-account`:
      return "delete-account";
    default:
      return null;
  }
}
function enqueueMutation(
  action: MutationAction,
  operation: () => Promise<AuthActionResult>,
): Promise<AuthActionResult> {
  if (lastQueuedMutation?.action === action) return lastQueuedMutation.promise;
  const current = mutationTail.then(operation, operation);
  lastQueuedMutation = { action, promise: current };
  mutationTail = current.then(
    () => undefined,
    () => undefined,
  );
  const clear = () => {
    if (lastQueuedMutation?.promise === current) lastQueuedMutation = null;
  };
  void current.then(clear, clear);
  return current;
}
export function handleAuthRuntimeMessage(
  message: unknown,
  sender: Pick<chrome.runtime.MessageSender, "id" | "url">,
  runtimeId: string,
  dependencies: {
    signIn?: () => ReturnType<typeof signInWithGoogle>;
    signOut?: () => ReturnType<typeof signOutOwlivoAccount>;
    getAccount?: () => ReturnType<typeof getOwlivoAccount>;
    deleteAccount?: (expectedUserId: string) => ReturnType<typeof deleteOwlivoAccount>;
    enqueueSync?: <T>(operation: () => Promise<T>) => Promise<T>;
    handleSignedOut?: () => ReturnType<typeof handleSignedOut>;
  } = {},
): Promise<{ handled: boolean; response?: unknown }> {
  const signIn = dependencies.signIn || signInWithGoogle;
  const signOut = dependencies.signOut || signOutOwlivoAccount;
  const getAccount = dependencies.getAccount || getOwlivoAccount;
  const action = actionForMessage(message);
  if (!action) return Promise.resolve({ handled: false });
  if (!isTrustedAuthSender(sender, runtimeId))
    return Promise.resolve({
      handled: true,
      response: { ok: false, message: "未授权的登录请求。" },
    });
  if (action === "account") {
    return Promise.resolve()
      .then(getAccount)
      .then((current) => ({
        handled: true,
        response:
          current &&
          typeof current === "object" &&
          current.account === null &&
          typeof current.status === "string"
            ? { ok: true, status: current.status, account: null }
            : current?.account &&
                typeof current.account.id === "string" &&
                typeof current.status === "string"
              ? { ok: true, status: current.status, account: current.account }
              : { ok: false, message: "无法读取账号信息。" },
      }))
      .catch((error: unknown) => ({
        handled: true,
        response: {
          ok: false,
          message: error instanceof Error ? error.message : "无法读取账号信息。",
        },
      }));
  }
  const expectedUserId =
    action === "delete-account" &&
    message &&
    typeof message === "object" &&
    typeof (message as { userId?: unknown }).userId === "string"
      ? (message as { userId: string }).userId
      : null;
  if (action === "delete-account" && !expectedUserId)
    return Promise.resolve({
      handled: true,
      response: { ok: false, reason: "invalid_request", message: "删除请求缺少预期账号。" },
    });
  const restoreGuest = () => (dependencies.handleSignedOut || handleSignedOut)();
  const operation: () => Promise<AuthActionResult> =
    action === "sign-in"
      ? async () => {
          const result = await signIn();
          if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
            return { ok: false, reason: "failed", message: "登录服务返回了无效结果。" };
          if (!result.ok) return result;
          const current = await getAccount();
          if (!current?.account || typeof current.account.id !== "string")
            return { ok: false, reason: "failed", message: "登录已完成，但无法读取账号信息。" };
          // 登录成功立即启动后台订阅同步；不阻塞登录响应，也与订阅变更共用串行队列。
          startSubscriptionSyncAfterSignIn(current.account.id);
          return { ok: true, account: current.account };
        }
      : action === "sign-out"
        ? async () => {
            const result = await signOut();
            if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
              return { ok: false, message: "退出登录服务返回了无效结果。" };
            if (!result.ok) return result;
            await restoreGuest();
            return { ok: true, personaRestored: true };
          }
        : async () => {
            const current = await getAccount();
            if (!current?.account || current.account.id !== expectedUserId)
              return { ok: false, reason: "failed", message: "当前登录账号已变化，请刷新后重试。" };
            const result = await (dependencies.deleteAccount || deleteOwlivoAccount)(
              expectedUserId!,
            );
            if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
              return { ok: false, reason: "failed", message: "删除服务返回了无效结果。" };
            if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
            await restoreGuest();
            return { ok: true, personaRestored: true };
          };
  const queuedOperation: Promise<AuthActionResult> = enqueueMutation(
    action,
    action === "sign-in"
      ? operation
      : () => (dependencies.enqueueSync || enqueueSubscriptionSync)(operation),
  );
  return queuedOperation.then(
    (response) => ({ handled: true, response }),
    (error: unknown) => ({
      handled: true,
      response: {
        ok: false,
        reason: "failed",
        message:
          error instanceof Error
            ? error.message
            : action === "sign-in"
              ? "登录失败。"
              : "退出登录失败。",
      },
    }),
  );
}
export function installAuthSessionHooks(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!actionForMessage(message)) return false;
    void handleAuthRuntimeMessage(message, sender, chrome.runtime.id)
      .then(({ response }) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "后台认证请求失败。",
        }),
      );
    return true;
  });
  if (!getOwlivoAuthClient()) return;
  if (typeof chrome.alarms?.get === "function") {
    chrome.alarms.get(AUTH_REFRESH_ALARM, (existing) => {
      if (!existing) chrome.alarms.create(AUTH_REFRESH_ALARM, { periodInMinutes: 10 });
    });
  } else {
    chrome.alarms.create(AUTH_REFRESH_ALARM, { periodInMinutes: 10 });
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTH_REFRESH_ALARM)
      void refreshPersistedAuthSession().catch(reportAuthBackgroundFailure);
  });
  chrome.runtime.onStartup.addListener(() => {
    void refreshPersistedAuthSession().catch(reportAuthBackgroundFailure);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void refreshPersistedAuthSession().catch(reportAuthBackgroundFailure);
  });
  void refreshPersistedAuthSession().catch(reportAuthBackgroundFailure);
}
