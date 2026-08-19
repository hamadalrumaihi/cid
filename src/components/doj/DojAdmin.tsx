'use client'

/** Attorney General administration — the minimal-DOJ management surface:
 *   - Memberships: the three live roles (prosecutor / judge / attorney
 *     general) with activate/deactivate (deactivation auto-returns unfinished
 *     work to the queues server-side) and explicit appointment
 *     (justice_appoint — direct and effective immediately; an active CID
 *     member is transferred inline, which takes DD+/Owner authority).
 *   - Coverage: temporary cross-bureau prosecutor coverage
 *     (justice_set_coverage / justice_end_coverage) — explicit, dated,
 *     audited, endable; AG authority cannot bypass bureau eligibility.
 *   - Transfers: the CID↔DOJ transfer queue (member_transfers) — DOJ-stage
 *     decisions, the handover checklist, and transactional activation.
 *   - Held work: claimed prosecutorial reviews with reassign / return-to-queue
 *     (a request can never be stranded).
 *  Every write is a definer RPC; RLS scopes every read. Names come from
 *  justice_directory() — a pure AG has no CID roster access (the appoint form
 *  falls back to a raw account-ID input for them); command/owner viewers get
 *  a real member picker from the shared roster cache. */
import { useCallback, useEffect, useState } from 'react'
import { useNow } from '@/lib/useNow'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { roleLabel } from '@/lib/roles'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { justiceRoleLabel, type LegalRequest } from '@/lib/justice'
import { CID_ROUTING_BUREAUS, humanize, type RoutingBureau } from '@/lib/legalWorkflow'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/PageHeader'
import { effectiveJusticeRole } from '@/components/justice/legalShared'
import { isRecusalError } from './RecusalBanner'
import { JusticePickerModal } from './JusticePickerModal'

type Transfer = Tables<'member_transfers'>
type Membership = Tables<'justice_memberships'>
type Coverage = Tables<'prosecutor_coverage'>

interface DirectoryEntry { user_id: string; display_name: string; justice_role: string; active: boolean }

/** justice_migration_review() → prosecutors_without_bureau entries (defensive
 *  parse — the report is jsonb). */
interface NoBureauEntry { user_id: string; name: string | null }
function parseNoBureau(data: unknown): NoBureauEntry[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const raw = (data as Record<string, unknown>).prosecutors_without_bureau
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.user_id === 'string')
    .map((x) => ({ user_id: String(x.user_id), name: typeof x.name === 'string' ? x.name : null }))
}

const OPEN_TRANSFER = ['requested', 'cid_approved', 'doj_accepted']

/* ── Appoint form ─────────────────────────────────────────────────────────── */
function AppointModal({ busy, onSubmit, onClose }: {
  busy: boolean
  onSubmit: (v: { userId: string; role: string; reason: string; bureau: RoutingBureau | '' }) => void
  onClose: () => void
}) {
  const { isCommand, isOwner } = useAuth()
  // Command/owner viewers can read the CID roster (RLS) — give them a real
  // member picker. A pure AG cannot, so the raw account-ID input remains
  // their path (the server enforces eligibility either way).
  const canRoster = isCommand || isOwner
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (canRoster) void fetchProfiles() }, [canRoster, fetchProfiles])
  const members = profiles
    .filter((p) => !p.removed_at && !p.is_system && !p.login_denied)
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active)
      || (a.display_name || '').localeCompare(b.display_name || ''))
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('prosecutor')
  const [bureau, setBureau] = useState<RoutingBureau | ''>('')
  const [reason, setReason] = useState('')
  // A prosecutor needs a home bureau (justice_appoint refuses without one).
  const ready = userId.trim() !== '' && (role !== 'prosecutor' || bureau !== '')
  return (
    <Modal open onClose={onClose} dirty={() => userId.trim() !== '' || reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title="Appoint a DOJ member" onClose={onClose} />
        <p className="text-sm text-slate-400">
          Appointment is direct and effective immediately — no approval chain. An active CID member is
          transferred inline: their CID membership ends the moment you appoint (moving an active member
          takes Deputy Director+ or Owner authority). Inactive or unassigned accounts are appointed
          directly. An Attorney General is appointed by the Owner only.
        </p>
        <div className="mt-4 space-y-4">
          {canRoster ? (
            <Field label="Member" required hint="Active CID members are moved inline (their CID membership ends immediately); inactive accounts are appointed directly.">
              {(id) => (
                <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">Select…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name || 'Member'} — {m.active
                        ? `${roleLabel(m.role)}${m.division ? ` · ${m.division}` : ''}`
                        : 'inactive'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Member account ID" required hint="The account's profile ID (from their transfer record or the Owner roster).">
              {(id) => <Input id={id} value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" placeholder="00000000-0000-…" />}
            </Field>
          )}
          <Field label="Role" required>
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="prosecutor">Prosecutor</option>
                <option value="judge">Judge</option>
                <option value="attorney_general">Attorney General (Owner only)</option>
              </Select>
            )}
          </Field>
          {role === 'prosecutor' && (
            <Field label="Home bureau" required hint="The one bureau queue this prosecutor works. Cross-bureau work takes temporary coverage from you.">
              {(id) => (
                <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value as RoutingBureau | '')}>
                  <option value="">Select…</option>
                  {CID_ROUTING_BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Reason" hint="Optional — recorded in the audit log.">
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ userId: userId.trim(), role, reason: reason.trim(), bureau })}>
            {busy ? 'Appointing…' : 'Appoint'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Coverage grant form (justice_set_coverage) ───────────────────────────── */
function CoverageModal({ prosecutors, busy, onSubmit, onClose }: {
  /** ACTIVE effective prosecutors from justice_directory (the justice-domain
   *  name source — never the CID roster). */
  prosecutors: DirectoryEntry[]
  busy: boolean
  onSubmit: (v: { userId: string; bureau: RoutingBureau; reason: string; expires: string }) => void
  onClose: () => void
}) {
  const [userId, setUserId] = useState('')
  const [bureau, setBureau] = useState<RoutingBureau | ''>('')
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  const invalidExpiry = expires !== '' && Number.isNaN(new Date(expires).getTime())
  const ready = userId !== '' && bureau !== '' && reason.trim() !== '' && !invalidExpiry
  return (
    <Modal open onClose={onClose} dirty={() => userId !== '' || reason.trim() !== '' || expires !== ''}>
      <div className="p-5">
        <ModalHeader title="Grant temporary coverage" onClose={onClose} />
        <p className="text-sm text-slate-400">
          Coverage lets a prosecutor work another bureau&rsquo;s queue — explicit, dated, audited, and
          endable. It never changes their home bureau. Use it when a bureau has no active prosecutor.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Prosecutor" required>
            {(id) => (
              <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select…</option>
                {prosecutors.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name || 'Member'}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Bureau to cover" required>
            {(id) => (
              <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value as RoutingBureau | '')}>
                <option value="">Select…</option>
                {CID_ROUTING_BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reason" required hint="Required — recorded in the audit log and shown on the coverage record.">
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Field label="Expires" hint="Optional — when the coverage lapses automatically. Must be in the future.">
            {(id) => <Input id={id} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}
          </Field>
          {invalidExpiry && <p className="text-xs text-rose-300">That date/time could not be read — fix or clear it.</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={() => bureau && onSubmit({ userId, bureau, reason: reason.trim(), expires })}
          >
            {busy ? 'Granting…' : 'Grant coverage'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Transfer decision (DOJ stage) ────────────────────────────────────────── */
function TransferDecideModal({ transfer, decision, busy, onSubmit, onClose }: {
  transfer: Transfer
  decision: 'approve' | 'return' | 'reject'
  busy: boolean
  onSubmit: (v: { note: string; retain: boolean; expires: string }) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [retain, setRetain] = useState(false)
  const [expires, setExpires] = useState('')
  const needNote = decision !== 'approve'
  const dualAllowed = decision === 'approve' && transfer.direction === 'cid_to_doj'
  const ready = (!needNote || note.trim() !== '') && (!retain || expires !== '')
  const title = decision === 'approve' ? 'Accept transfer' : decision === 'return' ? 'Return transfer' : 'Reject transfer'
  return (
    <Modal open onClose={onClose} dirty={() => note.trim() !== '' || retain}>
      <div className="p-5">
        <ModalHeader title={title} onClose={onClose} />
        <p className="text-sm text-slate-400">
          {humanize(transfer.direction)} · {justiceRoleLabel(transfer.requested_role)}
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Note" required={needNote} hint={needNote ? 'Required — the member sees it.' : 'Optional.'}>
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {dualAllowed && (
            <>
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-badge-500"
                />
                Temporary dual membership (member keeps CID)
              </label>
              {retain && (
                <Field label="Dual membership expires" required hint="Required — within 90 days; expiry is automatic.">
                  {(id) => <Input id={id} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}
                </Field>
              )}
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ note: note.trim(), retain, expires })}>
            {busy ? 'Recording…' : title}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Handover checklist display ───────────────────────────────────────────── */
const HANDOVER_LABEL: Record<string, string> = {
  led_cases: 'Led cases (need a new lead before activation)',
  open_assignments: 'Open case assignments',
  open_tasks: 'Open tasks',
  draft_reports: 'Draft reports',
  open_legal_requests: 'Open legal requests',
  pending_signoffs: 'Pending sign-offs routed to the member',
  held_doj_work: 'Held DOJ work (requeued automatically)',
}

function HandoverModal({ handover, onClose }: { handover: Record<string, unknown>; onClose: () => void }) {
  return (
    <Modal open onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Handover checklist" onClose={onClose} />
        <p className="text-sm text-slate-400">
          Everything the member still owns. Activation refuses while a led case lacks a named new lead.
        </p>
        <ul className="mt-4 space-y-2">
          {Object.entries(HANDOVER_LABEL).map(([key, label]) => {
            const v = handover[key]
            const items = Array.isArray(v) ? (v as Record<string, unknown>[]) : []
            return (
              <li key={key} className="rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">{label}</span>
                  <Badge tone={items.length ? 'warn' : 'good'}>{items.length}</Badge>
                </div>
                {items.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {items.map((it) => String(it.number ?? it.title ?? it.id ?? '')).filter(Boolean).slice(0, 6).join(' · ')}
                    {items.length > 6 ? ` · +${items.length - 6} more` : ''}
                  </p>
                )}
              </li>
            )
          })}
          <li className="rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-200">Unread notifications</span>
              <Badge tone="neutral">{String(handover.unread_notifications ?? 0)}</Badge>
            </div>
          </li>
        </ul>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── The panel ────────────────────────────────────────────────────────────── */
export function DojAdmin({ requests, onOpen, reload, onConflict }: {
  requests: LegalRequest[]
  onOpen: (id: string) => void
  reload: () => void
  /** Bubble a recusal/conflict refusal up to the workspace banner. */
  onConflict: (message: string) => void
}) {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [coverage, setCoverage] = useState<Coverage[]>([])
  const [noBureau, setNoBureau] = useState<NoBureauEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [appointOpen, setAppointOpen] = useState(false)
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [decide, setDecide] = useState<{ transfer: Transfer; decision: 'approve' | 'return' | 'reject' } | null>(null)
  const [handover, setHandover] = useState<Record<string, unknown> | null>(null)
  const [reassign, setReassign] = useState<LegalRequest | null>(null)
  const jmVersion = useTableVersion('justice_memberships')
  const mtVersion = useTableVersion('member_transfers')
  const pcVersion = useTableVersion('prosecutor_coverage')
  const [tick, setTick] = useState(0)
  const now = useNow()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const dir = await rpc('justice_directory', undefined as never)
      if (!cancelled && !dir.error && dir.data) setDirectory(dir.data as DirectoryEntry[])
      try {
        const rows = await list('justice_memberships', { order: 'approved_at', ascending: false })
        if (!cancelled) setMemberships(rows)
      } catch { /* membership dates unavailable — the directory still renders */ }
      try {
        const rows = await list('member_transfers', { order: 'updated_at', ascending: false })
        if (!cancelled) setTransfers(rows)
      } catch { /* transfers unavailable */ }
      try {
        const rows = await list('prosecutor_coverage', { order: 'starts_at', ascending: false })
        if (!cancelled) setCoverage(rows)
      } catch { /* coverage unavailable */ }
      // Migration attention: legacy prosecutor rows with no home bureau cover
      // NO queue until re-appointed with one (owner/AG-only report; an
      // {error} payload simply yields an empty list).
      const rev = await rpc('justice_migration_review', undefined as never)
      if (!cancelled && !rev.error) setNoBureau(parseNoBureau(rev.data))
    })()
    return () => { cancelled = true }
  }, [jmVersion, mtVersion, pcVersion, tick])
  const refresh = useCallback(() => { setTick((t) => t + 1); reload() }, [reload])

  const name = (id: string | null | undefined): string =>
    (id && directory.find((d) => d.user_id === id)?.display_name) || (id ? `${id.slice(0, 8)}…` : '—')

  const act = async (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (res.error) {
      if (isRecusalError(res.error.message)) onConflict(res.error.message)
      toast(res.error.message, 'danger')
      return false
    }
    toast(okMsg, 'success')
    refresh()
    return true
  }

  const setActive = async (userId: string, active: boolean) => {
    await act(
      () => rpc('set_justice_membership_active', { p_target: userId, p_active: active }),
      active ? 'Membership reactivated.' : 'Membership deactivated — their unfinished work returned to the queues.',
    )
  }

  const appoint = async (v: { userId: string; role: string; reason: string; bureau: RoutingBureau | '' }) => {
    const ok = await act(
      () => rpc('justice_appoint', {
        p_user: v.userId,
        p_role: v.role,
        p_reason: v.reason || undefined,
        // REQUIRED for prosecutors; forbidden otherwise (server-enforced).
        p_bureau: v.role === 'prosecutor' && v.bureau ? v.bureau : undefined,
      }),
      'Appointment recorded.',
    )
    if (ok) setAppointOpen(false)
  }

  /* ── Temporary coverage (AG/Owner — justice_set_coverage / _end_coverage) ── */
  const grantCoverage = async (v: { userId: string; bureau: RoutingBureau; reason: string; expires: string }) => {
    const ok = await act(
      () => rpc('justice_set_coverage', {
        p_user: v.userId,
        p_bureau: v.bureau,
        p_reason: v.reason,
        p_expires_at: v.expires ? new Date(v.expires).toISOString() : undefined,
      }),
      'Coverage granted — the prosecutor now works that queue too.',
    )
    if (ok) setCoverageOpen(false)
  }

  const endCoverage = async (c: Coverage) => {
    const reason = await uiPrompt('Reason for ending this coverage (optional).', { title: 'End coverage' })
    if (reason === null) return
    await act(
      () => rpc('justice_end_coverage', { p_coverage: c.id, p_reason: reason || undefined }),
      'Coverage ended.',
    )
  }

  const submitDecision = async (v: { note: string; retain: boolean; expires: string }) => {
    if (!decide) return
    const ok = await act(
      () => rpc('transfer_doj_decide', {
        p_transfer: decide.transfer.id,
        p_stage: 'doj',
        p_decision: decide.decision,
        p_note: v.note || undefined,
        p_retain_cid: v.retain || undefined,
        p_dual_expires_at: v.retain && v.expires ? new Date(v.expires).toISOString() : undefined,
      }),
      'Transfer decision recorded.',
    )
    if (ok) setDecide(null)
  }

  const showHandover = async (t: Transfer) => {
    const res = await rpc('transfer_handover', { p_transfer: t.id })
    if (res.error || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
      toast(res.error?.message ?? 'Handover checklist unavailable.', 'danger')
      return
    }
    setHandover(res.data as Record<string, unknown>)
  }

  const activate = async (t: Transfer) => {
    await act(
      () => rpc('transfer_doj_activate', { p_transfer: t.id }),
      'Transfer activated — membership moved in one transaction.',
    )
  }

  const cancelTransfer = async (t: Transfer) => {
    const reason = await uiPrompt('Reason for cancelling this transfer (optional).', { title: 'Cancel transfer' })
    if (reason === null) return
    await act(() => rpc('transfer_doj_cancel', { p_transfer: t.id, p_reason: reason || undefined }), 'Transfer cancelled.')
  }

  const returnToQueue = async (r: LegalRequest) => {
    const reason = await uiPrompt('Reason for returning this request to the shared queue.', { title: 'Return to queue' })
    if (reason === null) return
    await act(
      () => rpc('legal_return_to_prosecutor_queue', { p_request: r.id, p_reason: reason || undefined }),
      'Returned to the prosecutor queue.',
    )
  }

  const submitReassign = async (v: { userId: string; reason: string }) => {
    if (!reassign) return
    const ok = await act(
      () => rpc('legal_assign_prosecutor', {
        p_request: reassign.id, p_prosecutor: v.userId, p_reason: v.reason || undefined,
      }),
      'Prosecutor reassigned.',
    )
    if (ok) setReassign(null)
  }

  const membershipOf = (userId: string): Membership | undefined => memberships.find((m) => m.user_id === userId)
  const activeCoverage = coverage.filter((c) => !c.ended_at && (!c.expires_at || Date.parse(c.expires_at) > now))
  const activeProsecutors = directory.filter((d) => d.active && effectiveJusticeRole(d.justice_role) === 'prosecutor')
  const held = requests
    .filter((r) => r.review_status === 'prosecutor_review')
    .sort((a, b) => Date.parse(a.prosecutor_claimed_at ?? a.updated_at) - Date.parse(b.prosecutor_claimed_at ?? b.updated_at))
  const openTransfers = transfers.filter((t) => OPEN_TRANSFER.includes(t.status))
  const settledTransfers = transfers.filter((t) => !OPEN_TRANSFER.includes(t.status)).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* ── Migration attention: prosecutors with no home bureau ─────────── */}
      {noBureau.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
          <p className="text-sm font-semibold text-amber-200">
            {noBureau.length === 1 ? 'One prosecutor has' : `${noBureau.length} prosecutors have`} no home bureau
          </p>
          <p className="mt-0.5 text-xs text-amber-200/90">
            {noBureau.map((p) => p.name || `${p.user_id.slice(0, 8)}…`).join(' · ')} — until re-appointed with a
            home bureau (LSB, BCB, or SAB), they cover no queue and cannot claim or be assigned requests.
          </p>
        </div>
      )}

      {/* ── Memberships ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="DOJ memberships"
          subtitle="Prosecutors, judges, and the Attorney General. Deactivating a member auto-returns their unfinished work to the queues."
          actions={<Button size="sm" variant="primary" onClick={() => setAppointOpen(true)}>Appoint member…</Button>}
        />
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
          {directory.map((d) => {
            const m = membershipOf(d.user_id)
            const expired = !!m?.expires_at && Date.parse(m.expires_at) <= now
            return (
              <li key={d.user_id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-white">{d.display_name || 'Member'}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {justiceRoleLabel(d.justice_role)}
                    {m?.prosecutor_bureau ? ` · ${m.prosecutor_bureau}` : ''}
                  </span>
                  {effectiveJusticeRole(d.justice_role) === 'prosecutor' && m && !m.prosecutor_bureau && (
                    <Badge tone="warn" className="ml-2">No home bureau</Badge>
                  )}
                  {m?.expires_at && (
                    <span className="ml-2 text-xs text-slate-400">
                      {expired ? 'dual membership expired' : `dual until ${fmtDateTime(m.expires_at)}`}
                    </span>
                  )}
                </div>
                <Badge tone={d.active && !expired ? 'good' : 'neutral'}>
                  {d.active ? (expired ? 'Expired' : 'Active') : 'Inactive'}
                </Badge>
                <Button size="sm" disabled={busy} onClick={() => void setActive(d.user_id, !d.active)}>
                  {d.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </li>
            )
          })}
          {directory.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">No justice memberships on record.</li>
          )}
        </ul>
      </section>

      {/* ── Temporary coverage ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Temporary coverage"
          subtitle="Cross-bureau prosecutor coverage — explicit, dated, audited, endable. Your authority cannot bypass bureau eligibility; coverage is the path."
          actions={<Button size="sm" variant="primary" onClick={() => setCoverageOpen(true)}>Grant coverage…</Button>}
        />
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
          {activeCoverage.map((c) => (
            <li key={c.id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{name(c.prosecutor_id)}</span>
                  <Badge tone="warn">covers {c.bureau}</Badge>
                  <span className="text-xs text-slate-400">
                    {c.expires_at ? `until ${fmtDateTime(c.expires_at)}` : 'no expiry'}
                    {' · '}granted by {name(c.authorized_by)} {timeAgo(c.starts_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{c.reason}</p>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void endCoverage(c)}>End…</Button>
            </li>
          ))}
          {activeCoverage.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">No temporary coverage is active.</li>
          )}
        </ul>
      </section>

      {/* ── Transfers ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Member transfers"
          subtitle="CID ↔ DOJ organizational transfers — same account, same history. CID Command authorizes; you accept; activation is one transaction gated on the handover."
        />
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
          {openTransfers.map((t) => (
            <li key={t.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{name(t.user_id)}</span>
                <span className="text-xs text-slate-400">
                  {humanize(t.direction)} · {justiceRoleLabel(t.requested_role)}
                  {t.target_bureau ? ` · ${t.target_bureau}` : ''}
                </span>
                <Badge tone={t.status === 'doj_accepted' ? 'good' : t.status === 'cid_approved' ? 'warn' : 'neutral'}>
                  {humanize(t.status)}
                </Badge>
                {t.retain_cid && <Badge tone="warn">Dual{t.dual_expires_at ? ` until ${fmtDateTime(t.dual_expires_at)}` : ''}</Badge>}
              </div>
              <p className="text-xs text-slate-400">{t.reason}</p>
              <div className="flex flex-wrap items-center gap-2">
                {t.status === 'requested' && (
                  <span className="text-xs text-slate-400">Awaiting CID Command authorization.</span>
                )}
                {t.status === 'cid_approved' && (
                  <>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => setDecide({ transfer: t, decision: 'approve' })}>Accept…</Button>
                    <Button size="sm" disabled={busy} onClick={() => setDecide({ transfer: t, decision: 'return' })}>Return…</Button>
                    <Button size="sm" disabled={busy} onClick={() => setDecide({ transfer: t, decision: 'reject' })}>Reject…</Button>
                  </>
                )}
                {t.status === 'doj_accepted' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void showHandover(t)}>Handover checklist</Button>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void activate(t)}>Activate</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelTransfer(t)}>Cancel…</Button>
              </div>
            </li>
          ))}
          {openTransfers.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">No open transfers.</li>
          )}
        </ul>
        {settledTransfers.length > 0 && (
          <Card pad="sm">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Recently settled</h3>
            <ul className="divide-y divide-white/5">
              {settledTransfers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">{name(t.user_id)}</span>
                  <span>{humanize(t.direction)} · {justiceRoleLabel(t.requested_role)}</span>
                  <Badge tone={t.status === 'effective' ? 'good' : 'neutral'}>{humanize(t.status)}</Badge>
                  <span>{timeAgo(t.updated_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── Held prosecutorial work ──────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Held prosecutorial work"
          subtitle="Claimed reviews, oldest hold first. Reassign a stalled request (reason required) or return it to the shared queue."
        />
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
          {held.map((r) => (
            <li key={r.id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                aria-label={`Open request ${r.request_number}`}
                className="-mx-1.5 -my-1 flex min-h-[40px] min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5"
              >
                <span className="font-mono text-xs tabular-nums text-blue-300">{r.request_number}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{humanize(r.subtype ?? r.request_type)}</span>
                <span className="text-xs text-slate-300">held by {name(r.assigned_prosecutor_id)}</span>
              </button>
              <span className="text-xs text-slate-400">
                {r.prosecutor_claimed_at ? `claimed ${timeAgo(r.prosecutor_claimed_at)}` : '—'}
              </span>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => setReassign(r)}>Reassign…</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void returnToQueue(r)}>Return to queue…</Button>
              </div>
            </li>
          ))}
          {held.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">No requests are currently held in prosecutorial review.</li>
          )}
        </ul>
      </section>

      {appointOpen && (
        <AppointModal busy={busy} onSubmit={(v) => void appoint(v)} onClose={() => setAppointOpen(false)} />
      )}
      {coverageOpen && (
        <CoverageModal
          prosecutors={activeProsecutors}
          busy={busy}
          onSubmit={(v) => void grantCoverage(v)}
          onClose={() => setCoverageOpen(false)}
        />
      )}
      {decide && (
        <TransferDecideModal
          transfer={decide.transfer}
          decision={decide.decision}
          busy={busy}
          onSubmit={(v) => void submitDecision(v)}
          onClose={() => setDecide(null)}
        />
      )}
      {handover && <HandoverModal handover={handover} onClose={() => setHandover(null)} />}
      {reassign && (
        <JusticePickerModal
          seat="prosecutor"
          title={`Reassign — ${reassign.request_number}`}
          hint="Administrative reassignment of a claimed review. A reason is required and recorded."
          reasonMode="required"
          busy={busy}
          excludeIds={[reassign.created_by, reassign.assigned_prosecutor_id ?? ''].filter(Boolean)}
          onSubmit={(v) => void submitReassign(v)}
          onClose={() => setReassign(null)}
        />
      )}
    </div>
  )
}
