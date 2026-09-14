'use client'

/** The one-line origin of a registry record, rendered the same way on every
 *  dossier: who recorded it, when, and when it last changed.
 *
 *  It resolves the author against the roster ITSELF rather than through
 *  `officerName`, because that helper answers "Officer" for an id it cannot
 *  place — a sensible fallback in a table cell, and the wrong one here, where
 *  "Added by Officer" reads as a fact about a person. An id the roster cannot
 *  name gets the date and a tooltip saying why, which is the truth.
 *
 *  Subscribed to the roster store, so a dossier opened before the roster
 *  finished loading fills the name in rather than keeping the anonymous line
 *  until the next navigation. */
import { useProfilesStore } from '@/lib/profiles'
import { recordProvenance, type ProvenanceRecord } from '@/lib/recordProvenance'

export interface RecordProvenanceProps {
  record: ProvenanceRecord
  /** Extra facts the dossier wants on the same line — a lead detective, say.
   *  Rendered after the origin, never blended into it: a lead is an
   *  assignment and authorship is a fact, and the line keeps them apart. */
  children?: React.ReactNode
  className?: string
}

export function RecordProvenance({ record, children, className = '' }: RecordProvenanceProps) {
  const profiles = useProfilesStore((s) => s.profiles)
  const p = recordProvenance(record, (id) => profiles.find((x) => x.id === id)?.display_name ?? null)
  if (!p.added && !p.updated && !children) return null
  return (
    <p className={`text-[11px] text-slate-500 ${className}`}>
      {p.added && (
        <span title={p.authorUnknown ? 'Recorded by a member the roster cannot name — they may have left the division.' : undefined}>
          {p.added}
        </span>
      )}
      {p.added && p.updated && ' · '}
      {p.updated}
      {children != null && ((p.added || p.updated) ? <> · {children}</> : children)}
    </p>
  )
}
