/** 原 popup.js X_SUGGESTIONS：空查询默认可点选，非登录用户 Following */
export const X_SUGGESTIONS = [
  { id: 'elonmusk', name: 'Elon Musk' },
  { id: 'OpenAI', name: 'OpenAI' },
  { id: 'thsottiaux', name: 'Tibo · OpenAI' },
  { id: 'sama', name: 'Sam Altman' },
  { id: 'karpathy', name: 'Andrej Karpathy' },
  { id: 'AnthropicAI', name: 'Anthropic' },
  { id: 'GoogleDeepMind', name: 'Google DeepMind' },
  { id: 'naval', name: 'Naval' },
  { id: 'Reuters', name: 'Reuters' },
] as const

export type XSuggestion = { id: string; name: string; avatar?: string; followers?: number; verified?: boolean }

export function buildDefaultXPickerList(subscribed: Array<{ id: string; name?: string; avatar?: string }>): {
  subscribed: XSuggestion[]
  suggestions: XSuggestion[]
} {
  const subKeys = new Set(subscribed.map((s) => String(s.id || '').toLowerCase()))
  const subscribedRows: XSuggestion[] = subscribed.map((s) => ({
    id: String(s.id),
    name: String(s.name || s.id),
    avatar: s.avatar,
  }))
  const suggestions: XSuggestion[] = X_SUGGESTIONS.filter((s) => !subKeys.has(s.id.toLowerCase())).map((s) => ({
    id: s.id,
    name: s.name,
  }))
  return { subscribed: subscribedRows, suggestions }
}

export function filterXSuggestions(users: XSuggestion[], query: string): XSuggestion[] {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '')
  if (!q) return users
  return users.filter(
    (u) => u.id.toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q),
  )
}

/** 本地（已订阅+推荐）优先，再合并远端搜索，按 id 去重 */
export function mergeXSearchResults(
  local: XSuggestion[],
  remote: Array<{ id?: string; name?: string; avatar?: string; followers?: number; verified?: boolean }>,
): XSuggestion[] {
  const seen = new Set<string>()
  const out: XSuggestion[] = []
  for (const row of [...local, ...remote]) {
    const id = String(row.id || '').trim()
    if (!id) continue
    const key = id.toLowerCase()
    const existingIndex = out.findIndex((item) => item.id.toLowerCase() === key)
    if (existingIndex >= 0) {
      // 本地推荐项可能只有昵称；远端搜索结果有完整头像时要补齐元数据。
      const existing = out[existingIndex]
      out[existingIndex] = {
        ...existing,
        name: existing.name === existing.id ? String(row.name || existing.name) : existing.name,
        avatar: existing.avatar || row.avatar,
        followers: existing.followers || row.followers,
        verified: existing.verified || row.verified,
      }
      continue
    }
    seen.add(key)
    out.push({
      id,
      name: String(row.name || id),
      avatar: row.avatar,
      followers: row.followers,
      verified: row.verified,
    })
  }
  return out
}
