const OPTS = { sourceLanguage: 'en', targetLanguage: 'zh' } as const
const MAX_CHUNK = 1200
const cache = new Map<string, string>()

type TranslatorLike = {
  translate: (text: string) => Promise<string>
}

type TranslatorCtor = {
  availability: (opts: typeof OPTS) => Promise<string>
  create: (opts: typeof OPTS & { monitor?: (m: { addEventListener: Function }) => void }) => Promise<TranslatorLike>
}

function getTranslatorApi(): TranslatorCtor | null {
  const g = globalThis as { Translator?: TranslatorCtor }
  return g.Translator || null
}

function cacheKey(text: string) {
  return String(text || '').trim()
}

export function looksEnglish(text: string): boolean {
  const s = cacheKey(text)
  if (s.length < 6) return false
  const latin = (s.match(/[A-Za-z]/g) || []).length
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length
  if (cjk > 0 && cjk >= latin * 0.35) return false
  return latin >= 8
}

export function getCached(text: string): string {
  return cache.get(cacheKey(text)) || ''
}

let translator: TranslatorLike | null = null
let translatorAttempt: Promise<TranslatorLike | null> | null = null
let availability = ''

async function ensureTranslator(): Promise<TranslatorLike | null> {
  const Translator = getTranslatorApi()
  if (!Translator) return null
  if (translator) return translator
  if (translatorAttempt) return translatorAttempt
  translatorAttempt = (async () => {
    try {
      availability = await Translator.availability(OPTS)
      if (availability === 'unavailable') return null
      translator = await Translator.create({
        ...OPTS,
        monitor(m) {
          m.addEventListener('downloadprogress', () => {})
        },
      })
      return translator
    } catch {
      return null
    } finally {
      translatorAttempt = null
    }
  })()
  return translatorAttempt
}

async function translateChunk(tr: TranslatorLike, piece: string): Promise<string> {
  const raw = String(piece || '').trim()
  if (!raw) return ''
  if (raw.length <= MAX_CHUNK) return tr.translate(raw)
  let out = ''
  let start = 0
  while (start < raw.length) {
    let end = Math.min(start + MAX_CHUNK, raw.length)
    if (end < raw.length) {
      const slice = raw.slice(start, end)
      const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '))
      if (breakAt > MAX_CHUNK * 0.4) end = start + breakAt + 1
    }
    out += (out ? '\n' : '') + (await tr.translate(raw.slice(start, end).trim()))
    start = end
  }
  return out
}

export async function translateText(text: string): Promise<string | null> {
  const raw = cacheKey(text)
  if (!raw) return null
  if (cache.has(raw)) return cache.get(raw) || null
  if (!looksEnglish(raw)) return null
  const tr = await ensureTranslator()
  if (!tr) return null
  try {
    const paragraphs = raw.split(/\n\n+/)
    const parts: string[] = []
    for (const para of paragraphs) parts.push(await translateChunk(tr, para))
    const zh = parts.join('\n\n').trim()
    if (zh) cache.set(raw, zh)
    return zh || null
  } catch {
    return null
  }
}

export function isSupported(): boolean {
  return !!getTranslatorApi()
}

export async function preload(): Promise<TranslatorLike | null> {
  return ensureTranslator()
}

export function getAvailability(): string {
  return availability
}
