'use client'

/** A deep-link chip to another record, using the app's canonical query-param
 *  navigation (there are no `/persons/[id]`-style routes — every record opens
 *  via `?person=`/`?vehicle=`/`?case=` on its tab, or `?q=` seeding for gangs).
 *  Centralising the href shapes here keeps cross-record navigation consistent
 *  and prevents each view from re-deriving them. Visibility is still enforced
 *  by RLS server-side; a link the caller can't access resolves to nothing on
 *  the far side, never a leak. */
import { useRouter } from 'next/navigation'
import { caseLink } from '@/lib/caseLinks'

export type EntityKind = 'person' | 'vehicle' | 'case' | 'gang' | 'place'

/** Build the deep-link href for a record. `label` is used for gangs (which key
 *  off `?q=`), `id` for the id-addressed tabs. */
export function entityHref(kind: EntityKind, ref: { id?: string; label?: string }): string {
  const enc = encodeURIComponent
  switch (kind) {
    case 'person': return `/persons?person=${enc(ref.id ?? '')}`
    case 'vehicle': return `/vehicles?vehicle=${enc(ref.id ?? '')}`
    case 'case': return caseLink(ref.id ?? '')
    case 'gang': return `/gangs?q=${enc(ref.label ?? ref.id ?? '')}`
    case 'place': return `/places?q=${enc(ref.label ?? '')}`
  }
}

const ICON: Record<EntityKind, string> = {
  person: '👤', vehicle: '🚗', case: '📁', gang: '🚩', place: '📍',
}

export function EntityLink({
  kind,
  id,
  label,
  className = '',
  title,
}: {
  kind: EntityKind
  id?: string
  label: string
  className?: string
  title?: string
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(entityHref(kind, { id, label }))}
      title={title ?? `Open ${label}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-blue-200 transition hover:bg-white/10 ${className}`}
    >
      <span aria-hidden className="flex-shrink-0">{ICON[kind]}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
