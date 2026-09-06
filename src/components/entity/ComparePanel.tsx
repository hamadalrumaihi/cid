'use client'

/** ComparePanel — the draft a user is about to save, side by side with an
 *  existing record the duplicate check flagged. The existing row is read
 *  through the viewer's own RLS-scoped `list()` (a record they cannot see
 *  resolves to "not visible", never a leak). Differing fields are highlighted;
 *  the two actions are the two honest outcomes: use the existing record, or
 *  go back to the draft. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { CREATE_FIELDS, MERGE_TABLE, type MergeKind } from '@/lib/entity'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { cellText } from './labels'

export interface ComparePanelProps {
  kind: MergeKind
  recordId: string
  /** Label of the existing record, for the heading. */
  recordLabel?: string
  /** The draft values by column key. */
  draft: Record<string, string>
  /** Columns to compare, in order (default: the kind's create-sheet fields). */
  fields?: readonly { key: string; label: string }[]
  onUseExisting: () => void
  onBack: () => void
}

type Loaded = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; row: Record<string, unknown> }

const norm = (s: string) => s.trim().toLowerCase()

export function ComparePanel({ kind, recordId, recordLabel, draft, fields, onUseExisting, onBack }: ComparePanelProps) {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const cols = fields ?? CREATE_FIELDS[kind]

  useEffect(() => {
    let live = true
    // Every state write happens after an await (the ShiftsView idiom), so the
    // effect body never triggers a synchronous cascading render.
    void (async () => {
      await Promise.resolve()
      if (!live) return
      setState({ status: 'loading' })
      try {
        const rows = await list(MERGE_TABLE[kind], { eq: { id: recordId }, limit: 1 })
        if (!live) return
        const row = rows[0] as Record<string, unknown> | undefined
        setState(row ? { status: 'ready', row } : { status: 'missing' })
      } catch {
        if (live) setState({ status: 'missing' })
      }
    })()
    return () => { live = false }
  }, [kind, recordId])

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">
        Comparing your draft with <span className="font-semibold text-white">{recordLabel ?? 'the existing record'}</span>.
        Rows in amber differ.
      </p>

      {state.status === 'loading' ? (
        <ListSkeleton count={cols.length} />
      ) : state.status === 'missing' ? (
        <Notice text="That record is not visible to you, or no longer exists." />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Draft values compared with the existing record</caption>
          <thead>
            <tr className="text-left text-xs font-semibold text-slate-400">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Field</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Your draft</th>
              <th scope="col" className="py-1.5 font-semibold">Existing record</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {cols.map((c) => {
              const mine = draft[c.key] ?? ''
              const theirs = cellText(state.row[c.key])
              const differs = norm(mine) !== norm(theirs) && (mine.trim() !== '' || theirs.trim() !== '')
              return (
                <tr key={c.key} className={differs ? 'bg-amber-500/5' : ''}>
                  <th scope="row" className="py-1.5 pr-3 text-left text-xs font-semibold text-slate-400">{c.label}</th>
                  <td className={`py-1.5 pr-3 ${differs ? 'text-amber-100' : 'text-slate-300'}`}>{mine.trim() || <span className="text-slate-500">—</span>}</td>
                  <td className={`py-1.5 ${differs ? 'text-amber-100' : 'text-slate-300'}`}>{theirs.trim() || <span className="text-slate-500">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button variant="primary" disabled={state.status !== 'ready'} onClick={onUseExisting}>Use existing record</Button>
      </div>
    </div>
  )
}
