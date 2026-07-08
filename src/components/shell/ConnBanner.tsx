'use client'

/** Connection watch — port of vanilla setupConnectionWatch (core.js:1055-1064):
 *  a persistent "offline — reconnecting" pill so a dropped connection reads as
 *  a known state, plus a "Back online" toast on recovery. Connectivity is an
 *  external store, so it's read via useSyncExternalStore (SSR snapshot: online). */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { toast } from '@/lib/toast'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function ConnBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  const prev = useRef(online)

  useEffect(() => {
    if (!prev.current && online) toast('Back online', 'success')
    prev.current = online
  }, [online])

  if (online) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 shadow-glow backdrop-blur">
      ⚠ Offline — reconnecting…
    </div>
  )
}
