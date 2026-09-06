'use client'

/** MDT export controls (spec D4). The patrol (in-city) MDT may carry BOLOs and
 *  officer-safety caution flags — never case details. Any active CID member
 *  PROPOSES an export; a Lead+ APPROVES it (pushes it to the patrol MDT) and
 *  CLEARS it (manual — no auto-expiry). Every step is audited server-side.
 *  Self-approval is refused server-side (proposer ≠ approver), so the Approve
 *  control is disabled on the proposer's own rows.
 *
 *  Phase 5 expansion (arrest_warrant / person_record / vehicle_record /
 *  account kinds, the account CID-only lane, expiry reminders, lane badges)
 *  is DORMANT behind isMdtExpansionConfigured() — with the flag unset this
 *  panel renders and queries exactly what it did before Phase 5. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { suggestEntities } from '@/lib/entity'
import { searchAccountHits, searchVehicleHits } from '@/lib/entitySearch'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { fmtDateTime } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import { statusMeta } from '@/lib/status'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { inputCls } from '@/components/ui/Field'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { isMdtExpansionConfigured } from './mdtExpansionConfig'

type MdtExport = Tables<'mdt_exports'>
/** PickedRecord plus the mugshot for the picker's thumb/collapsed row. */
type PersonPick = PickedRecord & { thumbUrl?: string | null }
type ExportKind = 'person_bolo' | 'caution' | 'arrest_warrant' | 'person_record' | 'vehicle_record' | 'account'

const RISKS = ['low', 'medium', 'high', 'critical'] as const
const STATUS_TINT: Record<string, string> = {
  proposed: 'bg-amber-500/15 text-amber-300',
  exported: 'bg-emerald-500/15 text-emerald-300',
  cleared: 'bg-slate-500/20 text-slate-400',
}
const INPUT = inputCls

// Today's kinds — the only ones offered while the expansion flag is off.
const BASE_KINDS: ReadonlyArray<{ id: ExportKind; label: string }> = [
  { id: 'person_bolo', label: 'BOLO' },
  { id: 'caution', label: 'Caution flag' },
]
// Phase 5 kinds — offered ONLY when isMdtExpansionConfigured() is true.
const EXPANDED_KINDS: ReadonlyArray<{ id: ExportKind; label: string }> = [
  ...BASE_KINDS,
  { id: 'arrest_warrant', label: 'Arrest warrant (manual push)' },
  { id: 'person_record', label: 'Person record' },
  { id: 'vehicle_record', label: 'Vehicle record' },
  { id: 'account', label: 'Account (CID-only)' },
]

// The person target is a bounded search over the eligibility rule itself
// (bolo=true) — no caller-supplied flagged list, so the picker scales past a
// dropdown-sized list.
export function MdtExportsPanel({ canPropose, isCommand }: { canPropose: boolean; isCommand: boolean }) {
  const expansion = isMdtExpansionConfigured()
  const myId = useAuth().profile?.id
  const now = useNow()
  const [rows, setRows] = useState<MdtExport[] | null>(null)
  const [person, setPerson] = useState<PersonPick | null>(null)
  const [kind, setKind] = useState<ExportKind>('person_bolo')
  const [account, setAccount] = useState<PickedRecord | null>(null)
  const [vehicle, setVehicle] = useState<PickedRecord | null>(null)
  const [expiry, setExpiry] = useState('')
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

  // Person targets: only BOLO-flagged persons are eligible. A typed query
  // goes through entity_suggest (P2-08 — the shared, RLS-scoped suggestion
  // arm), then ONE bounded in:{id} read applies the eligibility rule
  // (eq:{bolo:true}) and fetches the mugshot/risk for the row; blank lists
  // the most recently flagged. Merged tombstones never come back from the
  // RPC, and the hydration filters them again for the blank path.
  const searchFlaggedPersons = useCallback(async (q: string): Promise<PersonPick[]> => {
    type Row = { id: string; name: string; alias: string | null; bolo_risk: string | null; mugshot_url: string | null; lifecycle: string }
    const select = 'id,name,alias,bolo_risk,mugshot_url,lifecycle'
    const term = q.trim()
    let r: Row[]
    if (term.length < 2) {
      r = (await list('persons', { select, eq: { bolo: true }, order: 'updated_at', ascending: false, limit: 20 })) as unknown as Row[]
    } else {
      const hits = await suggestEntities('person', term, 50)
      if (!hits.length) return []
      const rows = (await list('persons', { select, eq: { bolo: true }, in: { id: hits.map((h) => h.id) } })) as unknown as Row[]
      const byId = new Map(rows.map((x) => [x.id, x]))
      r = hits.map((h) => byId.get(h.id)).filter((x): x is Row => !!x)
    }
    return r.filter((p) => p.lifecycle !== 'merged').slice(0, 20).map((p) => ({
      id: p.id,
      label: p.name || 'Person',
      sublabel: [p.alias ? `“${p.alias}”` : null, p.bolo_risk ? `${p.bolo_risk} risk` : null].filter(Boolean).join(' · ') || undefined,
      thumbUrl: p.mugshot_url,
    }))
  }, [])

  // Only reachable with the expansion flag on (the pickers never render
  // without it). Shared entity-search arms (entity_suggest; RLS-scoped,
  // merged tombstones dropped). The account snapshot keeps the bare handle.
  const searchAccounts = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const hits = await searchAccountHits(q)
    return hits.map((h) => ({ id: h.id, label: h.label.replace(/^@/, ''), ...(h.sublabel ? { sublabel: h.sublabel } : {}) }))
  }, [])
  const searchVehicles = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const hits = await searchVehicleHits(q)
    return hits.map((h) => ({ id: h.id, label: h.label, ...(h.sublabel ? { sublabel: h.sublabel } : {}) }))
  }, [])

  const isAccountKind = kind === 'account'
  const isVehicleKind = kind === 'vehicle_record'
  const isPersonKind = !isAccountKind && !isVehicleKind
  const canSubmit = isAccountKind ? !!account : isVehicleKind ? !!vehicle : !!person

  const propose = async () => {
    if (busy || !canSubmit) return
    let target: { person: string | null; vehicle: string | null; account: string | null; snapshot: string }
    if (isAccountKind && account) {
      target = { person: null, vehicle: null, account: account.id, snapshot: account.label }
    } else if (isVehicleKind && vehicle) {
      target = { person: null, vehicle: vehicle.id, account: null, snapshot: vehicle.sublabel ? `${vehicle.label} (${vehicle.sublabel})` : vehicle.label }
    } else {
      if (!person) return
      target = { person: person.id, vehicle: null, account: null, snapshot: person.label }
    }
    // Parse the expiry BEFORE setBusy — an unparseable datetime-local value
    // would otherwise throw mid-flight and leave the button stuck disabled.
    let expiresIso: string | null = null
    if (expansion && expiry) {
      const d = new Date(expiry)
      if (Number.isNaN(d.getTime())) { toast('Invalid expiry date.', 'warn'); return }
      expiresIso = d.toISOString()
    }
    setBusy(true)
    const res = await rpc('mdt_export_propose', {
      p_kind: kind, p_person: target.person, p_vehicle: target.vehicle, p_snapshot: target.snapshot,
      p_risk: risk || undefined, p_instructions: instructions.trim() || undefined, p_reason: reason.trim() || undefined,
      // Phase 5 params ride only when the expansion flag is on — the ungated
      // payload stays byte-identical to today's. p_patrol_visible is never
      // sent: kind='account' is forced CID-only server-side regardless.
      ...(expansion ? { p_account: target.account, p_expires_at: expiresIso } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Proposed for MDT export — a command member must approve it.', 'success')
    setPerson(null); setAccount(null); setVehicle(null); setExpiry(''); setRisk(''); setInstructions(''); setReason('')
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
    <div className="rounded-lg border border-white/10 bg-ink-900/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-white">Patrol MDT exports</h2>
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
              {expansion && (
                <Badge tone={e.patrol_visible ? 'accent' : 'neutral'} title={e.patrol_visible ? 'Patrol lane — syncable to the in-city MDT once exported' : 'CID-only lane — never crosses to patrol'}>
                  {e.patrol_visible ? 'Patrol' : 'CID-only'}
                </Badge>
              )}
              {e.risk_level && <Badge tint={statusMeta('boloRisk', e.risk_level).cls}>{e.risk_level} risk</Badge>}
              {expansion && e.expires_at && <DeadlineChip at={e.expires_at} kind="expires" now={now} />}
              {e.instructions && <span className="text-xs text-slate-400">— {e.instructions}</span>}
              <span className="ml-auto text-[11px] text-slate-500">{fmtDateTime(e.proposed_at)}</span>
              {isCommand && e.status === 'proposed' && (
                // Mirrors the server rule (proposer ≠ approver) so the proposer
                // never gets a guaranteed error toast.
                e.proposed_by === myId ? (
                  <Button variant="primary" disabled title="Proposed by you — another Lead must approve.">Approve</Button>
                ) : (
                  <Button variant="primary" onClick={() => void approve(e.id)}>Approve</Button>
                )
              )}
              {isCommand && e.status !== 'cleared' && (
                <Button size="sm" variant="danger" className="min-h-[44px] sm:min-h-0" aria-label={`Clear ${e.subject_snapshot}`} onClick={() => void clear(e.id)}>Clear</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPropose && (
        <div className="mt-4 grid gap-2 border-t border-white/5 pt-4 sm:grid-cols-2">
          {isPersonKind ? (
            <RecordSearchPicker<PersonPick>
              label="Subject"
              required
              hint="Only BOLO-flagged persons are eligible."
              placeholder="Search flagged persons…"
              value={person}
              onChange={setPerson}
              search={searchFlaggedPersons}
              getThumb={(p) => p.thumbUrl}
              peekType="person"
            />
          ) : isAccountKind ? (
            <RecordSearchPicker
              label="Account"
              required
              hint="CID-only — an account export is never patrol-visible."
              placeholder="Search by handle…"
              value={account}
              onChange={setAccount}
              search={searchAccounts}
              peekType="account"
            />
          ) : (
            <RecordSearchPicker
              label="Vehicle"
              required
              placeholder="Search by plate or model…"
              value={vehicle}
              onChange={setVehicle}
              search={searchVehicles}
              peekType="vehicle"
            />
          )}
          <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as ExportKind)} aria-label="Kind">
            {(expansion ? EXPANDED_KINDS : BASE_KINDS).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <select className={INPUT} value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk level">
            <option value="">Risk level…</option>
            {RISKS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select>
          <input className={INPUT} placeholder="Approach instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label="Instructions" />
          {expansion && (
            <input
              type="datetime-local" className={INPUT} value={expiry} onChange={(e) => setExpiry(e.target.value)}
              aria-label="Expiry reminder (optional)" title="Expiry reminder (optional) — informational only; clearing stays a manual command action"
            />
          )}
          <input className={`${INPUT} sm:col-span-2`} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <div className="sm:col-span-2">
            <Button variant="primary" disabled={busy || !canSubmit} onClick={() => void propose()}>Propose MDT export</Button>
            <span className="ml-3 text-[11px] text-slate-500">A command member must approve a proposal before it reaches patrol.</span>
          </div>
        </div>
      )}
    </div>
  )
}
