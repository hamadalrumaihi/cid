'use client'

/** Client redirect shim for the retired non-tool routes (`/action`,
 *  `/command`, `/undergrnd`). The route stays prerendered
 *  (LEGACY_REDIRECT_TABS) so every bookmark, notification deep link and case
 *  cross-link still resolves; the query string is carried over untouched
 *  (`/action?preset=command` → `/inbox?preset=command`), the ToolTabRedirect
 *  idiom for the tool routes. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'

export function LegacyRedirect({ to }: { to: string }) {
  const router = useRouter()

  useEffect(() => {
    const q = window.location.search
    router.replace(q ? `${to}${q}` : to)
  }, [router, to])

  // The retired id carries no PAGE_META — show the destination's for the
  // frame the redirect takes. A nested destination (`/guides/undergrnd`)
  // borrows its first segment's metadata, which is the section being entered.
  return <ViewPlaceholder tab={to.replace(/^\//, '').split('?')[0].split('/')[0]} />
}
