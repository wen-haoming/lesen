import type { RuntimeResponse } from './messages'

export function hasChromeRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.runtime?.id
}

export function storageGet(keys?: string[] | null): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    if (!hasChromeRuntime() || !chrome.storage?.local) {
      resolve(null)
      return
    }
    chrome.storage.local.get(keys === null || keys === undefined ? null : keys, (data) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve((data || {}) as Record<string, unknown>)
    })
  })
}

export function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!hasChromeRuntime() || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set(obj, () => resolve())
  })
}

export function sendRuntime(message: Record<string, unknown>): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    if (!hasChromeRuntime() || !chrome.runtime?.sendMessage) {
      resolve({ ok: false, reason: 'NO_BACKGROUND' })
      return
    }
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      resolve(error ? { ok: false, reason: 'NO_BACKGROUND' } : ((response || { ok: true }) as RuntimeResponse))
    })
  })
}

export function openTab(url: string): void {
  const target = String(url || '').trim()
  if (!target) return
  if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
    // 从侧栏/弹窗打开时，显式复用当前聚焦窗口；否则 Chrome 可能把链接放到
    // 另一个最近使用的窗口，X 话题尤其容易表现成“打开错 tab”。
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const windowId = tabs?.[0]?.windowId
      chrome.tabs.create(windowId ? { url: target, active: true, windowId } : { url: target, active: true }, () => {
        if (chrome.runtime.lastError) {
          void sendRuntime({ type: 'POPUP_OPEN_URL', url: target })
        }
      })
    })
    return
  }
  void sendRuntime({ type: 'POPUP_OPEN_URL', url: target })
}

/**
 * 打开 macOS「系统设置 › 通知」，并尽量定位到 Google Chrome。
 * 注意：Owlivo 走的是 Chrome，不是 ego lite；站点通知页也不能代替这项设置。
 */
export function openNotificationSettings(): void {
  const macUrls = [
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.google.Chrome',
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    'x-apple.systempreferences:com.apple.preference.notifications',
  ]
  // 必须用用户手势触发系统协议；走 tabs.create 常被拦，还会误落到 Chrome 网站通知页。
  if (typeof document !== 'undefined') {
    for (const url of macUrls) {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      break
    }
    return
  }
  if (typeof window !== 'undefined') {
    window.open(macUrls[0], '_blank', 'noopener,noreferrer')
  }
}
