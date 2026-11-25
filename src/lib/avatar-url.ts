/** 头像 URL 规范化：沿用已有公开字段，统一 https，不做猜测拼装 */

/** 扩展包内静态资源（演示 fixture / 图标），勿拼到 xavatar */
export function isPackagedAssetPath(path: string): boolean {
  return /^(?:\.\.?\/|\/)?(?:fixtures|icons)\//i.test(String(path || '').trim())
}

export function normalizeAvatarCandidates(rawUrl: string, platform: string): string[] {
  let base = String(rawUrl || '').trim().replace(/^["']+|["']+$/g, '')
  if (!base) return []
  if (/^data:/i.test(base) || /^blob:/i.test(base)) return [base.slice(0, 2000)]
  // 仅明确的包内路径（fixtures/icons，可带前导 /），勿把雪球相对头像当成本地资源
  if (isPackagedAssetPath(base)) {
    // 统一成根路径，便于 popup.html 与扩展页解析
    const normalized = base.replace(/^(?:\.\.?\/)+/, '').replace(/^\//, '')
    return [('/' + normalized).slice(0, 500)]
  }
  // 雪球历史脏数据：逗号拼接多档路径整串存进 avatar，显示前拆成单条
  if (platform === 'xueqiu' && base.includes(',')) {
    const parts = base
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const sized = parts.find((part) => /!\d+x\d+\.[a-z0-9]+$/i.test(part))
    const picked = sized || parts[0] || ''
    const hostPart = parts.find((part) => /^(?:https?:)?\/\//i.test(part))
    let host = 'https://xavatar.imedao.com'
    if (hostPart) {
      try {
        const abs = hostPart.indexOf('//') === 0 ? 'https:' + hostPart : hostPart.replace(/^http:\/\//i, 'https://')
        host = new URL(abs).origin
      } catch {
        host = 'https://xavatar.imedao.com'
      }
    }
    if (/^(?:https?:)?\/\//i.test(picked)) base = picked
    else base = host + (picked.indexOf('/') === 0 ? picked : '/' + picked)
  }
  if (base.indexOf('//') === 0) base = 'https:' + base
  else if (/^http:\/\//i.test(base)) base = 'https://' + base.slice(7)
  else if (!/^https:\/\//i.test(base)) {
    if (platform === 'xueqiu') {
      base = 'https://xavatar.imedao.com' + (base.indexOf('/') === 0 ? base : '/' + base)
    } else {
      return []
    }
  }
  if (!/^https:\/\//i.test(base)) return []
  const list = [base.slice(0, 500)]
  if (platform === 'x') {
    const sizes = ['_normal', '_bigger', '_400x400']
    for (const size of sizes) {
      if (base.includes(size)) {
        for (const alt of sizes) {
          if (alt !== size) list.push(base.replace(size, alt).slice(0, 500))
        }
        break
      }
    }
  }
  return Array.from(new Set(list)).slice(0, 4)
}

export function pickAvatarSrc(rawUrl: string | undefined, platform: string): string {
  return normalizeAvatarCandidates(rawUrl || '', platform)[0] || ''
}
