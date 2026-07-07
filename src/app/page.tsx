'use client'

/** Root redirect shim. Preserves vanilla deep links across cutover:
 *    #case=<id>  → /cases?case=<id>   (case detail — contract for the Cases slice)
 *    #reports    → /cases             (legacy leaf, vanilla folds it into cases)
 *    #<tab>      → /<tab>
 *  otherwise the last-used tab from the shared Store blob (vanilla
 *  Store('tab')), defaulting to /command like the vanilla router.
 *
 *  Auth-callback safety: if Supabase lands an OAuth/magic-link response on '/'
 *  (hash tokens or ?code=), do NOT strip it — let supabase-js consume it via
 *  detectSessionInUrl, then redirect once the session settles. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isValidTab } from '@/lib/nav'
import { Store } from '@/lib/store'
import { isConfigured, supabase } from '@/lib/supabase'

function savedTarget(): string {
  const saved = Store.get<string>('tab', 'command')
  return saved === 'reports' ? 'cases' : isValidTab(saved) ? saved : 'command'
}

const hasAuthParams = () =>
  /(?:access_token|refresh_token|error_description|error_code)=/.test(window.location.hash) ||
  new URLSearchParams(window.location.search).has('code')

export default function RootRedirect() {
  const router = useRouter()

  useEffect(() => {
    if (isConfigured && hasAuthParams()) {
      // Instantiating the client triggers detectSessionInUrl; redirect only
      // after it has consumed the tokens (INITIAL_SESSION / SIGNED_IN).
      const { data: sub } = supabase().auth.onAuthStateChange((event) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          sub.subscription.unsubscribe()
          router.replace(`/${savedTarget()}`)
        }
      })
      return () => sub.subscription.unsubscribe()
    }

    const hash = window.location.hash.replace(/^#/, '')
    const caseLink = hash.match(/^case=(.+)$/)
    if (caseLink) { router.replace(`/cases?case=${encodeURIComponent(caseLink[1])}`); return }
    if (hash === 'reports') { router.replace('/cases'); return }
    if (hash && isValidTab(hash)) { router.replace(`/${hash}`); return }
    router.replace(`/${savedTarget()}`)
  }, [router])

  // Rendered for at most a frame on plain loads; visible only while an
  // OAuth/magic-link callback is being consumed. Matches the gate boot copy.
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <p className="text-sm text-slate-400">Initializing secure session…</p>
    </div>
  )
}
