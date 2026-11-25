import type { WeiboHotResponse } from './weibo-hot'
import type { XueqiuHotResponse, XueqiuTopicResponse } from './xueqiu-hot'

export type XHotRequest = { type: 'POPUP_X_HOT'; force?: boolean }
export type XTopicRequest = { type: 'POPUP_X_TOPIC'; word: string; cursor?: string; force?: boolean }
export type { XHotResponse, XTopicResponse } from './x-topic'

export type WeiboTopicRequest = { type: 'POPUP_WEIBO_TOPIC'; word: string; page?: number; force?: boolean }
export type { WeiboTopicResponse } from './weibo-topic'
export type WeiboHotRequest = { type: 'POPUP_WEIBO_HOT'; force?: boolean }
export type XueqiuHotRequest = { type: 'POPUP_XUEQIU_HOT'; force?: boolean }
export type XueqiuTopicRequest = { type: 'POPUP_XUEQIU_TOPIC'; word: string; page?: number; force?: boolean }
export type { XueqiuHotResponse, XueqiuTopicResponse }
export type SquareFeedRequest = { type: 'POPUP_SQUARE_FEED'; feedKey: string }
export type SquareFeedResponse = {
  ok: boolean
  posts: unknown[]
  updatedAt: number
  error?: string
  stale?: boolean
}
export type { WeiboHotResponse }

/** 与 background / content / page-bridge 保持一致的消息类型（勿随意改名） */
export const POPUP_MESSAGES = [
  'POPUP_SESSION',
  'POPUP_PLATFORM_SESSIONS',
  'POPUP_ACCOUNT_REQUEST',
  'POPUP_LOAD_USER',
  'POPUP_REFRESH',
  'POPUP_LOAD_MORE',
  'POPUP_ADD_SOURCE',
  'POPUP_SEARCH_X_USERS',
  'POPUP_SEARCH_USERS',
  'POPUP_X_FOLLOWING',
  'POPUP_WEIBO_FOLLOWING',
  'POPUP_X_HOT',
  'POPUP_X_TOPIC',
  'POPUP_WEIBO_HOT',
  'POPUP_WEIBO_TOPIC',
  'POPUP_XUEQIU_HOT',
  'POPUP_XUEQIU_TOPIC',
  'POPUP_SQUARE_FEED',
  'POPUP_OPEN_WINDOW',
  'POPUP_OPEN_SIDEBAR',
  'POPUP_CLOSE_SIDEBAR',
  'POPUP_OPEN_POPUP',
  'POPUP_OPEN_URL',
  'POPUP_OPEN_XUEQIU',
  'POPUP_OPEN_X_LOGIN',
  'POPUP_RELOAD_TAB',
  'POPUP_NOTIFY_SET',
  'POPUP_NOTIFY_TEST',
] as const

export const BROADCAST_MESSAGES = [
  'SESSION_CHANGED',
  'ACCOUNT_LOADING',
  'ACCOUNT_RESULT',
  'USER_LOADING',
  'USER_TIMELINE_RESULT',
  'TIMELINE_UPDATED',
] as const

export const FORWARDED_TO_CONTENT = [
  'POPUP_ACCOUNT_REQUEST',
  'POPUP_LOAD_USER',
  'POPUP_REFRESH',
  'POPUP_LOAD_MORE',
] as const

export type PopupMessageType = (typeof POPUP_MESSAGES)[number]
export type BroadcastMessageType = (typeof BROADCAST_MESSAGES)[number]

export type RuntimeResponse = {
  ok?: boolean
  reason?: string
  error?: string
  status?: string
  source?: unknown
  users?: unknown[]
  page?: number
  hasMore?: boolean
  cursor?: string
  count?: number
  windowId?: number
  reused?: boolean
  created?: boolean
  bounds?: unknown
  readable?: boolean
  uid?: string
  hasLoginFlag?: boolean
  hasToken?: boolean
  tabId?: number
  url?: string
  [key: string]: unknown
}
