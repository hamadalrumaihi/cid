'use client'

/** Per-charge administration for one penal code version.
 *
 *  Two lists, because two things can be wrong with a statute:
 *
 *    AWAITING A CODE   A charge imported without a number. It is held back —
 *                      `penal_charges_sel` keeps `lifecycle = 'draft'` out of
 *                      every selector — so it cannot be charged on a case and
 *                      publishing the version ships an incomplete code. Giving
 *                      it a number brings it into force.
 *
 *    ARCHIVED          A statute that was retired. Archived, never deleted, so
 *                      a case that charged it can still resolve what it
 *                      charged. Restoring makes it selectable again.
 *
 *  Both are `penal_restore_charge()`, which is one RPC because both are the
 *  same act: make this charge selectable. It refuses a charge that is already
 *  active, and refuses a codeless one with no code supplied.
 *
 *  The code-collision check here is presentation only. The guarantee is
 *  `penal_charges_code_unique (version_id, code)`; this just catches the
 *  common mistake before a round trip and explains it in a sentence. A
 *  collision it misses still fails, in the database, with an error.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  type PenalAdminCharge,
  archivePenalCharge,
  codeConflict,
  loadVersionCharges,
  restorePenalCharge,
} from '@/lib/penalAdmin'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { Button } from '@/components/ui/Button'

export function PenalChargeAdmin({ versionId, onChanged }: { versionId: string; onChanged: () => void }) {
  const [codeless, setCodeless] = useState<PenalAdminCharge[]>([])
  const [archived, setArchived] = useState<PenalAdminCharge[]>([])
  const [active, setActive] = useState<PenalAdminCharge[]>([])
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState({ code: '', reason: '' })
  const [retireQ, setRetireQ] = useState('')

  const refresh = useCallback(async () => {
    const [d, a, ac] = await Promise.all([
      loadVersionCharges(versionId, 'draft'),
      loadVersionCharges(versionId, 'archived'),
      loadVersionCharges(versionId, 'active'),
    ])
    setCodeless(d)
    setArchived(a)
    setActive(ac)
    setLoaded(true)
  }, [versionId])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const { run: bringIntoForce, busy } = useAction(async (ch: PenalAdminCharge) => {
    const needsCode = !ch.code
    const clash = needsCode ? codeConflict(form.code, active) : null
    if (clash) { toast(clash, 'danger'); return }
    if (!form.reason.trim()) { toast('A reason is required — it goes in the audit log.', 'danger'); return }
    const err = await restorePenalCharge(ch.id, form.reason.trim(), needsCode ? form.code.trim() : undefined)
    if (err) { toast(err, 'danger'); return }
    await refresh()
    onChanged()
    setOpenId(null)
    setForm({ code: '', reason: '' })
    toast(`${ch.offense} is now in force.`, 'success')
  })

  const { run: retire, busy: retiring } = useAction(async (ch: PenalAdminCharge) => {
    if (!form.reason.trim()) { toast('A reason is required — it goes in the audit log.', 'danger'); return }
    const err = await archivePenalCharge(ch.id, form.reason.trim())
    if (err) { toast(err, 'danger'); return }
    await refresh()
    onChanged()
    setOpenId(null)
    setForm({ code: '', reason: '' })
    toast(`${ch.offense} retired. Cases that charged it are unaffected.`, 'success')
  })

  if (!loaded) return <p className="t-readout p-3 text-[11px] text-slate-600">LOADING CHARGES…</p>

  const row = (ch: PenalAdminCharge, kind: 'codeless' | 'archived') => (
    <div key={ch.id} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">
            <span className="font-mono text-slate-500">{ch.code ?? '(no code)'}</span> {ch.offense}
          </p>
          <p className="t-readout text-[10px] text-slate-600">
            {ch.charge_class.toUpperCase()}
            {ch.penal_title && ` · ${ch.penal_title}`}
            {ch.substance_schedule != null && ` · SCHEDULE ${ch.substance_schedule}`}
            {kind === 'archived' && ch.archive_reason && ` · RETIRED: ${ch.archive_reason}`}
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy || retiring}
          onClick={() => {
            setOpenId(openId === ch.id ? null : ch.id)
            setForm({ code: ch.code ?? '', reason: '' })
          }}>
          {kind === 'codeless' ? 'Assign a code' : 'Restore'}
        </Button>
      </div>

      {openId === ch.id && (
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {kind === 'codeless' && (
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Charge code" aria-label="Charge code"
              className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200" />
          )}
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Reason (recorded in the audit log)" aria-label="Reason"
            className={`rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200 ${kind === 'codeless' ? '' : 'md:col-span-2'}`} />
          <Button size="sm" variant="primary" loading={busy}
            onClick={() => void bringIntoForce(ch)}>
            {kind === 'codeless' ? 'Bring into force' : 'Restore'}
          </Button>
          {kind === 'codeless' && form.code.trim() && codeConflict(form.code, active) && (
            <p className="text-xs text-rose-300 md:col-span-3">{codeConflict(form.code, active)}</p>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="mt-2 space-y-3">
      {codeless.length > 0 && (
        <div className="space-y-1.5">
          <p className="t-readout text-[11px] text-amber-300">
            {codeless.length} AWAITING A CODE — HELD OUT OF EVERY CHARGE PICKER
          </p>
          {codeless.map((ch) => row(ch, 'codeless'))}
        </div>
      )}
      {archived.length > 0 && (
        <div className="space-y-1.5">
          <p className="t-readout text-[11px] text-slate-500">
            {archived.length} RETIRED — STILL RESOLVABLE BY CASES THAT CHARGED THEM
          </p>
          {archived.map((ch) => row(ch, 'archived'))}
        </div>
      )}

      {/* Retiring a statute is rare and deliberate, so it is behind a search
          rather than a button on all 162 catalog rows. Nothing is deleted:
          an archived charge stays readable so a case that charged it can still
          resolve what it charged. */}
      <div className="space-y-1.5">
        <p className="t-readout text-[11px] text-slate-500">
          RETIRE A STATUTE — {active.length} SELECTABLE
        </p>
        <input value={retireQ} onChange={(e) => setRetireQ(e.target.value)}
          placeholder="Find the statute to retire…" aria-label="Find a statute to retire"
          className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-badge-500" />
        {retireQ.trim().length >= 2 && active
          .filter((ch) => `${ch.code ?? ''} ${ch.offense}`.toLowerCase().includes(retireQ.trim().toLowerCase()))
          .slice(0, 8)
          .map((ch) => (
            <div key={ch.id} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-200">
                  <span className="font-mono text-slate-500">{ch.code ?? '(no code)'}</span> {ch.offense}
                </p>
                <Button size="sm" variant="warn" disabled={busy || retiring}
                  onClick={() => {
                    setOpenId(openId === `retire:${ch.id}` ? null : `retire:${ch.id}`)
                    setForm({ code: '', reason: '' })
                  }}>
                  Retire
                </Button>
              </div>
              {openId === `retire:${ch.id}` && (
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Reason (recorded in the audit log)" aria-label="Reason"
                    className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-slate-200 md:col-span-2" />
                  <Button size="sm" variant="warn" loading={retiring}
                    onClick={() => void retire(ch)}>Retire this statute</Button>
                  <p className="text-xs text-slate-500 md:col-span-3">
                    It stops appearing in every charge picker. Cases that already
                    charged it keep their snapshots and can still resolve it.
                  </p>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
