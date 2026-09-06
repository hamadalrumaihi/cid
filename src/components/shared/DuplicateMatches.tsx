'use client'

/** Non-blocking duplicate hint for the create modals (Person / Gang /
 *  Vehicle / Place / Narcotic / Case). Renders an inline notice under the
 *  name/plate field listing up to 3 existing similar records, each openable
 *  via RecordPeek — it NEVER blocks saving (the reviewer decides).
 *
 *  Phase 2 (P2-08): matches come from `entity_duplicates` (findDuplicates).
 *  A STRONG signal (same normalized phone/plate/handle, same name+dob …)
 *  renders as a warning with a "Use existing" affordance — the caller decides
 *  what that means (open the record, adopt its id …). SOFT signals (trigram
 *  near-misses) render as a quieter notice. Neither is a hard block. */
import { Button } from '@/components/ui/Button'
import { RecordPeekButton } from './RecordPeekButton'
import type { DuplicateRow } from '@/lib/entity'
import type { PreviewType } from '@/lib/entityPreview'

export interface DuplicateMatch {
  type: PreviewType
  id: string
  label: string
  sublabel?: string
  /** entity_duplicates strength; absent ⇒ treated as strong (legacy callers). */
  strength?: 'strong' | 'soft'
  /** entity_duplicates signal (phone, plate, name+dob, name~ …) for the hint. */
  signal?: string
}

/** entity_duplicates rows → notice matches (strong first, capped at 3). */
export function duplicateMatches(type: PreviewType, rows: readonly DuplicateRow[]): DuplicateMatch[] {
  return [...rows]
    .sort((a, b) => (a.strength === b.strength ? b.score - a.score : a.strength === 'strong' ? -1 : 1))
    .slice(0, 3)
    .map((r) => ({ type, id: r.id, label: r.label, sublabel: r.sublabel ?? undefined, strength: r.strength, signal: r.signal }))
}

const SIGNAL_TEXT: Record<string, string> = {
  phone: 'same phone', name: 'same name', 'name+dob': 'same name and date of birth', alias: 'same alias',
  plate: 'same plate', handle: 'same handle', value: 'same value', case_number: 'same case number',
  'name+area': 'same name and area', 'name~': 'similar name', 'plate~': 'similar plate',
  'handle~': 'similar handle', 'title~': 'similar title',
}

export function DuplicateMatchNotice({ matches, onUseExisting }: {
  matches: DuplicateMatch[]
  /** Renders a "Use existing" control on strong matches. */
  onUseExisting?: (m: DuplicateMatch) => void
}) {
  if (!matches.length) return null
  const strong = matches.some((m) => m.strength !== 'soft')
  return (
    <div
      className={`mt-1.5 rounded-lg border px-3 py-2 ${strong ? 'border-amber-500/25 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}
      role="status"
    >
      <p className={`text-xs font-semibold ${strong ? 'text-amber-200' : 'text-slate-300'}`}>
        {strong ? 'Likely existing record — open it before creating a duplicate.' : 'Similar records exist — check before creating a new one.'}
      </p>
      <ul className="mt-1 space-y-0.5">
        {matches.slice(0, 3).map((m) => (
          <li key={`${m.type}-${m.id}`} className="flex items-center gap-1.5 text-xs text-slate-200">
            <span className="min-w-0 flex-1 truncate">
              {m.label}
              {m.sublabel ? <span className="text-slate-400"> · {m.sublabel}</span> : null}
              {m.signal && SIGNAL_TEXT[m.signal] ? <span className="text-slate-400"> ({SIGNAL_TEXT[m.signal]})</span> : null}
            </span>
            <RecordPeekButton type={m.type} id={m.id} label={m.label} />
            {onUseExisting && m.strength !== 'soft' && (
              <Button size="sm" variant="ghost" onClick={() => onUseExisting(m)}>Use existing</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
