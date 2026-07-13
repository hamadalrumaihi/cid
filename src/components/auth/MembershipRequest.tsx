'use client'

/** Membership request — the pending-gate applicant flow. An inactive user
 *  files ONE request (unique per applicant, RLS-enforced): draft/correction →
 *  editable form, pending → status + withdraw, decided → outcome panel. All
 *  transitions go through the membership_request_* RPCs; the DB freezes every
 *  non-applicant column. Rendered inside the Gate card, so panels reuse its
 *  amber/rose notice language. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { insert, list, rpc, update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useTableVersion } from '@/lib/realtime'
import { BUREAUS, ROLE_LABEL, bureauLabel, roleLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'

type RequestRow = Tables<'membership_requests'>
/** Explicit projection — internal_decision_note is column-grant-revoked for
 *  clients, so a default select('*') (incl. insert/update returning) is a
 *  PostgREST 42501 for every applicant. */
const MR_COLS = 'id,applicant_id,display_name,badge_number,requested_bureau,requested_role,reason,additional_notes,status,decided_bureau,decided_role,applicant_visible_decision_note,decided_by,decided_at,submitted_at,created_at,updated_at'
/** JTF is never offered to applicants (CHECK-enforced server-side too). */
const APPLICANT_BUREAUS = ['LSB', 'BCB', 'SAB'] as const
const APPLICANT_ROLES = ['detective', 'senior_detective'] as const
type ApplicantBureau = (typeof APPLICANT_BUREAUS)[number]
type ApplicantRole = (typeof APPLICANT_ROLES)[number]

interface FormState {
  display_name: string
  badge_number: string
  requested_bureau: ApplicantBureau
  requested_role: ApplicantRole
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

export function MembershipRequest() {
  const { session, profile, refresh } = useAuth()
  const uid = session?.user?.id ?? profile?.id ?? null
  const [req, setReq] = useState<RequestRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<TimelineEntry[] | null>(null)
  const [form, setForm] = useState<FormState>({
    display_name: '', badge_number: '', requested_bureau: 'LSB', requested_role: 'detective', reason: '', additional_notes: '',
  })
  const v = useTableVersion('membership_requests')

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const rows = await list('membership_requests', { eq: { applicant_id: uid }, select: MR_COLS })
      setReq(rows[0] ?? null)
      setLoadError(false)
    } catch { setLoadError(true) }
    setLoaded(true)
  }, [uid])
  useEffect(() => { const t = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(t) }, [load, v])

  // Seed the form from the request row (or profile prefill) once per
  // id+status transition, so realtime refetches never clobber typing.
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (!loaded) return
    const key = req ? `${req.id}:${req.status}` : 'none'
    if (seeded.current === key) return
    seeded.current = key
    setForm({
      display_name: req?.display_name ?? profile?.display_name ?? '',
      badge_number: req?.badge_number ?? profile?.badge_number ?? '',
      requested_bureau: (APPLICANT_BUREAUS as readonly string[]).includes(req?.requested_bureau ?? '') ? (req!.requested_bureau as ApplicantBureau) : 'LSB',
      requested_role: req?.requested_role === 'senior_detective' ? 'senior_detective' : 'detective',
      reason: req?.reason ?? '',
      additional_notes: req?.additional_notes ?? '',
    })
  }, [loaded, req, profile])

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setForm((f) => ({ ...f, [k]: val }))

  const submit = async () => {
    const name = form.display_name.trim()
    const reason = form.reason.trim()
    if (!name || !reason) { toast('Display name and reason are required.', 'warn'); return }
    if (!uid) { toast('No signed-in user — reload and try again.', 'danger'); return }
    setBusy(true)
    try {
      const fields = {
        display_name: name,
        badge_number: form.badge_number.trim() || null,
        requested_bureau: form.requested_bureau,
        requested_role: form.requested_role,
        reason,
        additional_notes: form.additional_notes.trim() || null,
      }
      let id = req?.id
      if (!id) {
        const r = await insert('membership_requests', { applicant_id: uid, ...fields }, MR_COLS)
        if (r.error) { toast(`Could not save request: ${r.error.message}`, 'danger'); return }
        id = r.data?.[0]?.id
      } else {
        const r = await update('membership_requests', id, fields, MR_COLS)
        if (r.error) { toast(`Could not save request: ${r.error.message}`, 'danger'); return }
      }
      if (!id) { toast('Could not save request.', 'danger'); return }
      const s = await rpc('membership_request_submit', { p_request: id })
      if (s.error) { toast(`Submit failed: ${s.error.message}`, 'danger'); return }
      toast('Membership request submitted — Command has been notified.', 'success')
    } finally {
      setBusy(false)
      void load()
    }
  }

  const withdraw = async () => {
    if (!req) return
    const ok = await uiConfirm('Withdraw your membership request? You will need to contact Command to reopen it.', {
      title: 'Withdraw request', confirmText: 'Withdraw',
    })
    if (!ok) return
    setBusy(true)
    const r = await rpc('membership_request_withdraw', { p_request: req.id })
    setBusy(false)
    if (r.error) toast(`Withdraw failed: ${r.error.message}`, 'danger')
    else toast('Request withdrawn.', 'info')
    void load()
  }

  // Lazy-loaded decision trail for the pending panel — RLS returns only
  // non-internal rows to the applicant, and applicants can't read the roster,
  // so actor names are omitted. Load failures fall back to the empty message.
  const toggleHistory = async () => {
    const next = !histOpen
    setHistOpen(next)
    if (!next || hist !== null || !req) return
    try {
      const rows = await list('membership_request_history', { eq: { request_id: req.id }, order: 'created_at' })
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

  if (!loaded) return <p className="text-sm text-slate-400">Loading your membership request…</p>
  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          Couldn’t load your membership request (network hiccup?). Try again.
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
          Your membership request was approved{status === 'approved_with_changes' ? ' with changes' : ''}. Reload to enter the portal.
        </div>
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <InfoRow label="Requested" value={`${bureauLabel(req!.requested_bureau)} · ${roleLabel(req!.requested_role)}`} />
          <InfoRow label="Assigned" value={`${bureauLabel(req!.decided_bureau)} · ${roleLabel(req!.decided_role)}`} />
        </div>
        {req?.applicant_visible_decision_note && (
          <p className="text-sm text-slate-400">Note from Command: {req.applicant_visible_decision_note}</p>
        )}
        <Button variant="primary" className="w-full" onClick={() => void refresh()}>Reload</Button>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          <p className="font-semibold">Your membership request was rejected.</p>
          {req?.applicant_visible_decision_note && <p className="mt-1">{req.applicant_visible_decision_note}</p>}
        </div>
        <p className="text-xs text-slate-400">One request is kept on file per account — contact Command if you believe this was in error or your situation has changed.</p>
      </div>
    )
  }

  if (status === 'withdrawn') {
    return (
      <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4 text-sm text-slate-300">
        Request withdrawn — contact Command to reopen it.
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          ⏳ Your membership request is awaiting Command review.
        </div>
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <InfoRow label="Requested department" value={bureauLabel(req!.requested_bureau)} />
          <InfoRow label="Requested role" value={roleLabel(req!.requested_role)} />
          <InfoRow label="Submitted" value={req?.submitted_at ? new Date(req.submitted_at).toLocaleString() : '—'} />
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

  // No request yet, an unsent draft, or a correction round — show the form.
  const correcting = status === 'correction_requested'
  return (
    <div className="space-y-3">
      {correcting ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          <p className="font-semibold">Command requested corrections:</p>
          <p className="mt-1">{req?.applicant_visible_decision_note || 'Review your details and resubmit.'}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Your account has not been approved yet. Submit your department request so Command can verify your assignment.
        </p>
      )}
      <Field label="Display Name" required>
        {(id) => <Input id={id} value={form.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="Firstname Lastname" />}
      </Field>
      <Field label="Badge Number">
        {(id) => <Input id={id} value={form.badge_number} onChange={(e) => set('badge_number', e.target.value)} placeholder="e.g. 4211" />}
      </Field>
      <Field label="Requested Department" required>
        {(id) => (
          <Select id={id} value={form.requested_bureau} onChange={(e) => set('requested_bureau', e.target.value as ApplicantBureau)}>
            {APPLICANT_BUREAUS.map((b) => <option key={b} value={b}>{b} — {BUREAUS[b]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Requested CID Role" required>
        {(id) => (
          <Select id={id} value={form.requested_role} onChange={(e) => set('requested_role', e.target.value as ApplicantRole)}>
            {APPLICANT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Reason / Current Assignment Note" required>
        {(id) => <Textarea id={id} rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Current department, rank and why you are requesting CID access" />}
      </Field>
      <Field label="Additional Notes">
        {(id) => <Textarea id={id} rows={2} value={form.additional_notes} onChange={(e) => set('additional_notes', e.target.value)} />}
      </Field>
      {profile?.discord_id && (
        <p className="text-xs text-slate-400">
          Discord ID <span className="font-mono text-slate-200">{profile.discord_id}</span> was captured at sign-in and is attached automatically.
        </p>
      )}
      <Button variant="primary" className="w-full" disabled={busy} onClick={() => void submit()}>
        {correcting ? 'Resubmit request' : 'Submit Request'}
      </Button>
    </div>
  )
}
