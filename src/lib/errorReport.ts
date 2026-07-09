'use client'

/** In-app error tracking: uncaught exceptions and unhandled rejections are
 *  reported to the `client_errors` table (insert-only for members; the Owner
 *  Portal reads them and owners get a throttled bell notification via a DB
 *  trigger). Reporting must never make things worse, so everything here is
 *  fire-and-forget, deduplicated, and capped per session. */
import { isConfigured, supabase } from './supabase'

const seen = new Set<string>()
let sent = 0
const MAX_PER_SESSION = 5

/** Noise that isn't actionable — never report these. */
const IGNORE = [
  /ResizeObserver loop/i,
  /Loading chunk .* failed/i, // stale deploy — fixed by the reload the user is about to do
  /AbortError/i,
  /NetworkError|Failed to fetch|Load failed/i, // connectivity, not a code bug
]

function report(message: string, stack?: string): void {
  if (!isConfigured || !message) return
  if (IGNORE.some((re) => re.test(message))) return
  const key = message.slice(0, 200)
  if (seen.has(key) || sent >= MAX_PER_SESSION) return
  seen.add(key)
  sent += 1
  try {
    void supabase()
      .from('client_errors')
      .insert({
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 6000) ?? null,
        route: window.location.pathname + window.location.search,
        user_agent: navigator.userAgent.slice(0, 300),
      })
      .then(() => undefined, () => undefined) // RLS-denied / offline: drop silently
  } catch { /* never throw from the reporter */ }
}

let installed = false

/** Idempotent — called once from the auth provider on mount. */
export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    report(e.message || String(e.error ?? 'Unknown error'), e.error instanceof Error ? e.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    report(r instanceof Error ? r.message : String(r ?? 'Unhandled rejection'), r instanceof Error ? r.stack : undefined)
  })
}
