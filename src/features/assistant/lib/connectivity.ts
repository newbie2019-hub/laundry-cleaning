const CACHE_TTL_MS = 15_000
const PROBE_URL = 'https://www.google.com/favicon.ico'
const PROBE_TIMEOUT_MS = 4_000

type CacheEntry = { online: boolean; at: number }
let cache: CacheEntry | null = null

async function probe(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    await fetch(PROBE_URL, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
    clearTimeout(timeout)
    return true
  } catch {
    return false
  }
}

export async function checkOnline(): Promise<boolean> {
  if (!navigator.onLine) return false

  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.online

  const online = await probe()
  cache = { online, at: Date.now() }
  return online
}

/** Synchronous quick check using only navigator.onLine (no network round-trip). */
export function isLikelyOnline(): boolean {
  return navigator.onLine
}

/** Invalidate the cache so the next call re-probes. */
export function invalidateOnlineCache(): void {
  cache = null
}
