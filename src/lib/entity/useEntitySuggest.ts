'use client'
/** Debounced `entity_suggest` hook for pickers and the create sheet.
 *  300 ms after the last keystroke, ≥ 2 characters, one in-flight request
 *  at a time (a stale answer never overwrites a newer query). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { suggestEntities, type SuggestRow } from './api'
import type { SuggestKind } from './kinds'

export const SUGGEST_DEBOUNCE_MS = 300

export interface EntitySuggestState {
  hits: SuggestRow[]
  loading: boolean
  /** True once the debounced query ran and returned nothing. */
  empty: boolean
}

type Answer = { key: string; hits: SuggestRow[] }

export function useEntitySuggest(kind: SuggestKind, q: string, opts: { limit?: number; enabled?: boolean; exclude?: ReadonlySet<string> } = {}): EntitySuggestState {
  const { limit = 20, enabled = true, exclude } = opts
  const term = q.trim()
  const active = enabled && term.length >= 2
  const key = `${kind}\u0000${term}\u0000${limit}`
  /** The last answer, keyed by the query it answered: "loading" is simply
   *  "no answer for this key yet", so no state is written inside the effect. */
  const [answer, setAnswer] = useState<Answer | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!active) { seq.current += 1; return }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const rows = await suggestEntities(kind, term, limit)
      if (mine === seq.current) setAnswer({ key, hits: rows })
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [active, kind, term, limit, key])

  return useMemo(() => {
    if (!active) return { hits: [], loading: false, empty: false }
    if (!answer || answer.key !== key) return { hits: [], loading: true, empty: false }
    const hits = exclude ? answer.hits.filter((r) => !exclude.has(r.id)) : answer.hits
    return { hits, loading: false, empty: hits.length === 0 }
  }, [active, answer, key, exclude])
}
