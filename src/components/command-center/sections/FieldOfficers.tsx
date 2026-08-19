'use client'

/** Command Center → Field Intelligence Officers. Appoint and revoke the
 *  SAHP/BCSO/LSPD accounts that reach the Field Intelligence portal.
 *
 *  Both actions go through SECURITY DEFINER RPCs that re-check
 *  `private.is_command()`, so a detective who reached this panel would simply
 *  be refused. The panel is convenience; the RPC is the boundary.
 *
 *  Appointing does NOT make the account a CID member. A field officer is
 *  deliberately not `profiles.active` — see src/lib/fieldOfficers.ts for why
 *  that distinction is the entire security model here.
 */
import { useCallback, useEffect, useState } from 'react'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import {
  FIELD_AGENCIES, FIELD_AGENCY_NAME, type FieldAgency, type FieldOfficerRow,
  appointFieldOfficer, appointmentProblem, endFieldOfficer, loadFieldOfficers,
} from '@/lib/fieldOfficers'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'

export function FieldOfficers() {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [officers, setOfficers] = useState<FieldOfficerRow[]>([])
  const [form, setForm] = useState({ userId: '', agency: '' as '' | FieldAgency, callsign: '', rank: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const v = useTableVersion('field_officers')

  const refresh = useCallback(async () => { setOfficers(await loadFieldOfficers()) }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void fetchProfiles(); void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [fetchProfiles, refresh, v])

  // Candidates are accounts that have signed in but hold no CID standing.
  // An active CID member does not need an appointment and would be routed to
  // the investigative portal regardless, so offering them here invites a
  // mistake rather than enabling anything.
  const candidates = profiles.filter((p) => !p.active && !p.removed_at)

  const appoint = async () => {
    const problem = appointmentProblem(form.userId, form.agency, profiles)
    if (problem) { toast(problem, 'warn'); return }
    setBusy(true)
    const err = await appointFieldOfficer(
      form.userId, form.agency as FieldAgency, form.callsign, form.rank, form.unit,
    )
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setForm({ userId: '', agency: '', callsign: '', rank: '', unit: '' })
    toast('Appointed. The officer reaches Field Intelligence on their next sign-in.', 'success')
    await refresh()
  }

  const revoke = async (o: FieldOfficerRow) => {
    const reason = await uiPrompt(
      `End ${nameOf(o.user_id)}’s ${o.agency} appointment? Their submissions stay attributed to them.`,
      { title: 'End this appointment', placeholder: 'Reason (recorded in the audit log)', confirmText: 'End appointment' },
    )
    if (!reason?.trim()) return
    const err = await endFieldOfficer(o.user_id, reason)
    if (err) { toast(err, 'danger'); return }
    toast('Appointment ended. Their submissions stay attributed to them.', 'success')
    await refresh()
  }

  const nameOf = (id: string): string =>
    profiles.find((p) => p.id === id)?.display_name || 'Unknown account'

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-base font-semibold text-white">Appoint a field officer</h3>
        <p className="mt-1 text-sm text-slate-400">
          Gives a SAHP, BCSO or LSPD account the Field Intelligence portal — and nothing
          else. It does not grant CID access, and the officer cannot read case files,
          persons, vehicles, gangs or any other investigative record.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          The account must have signed in at least once. Appoint people individually:
          a shared agency login would make every submission untraceable to the officer
          who actually made it.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Account">
            {(id) => (
              <Select id={id} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Select an account…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || p.id}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Agency">
            {(id) => (
              <Select id={id} value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value as '' | FieldAgency })}>
                <option value="">Select an agency…</option>
                {FIELD_AGENCIES.map((a) => (
                  <option key={a} value={a}>{a} — {FIELD_AGENCY_NAME[a]}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Callsign / badge" hint="Attached to every submission. Set here, not by the officer.">
            {(id) => <Input id={id} value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value })} placeholder="924" />}
          </Field>
          <Field label="Rank">
            {(id) => <Input id={id} value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} placeholder="Senior Trooper" />}
          </Field>
          <Field label="Unit">
            {(id) => <Input id={id} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Highway Patrol Division" />}
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={() => void appoint()} disabled={busy}>
            {busy ? 'Appointing…' : 'Appoint'}
          </Button>
        </div>
      </Card>

      <Card pad="none" className="overflow-hidden">
        <div className="border-b border-white/5 px-6 py-4">
          <h3 className="text-base font-semibold text-white">Appointments</h3>
          <p className="text-xs text-slate-400">
            Ended appointments are kept — they are the provenance of everything that
            officer submitted.
          </p>
        </div>
        {!officers.length ? (
          <EmptyState
            title="No field officers yet"
            hint="Appoint a SAHP, BCSO or LSPD account above to give it the Field Intelligence portal."
            className="m-4"
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {officers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {nameOf(o.user_id)}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      {[o.callsign, o.agency, o.officer_rank, o.unit].filter(Boolean).join(' · ')}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Appointed {fmtDateTime(o.appointed_at)}
                    {o.ended_at && ` · ended ${fmtDateTime(o.ended_at)}${o.end_reason ? ` — ${o.end_reason}` : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={o.active ? 'good' : 'neutral'}>{o.active ? 'Active' : 'Ended'}</Badge>
                  {o.active && (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(o)}>End</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
