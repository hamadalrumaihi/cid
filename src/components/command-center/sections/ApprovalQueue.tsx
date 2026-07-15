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
import { fmtDateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { officerName, type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useTableVersion } from '@/lib/realtime'
import { PERMANENT_BUREAUS, ROLE_LABEL, ROLE_ORDER, bureauLabel, canApproveRequestedRole, roleLabel, type RoleParty } from '@/lib/roles'
import { signoffLabel, signoffTint } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { canReviewCase } from '../lib/approvals'

type CaseRow = Tables<'cases'>
type RequestRow = Tables<'membership_requests'>
type Bureau = RequestRow['requested_bureau']
type Role = RequestRow['requested_role']
type Decision = 'approve' | 'approve_with_changes' | 'request_correction' | 'reject'

/** JTF is never a final assignment offered here — same list the applicant saw. */
const FINAL_BUREAUS = PERMANENT_BUREAUS as readonly Bureau[]

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

/** Snake-case history token → sentence case ("approve_with_changes" → "Approve with changes"). */
const humanize = (s: string) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) }

/** Decision chain for one request — membership_request_history rendered for
 *  reviewers. Loaded lazily on first expand (RLS: command also sees
 *  internal=true rows; those notes are flagged inline). Load failures fall
 *  back to the timeline's empty message. */
function RequestHistory({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || entries !== null) return
    try {
      const rows = await list('membership_request_history', { eq: { request_id: requestId }, order: 'created_at' })
      setEntries(rows.map((h) => ({
        id: h.id,
        title: humanize(h.action),
        actor: officerName(h.actor_id),
        at: h.created_at,
        from: h.from_status ? humanize(h.from_status) : null,
        to: h.to_status ? humanize(h.to_status) : null,
        note: h.internal ? `(internal) ${h.note ?? ''}`.trimEnd() : h.note,
      })))
    } catch { setEntries([]) }
  }
  return (
    <div className="mt-3">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => void toggle()}>
        {open ? 'Hide history' : 'History'}
      </Button>
      {open && (entries === null
        ? <p className="mt-2 text-xs text-slate-400">Loading history…</p>
        : <div className="mt-2"><WorkflowTimeline dense entries={entries} /></div>)}
    </div>
  )
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
  // Client mirror of the server authority matrix (can_assign_cid_role): the
  // options offered are exactly the (bureau, role) pairs this reviewer may
  // grant. The RPC re-validates, so this is UX only.
  const actor: RoleParty = { ...(profile ?? {}), is_owner: isOwner || profile?.is_owner }
  const grantableBureaus = FINAL_BUREAUS.filter((b) =>
    (ROLE_ORDER as readonly string[]).some((r) => canApproveRequestedRole(actor, r, b)))
  const [bureau, setBureau] = useState<Bureau>(
    grantableBureaus.includes(req.requested_bureau) ? req.requested_bureau : (grantableBureaus[0] ?? req.requested_bureau))
  const roleOptions = (ROLE_ORDER as readonly string[]).filter((r) => canApproveRequestedRole(actor, r, bureau))
  const [role, setRole] = useState<Role>(req.requested_role)
  const effectiveRole = roleOptions.includes(role) ? role : ((roleOptions[0] ?? role) as Role)
  const [note, setNote] = useState('')
  const [internal, setInternal] = useState('')
  const [busy, setBusy] = useState(false)

  const approving = kind === 'approve' || kind === 'approve_with_changes'
  const finalBureau = kind === 'approve' ? req.requested_bureau : bureau
  const finalRole = kind === 'approve' ? req.requested_role : (effectiveRole as Role)
  const changed = approving && (finalBureau !== req.requested_bureau || finalRole !== req.requested_role)
  // Corrections/rejections always need a note; so does any approval that
  // differs from the request (the server refuses a change without a reason).
  const needsNote = kind === 'request_correction' || kind === 'reject' || changed
  const cannotApprove = approving && !canApproveRequestedRole(actor, finalRole, finalBureau)

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
            <Field label="Final Department" required hint="Options are limited to departments you may assign into.">
              {(id) => (
                <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value as Bureau)}>
                  {grantableBureaus.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Final Role" required hint="Options are limited to roles you may grant here.">
              {(id) => (
                <Select id={id} value={effectiveRole} onChange={(e) => setRole(e.target.value as Role)}>
                  {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
              )}
            </Field>
          </div>
        )}

        {cannotApprove && (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
            Granting {roleLabel(finalRole)} in {bureauLabel(finalBureau)} requires higher authority
            (Detective/Senior Detective — Bureau Lead of that bureau or higher; Bureau Lead — Deputy
            Director or higher; Deputy Director — Director; Director — Owner). Use “Approve with
            Changes” for an assignment within your authority, or leave it for higher command.
          </p>
        )}

        {(needsNote || kind === 'approve_with_changes') && (
          <div className="mt-4 space-y-3">
            <Field
              label={kind === 'reject' ? 'Reason shown to applicant'
                : changed ? 'Reason for the change (shown to applicant)' : 'Note to applicant'}
              required={needsNote}
            >
              {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'reject' ? 'Why this request is being rejected' : changed ? 'Why the assignment differs from what was requested' : 'What needs to be corrected before resubmitting'} />}
            </Field>
            <Field label="Internal note (Command only)">
              {(id) => <Textarea id={id} rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} />}
            </Field>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={kind === 'reject' ? 'danger' : 'primary'} disabled={busy || cannotApprove || (needsNote && !note.trim())} onClick={() => void run()}>
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
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const router = useRouter()
  const [cases, setCases] = useState<CaseRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [decision, setDecision] = useState<{ req: RequestRow; kind: Decision } | null>(null)
  const vP = useTableVersion('profiles')
  const vC = useTableVersion('cases')
  const vM = useTableVersion('membership_requests')
  const vJ = useTableVersion('justice_memberships')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    void fetchJustice()
    try { setCases(await list('cases', { order: 'updated_at', ascending: false })) } catch { /* stale */ }
    if (isCommand) {
      const [rq, em] = await Promise.all([
        rpc('admin_membership_requests', undefined as never),
        rpc('admin_member_emails', undefined as never),
      ])
      if (!rq.error && Array.isArray(rq.data)) setRequests(rq.data)
      if (!em.error && Array.isArray(em.data)) setEmails(Object.fromEntries(em.data.map((x) => [x.id, x.email])))
    }
  }, [fetchProfiles, fetchJustice, isCommand])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, vP, vC, vM, vJ])

  const reqByApplicant = new Map(requests.map((r) => [r.applicant_id, r]))
  // Members moved out of CID by an organization correction are inactive-with-a-
  // justice-identity — they are not pending sign-ins and must never surface a
  // quick Approve (which is now blocked server-side anyway).
  const pending = profiles.filter((p) => !p.removed_at && !p.active && !justiceByUser[p.id])
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
    // Activation-only since v1.16 — role/division stay exactly as they are.
    const res = await rpc('assign_member', { target: p.id, set_active: true })
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
                  <p className="text-slate-400">Submitted <span className="text-slate-200">{fmtDateTime(r.submitted_at)}</span></p>
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
                <RequestHistory requestId={r.id} />
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
