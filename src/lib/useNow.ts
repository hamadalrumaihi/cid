'use client'

/** A render-stable "now" timestamp. Reading `Date.now()` directly in a
 *  component body trips the react-hooks/purity rule (impure call during
 *  render); this captures it once at mount via a module-level initializer so
 *  staleness/age calculations have a stable reference for the component's life.
 *  Good enough for dossier-style screens — remount (or refetch) to re-read. */
import { useState } from 'react'

const nowMs = (): number => Date.now()

export function useNow(): number {
  const [n] = useState(nowMs)
  return n
}
