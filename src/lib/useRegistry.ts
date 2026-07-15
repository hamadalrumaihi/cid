'use client'

/** useRegistry — the shared skeleton behind every list/registry screen
 *  (Indicators, Vehicles, Persons, Gangs, …). Each of those repeated the same
 *  five moving parts: rows/loading/error state, a sign-in-gated `refresh` that
 *  fetches through `withRetry`, an effect that re-runs on mount and whenever a
 *  watched table's realtime version bumps, and a deferred first load. This
 *  hook owns all of it so a view only supplies its query.
 *
 *  Deliberately NOT included (they vary too much to share): filtering, the
 *  create/edit modal, and delete — views keep those. `refresh` and `setRows`
 *  are returned so a view can re-fetch or optimistically patch. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useAuth } from './auth'
import { useTableVersion } from './realtime'

export interface Registry<T> {
  rows: T[]
  /** True during the FIRST fetch only — the "show a skeleton" signal. */
  loading: boolean
  /** True while re-fetching after rows have already loaded (realtime bump or
   *  manual refresh). Stale rows stay visible — views may show a subtle hint
   *  or ignore this entirely. */
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
  setRows: Dispatch<SetStateAction<T[]>>
}

export function useRegistry<T>(opts: {
  /** Primary realtime table — its version bumps trigger a re-fetch. */
  table: string
  /** The query. Return the rows to display. Throwing sets `error`. */
  load: () => Promise<T[]>
  /** Extra realtime version numbers to also re-fetch on (from the caller's
   *  own useTableVersion calls — hook rules forbid calling it in a loop). */
  watch?: number[]
  /** Gate. Defaults to "signed in"; pass false to hold off fetching. */
  enabled?: boolean
}): Registry<T> {
  const { state } = useAuth()
  const on = opts.enabled ?? state === 'in'
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const v = useTableVersion(opts.table)

  // Keep `load` current without making `refresh` change identity every render
  // (callers pass an inline closure) — otherwise the effect would loop.
  const loadRef = useRef(opts.load)
  useEffect(() => { loadRef.current = opts.load })

  // Stale-while-revalidate: once a load has succeeded, later re-fetches must
  // not blank the screen back to a skeleton — realtime bumps arrive mid-read.
  // A ref (not state) so back-to-back refreshes in one tick see it flip.
  const hasLoaded = useRef(false)

  const refresh = useCallback(async () => {
    if (!on) return
    if (hasLoaded.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setRows(await loadRef.current())
      hasLoaded.current = true
    } catch (e) {
      // Failed refresh: surface the error but keep the stale rows visible.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [on])

  const watchKey = (opts.watch ?? []).join(',')
  useEffect(() => {
    // Deferred so the first paint isn't blocked (matches the prior
    // setTimeout(0)/queueMicrotask pattern across the views).
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v, watchKey])

  return { rows, loading, refreshing, error, refresh, setRows }
}
