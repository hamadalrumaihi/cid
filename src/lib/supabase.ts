import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { clientPortalMode, PORTAL_MODE_HEADER, portalRefusal, portalVerdict } from './portalMode'

// Publishable (anon) key only — public by design; RLS is the security boundary.
// NEVER put a service_role key anywhere in this app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** False when env is missing/placeholder → the auth gate shows its "setup"
 *  state instead of crashing (vanilla CIDDB.ready contract). */
export const isConfigured = !!(url && anonKey && !/PASTE_/.test(anonKey))

let client: SupabaseClient<Database> | null = null

/** The refusal, shaped so every Supabase sub-client reads it cleanly:
 *  postgrest-js takes `message`/`code`/`details`/`hint` from the body,
 *  storage-js takes `message`/`statusCode`, functions-js keeps the Response
 *  (db.ts lifts `message` from it). The caller sees the mode sentence and
 *  nothing else. */
function refusalResponse(mode: 'retired' | 'maintenance' | 'readonly'): Response {
  const r = portalRefusal(mode)
  return new Response(
    JSON.stringify({ ...r, error: r.message, statusCode: '403', details: null, hint: null }),
    { status: 403, headers: { 'content-type': 'application/json', [PORTAL_MODE_HEADER]: mode } },
  )
}

/** Every request supabase-js makes (PostgREST, storage, functions, auth)
 *  passes here. In read-only mode a write is refused before it leaves the
 *  browser; in a blocking mode everything but session management is. The
 *  mode comes from the proxy's cookie, so a page that was open when the
 *  variable changed adopts the new mode on its next navigation or reload.
 *  In normal mode this is a pass-through — nothing changes. */
const guardedFetch: typeof fetch = (input, init) => {
  const mode = clientPortalMode()
  if (mode !== 'normal') {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (portalVerdict(mode, method, target) === 'refuse') return Promise.resolve(refusalResponse(mode))
  }
  return fetch(input, init)
}

export function supabase(): SupabaseClient<Database> {
  if (!client) {
    if (!isConfigured) throw new Error('Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)')
    client = createClient<Database>(url!, anonKey!, {
      // Same explicit auth options as the vanilla client (supabase.js:10-12):
      // persisted session, auto refresh, and URL detection so both OAuth
      // redirects and magic links complete.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: guardedFetch },
    })
  }
  return client
}
