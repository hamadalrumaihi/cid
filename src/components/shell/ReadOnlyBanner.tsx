'use client'

/** Read-only mode indicator — the persistent pill the connection watch uses
 *  for "offline", in the same place, because it means the same kind of thing:
 *  the portal is in a known, temporary state. The mode is read from the
 *  proxy's cookie through useSyncExternalStore with a server snapshot of
 *  "not read-only", so the server markup and the hydration render agree. */
import { useSyncExternalStore } from 'react'
import { clientPortalMode, READONLY_MESSAGE } from '@/lib/portalMode'

// The cookie is an external store that changes only with a new response, so
// there is nothing to subscribe to; the server snapshot is "normal" (see the
// module header) and the client snapshot is the cookie.
const noop = () => () => {}

export function ReadOnlyBanner() {
  const on = useSyncExternalStore(noop, () => clientPortalMode() === 'readonly', () => false)
  if (!on) return null
  return (
    <div
      role="status"
      title={READONLY_MESSAGE}
      className="fixed bottom-[calc(var(--bottom-nav-h,0rem)+1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-banner flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 shadow-pop backdrop-blur"
    >
      <span className="t-dot t-dot-amber" aria-hidden="true" />
      <span className="whitespace-nowrap">Read-only mode</span>
      <span className="hidden text-amber-200/70 sm:inline">· viewing only — changes are disabled</span>
    </div>
  )
}
