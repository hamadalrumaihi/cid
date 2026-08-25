'use client'

/** Non-blocking duplicate hint for the create modals (Person / Gang /
 *  Vehicle). Renders an amber inline notice under the name/plate field
 *  listing up to 3 existing similar records, each openable via RecordPeek —
 *  it NEVER blocks saving (the reviewer decides). */
import { RecordPeekButton } from './RecordPeekButton'
import type { PreviewType } from '@/lib/entityPreview'

export interface DuplicateMatch {
  type: PreviewType
  id: string
  label: string
  sublabel?: string
}

export function DuplicateMatchNotice({ matches }: { matches: DuplicateMatch[] }) {
  if (!matches.length) return null
  return (
    <div className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2" role="status">
      <p className="text-xs font-semibold text-amber-200">
        Possible existing record — open before creating a duplicate.
      </p>
      <ul className="mt-1 space-y-0.5">
        {matches.slice(0, 3).map((m) => (
          <li key={`${m.type}-${m.id}`} className="flex items-center gap-1.5 text-xs text-slate-200">
            <span className="min-w-0 truncate">
              {m.label}
              {m.sublabel ? <span className="text-slate-400"> · {m.sublabel}</span> : null}
            </span>
            <RecordPeekButton type={m.type} id={m.id} label={m.label} />
          </li>
        ))}
      </ul>
    </div>
  )
}
