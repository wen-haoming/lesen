import type { OwlivoAccount, OwlivoAuthStatus, OwlivoSignInResult } from "./owlivo-auth";

export type BackgroundAccountState = { status: OwlivoAuthStatus; account: OwlivoAccount | null };
type FailureReason = "cancelled" | "failed" | "unconfigured" | "needs_google_client";
type SignOutResponse = { ok: true } | { ok: false; message: string };
type DeleteResponse = { ok: true } | { ok: false; message: string };
const statuses = new Set<OwlivoAuthStatus>([
  "unconfigured",
  "needs_google_client",
  "signed_out",
  "signed_in",
]);
const reasons = new Set<FailureReason>([
  "cancelled",
  "failed",
  "unconfigured",
  "needs_google_client",
]);

function isAccount(value: unknown): value is OwlivoAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Record<string, unknown>;
  if (Object.keys(account).some((key) => !["id", "email", "nickname", "avatarUrl"].includes(key)))
    return false;
  return (
    typeof account.id === "string" &&
    account.id.length > 0 &&
    (account.email === null || typeof account.email === "string") &&
    typeof account.nickname === "string" &&
    (account.avatarUrl === null || typeof account.avatarUrl === "string")
  );
}

function failure(response?: unknown): { ok: false; reason: FailureReason; message: string } {
  const value =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const reason = reasons.has(value.reason as FailureReason)
    ? (value.reason as FailureReason)
    : "failed";
  return {
    ok: false,
    reason,
    message: typeof value.message === "string" ? value.message : "后台服务当前不可用。",
  };
}

function sendAuthMessage<T>(type: string, validate: (response: unknown) => T): Promise<T> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      resolve(validate(undefined));
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: `owlivo-auth:${type}` }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(validate(undefined));
          return;
        }
        resolve(validate(response));
      });
    } catch {
      resolve(validate(undefined));
    }
  });
}

function validateSignIn(response: unknown): OwlivoSignInResult {
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    if (value.ok === true && isAccount(value.account)) return { ok: true, account: value.account };
    if (value.ok === false && typeof value.message === "string") {
      if (value.reason !== undefined && !reasons.has(value.reason as FailureReason))
        return failure(undefined);
      return failure(response);
    }
  }
  return failure(response);
}

function validateSignOut(response: unknown): SignOutResponse {
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    if (value.ok === true && value.personaRestored === true && Object.keys(value).length === 2)
      return { ok: true };
    if (value.ok === false && typeof value.message === "string")
      return { ok: false, message: value.message };
  }
  return { ok: false, message: "后台服务返回了无效的退出登录结果。" };
}

function validateAccount(response: unknown): BackgroundAccountState | null {
  if (!response || typeof response !== "object") return null;
  const value = response as Record<string, unknown>;
  if (value.ok !== true || !statuses.has(value.status as OwlivoAuthStatus)) return null;
  if (value.account === null) {
    if (value.status === "signed_in") return null;
    return { status: value.status as OwlivoAuthStatus, account: null };
  }
  if (!isAccount(value.account) || value.status !== "signed_in") return null;
  return { status: value.status as OwlivoAuthStatus, account: value.account };
}

export function getOwlivoAccountInBackground(): Promise<BackgroundAccountState | null> {
  return sendAuthMessage("account", validateAccount);
}

export function signInWithGoogleInBackground(): Promise<OwlivoSignInResult> {
  return sendAuthMessage("sign-in", validateSignIn);
}

export function signOutOwlivoAccountInBackground(): Promise<SignOutResponse> {
  return sendAuthMessage("sign-out", validateSignOut);
}

function validateDelete(response: unknown): DeleteResponse {
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    if (value.ok === true && value.personaRestored === true && Object.keys(value).length === 2)
      return { ok: true };
    if (value.ok === false && typeof value.message === "string")
      return { ok: false, message: value.message };
  }
  return { ok: false, message: "后台服务返回了无效的删除结果。" };
}

export function deleteOwlivoAccountInBackground(userId: string): Promise<DeleteResponse> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id || !userId) {
      resolve({ ok: false, message: "后台服务当前不可用。" });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "owlivo-auth:delete-account", userId }, (response) => {
        resolve(chrome.runtime.lastError ? validateDelete(undefined) : validateDelete(response));
      });
    } catch {
      resolve(validateDelete(undefined));
    }
  });
}
