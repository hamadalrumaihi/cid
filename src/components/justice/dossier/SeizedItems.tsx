'use client'

/** Seized-property inventory for a warrant (spec D3). Read-only list for anyone
 *  who can view the request; an add form + remove controls for CID members who
 *  can fulfil the warrant (the server re-checks via can_fulfil_legal). Rows are
 *  structured (item · quantity · category) and complement the free-text
 *  execution notes — Batch 10.6's "both". Entity links (evidence/person/vehicle)
 *  exist on the row and are surfaced when present; picking them from the UI is a
 *  follow-up. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { fmtDateTime } from '@/lib/format'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '../legalShared'

type SeizedItem = Tables<'legal_seized_items'>

export const SEIZED_CATEGORIES = ['weapon', 'narcotics', 'currency', 'electronics', 'document', 'vehicle', 'other'] as const

const INPUT = 'min-h-[38px] rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'

export function SeizedItemsPanel({ requestId, canFulfil }: { requestId: string; canFulfil: boolean }) {
  const [rows, setRows] = useState<SeizedItem[] | null>(null)
  const [item, setItem] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchRows = useCallback(async () => {
    try {
      const data = await list('legal_seized_items', { eq: { legal_request_id: requestId }, order: 'created_at', ascending: true })
      setRows(data as SeizedItem[])
    } catch { setRows([]) }
  }, [requestId])
  useEffect(() => { queueMicrotask(() => { void fetchRows() }) }, [fetchRows])

  const add = async () => {
    if (!item.trim() || busy) return
    setBusy(true)
    const res = await rpc('legal_seized_item_add', {
      p_request: requestId, p_item: item.trim(),
      p_quantity: quantity.trim() || undefined,
      p_category: category || undefined,
      p_notes: notes.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Seized item logged.', 'success')
    setItem(''); setQuantity(''); setCategory(''); setNotes('')
    void fetchRows()
  }

  const remove = async (id: string) => {
    const res = await rpc('legal_seized_item_remove', { p_item: id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Seized item removed.', 'success')
    void fetchRows()
  }

  // Nothing to show for a viewer who can neither fulfil nor see any rows yet.
  if (rows !== null && rows.length === 0 && !canFulfil) return null

  return (
    <Card pad="sm">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Seized property</h3>
      {rows === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No seized property logged.</p>
      ) : (
        <ul className="space-y-2" aria-label="Seized property inventory">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <span className="text-sm font-semibold text-white">{s.item}</span>
              {s.quantity && <span className="text-xs text-slate-300">× {s.quantity}</span>}
              {s.category && <StatusChip label={s.category} tone="slate" />}
              {s.notes && <span className="text-xs text-slate-400">— {s.notes}</span>}
              <span className="ml-auto text-[11px] text-slate-500">{fmtDateTime(s.created_at)}</span>
              {canFulfil && (
                <button
                  onClick={() => void remove(s.id)}
                  className="rounded px-2 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
                  aria-label={`Remove ${s.item}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canFulfil && (
        <div className="mt-3 grid gap-2 border-t border-white/5 pt-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input className={INPUT} placeholder="Item (e.g. Glock 19)" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item" />
          <input className={INPUT} placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
          <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Category…</option>
            {SEIZED_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
          <input className={`${INPUT} sm:col-span-2`} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          <Button variant="primary" disabled={busy || !item.trim()} onClick={() => void add()}>Log item</Button>
        </div>
      )}
    </Card>
  )
}
