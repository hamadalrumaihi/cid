'use client'

/** Route helpers over the two-tier nav model. The vanilla router used
 *  `#<tab>` hashes + Store('tab'); here each leaf tab is a real path
 *  (`/cases`, `/penal`, …) and Store('tab') is still written so the last
 *  tab survives cutover in both directions. */
import { usePathname, useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { CAT_DEFAULT, TAB_CATEGORY, isValidTab } from '@/lib/nav'

export function useNav() {
  const pathname = usePathname()
  const router = useRouter()

  // First path segment is the tab id ('/cases/…' → 'cases'); default 'command'.
  const seg = pathname.split('/')[1] || 'command'
  const activeTab = isValidTab(seg) ? seg : 'command'
  // TAB_CATEGORY now covers every PAGE_META tab; null means "belongs to no
  // category" (profile/owner/command-center/concern/siu/feedback) — no strip
  // highlight, Subtabs suppressed. The 'command' fallback only guards a tab
  // somehow missing from the map entirely. (Feedback keeps its explicit
  // special case — it predates the null entries and must never regress.)
  const activeCategory: string | null =
    activeTab === 'feedback' ? null : (TAB_CATEGORY[activeTab] !== undefined ? TAB_CATEGORY[activeTab] : 'command')

  const navigate = useCallback(
    (tab: string) => {
      const target = isValidTab(tab) ? tab : 'command'
      // Store('tab') persistence happens in AppShell's route-change effect so
      // direct loads and back/forward persist too — not just clicks.
      router.push(`/${target}`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [router],
  )

  const navigateCategory = useCallback(
    (cat: string) => navigate(CAT_DEFAULT[cat] ?? 'command'),
    [navigate],
  )

  return { activeTab, activeCategory, navigate, navigateCategory }
}
