'use client'

/** Charges on a case — records with a status, not entries in a jsonb array.
 *
 *  Each row is a `case_charges` row carrying a SNAPSHOT of what the penal code
 *  said when the charge was attached, so amending the code later cannot change
 *  what this case charged. The figures below are read from
 *  `case_charge_totals()` rather than summed here, because the database is the
 *  only place that knows which rows the viewer may see.
 *
 *  ── Nothing here decides anything ──────────────────────────────────────────
 *  The buttons offered come from `caseChargeNext()`, a mirror of the
 *  transition table. Whether a given person may WALK an edge is decided by
 *  `private.case_charge_may()` in a BEFORE UPDATE trigger, and who may touch
 *  the row at all is decided by RLS. So an action can be visible and still be
 *  refused — deliberately: the alternative is a client that quietly knows
 *  everyone's authority, which is the thing that drifts.
 *
 *  That is also why every mutation checks whether anything actually CHANGED.
 *  RLS refuses by matching zero rows, not by erroring, so "no error" proves
 *  nothing and a silent no-op would otherwise look like success.
 */

import { useCallback, useEffect, useState } from 'react'
import { fmtUSD } from '@/lib/format'
import {
  type CaseChargeRow,
  type CaseChargeStatus,
  type CaseChargeTotals,
  caseChargeActorLabel,
  caseChargeCapLabel,
  caseChargeFineLabel,
  caseChargeJailLabel,
  caseChargeNext,
  caseChargeStatusLabel,
  caseChargeStatusMeaning,
  caseChargeTotalIsProvisional,
  loadCaseChargeTotals,
  loadCaseCharges,
  moveCaseCharge,
  proposeCaseCharge,
  setCaseChargeCounts,
  setCaseChargeSubstance,
} from '@/lib/caseCharges'
import { penalCatalog, penalSearch } from '@/lib/penal'
import { usePenalCode } from '@/lib/usePenalCode'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { EmptyState } from '@/components/ui/Notice'
import { Button } from '@/components/ui/Button'
import { Stat, type CaseRow } from './shared'

const STATUS_TINT: Record<CaseChargeStatus, string> = {
  proposed: 'border-white/10 bg-white/5 text-slate-300',
  under_review: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  filed: 'border-badge-500/30 bg-badge-500/10 text-badge-200',
  convicted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  dismissed: 'border-white/10 bg-white/5 text-slate-500',
  withdrawn: 'border-white/10 bg-white/5 text-slate-500',
}

export function ChargesTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<CaseChargeRow[]>([])
  const [totals, setTotals] = useState<CaseChargeTotals | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [substanceFor, setSubstanceFor] = useState<string | null>(null)
  const [sub, setSub] = useState({ quantity: '', unit: '', note: '' })
  const { ready: penalReady } = usePenalCode()
  // An SIU case never routes through a Bureau Lead or a prosecutor queue, so
  // the wording of who does what has to branch on it.
  const siu = c.case_authority === 'siu'

  const refresh = useCallback(async () => {
    const [r, t] = await Promise.all([loadCaseCharges(c.id), loadCaseChargeTotals(c.id)])
    setRows(r)
    setTotals(t)
    setLoaded(true)
  }, [c.id])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    await refresh()
    onChanged()
    toast(ok, 'success')
  }

  const { run: add, busy: adding } = useAction(async (chargeId: string) => {
    const existing = rows.find((r) => r.charge_id === chargeId && r.status !== 'withdrawn' && r.status !== 'dismissed')
    if (existing) {
      // One live row per charge per case; multiplicity is `counts`. Adding the
      // same statute again means "another count of it", not a second record.
      await after(await setCaseChargeCounts(existing.id, existing.counts + 1), 'Count increased.')
      return
    }
    const err = await proposeCaseCharge(c.id, chargeId)
    if (err) {
      // The INSERT policy reserves RICO modifiers to a prosecuting attorney or
      // judge, and refuses with a bare "violates row-level security policy".
      // Explaining WHY is the client's job; deciding is not — the database
      // already said no and this only translates it.
      const pc = penalCatalog().find((x) => x.id === chargeId)
      toast(pc?.rico && /row-level security/i.test(err)
        ? 'RICO charges are modifiers only a prosecuting attorney or judge may add.'
        : err, 'danger')
      return
    }
    await refresh()
    onChanged()
    toast('Charge proposed.', 'success')
  })

  const { run: move, busy: moving } = useAction(async (id: string, to: CaseChargeStatus) => {
    const err = await moveCaseCharge(id, to)
    if (err) { toast(err, 'danger'); return }
    // RLS refuses by matching zero rows. Re-read and confirm the move actually
    // happened rather than reporting a success the database never performed.
    const fresh = await loadCaseCharges(c.id)
    const row = fresh.find((r) => r.id === id)
    setRows(fresh)
    setTotals(await loadCaseChargeTotals(c.id))
    if (row?.status !== to) {
      toast(`Only ${caseChargeActorLabel(to, siu)} can do that.`, 'danger')
      return
    }
    onChanged()
    toast(`Charge ${caseChargeStatusLabel(to).toLowerCase()}.`, 'success')
  })

  const { run: saveSubstance, busy: savingSub } = useAction(async (id: string) => {
    const qty = sub.quantity.trim() === '' ? null : Number(sub.quantity)
    if (qty != null && (!Number.isFinite(qty) || qty < 0)) { toast('Quantity must be a positive number.', 'danger'); return }
    const err = await setCaseChargeSubstance(id, qty, sub.unit.trim() || null, sub.note.trim() || null)
    if (err) { toast(err, 'danger'); return }
    await refresh()
    setSubstanceFor(null)
    setSub({ quantity: '', unit: '', note: '' })
    toast('Substance detail saved.', 'success')
  })

  const { run: fewer, busy: reducing } = useAction(async (ch: CaseChargeRow) => {
    await after(await setCaseChargeCounts(ch.id, Math.max(1, ch.counts - 1)), 'Count reduced.')
  })

  const busy = adding || moving || savingSub || reducing
  const results = penalReady ? penalSearch(q).slice(0, 40) : []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Charges" value={loaded ? (totals?.counts ?? 0) : '—'} />
        <Stat
          label="Sentence"
          value={!loaded || !totals ? '—'
            : totals.judge_jail_pending > 0
              // A judge-set term is NOT zero. Saying "40mo" while a judge has
              // yet to rule on another charge would understate the exposure.
              ? `${totals.months} mo + ${totals.judge_jail_pending} for a judge`
              : `${totals.months} mo`}
        />
        <Stat
          label="Fine"
          value={!loaded || !totals ? '—'
            : totals.judge_fine_pending > 0
              ? `${fmtUSD(totals.fine)} + judge`
              : fmtUSD(totals.fine)}
        />
        <Stat label="RICO" value={loaded ? (totals?.rico ?? 0) : '—'} />
      </div>

      {totals && caseChargeCapLabel(totals) && (
        <p className={`t-readout text-[11px] ${totals.over_cap ? 'text-rose-300' : 'text-slate-500'}`}>
          {caseChargeCapLabel(totals)!.toUpperCase()}
        </p>
      )}
      {totals && caseChargeTotalIsProvisional(totals) && (
        <p className="t-readout text-[11px] text-amber-300">
          PROVISIONAL — A JUDGE HAS NOT SET EVERY PENALTY
        </p>
      )}

      <div className="space-y-2">
        {rows.map((ch) => {
          const moves = caseChargeNext(ch.status)
          return (
            <div key={ch.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">
                    <span className="font-mono text-badge-200">{ch.code ?? '—'}</span> {ch.offense}
                    {ch.is_rico && <span className="ml-1 rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">RICO</span>}
                    {ch.is_modifier && <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">MODIFIER</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {ch.charge_class} · {caseChargeJailLabel(ch)} · {caseChargeFineLabel(ch)}
                  </p>
                  <p className="t-readout mt-1 text-[10px] text-slate-600">
                    UNDER {ch.version_name.toUpperCase()}
                    {ch.version_status !== 'published' && ` (${ch.version_status.toUpperCase()})`}
                  </p>
                  {ch.substance_schedule != null && (
                    <p className="mt-1 text-xs text-amber-200/80">
                      Schedule {ch.substance_schedule}
                      {ch.substance_quantity != null && ` · ${ch.substance_quantity}${ch.substance_unit ? ` ${ch.substance_unit}` : ''}`}
                      {ch.substance_note && ` · ${ch.substance_note}`}
                    </p>
                  )}
                  {ch.note && <p className="mt-1 text-xs text-slate-500">{ch.note}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TINT[ch.status]}`}
                    title={caseChargeStatusMeaning(ch.status)}>
                    {caseChargeStatusLabel(ch.status)}
                  </span>
                  <span className="font-mono text-sm text-white">x{ch.counts}</span>
                </div>
              </div>

              {canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Counts are frozen once a charge is before a court. */}
                  {ch.status !== 'filed' && ch.status !== 'convicted' && ch.status !== 'dismissed' && (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy}
                        onClick={() => void add(ch.charge_id)}>+</Button>
                      <Button size="sm" variant="ghost" disabled={busy || ch.counts <= 1}
                        onClick={() => void fewer(ch)}>-</Button>
                    </>
                  )}
                  {moves.map((to) => (
                    <Button key={to} size="sm"
                      variant={to === 'withdrawn' ? 'ghost' : to === 'approved' ? 'primary' : 'secondary'}
                      disabled={busy}
                      title={`${caseChargeActorLabel(to, siu)} does this`}
                      onClick={() => void move(ch.id, to)}>
                      {to === 'proposed' ? 'Send back' : caseChargeStatusLabel(to)}
                    </Button>
                  ))}
                  {ch.substance_schedule != null && (
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => {
                        setSubstanceFor(substanceFor === ch.id ? null : ch.id)
                        setSub({
                          quantity: ch.substance_quantity?.toString() ?? '',
                          unit: ch.substance_unit ?? '',
                          note: ch.substance_note ?? '',
                        })
                      }}>
                      Substance detail
                    </Button>
                  )}
                  {!moves.length && (
                    <span className="t-readout text-[10px] text-slate-600">NO FURTHER STEP</span>
                  )}
                </div>
              )}

              {substanceFor === ch.id && (
                <div className="mt-2 grid gap-2 rounded-lg border border-white/10 bg-ink-900 p-3 md:grid-cols-4">
                  <input value={sub.quantity} onChange={(e) => setSub({ ...sub, quantity: e.target.value })}
                    placeholder="Quantity" inputMode="decimal"
                    className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200" />
                  <input value={sub.unit} onChange={(e) => setSub({ ...sub, unit: e.target.value })}
                    placeholder="Unit (g, oz, pills)"
                    className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200" />
                  <input value={sub.note} onChange={(e) => setSub({ ...sub, note: e.target.value })}
                    placeholder="Note"
                    className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200 md:col-span-2" />
                  <Button size="sm" variant="primary" loading={savingSub}
                    onClick={() => void saveSubstance(ch.id)}>Save</Button>
                </div>
              )}
            </div>
          )
        })}

        {loaded && !rows.length && (
          <EmptyState
            title="No charges attached"
            hint={canEdit
              ? 'Search the published penal code below. A charge starts as a proposal and moves through review before anyone files it.'
              : 'Charges attached to this case build the sentence and fine totals above.'}
          />
        )}
        {!loaded && <p className="t-readout p-6 text-center text-sm text-slate-500">LOADING CHARGES…</p>}
      </div>

      {canEdit && (
        <div className="space-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={penalReady ? 'Search the penal code…' : 'Loading penal code…'}
            disabled={!penalReady}
            aria-label="Search the penal code"
            className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-badge-500 disabled:opacity-60"
          />
          {results.map((pc) => (
            <button key={pc.id} onClick={() => void add(pc.id)} disabled={busy}
              className="block w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10 disabled:opacity-60">
              <span className="font-mono text-badge-200">{pc.code}</span>{' '}
              <span className="font-bold text-white">{pc.title}</span>
              <span className="ml-2 text-xs text-slate-500">
                {pc.level}{pc.rico ? ' · RICO' : ''}{pc.modifier ? ' · modifier' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
