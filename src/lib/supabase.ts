import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Publishable (anon) key only — public by design; RLS is the security boundary.
// NEVER put a service_role key anywhere in this app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** False when env is missing/placeholder → the auth gate shows its "setup"
 *  state instead of crashing (vanilla CIDDB.ready contract). */
export const isConfigured = !!(url && anonKey && !/PASTE_/.test(anonKey))

let client: SupabaseClient<Database> | null = null

export function supabase(): SupabaseClient<Database> {
  if (!client) {
    if (!isConfigured) throw new Error('Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)')
    client = createClient<Database>(url!, anonKey!, {
      // Same explicit auth options as the vanilla client (supabase.js:10-12):
      // persisted session, auto refresh, and URL detection so both OAuth
      // redirects and magic links complete.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return client
}
