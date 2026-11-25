import { useEffect, useState } from "react";
import type { OwlivoAccount, OwlivoAuthStatus } from "@/lib/owlivo-auth";
import { getOwlivoAccountInBackground } from "@/lib/owlivo-auth-runtime";

export type OwlivoAccountSnapshot = {
  status: OwlivoAuthStatus;
  account: OwlivoAccount | null;
  loaded: boolean;
};

const INITIAL_SNAPSHOT: OwlivoAccountSnapshot = {
  status: "unconfigured",
  account: null,
  loaded: false,
};

/**
 * 订阅后台扩展账号态，并监听 `chrome.storage.local["owlivo-auth"]` 变化实时更新。
 * 在非扩展宿主（如本地 agent-reader 或单元测试）中安全返回未登录空态。
 */
export function useOwlivoAccount(enabled = true): OwlivoAccountSnapshot {
  const [snapshot, setSnapshot] = useState<OwlivoAccountSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    if (!enabled) return;
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      setSnapshot({ status: "unconfigured", account: null, loaded: true });
      return;
    }

    let cancelled = false;
    let generation = 0;

    const refresh = () => {
      const current = ++generation;
      void getOwlivoAccountInBackground().then((next) => {
        if (cancelled || current !== generation) return;
        if (!next) {
          setSnapshot((prev) => ({ ...prev, loaded: true }));
          return;
        }
        setSnapshot({ status: next.status, account: next.account, loaded: true });
      });
    };

    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes["owlivo-auth"]) {
        refresh();
      }
    };

    chrome.storage?.onChanged?.addListener(onStorageChange);
    refresh();

    return () => {
      cancelled = true;
      generation++;
      chrome.storage?.onChanged?.removeListener(onStorageChange);
    };
  }, [enabled]);

  return snapshot;
}
