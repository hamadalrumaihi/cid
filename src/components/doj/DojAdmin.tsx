'use client'

/** Attorney General administration — the justice management surface after
 *  P4-01 / L16 (judges + the Attorney General are the only live roles):
 *   - Memberships: judges and the Attorney General with activate/deactivate
 *     and explicit appointment (justice_appoint — direct and effective
 *     immediately; an active CID member is transferred inline, which takes
 *     DD+/Owner authority; an Attorney General is Owner-appointed only).
 *     Historical prosecutor / ADA / DA rows still list, marked as a retired
 *     role — they can be deactivated, never re-granted.
 *   - Transfers: the CID↔DOJ transfer queue (member_transfers) — DOJ-stage
 *     decisions, the handover checklist, and transactional activation.
 *   - Observers: a pointer only — per-request observer access is granted from
 *     the request dossier (legal_set_observer), not from an admin roster.
 *  The prosecutor coverage panel and the held-work reassignment panel are
 *  gone with the prosecutor queue. Every write is a definer RPC; RLS scopes
 *  every read. Names come from justice_directory() — a pure AG has no CID
 *  roster access (the appoint form falls back to a raw account-ID input for
 *  them); command/owner viewers get a real member picker from the shared
 *  roster cache. */
import { useCallback, useEffect, useState } from 'react'
import { useNow } from '@/lib/useNow'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { bureauShort, roleLabel } from '@/lib/roles'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { isRetiredJusticeRole, justiceRoleLabel } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'
import { isRecusalError } from './RecusalBanner'

type Transfer = Tables<'member_transfers'>
type Membership = Tables<'justice_memberships'>

interface DirectoryEntry { user_id: string; display_name: string; justice_role: string; active: boolean }

const OPEN_TRANSFER = ['requested', 'cid_approved', 'doj_accepted']

/* ── Appoint form ─────────────────────────────────────────────────────────── */
function AppointModal({ busy, onSubmit, onClose }: {
  busy: boolean
  onSubmit: (v: { userId: string; role: string; reason: string }) => void
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
  const [role, setRole] = useState('judge')
  const [reason, setReason] = useState('')
  const ready = userId.trim() !== ''
  return (
    <Modal open onClose={onClose} dirty={() => userId.trim() !== '' || reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title="Appoint a justice member" onClose={onClose} />
        <p className="text-sm text-slate-400">
          Appointment is direct and effective immediately — no approval chain. An active CID member is
          transferred inline: their CID membership ends the moment you appoint (moving an active member
          takes Deputy Director+ or Owner authority). Inactive or unassigned accounts are appointed
          directly. Only judges and the Attorney General can be appointed; the prosecutor role is retired —
          grant per-request observer access from the dossier instead.
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
                        ? `${roleLabel(m.role)}${m.division ? ` · ${bureauShort(m.division)}` : ''}`
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
          <Field label="Role" required hint={isOwner ? undefined : 'An Attorney General is appointed by the Owner only.'}>
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="judge">Judge</option>
                {isOwner && <option value="attorney_general">Attorney General</option>}
              </Select>
            )}
          </Field>
          <Field label="Reason" hint="Optional — recorded in the audit log.">
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ userId: userId.trim(), role, reason: reason.trim() })}>
            {busy ? 'Appointing…' : 'Appoint'}
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
export function DojAdmin({ reload, onConflict }: {
  reload: () => void
  /** Bubble a recusal/conflict refusal up to the workspace banner. */
  onConflict: (message: string) => void
}) {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [busy, setBusy] = useState(false)
  const [appointOpen, setAppointOpen] = useState(false)
  const [decide, setDecide] = useState<{ transfer: Transfer; decision: 'approve' | 'return' | 'reject' } | null>(null)
  const [handover, setHandover] = useState<Record<string, unknown> | null>(null)
  const jmVersion = useTableVersion('justice_memberships')
  const mtVersion = useTableVersion('member_transfers')
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
    })()
    return () => { cancelled = true }
  }, [jmVersion, mtVersion, tick])
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
      active ? 'Membership reactivated.' : 'Membership deactivated — any judicial review they held returned to the queue.',
    )
  }

  const appoint = async (v: { userId: string; role: string; reason: string }) => {
    // p_bureau stays unset: justice_appoint accepts only judge /
    // attorney_general now and refuses a bureau for either.
    const ok = await act(
      () => rpc('justice_appoint', { p_user: v.userId, p_role: v.role, p_reason: v.reason || undefined }),
      'Appointment recorded.',
    )
    if (ok) setAppointOpen(false)
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

  const membershipOf = (userId: string): Membership | undefined => memberships.find((m) => m.user_id === userId)
  // Live roles first, retired titles last, then by name — so the roster reads
  // as "who can act today" before "who once could".
  const roster = directory.slice().sort((a, b) =>
    Number(isRetiredJusticeRole(a.justice_role)) - Number(isRetiredJusticeRole(b.justice_role))
    || Number(b.active) - Number(a.active)
    || (a.display_name || '').localeCompare(b.display_name || ''))
  const openTransfers = transfers.filter((t) => OPEN_TRANSFER.includes(t.status))
  const settledTransfers = transfers.filter((t) => !OPEN_TRANSFER.includes(t.status)).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* ── Memberships ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Justice memberships"
          subtitle="Judges and the Attorney General. Deactivating a judge returns any review they hold to the judicial queue. Retired prosecution-side roles remain listed as history and cannot be re-granted."
          actions={<Button size="sm" variant="primary" onClick={() => setAppointOpen(true)}>Appoint member…</Button>}
        />
        <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-ink-900/60">
          {roster.map((d) => {
            const m = membershipOf(d.user_id)
            const expired = !!m?.expires_at && Date.parse(m.expires_at) <= now
            const retired = isRetiredJusticeRole(d.justice_role)
            return (
              <li key={d.user_id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-white">{d.display_name || 'Member'}</span>
                  <span className="ml-2 text-xs text-slate-400">{justiceRoleLabel(d.justice_role)}</span>
                  {retired && <Badge tone="warn" className="ml-2">Retired role</Badge>}
                  {m?.expires_at && (
                    <span className="ml-2 text-xs text-slate-400">
                      {expired ? 'dual membership expired' : `dual until ${fmtDateTime(m.expires_at)}`}
                    </span>
                  )}
                </div>
                <Badge tone={d.active && !expired ? 'good' : 'neutral'}>
                  {d.active ? (expired ? 'Expired' : 'Active') : 'Inactive'}
                </Badge>
                {/* A retired title can be switched off, never switched back on —
                    reactivation would resurrect a role the server refuses. */}
                {(d.active || !retired) && (
                  <Button size="sm" disabled={busy} onClick={() => void setActive(d.user_id, !d.active)}>
                    {d.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </li>
            )
          })}
          {roster.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">No justice memberships on record.</li>
          )}
        </ul>
      </section>

      {/* ── Observers ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Observers"
          subtitle="Read-and-comment access for a former prosecutor, counsel, or anyone else who needs one request — granted per request, never as a standing role."
        />
        <Notice text="Observer access is granted and revoked from the request dossier (Participants → Add observer). It is recorded on the request, notifies the observer, and applies to that request only. There is no observer roster to manage here." />
      </section>

      {/* ── Transfers ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Member transfers"
          subtitle="CID ↔ DOJ organizational transfers — same account, same history. CID Command authorizes; you accept; activation is one transaction gated on the handover."
        />
        <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-ink-900/60">
          {openTransfers.map((t) => (
            <li key={t.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{name(t.user_id)}</span>
                <span className="text-xs text-slate-400">
                  {humanize(t.direction)} · {justiceRoleLabel(t.requested_role)}
                  {t.target_bureau ? ` · ${bureauShort(t.target_bureau)}` : ''}
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
            <h3 className="mb-1 text-[13px] font-semibold text-white">Recently settled</h3>
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

      {appointOpen && (
        <AppointModal busy={busy} onSubmit={(v) => void appoint(v)} onClose={() => setAppointOpen(false)} />
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
    </div>
  )
}
