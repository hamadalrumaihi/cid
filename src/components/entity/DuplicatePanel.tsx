'use client'

/** DuplicatePanel — what `entity_duplicates` (or a mapped claim match) found
 *  for a record that is about to be created. Strong matches are a warning
 *  block whose primary action is **Use existing** (EA10: the default is to
 *  reuse); soft matches are a quiet list. Nothing here blocks anything (EA1)
 *  — the caller keeps its own "create anyway" path. */
import { RecordPeekButton } from '@/components/shared/RecordPeekButton'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { DuplicateRow, SuggestKind } from '@/lib/entity'
import type { PreviewType } from '@/lib/entityPreview'
import { signalLabel } from './labels'

const PEEK_TYPE: Partial<Record<SuggestKind, PreviewType>> = {
  person: 'person', vehicle: 'vehicle', gang: 'gang', place: 'place',
  narcotic: 'narcotic', case: 'case', account: 'account',
}

export interface DuplicatePanelProps {
  rows: DuplicateRow[]
  /** Enables the quick-preview button on rows RecordPeek can show. */
  kind?: SuggestKind
  onUseExisting: (row: DuplicateRow) => void
  onCompare?: (row: DuplicateRow) => void
  /** Rendered only when given — the caller decides whether merging is on offer here. */
  onMerge?: (row: DuplicateRow) => void
  busy?: boolean
  className?: string
}

export function DuplicatePanel({ rows, kind, onUseExisting, onCompare, onMerge, busy, className = '' }: DuplicatePanelProps) {
  const strong = rows.filter((r) => r.strength === 'strong')
  const soft = rows.filter((r) => r.strength !== 'strong')
  if (!rows.length) return null
  const peekType = kind ? PEEK_TYPE[kind] : undefined

  const actions = (r: DuplicateRow, primary: boolean) => (
    <span className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
      <Button size="sm" variant={primary ? 'primary' : 'secondary'} disabled={busy} onClick={() => onUseExisting(r)}>
        Use existing
      </Button>
      {onCompare && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCompare(r)}>Compare</Button>}
      {onMerge && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMerge(r)}>Merge</Button>}
      {peekType && <RecordPeekButton type={peekType} id={r.id} label={r.label} />}
    </span>
  )

  const row = (r: DuplicateRow, primary: boolean) => (
    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-200">
        <span className="min-w-0 truncate font-medium text-white">{r.label}</span>
        {r.sublabel && <span className="text-xs text-slate-400">{r.sublabel}</span>}
        <Badge tone={primary ? 'warn' : 'neutral'}>{signalLabel(r.signal)}</Badge>
      </span>
      {actions(r, primary)}
    </li>
  )

  return (
    <div className={`space-y-2 ${className}`}>
      {strong.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <p className="text-xs font-semibold text-amber-200">
            {strong.length === 1 ? 'This record may already exist' : `${strong.length} records look like this one`}
          </p>
          <p className="mt-0.5 text-xs text-slate-300">
            Use the existing record unless you are sure this is a different one — two profiles for one subject split the intelligence between them.
          </p>
          <ul className="mt-1 divide-y divide-white/5">{strong.map((r) => row(r, true))}</ul>
        </div>
      )}
      {soft.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2">
          <p className="text-xs font-medium text-slate-400">Similar records</p>
          <ul className="mt-1 divide-y divide-white/5">{soft.map((r) => row(r, false))}</ul>
        </div>
      )}
    </div>
  )
}
