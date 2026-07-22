'use client'

/** MDT export controls (spec D4). The patrol (in-city) MDT may carry BOLOs and
 *  officer-safety caution flags — never case details. Any active CID member
 *  PROPOSES an export; a Lead+ APPROVES it (pushes it to the patrol MDT) and
 *  CLEARS it (manual — no auto-expiry). Every step is audited server-side.
 *  Vehicle-BOLO proposing (and proposing from a profile) is a follow-up; this
 *  covers the person BOLO / caution path from the BOLO board. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { fmtDateTime } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

type MdtExport = Tables<'mdt_exports'>
type PersonLite = { id: string; name: string }

const RISKS = ['low', 'medium', 'high', 'critical'] as const
const RISK_TINT: Record<string, string> = {
  low: 'bg-slate-500/15 text-slate-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-orange-500/15 text-orange-300',
  critical: 'bg-rose-500/15 text-rose-300',
}
const STATUS_TINT: Record<string, string> = {
  proposed: 'bg-amber-500/15 text-amber-300',
  exported: 'bg-emerald-500/15 text-emerald-300',
  cleared: 'bg-slate-500/20 text-slate-400',
}
const INPUT = 'min-h-[38px] rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'

export function MdtExportsPanel({ persons, canPropose, isCommand }: { persons: PersonLite[]; canPropose: boolean; isCommand: boolean }) {
  const [rows, setRows] = useState<MdtExport[] | null>(null)
  const [personId, setPersonId] = useState('')
  const [kind, setKind] = useState<'person_bolo' | 'caution'>('person_bolo')
  const [risk, setRisk] = useState('')
  const [instructions, setInstructions] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const v = useTableVersion('mdt_exports')

  const fetchRows = useCallback(async () => {
    try {
      const data = await list('mdt_exports', { order: 'proposed_at', ascending: false })
      setRows(data as MdtExport[])
    } catch { setRows([]) }
  }, [])
  useEffect(() => { queueMicrotask(() => { void fetchRows() }) }, [fetchRows, v])

  const active = useMemo(() => (rows ?? []).filter((r) => r.status !== 'cleared'), [rows])

  const propose = async () => {
    if (!personId || busy) return
    const name = persons.find((p) => p.id === personId)?.name
    if (!name) return
    setBusy(true)
    const res = await rpc('mdt_export_propose', {
      p_kind: kind, p_person: personId, p_vehicle: null, p_snapshot: name,
      p_risk: risk || undefined, p_instructions: instructions.trim() || undefined, p_reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Proposed for MDT export — a command member must approve it.', 'success')
    setPersonId(''); setRisk(''); setInstructions(''); setReason('')
    void fetchRows()
  }

  const approve = async (id: string) => {
    const res = await rpc('mdt_export_approve', { p_export: id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Approved — pushed to the patrol MDT.', 'success'); void fetchRows()
  }
  const clear = async (id: string) => {
    const res = await rpc('mdt_export_clear', { p_export: id, p_reason: null })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Cleared from the patrol MDT.', 'success'); void fetchRows()
  }

  // Hide the whole panel when there's nothing to show and the viewer can't propose.
  if (rows !== null && active.length === 0 && !canPropose) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-300">Patrol MDT exports</h2>
        <span className="text-[11px] text-slate-500">BOLOs &amp; caution flags pushed to the in-city MDT — never case details.</span>
      </div>

      {rows === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing is currently exported to the patrol MDT.</p>
      ) : (
        <ul className="space-y-2" aria-label="MDT exports">
          {active.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <Badge tint={STATUS_TINT[e.status]}>{e.status}</Badge>
              <span className="text-sm font-semibold text-white">{e.subject_snapshot}</span>
              <Badge>{e.kind.replace('_', ' ')}</Badge>
              {e.risk_level && <Badge tint={RISK_TINT[e.risk_level]}>{e.risk_level} risk</Badge>}
              {e.instructions && <span className="text-xs text-slate-400">— {e.instructions}</span>}
              <span className="ml-auto text-[11px] text-slate-500">{fmtDateTime(e.proposed_at)}</span>
              {isCommand && e.status === 'proposed' && (
                <Button variant="primary" onClick={() => void approve(e.id)}>Approve</Button>
              )}
              {isCommand && e.status !== 'cleared' && (
                <button onClick={() => void clear(e.id)} className="rounded px-2 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10">Clear</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPropose && (
        <div className="mt-4 grid gap-2 border-t border-white/5 pt-4 sm:grid-cols-2">
          <select className={INPUT} value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Subject">
            <option value="">Choose a flagged person…</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as 'person_bolo' | 'caution')} aria-label="Kind">
            <option value="person_bolo">BOLO</option>
            <option value="caution">Caution flag</option>
          </select>
          <select className={INPUT} value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk level">
            <option value="">Risk level…</option>
            {RISKS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select>
          <input className={INPUT} placeholder="Approach instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label="Instructions" />
          <input className={`${INPUT} sm:col-span-2`} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <div className="sm:col-span-2">
            <Button variant="primary" disabled={busy || !personId} onClick={() => void propose()}>Propose MDT export</Button>
            <span className="ml-3 text-[11px] text-slate-500">A command member must approve a proposal before it reaches patrol.</span>
          </div>
        </div>
      )}
    </div>
  )
}
