'use client'

/** Root redirect shim. Preserves vanilla deep links across cutover:
 *    #case=<id>  → /cases?case=<id>   (case detail — contract for the Cases slice)
 *    #reports    → /cases             (legacy leaf, vanilla folds it into cases)
 *    #<tab>      → /<tab>
 *  otherwise the last-used tab from the shared Store blob (vanilla
 *  Store('tab')), defaulting to /command like the vanilla router. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isValidTab } from '@/lib/nav'
import { Store } from '@/lib/store'

export default function RootRedirect() {
  const router = useRouter()
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const caseLink = hash.match(/^case=(.+)$/)
    if (caseLink) { router.replace(`/cases?case=${encodeURIComponent(caseLink[1])}`); return }
    if (hash === 'reports') { router.replace('/cases'); return }
    if (hash && isValidTab(hash)) { router.replace(`/${hash}`); return }
    const saved = Store.get<string>('tab', 'command')
    const target = saved === 'reports' ? 'cases' : isValidTab(saved) ? saved : 'command'
    router.replace(`/${target}`)
  }, [router])
  return null
}
