'use client'

/** Live directory counts — RLS-scoped HEAD counts through the shared db
 *  layer, so every number is "rows THIS viewer can see". Loaded lazily when
 *  the directory is visible; a failed count simply shows nothing (never a
 *  cached or invented number). Registry tools count totals; BOLO counts the
 *  live board (persons flagged bolo) and Intelligence counts the open review
 *  queue (OPEN_STATUSES). Analysis/archive tools have no cheap headline
 *  number, so they deliberately show none. */
import { useEffect, useState } from 'react'
import { countRows, list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { OPEN_STATUSES } from '@/lib/fieldReview'
import type { ToolId } from '@/lib/toolsModel'

export const COUNTED_TOOLS: readonly ToolId[] = [
  'persons', 'gangs', 'places', 'vehicles', 'accounts', 'indicators', 'bolo', 'field-review',
]

export interface ToolCounts {
  /** tool id → count. Absent while loading, absent forever on error. */
  counts: Partial<Record<ToolId, number>>
  loading: boolean
}

export function useToolCounts(enabled: boolean): ToolCounts {
  const { state } = useAuth()
  const [counts, setCounts] = useState<Partial<Record<ToolId, number>>>({})
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  useEffect(() => {
    if (!enabled || state !== 'in' || loadedOnce) return
    let cancelled = false
    // Deferred (the useNavBadges idiom) so no setState runs synchronously
    // inside the effect body.
    const timer = window.setTimeout(() => {
      setLoading(true)
      const put = (tool: ToolId, n: number) => {
        if (!cancelled) setCounts((c) => ({ ...c, [tool]: n }))
      }
      const jobs: Promise<void>[] = [
        countRows('persons').then((n) => put('persons', n)),
        countRows('gangs').then((n) => put('gangs', n)),
        countRows('places').then((n) => put('places', n)),
        countRows('vehicles').then((n) => put('vehicles', n)),
        countRows('accounts').then((n) => put('accounts', n)),
        countRows('indicators').then((n) => put('indicators', n)),
        // Live BOLOs — the board is persons flagged bolo=true (BoloView's query).
        countRows('persons', { eq: { bolo: true } }).then((n) => put('bolo', n)),
        // Open review queue (new / reviewing / needs_info), ids only.
        list('field_submissions', { select: 'id', in: { status: OPEN_STATUSES } })
          .then((rows) => put('field-review', rows.length)),
      ]
      void Promise.allSettled(jobs).then(() => {
        if (!cancelled) { setLoading(false); setLoadedOnce(true) }
      })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [enabled, state, loadedOnce])

  return { counts, loading }
}
