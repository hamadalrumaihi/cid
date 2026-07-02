import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Publishable (anon) key only — public by design; RLS is the security boundary.
// NEVER put a service_role key anywhere in this app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let client: SupabaseClient<Database> | null = null

export function supabase(): SupabaseClient<Database> {
  if (!client) client = createClient<Database>(url, anonKey)
  return client
}
