'use client'

/** Structured revision checklist (P4-06, decision L11). A return now
 *  carries rows in `legal_request_revision_items` (a field label + a note)
 *  beside the free-text return note; the creator works through them and
 *  marks each resolved (`legal_revision_resolve`, creator while editable)
 *  before resubmitting with a change summary. Everyone else sees the same
 *  list read-only, so a reviewer can check what was asked and what was
 *  answered. */
import type { Tables } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import { humanize } from '@/lib/legalWorkflow'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { readJsonRpc } from './rpcJson'

export type RevisionItem = Tables<'legal_request_revision_items'>
type NameFn = (id: string | null | undefined) => string

export const fieldLabel = (f: string | null): string => (f ? humanize(f) : 'General')

export function RevisionChecklist({ items, canResolve, busy, name, returnNote, onChanged, className = '' }: {
  items: RevisionItem[]
  /** The creator on an editable draft. */
  canResolve: boolean
  busy: boolean
  name: NameFn
  /** The newest return's public note, shown above the rows. */
  returnNote?: { by: string | null; at: string; note: string | null } | null
  onChanged: () => void
  className?: string
}) {
  const open = items.filter((i) => !i.resolved_at)
  const done = items.filter((i) => !!i.resolved_at)
  if (items.length === 0 && !returnNote) return null

  const resolve = async (item: RevisionItem) => {
    const note = await uiPrompt(`Mark "${fieldLabel(item.field)}" resolved — what changed? (optional)`, { title: 'Resolve revision item', confirmText: 'Mark resolved' })
    if (note === null) return
    const res = readJsonRpc(await rpc('legal_revision_resolve', { p_item: item.id, ...(note.trim() ? { p_note: note.trim() } : {}) }))
    if (!res.ok) { toast(res.message ?? 'Refused.', 'danger'); return }
    toast('Revision item resolved.', 'success')
    onChanged()
  }

  return (
    <Card pad="sm" className={`border-amber-500/20 ${className}`}>
      <h3 className="text-[13px] font-semibold text-amber-300">
        Requested revisions
        {open.length > 0 && (
          <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-200">{open.length} open</span>
        )}
      </h3>
      {returnNote && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-amber-100">
          {returnNote.note || 'No return note was recorded.'}
          <span className="ml-2 text-xs text-amber-200/80">{name(returnNote.by)} · {fmtDateTime(returnNote.at)}</span>
        </p>
      )}
      {open.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Unresolved revision items">
          {open.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">{fieldLabel(i.field)}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-slate-200">{i.note}</span>
              {canResolve && <Button size="sm" disabled={busy} onClick={() => void resolve(i)}>Mark resolved</Button>}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer rounded text-xs font-semibold text-slate-400 hover:text-white">
            Resolved ({done.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {done.map((i) => (
              <li key={i.id} className="text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{fieldLabel(i.field)}</span> — {i.note}
                <span className="ml-1">· resolved by {name(i.resolved_by)} {i.resolved_at ? fmtDateTime(i.resolved_at) : ''}</span>
                {i.resolution_note && <span className="block whitespace-pre-wrap text-slate-300">{i.resolution_note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
