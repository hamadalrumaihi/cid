'use client'

/** "≥14d quiet" attention badge on case cards (casefiles.js:313-317). */
import { caseStaleDays, isStaleCase, type CaseRow } from './caseUtils'

export function StaleBadge({ c }: { c: CaseRow }) {
  if (!isStaleCase(c)) return null
  const d = caseStaleDays(c)
  return (
    <span
      className="t-readout inline-flex flex-shrink-0 items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
      title={`No updates in ${d} days`}
    >
      <span className="t-dot t-dot-amber" /> {d}D STALE
    </span>
  )
}
