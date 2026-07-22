'use client'

/** Seized-property inventory for a warrant (spec D3). Read-only list for anyone
 *  who can view the request; an add form + custody controls for CID members who
 *  can fulfil the warrant (the server re-checks via can_fulfil_legal). Rows are
 *  structured (item · quantity · category) and complement the free-text
 *  execution notes — Batch 10.6's "both". Custody columns (evidence bag,
 *  storage location, disposition) are surfaced inline; a strike is a CORRECTION,
 *  not a deletion, so struck rows stay on the record (dimmed, with the reason /
 *  who / when) for an intact chain. Entity links (evidence/person/vehicle) exist
 *  on the row and are surfaced when present; picking them from the UI is a
 *  follow-up. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { fmtDateTime } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { StatusChip } from '../legalShared'

type SeizedItem = Tables<'legal_seized_items'>

export const SEIZED_CATEGORIES = ['weapon', 'narcotics', 'currency', 'electronics', 'document', 'vehicle', 'other'] as const
export const SEIZED_DISPOSITIONS = ['held', 'returned', 'destroyed', 'forfeited', 'other'] as const

// Disposition chip tone: held is neutral, returned informational, forfeited a
// caution, destroyed destructive.
const DISP_TONE: Record<string, 'slate' | 'amber' | 'emerald' | 'rose' | 'blue'> = {
  held: 'slate', returned: 'blue', destroyed: 'rose', forfeited: 'amber', other: 'slate',
}

const INPUT = 'min-h-[38px] rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function SeizedItemsPanel({ requestId, canFulfil }: { requestId: string; canFulfil: boolean }) {
  const [rows, setRows] = useState<SeizedItem[] | null>(null)
  const [item, setItem] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState('')
  const [evidenceBag, setEvidenceBag] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [disposition, setDisposition] = useState('held')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // The roster resolves removed_by → name on struck rows; lazy-load if the
  // cache is cold (loaded flips false→true on first fetch, re-rendering names).
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchProfiles() }, [rosterLoaded, fetchProfiles])

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
      p_evidence_bag: evidenceBag.trim() || undefined,
      p_storage_location: storageLocation.trim() || undefined,
      p_disposition: disposition,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Seized item logged.', 'success')
    setItem(''); setQuantity(''); setCategory(''); setNotes('')
    setEvidenceBag(''); setStorageLocation(''); setDisposition('held')
    void fetchRows()
  }

  // A strike is a custody CORRECTION, not a deletion: the row stays on the
  // record (removed_at/by + reason) so the chain is intact. A reason is required.
  const remove = async (id: string) => {
    const reason = await uiPrompt('Reason for striking this item from the inventory (required).', { title: 'Strike seized item' })
    if (!reason?.trim()) return
    const res = await rpc('legal_seized_item_remove', { p_item: id, p_reason: reason })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Seized item struck from the inventory.', 'success')
    void fetchRows()
  }

  // Disposition is a live custody state (held → returned/destroyed/forfeited);
  // the compact per-row <select> fires this on change.
  const updateDisposition = async (id: string, value: string) => {
    const res = await rpc('legal_seized_item_set_disposition', { p_item: id, p_disposition: value })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Disposition updated.', 'success')
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
          {rows.map((s) => {
            const struck = !!s.removed_at
            const disp = s.disposition || 'held'
            return (
              <li key={s.id} className={`rounded-lg border border-white/5 bg-white/5 px-3 py-2 ${struck ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-semibold text-white ${struck ? 'line-through' : ''}`}>{s.item}</span>
                  {s.quantity && <span className="text-xs text-slate-300">× {s.quantity}</span>}
                  {s.category && <StatusChip label={s.category} tone="slate" />}
                  {s.evidence_bag && <span className="text-xs text-slate-400">Bag {s.evidence_bag}</span>}
                  {s.storage_location && <span className="text-xs text-slate-400">@ {s.storage_location}</span>}
                  <StatusChip label={disp} tone={DISP_TONE[disp] ?? 'slate'} />
                  {s.notes && <span className="text-xs text-slate-400">— {s.notes}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">{fmtDateTime(s.created_at)}</span>
                    {canFulfil && !struck && (
                      <>
                        <select
                          value={disp}
                          onChange={(e) => void updateDisposition(s.id, e.target.value)}
                          aria-label={`Disposition for ${s.item}`}
                          className="min-h-[32px] rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-xs text-white"
                        >
                          {SEIZED_DISPOSITIONS.map((d) => <option key={d} value={d}>{cap(d)}</option>)}
                        </select>
                        <button
                          onClick={() => void remove(s.id)}
                          className="rounded px-2 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
                          aria-label={`Remove ${s.item}`}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {struck && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Struck{s.removal_reason ? `: ${s.removal_reason}` : ''}
                    {s.removed_by ? ` — ${officerName(s.removed_by)}` : ''}
                    {s.removed_at ? ` · ${fmtDateTime(s.removed_at)}` : ''}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canFulfil && (
        <div className="mt-3 grid gap-2 border-t border-white/5 pt-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input className={INPUT} placeholder="Item (e.g. Glock 19)" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item" />
          <input className={INPUT} placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
          <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Category…</option>
            {SEIZED_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          <input className={INPUT} placeholder="Evidence bag #" value={evidenceBag} onChange={(e) => setEvidenceBag(e.target.value)} aria-label="Evidence bag" />
          <input className={INPUT} placeholder="Storage location" value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} aria-label="Storage location" />
          <select className={INPUT} value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="Disposition">
            {SEIZED_DISPOSITIONS.map((d) => <option key={d} value={d}>{cap(d)}</option>)}
          </select>
          <input className={`${INPUT} sm:col-span-2`} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          <Button variant="primary" disabled={busy || !item.trim()} onClick={() => void add()}>Log item</Button>
        </div>
      )}
    </Card>
  )
}
