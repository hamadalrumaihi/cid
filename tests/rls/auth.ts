import type { SupabaseClient } from '@supabase/supabase-js'

/** Password sign-in with backoff. The combined RLS suites authenticate ~20
 *  fixture accounts per run, which can trip GoTrue's per-IP burst limit —
 *  a limited retry keeps the suites deterministic without weakening any
 *  assertion (a real credential failure still throws after the retries). */
export async function signInWithRetry(
  client: SupabaseClient, email: string, password: string, tries = 4,
): Promise<string> {
  let lastMsg = ''
  for (let i = 0; i < tries; i++) {
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (!error) return data.user!.id
    lastMsg = error.message || JSON.stringify(error)
    // Real credential problems never self-heal — fail fast.
    if (/invalid login credentials/i.test(lastMsg)) break
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
  }
  throw new Error(`sign-in failed for ${email}: ${lastMsg}`)
}
