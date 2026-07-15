'use client'

/** Small intel-provenance chips shared across the dossier: how reliable a
 *  claim is (confidence), how an association is known (provenance/source), and
 *  whether the intelligence is overdue for review (stale). The repo had no
 *  confidence/source/verified badge — only a case-specific StaleBadge — so
 *  these fill the gap while reusing the central `lib/tint` colour vocabulary
 *  and the `.t-readout` hardware-readout idiom. Colour is never the only
 *  signal: every chip carries text and a title. */
import { Badge } from './Badge'
import { confidenceTint, provenanceTint } from '@/lib/tint'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** confirmed / probable / possible / unverified / disproven. */
export function ConfidenceBadge({ confidence, className = '' }: { confidence?: string | null; className?: string }) {
  const c = (confidence ?? 'unverified').toLowerCase()
  return (
    <Badge tint={confidenceTint(c)} className={className} title={`Intelligence confidence: ${cap(c)}`}>
      {cap(c)}
    </Badge>
  )
}

/** imported / reported / manually_confirmed / inferred / historical / disputed —
 *  how a relationship is known. Keeps inferred links visibly distinct from
 *  confirmed fact. */
export function ProvenanceBadge({ provenance, className = '' }: { provenance?: string | null; className?: string }) {
  if (!provenance) return null
  const p = provenance.toLowerCase()
  const label = cap(p.replace(/_/g, ' '))
  return (
    <Badge tint={provenanceTint(p)} className={className} title={`Source of this link: ${label}`}>
      {label}
    </Badge>
  )
}

/** Days-since-review staleness. `reviewedAt` null → an "unreviewed" chip;
 *  older than `thresholdDays` → an "N D STALE" readout; fresh → nothing.
 *  `now` is injectable so this is deterministic in tests. */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / 86_400_000)
}

// Module-scope so the impure read isn't "during render" (react-hooks/purity).
const resolveNow = (now?: number): number => now ?? Date.now()

export function StaleIntelBadge({
  reviewedAt,
  thresholdDays = 90,
  now,
  className = '',
}: {
  reviewedAt: string | null | undefined
  thresholdDays?: number
  now?: number
  className?: string
}) {
  const ref = resolveNow(now)
  const d = daysSince(reviewedAt, ref)
  if (d === null) {
    return (
      <span className={`t-readout inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-300 ${className}`} title="This intelligence has never been marked reviewed">
        <span className="t-dot" /> UNREVIEWED
      </span>
    )
  }
  if (d < thresholdDays) return null
  return (
    <span className={`t-readout inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ${className}`} title={`Not reviewed in ${d} days (threshold ${thresholdDays})`}>
      <span className="t-dot t-dot-amber pulse-dot" /> {d}D STALE
    </span>
  )
}
