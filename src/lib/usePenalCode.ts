'use client'

/** usePenalCode — loads the published penal code once and reports readiness.
 *
 *  Every surface that shows statutes needs the same three things: the catalog,
 *  a way to know it has actually arrived, and a way to say so when it has not.
 *  The load itself is single-flight in `ensurePenalCode()`, so mounting five
 *  components that each call this hook still produces one request.
 *
 *  `ready` matters more than it looks. Before the catalog loads,
 *  `penalCatalog()` is empty and `penalByCode()` returns null — which is
 *  indistinguishable, at a glance, from "the penal code is empty" or "that
 *  charge does not exist". A view that renders an empty statute book without
 *  saying it is still loading is telling the user something false, so this
 *  hook makes the distinction available rather than optional.
 */

import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { ensurePenalCode, penalCatalog, penalLoaded, penalVersionName, type PenalCharge } from './penal'

export interface PenalCodeState {
  charges: PenalCharge[]
  /** True once the catalog has arrived. False while loading AND on failure. */
  ready: boolean
  /** Non-null when the first load failed; the catalog is empty in that case. */
  error: string | null
  /** Name of the published version, for a footer or an export header. */
  version: string | null
}

export function usePenalCode(): PenalCodeState {
  const { state } = useAuth()
  const [, bump] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state !== 'in' || penalLoaded()) return
    let live = true
    void ensurePenalCode()
      .then(() => {
        if (!live) return
        // The cache is module-level, so there is nothing to copy into state —
        // this render bump is the whole subscription.
        setError(penalLoaded() ? null : 'The penal code could not be loaded.')
        bump((n) => n + 1)
      })
      .catch((e: unknown) => {
        if (!live) return
        setError(e instanceof Error ? e.message : 'The penal code could not be loaded.')
        bump((n) => n + 1)
      })
    return () => { live = false }
  }, [state])

  return {
    charges: penalCatalog(),
    ready: penalLoaded(),
    error,
    version: penalVersionName(),
  }
}
