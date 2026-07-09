'use client'

import { update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { officerName } from '@/lib/profiles'
import { caseStatusTint } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { isStaleCase } from './caseUtils'
import { StaleBadge } from './StaleBadge'

type CaseRow = Tables<'cases'>
const BOARD_COLS = [
  ['open', 'Open', 'text-amber-300'],
  ['active', 'Active', 'text-emerald-300'],
  ['cold', 'Cold', 'text-blue-300'],
  ['closed', 'Closed', 'text-slate-300'],
] as const

export function CaseBoard({ items, canEdit, onOpen, onMoved }: { items: CaseRow[]; canEdit: boolean; onOpen: (id: string) => void; onMoved: () => void }) {
  const move = async (id: string, status: CaseRow['status']) => {
    const row = items.find((c) => c.id === id)
    if (!row || row.status === status) return
    row.status = status
    const res = await update('cases', id, { status, closed_at: status === 'closed' ? new Date().toISOString() : row.closed_at })
    if (res.error) toast(res.error.message, 'danger')
    else toast(`Status -> ${status.toUpperCase()}`, 'success')
    onMoved()
  }

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      {BOARD_COLS.map(([status, label, tint]) => {
        const col = items.filter((c) => c.status === status)
        return (
          <section
            key={status}
            onDragOver={(e) => { if (canEdit) e.preventDefault() }}
            onDrop={(e) => { if (canEdit) void move(e.dataTransfer.getData('text/case-id'), status) }}
            className="min-h-[18rem] rounded-2xl border border-white/10 bg-ink-900/45 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className={`text-sm font-bold uppercase tracking-[0.16em] ${tint}`}>{label}</h3>
              <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">{col.length}</span>
            </div>
            <div className="space-y-3">
              {col.map((c) => (
                <article
                  key={c.id}
                  draggable={canEdit}
                  onDragStart={(e) => { e.dataTransfer.setData('text/case-id', c.id); e.currentTarget.style.opacity = '.45' }}
                  onDragEnd={(e) => { e.currentTarget.style.opacity = '1' }}
                  data-status={c.status}
                  data-bureau={c.bureau}
                  data-stale={isStaleCase(c) ? 'true' : 'false'}
                  className="board-card rounded-xl border border-white/10 bg-ink-950/70 p-3 transition hover:border-badge-400/50"
                >
                  <button onClick={() => onOpen(c.id)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm font-bold text-white">{c.case_number.replaceAll('-', ' - ')}</p>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${caseStatusTint(c.status)}`}>{c.bureau}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">{c.title || 'Untitled case'}</p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span>{officerName(c.lead_detective_id) || 'Unassigned'}</span>
                      <StaleBadge c={c} />
                    </div>
                  </button>
                  {/* Keyboard/screen-reader path for the drag-and-drop move. */}
                  {canEdit && (
                    <select
                      value={c.status}
                      onChange={(e) => void move(c.id, e.target.value as CaseRow['status'])}
                      aria-label={`Change status of ${c.case_number}`}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px] font-bold uppercase text-slate-300 outline-none focus:border-badge-500"
                    >
                      {BOARD_COLS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
                    </select>
                  )}
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
