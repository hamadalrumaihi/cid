'use client'

/** Command Center → Approval Queue. One aggregated view of everything waiting
 *  on a command decision: (1) submitted membership requests (reviewed through
 *  the `review_membership_request` RPC, which activates the profile atomically
 *  on approval), (2) pending sign-ins WITHOUT a request (the legacy one-click
 *  `assign_member` activate), and (3) cases whose sign-off stage THIS command
 *  user can decide — those deep-link into the case Sign-off tab (the
 *  `signoff_decide` RPC is the authority). */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list, rpc } from '@/lib/db'
import type { Database, Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL, ROLE_ORDER, SUBMIT_ROLES, bureauLabel, roleLabel } from '@/lib/roles'
import { signoffLabel, signoffTint } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { canReviewCase } from '../lib/approvals'

type CaseRow = Tables<'cases'>
type RequestRow = Tables<'membership_requests'>
type Bureau = RequestRow['requested_bureau']
type Role = RequestRow['requested_role']
type Decision = 'approve' | 'approve_with_changes' | 'request_correction' | 'reject'

/** JTF is never a final assignment offered here — same list the applicant saw. */
const FINAL_BUREAUS: Bureau[] = ['LSB', 'BCB', 'SAB']

const TITLE: Record<Decision, string> = {
  approve: 'Approve as Requested',
  approve_with_changes: 'Approve with Changes',
  request_correction: 'Request Correction',
  reject: 'Reject Request',
}
const CONFIRM: Record<Decision, string> = {
  approve: 'Approve & Activate',
  approve_with_changes: 'Approve & Activate',
  request_correction: 'Send Back for Correction',
  reject: 'Reject Request',
}
const DONE: Record<Decision, string> = {
  approve: 'approved as requested — account activated',
  approve_with_changes: 'approved with changes — account activated',
  request_correction: 'sent back for correction',
  reject: 'rejected',
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-200">{value}</span>
    </div>
  )
}

function DecisionModal({ req, kind, onClose, onDone }: {
  req: RequestRow
  kind: Decision
  onClose: () => void
  onDone: () => void
}) {
  const { profile, isOwner } = useAuth()
  // Client mirror of the server rule: a bureau lead (who is not the owner)
  // assigns into their own division only, and cannot grant command roles.
  const leadLocked = profile?.role === 'bureau_lead' && !isOwner
  const [bureau, setBureau] = useState<Bureau>(leadLocked ? ((profile?.division as Bureau) ?? req.requested_bureau) : req.requested_bureau)
  const [role, setRole] = useState<Role>(req.requested_role)
  const [note, setNote] = useState('')
  const [internal, setInternal] = useState('')
  const [busy, setBusy] = useState(false)

  const approving = kind === 'approve' || kind === 'approve_with_changes'
  const needsNote = kind === 'request_correction' || kind === 'reject'
  const finalBureau = kind === 'approve' ? req.requested_bureau : bureau
  const finalRole = kind === 'approve' ? req.requested_role : role
  const roleOptions = leadLocked ? (SUBMIT_ROLES as readonly string[]) : (ROLE_ORDER as readonly string[])

  const run = async () => {
    if (needsNote && !note.trim()) { toast('A note to the applicant is required.', 'warn'); return }
    setBusy(true)
    const args: Database['public']['Functions']['review_membership_request']['Args'] = { p_request: req.id, p_decision: kind }
    if (approving) { args.p_final_bureau = finalBureau; args.p_final_role = finalRole }
    if (note.trim()) args.p_applicant_note = note.trim()
    if (internal.trim()) args.p_internal_note = internal.trim()
    const res = await rpc('review_membership_request', args)
    setBusy(false)
    if (res.error) { toast(`Decision failed: ${res.error.message}`, 'danger'); return }
    toast(`${req.display_name} ${DONE[kind]}`, 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(note.trim() || internal.trim())}>
      <div className="p-6">
        <ModalHeader title={TITLE[kind]} onClose={onClose} />
        <div className="space-y-1.5 rounded-xl border border-white/10 bg-ink-950/50 p-4">
          <SummaryRow label="Applicant" value={req.display_name} />
          <SummaryRow label="Requested" value={`${bureauLabel(req.requested_bureau)} — ${roleLabel(req.requested_role)}`} />
          {approving && <SummaryRow label="Final Assignment" value={`${bureauLabel(finalBureau)} — ${roleLabel(finalRole)}`} />}
          {approving && <SummaryRow label="Activate Account" value="Yes" />}
        </div>

        {kind === 'approve_with_changes' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Final Department" required hint={leadLocked ? 'Locked to your division (bureau lead).' : undefined}>
              {(id) => (
                <Select id={id} value={bureau} disabled={leadLocked} onChange={(e) => setBureau(e.target.value as Bureau)}>
                  {leadLocked
                    ? <option value={bureau}>{bureauLabel(bureau)}</option>
                    : FINAL_BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Final Role" required>
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
              )}
            </Field>
          </div>
        )}

        {needsNote && (
          <div className="mt-4 space-y-3">
            <Field label={kind === 'reject' ? 'Reason shown to applicant' : 'Note to applicant'} required>
              {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'reject' ? 'Why this request is being rejected' : 'What needs to be corrected before resubmitting'} />}
            </Field>
            <Field label="Internal note (Command only)">
              {(id) => <Textarea id={id} rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} />}
            </Field>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={kind === 'reject' ? 'danger' : 'primary'} disabled={busy || (needsNote && !note.trim())} onClick={() => void run()}>
            {CONFIRM[kind]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function ApprovalQueue() {
  const { profile, isCommand } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const router = useRouter()
  const [cases, setCases] = useState<CaseRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [decision, setDecision] = useState<{ req: RequestRow; kind: Decision } | null>(null)
  const vP = useTableVersion('profiles')
  const vC = useTableVersion('cases')
  const vM = useTableVersion('membership_requests')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    try { setCases(await list('cases', { order: 'updated_at', ascending: false })) } catch { /* stale */ }
    if (isCommand) {
      const [rq, em] = await Promise.all([
        rpc('admin_membership_requests', undefined as never),
        rpc('admin_member_emails', undefined as never),
      ])
      if (!rq.error && Array.isArray(rq.data)) setRequests(rq.data)
      if (!em.error && Array.isArray(em.data)) setEmails(Object.fromEntries(em.data.map((x) => [x.id, x.email])))
    }
  }, [fetchProfiles, isCommand])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, vP, vC, vM])

  const reqByApplicant = new Map(requests.map((r) => [r.applicant_id, r]))
  const pending = profiles.filter((p) => !p.removed_at && !p.active)
  const submitted = pending
    .map((p) => ({ p, r: reqByApplicant.get(p.id) }))
    .filter((x): x is { p: RosterProfile; r: RequestRow } => x.r?.status === 'pending')
  // Members whose flow is running through a request stay out of quick approve.
  const legacy = pending.filter((p) => {
    const s = reqByApplicant.get(p.id)?.status
    return s !== 'pending' && s !== 'correction_requested'
  })
  const awaitingApplicant = requests.filter((r) => r.status === 'correction_requested')
  const reviews = cases.filter((c) => canReviewCase(c, profile))

  const approve = async (p: RosterProfile) => {
    const res = await rpc('assign_member', { target: p.id, new_role: p.role, new_division: p.division, set_active: true })
    if (res.error) { toast(`Approve failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} approved for access`, 'success')
    void notify(p.id, 'member_approved', { detective: profile?.display_name || 'Command', reason: 'Your CID access has been approved — welcome aboard.' })
    void refresh()
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Pending membership requests <span className="text-slate-500">({submitted.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">Submitted department requests awaiting a Command decision. Approval activates the account atomically.</p>
        {submitted.length ? (
          <div className="space-y-3">
            {submitted.map(({ p, r }) => (
              <div key={r.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{r.display_name}</p>
                    <p className="text-[11px] text-slate-400">
                      {emails[r.applicant_id] || p.display_name}{p.discord_id ? ` · Discord ${p.discord_id}` : ''}
                    </p>
                  </div>
                  <Badge tone="warn">Pending review</Badge>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <p className="text-slate-400">Badge <span className="text-slate-200">{r.badge_number || '—'}</span></p>
                  <p className="text-slate-400">Submitted <span className="text-slate-200">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}</span></p>
                  <p className="text-slate-400">Requested department <span className="text-slate-200">{bureauLabel(r.requested_bureau)}</span></p>
                  <p className="text-slate-400">Requested role <span className="text-slate-200">{roleLabel(r.requested_role)}</span></p>
                </div>
                <p className="mt-2 text-sm text-slate-300"><span className="text-xs font-semibold text-slate-400">Reason:</span> {r.reason}</p>
                {r.additional_notes && <p className="mt-1 text-sm text-slate-300"><span className="text-xs font-semibold text-slate-400">Notes:</span> {r.additional_notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setDecision({ req: r, kind: 'approve' })}>Approve as Requested</Button>
                  <Button size="sm" onClick={() => setDecision({ req: r, kind: 'approve_with_changes' })}>Approve with Changes</Button>
                  <Button size="sm" onClick={() => setDecision({ req: r, kind: 'request_correction' })}>Request Correction</Button>
                  <Button size="sm" variant="danger" onClick={() => setDecision({ req: r, kind: 'reject' })}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-emerald-300">✓ No submitted requests waiting.</p>}
        {awaitingApplicant.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-slate-400">Waiting on applicant ({awaitingApplicant.length}) — corrections requested, no action needed until they resubmit.</p>
            <div className="space-y-2">
              {awaitingApplicant.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-ink-950/40 px-4 py-2.5 opacity-80">
                  <div>
                    <p className="text-sm font-semibold text-slate-300">{r.display_name}</p>
                    <p className="text-[11px] text-slate-400">{bureauLabel(r.requested_bureau)} · {roleLabel(r.requested_role)}</p>
                  </div>
                  <Badge tone="neutral">Correction requested</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Pending member approvals <span className="text-slate-500">({legacy.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">Sign-ins without a submitted membership request. Quick approve activates them with their current profile role/division.</p>
        {legacy.length ? (
          <div className="space-y-2">
            {legacy.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
                <div><p className="text-sm font-semibold text-white">{p.display_name}</p><p className="text-[11px] text-slate-400">{ROLE_LABEL[p.role] || p.role} · {p.division}</p></div>
                <button onClick={() => void approve(p)} title="Legacy quick approve — activates with the profile's current role and division" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">✓ Approve</button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-emerald-300">✓ No pending sign-ins.</p>}
      </section>

      <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Sign-offs awaiting your decision <span className="text-slate-500">({reviews.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">Cases at a stage your role can decide. Opens the case Sign-off tab, where the decision is recorded.</p>
        {reviews.length ? (
          <div className="space-y-2">
            {reviews.map((c) => (
              <button key={c.id} onClick={() => router.push(`/cases?case=${c.id}&tab=signoff`)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 px-4 py-2.5 text-left transition hover:border-badge-400/50">
                <div><p className="font-mono text-sm font-bold text-white">{c.case_number}</p><p className="text-[11px] text-slate-400">{c.title || 'Untitled'} · {c.bureau}</p></div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-emerald-300">✓ No sign-offs waiting on you.</p>}
      </section>
      <p className="text-[11px] text-slate-500">The same reviews appear on your <b>My Desk</b> tab; this is the command-wide aggregate. Decisions and member activation are unchanged — the database enforces who may decide each stage.</p>

      {decision && (
        <DecisionModal
          req={decision.req}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); void refresh() }}
        />
      )}
    </div>
  )
}
