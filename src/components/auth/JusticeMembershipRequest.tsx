'use client'

/** Justice membership request — the DOJ/Judiciary side of the adaptive
 *  first-login Gate. A separate flow from the CID department request
 *  (separate table + approval RPCs): agency-scoped role menus, a Bar/Court
 *  identifier instead of a CID bureau, and the DA/AG/Owner approval matrix.
 *  Selecting a role never grants anything — the request stays a request until
 *  review_justice_membership_request() activates the justice membership. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { insert, list, rpc, update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useTableVersion } from '@/lib/realtime'
import {
  AGENCY_LABEL, AGENCY_ROLES, JMR_COLS, JUSTICE_ROLE_LABEL,
  justiceRoleLabel, type JusticeAgency, type JusticeRole,
} from '@/lib/justice'
import { fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'

type RequestRow = Tables<'justice_membership_requests'>

interface FormState {
  display_name: string
  justice_identifier: string
  requested_agency: JusticeAgency
  requested_justice_role: JusticeRole
  reason: string
  additional_notes: string
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-200">{value}</span>
    </div>
  )
}

/** Snake-case history token → sentence case ("correction_requested" → "Correction requested"). */
const humanize = (s: string) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) }

/** Reviewer needed for a requested role — shown so applicants know who
 *  decides (approval matrix: ADA ← DA/AG/Owner, DA ← AG/Owner, AG/Judge ← Owner). */
const APPROVER_HINT: Record<JusticeRole, string> = {
  assistant_district_attorney: 'a District Attorney, the Attorney General, or the project owner',
  district_attorney: 'the Attorney General or the project owner',
  attorney_general: 'the project owner',
  judge: 'the project owner',
}

export function JusticeMembershipRequest({ initialAgency = 'doj' }: { initialAgency?: JusticeAgency }) {
  const { session, profile, refresh } = useAuth()
  const uid = session?.user?.id ?? profile?.id ?? null
  const [req, setReq] = useState<RequestRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<TimelineEntry[] | null>(null)
  const [form, setForm] = useState<FormState>({
    display_name: '', justice_identifier: '', requested_agency: initialAgency,
    requested_justice_role: initialAgency === 'judiciary' ? 'judge' : 'assistant_district_attorney',
    reason: '', additional_notes: '',
  })
  const v = useTableVersion('justice_membership_requests')

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const rows = await list('justice_membership_requests', { eq: { applicant_id: uid }, select: JMR_COLS })
      setReq(rows[0] ?? null)
      setLoadError(false)
    } catch { setLoadError(true) }
    setLoaded(true)
  }, [uid])
  useEffect(() => { const t = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(t) }, [load, v])

  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (!loaded) return
    const key = req ? `${req.id}:${req.status}` : 'none'
    if (seeded.current === key) return
    seeded.current = key
    const agency = (req?.requested_agency === 'judiciary' ? 'judiciary' : req?.requested_agency === 'doj' ? 'doj' : initialAgency) as JusticeAgency
    const role = AGENCY_ROLES[agency].includes(req?.requested_justice_role as JusticeRole)
      ? (req!.requested_justice_role as JusticeRole)
      : AGENCY_ROLES[agency][0]
    setForm({
      display_name: req?.display_name ?? profile?.display_name ?? '',
      justice_identifier: req?.justice_identifier ?? '',
      requested_agency: agency,
      requested_justice_role: role,
      reason: req?.reason ?? '',
      additional_notes: req?.additional_notes ?? '',
    })
  }, [loaded, req, profile, initialAgency])

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setForm((f) => ({ ...f, [k]: val }))
  const setAgency = (agency: JusticeAgency) =>
    setForm((f) => ({
      ...f, requested_agency: agency,
      // Role menu is agency-scoped; an out-of-agency role can never linger
      // (the DB CHECK + review RPC reject it server-side regardless).
      requested_justice_role: AGENCY_ROLES[agency].includes(f.requested_justice_role) ? f.requested_justice_role : AGENCY_ROLES[agency][0],
    }))

  const submit = async () => {
    const name = form.display_name.trim()
    const reason = form.reason.trim()
    if (!name || !reason) { toast('Display name and reason are required.', 'warn'); return }
    if (!uid) { toast('No signed-in user — reload and try again.', 'danger'); return }
    setBusy(true)
    try {
      const fields = {
        display_name: name,
        justice_identifier: form.justice_identifier.trim() || null,
        requested_agency: form.requested_agency,
        requested_justice_role: form.requested_justice_role,
        reason,
        additional_notes: form.additional_notes.trim() || null,
      }
      let id = req?.id
      if (!id) {
        const r = await insert('justice_membership_requests', { applicant_id: uid, ...fields }, JMR_COLS)
        if (r.error) { toast(`Could not save request: ${r.error.message}`, 'danger'); return }
        id = r.data?.[0]?.id
      } else {
        const r = await update('justice_membership_requests', id, fields, JMR_COLS)
        if (r.error) { toast(`Could not save request: ${r.error.message}`, 'danger'); return }
      }
      if (!id) { toast('Could not save request.', 'danger'); return }
      const s = await rpc('justice_membership_request_submit', { p_request: id })
      if (s.error) { toast(`Submit failed: ${s.error.message}`, 'danger'); return }
      toast('Justice membership request submitted for review.', 'success')
    } finally {
      setBusy(false)
      void load()
    }
  }

  const withdraw = async () => {
    if (!req) return
    const ok = await uiConfirm('Withdraw your justice membership request?', {
      title: 'Withdraw request', confirmText: 'Withdraw',
    })
    if (!ok) return
    setBusy(true)
    const r = await rpc('justice_membership_request_withdraw', { p_request: req.id })
    setBusy(false)
    if (r.error) toast(`Withdraw failed: ${r.error.message}`, 'danger')
    else toast('Request withdrawn.', 'info')
    void load()
  }

  // Lazy-loaded decision trail for the pending panel — RLS returns only
  // non-internal rows to the applicant, and justice applicants can't read the
  // roster, so actor names are omitted. Load failures fall back to the empty
  // message.
  const toggleHistory = async () => {
    const next = !histOpen
    setHistOpen(next)
    if (!next || hist !== null || !req) return
    try {
      const rows = await list('justice_membership_request_history', { eq: { request_id: req.id }, order: 'created_at' })
      setHist(rows.map((h) => ({
        id: h.id,
        title: humanize(h.action),
        at: h.created_at,
        from: h.from_status ? humanize(h.from_status) : null,
        to: h.to_status ? humanize(h.to_status) : null,
        note: h.note,
      })))
    } catch { setHist([]) }
  }

  if (!loaded) return <p className="text-sm text-slate-400">Loading your justice membership request…</p>
  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          Couldn’t load your justice membership request (network hiccup?). Try again.
        </div>
        <Button className="w-full" onClick={() => void load()}>Retry</Button>
      </div>
    )
  }

  const status = req?.status ?? null

  if (status === 'approved' || status === 'approved_with_changes') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">
          Your justice membership was approved{status === 'approved_with_changes' ? ' with changes' : ''}. Reload to enter the Justice portal.
        </div>
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <InfoRow label="Requested" value={`${AGENCY_LABEL[req!.requested_agency as JusticeAgency] ?? req!.requested_agency} · ${justiceRoleLabel(req!.requested_justice_role)}`} />
          <InfoRow label="Assigned" value={`${AGENCY_LABEL[req!.decided_agency as JusticeAgency] ?? req!.decided_agency ?? '—'} · ${justiceRoleLabel(req!.decided_justice_role)}`} />
        </div>
        {req?.applicant_visible_decision_note && (
          <p className="text-sm text-slate-400">Reviewer note: {req.applicant_visible_decision_note}</p>
        )}
        <Button variant="primary" className="w-full" onClick={() => void refresh()}>Reload</Button>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          <p className="font-semibold">Your justice membership request was rejected.</p>
          {req?.applicant_visible_decision_note && <p className="mt-1">{req.applicant_visible_decision_note}</p>}
        </div>
        <p className="text-xs text-slate-400">One justice request is kept on file per account — contact DOJ leadership if your situation has changed.</p>
      </div>
    )
  }

  if (status === 'withdrawn') {
    return (
      <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4 text-sm text-slate-300">
        Request withdrawn — contact DOJ leadership to reopen it.
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          ⏳ Your justice membership request is awaiting review by {APPROVER_HINT[(req!.requested_justice_role as JusticeRole)] ?? 'an authorized reviewer'}.
        </div>
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <InfoRow label="Requested agency" value={AGENCY_LABEL[req!.requested_agency as JusticeAgency] ?? req!.requested_agency} />
          <InfoRow label="Requested role" value={justiceRoleLabel(req!.requested_justice_role)} />
          <InfoRow label="Submitted" value={fmtDateTime(req?.submitted_at)} />
        </div>
        <Button size="sm" variant="ghost" className="w-full" aria-expanded={histOpen} onClick={() => void toggleHistory()}>
          {histOpen ? 'Hide request history' : 'Request history'}
        </Button>
        {histOpen && (hist === null
          ? <p className="text-xs text-slate-400">Loading history…</p>
          : <WorkflowTimeline dense entries={hist} />)}
        <Button className="w-full" disabled={busy} onClick={() => void withdraw()}>Withdraw request</Button>
      </div>
    )
  }

  const correcting = status === 'correction_requested'
  return (
    <div className="space-y-3">
      {correcting ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          <p className="font-semibold">The reviewer requested corrections:</p>
          <p className="mt-1">{req?.applicant_visible_decision_note || 'Review your details and resubmit.'}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Choose the justice role you are applying for. Your selection does not grant access immediately —
          an authorized reviewer must approve your request and may adjust the final role before activation.
        </p>
      )}
      <Field label="Display Name" required>
        {(id) => <Input id={id} value={form.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="Firstname Lastname" />}
      </Field>
      <Field label="Badge / Bar / Court Identifier">
        {(id) => <Input id={id} value={form.justice_identifier} onChange={(e) => set('justice_identifier', e.target.value)} placeholder="e.g. BAR-1042" />}
      </Field>
      <Field label="Requested Agency" required>
        {(id) => (
          <Select id={id} value={form.requested_agency} onChange={(e) => setAgency(e.target.value as JusticeAgency)}>
            <option value="doj">{AGENCY_LABEL.doj}</option>
            <option value="judiciary">{AGENCY_LABEL.judiciary}</option>
          </Select>
        )}
      </Field>
      <Field label="Requested Justice Role" required>
        {(id) => (
          <Select id={id} value={form.requested_justice_role} onChange={(e) => set('requested_justice_role', e.target.value as JusticeRole)}>
            {AGENCY_ROLES[form.requested_agency].map((r) => (
              <option key={r} value={r}>{JUSTICE_ROLE_LABEL[r]}</option>
            ))}
          </Select>
        )}
      </Field>
      <p className="text-xs text-slate-500">
        {justiceRoleLabel(form.requested_justice_role)} requests are decided by {APPROVER_HINT[form.requested_justice_role]}.
      </p>
      <Field label="Reason / Assignment Note" required>
        {(id) => <Textarea id={id} rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Current position and why you are requesting justice access" />}
      </Field>
      <Field label="Additional Notes">
        {(id) => <Textarea id={id} rows={2} value={form.additional_notes} onChange={(e) => set('additional_notes', e.target.value)} />}
      </Field>
      <Button variant="primary" className="w-full" disabled={busy} onClick={() => void submit()}>
        {correcting ? 'Resubmit request' : 'Submit Request'}
      </Button>
    </div>
  )
}
