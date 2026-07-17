'use client'

/** Justice roster + membership applications (rebuild of the old flat
 *  personnel/approvals sections). Reads: `admin_justice_membership_requests`
 *  (reviewer RPC, internal-note capable) with the RLS-scoped table read as
 *  fallback, and `justice_directory`. Writes keep the existing definer RPCs
 *  verbatim: review_justice_membership_request, set_justice_membership_active,
 *  correct_membership_organization. Who may decide/deactivate mirrors the
 *  server matrix via the model's canReviewJusticeRole — hiding is cosmetic,
 *  the RPCs re-check everything. */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import {
  AGENCY_LABEL, JMR_COLS, justiceRoleAbbr, justiceRoleLabel,
  type JusticeAgency,
} from '@/lib/justice'
import { canReviewJusticeRole, type LegalViewer } from '@/lib/legalWorkflow'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'
import { useJusticeDirectory, type JusticeDirEntry } from './legalShared'

type JMRow = Tables<'justice_membership_requests'>

/** Narrow the auth string to the model's justice-role union. */
export function narrowJusticeRole(jr: string | null): LegalViewer['justiceRole'] {
  return jr === 'assistant_district_attorney' || jr === 'district_attorney'
    || jr === 'attorney_general' || jr === 'judge' ? jr : null
}

/** Application loader — reviewer RPC first (full rows), RLS-scoped table read
 *  as the fallback. `enabled` mirrors the old portal's canManage gate. */
export function useJusticeApplications(enabled: boolean): { rows: JMRow[]; reload: () => void } {
  const [rows, setRows] = useState<JMRow[]>([])
  const v = useTableVersion('justice_membership_requests')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      // Reviewers get the full rows (internal note included) via the admin
      // RPC; the plain table read is the RLS-scoped fallback.
      const r = await rpc('admin_justice_membership_requests', {} as never)
      if (cancelled) return
      if (!r.error && r.data) { setRows(r.data); return }
      try { setRows(await list('justice_membership_requests', { select: JMR_COLS, order: 'created_at', ascending: false })) }
      catch { /* not a reviewer */ }
    })()
    return () => { cancelled = true }
  }, [enabled, v, tick])
  return { rows, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** Pending applications this viewer may actually decide — the client mirror of
 *  the server review matrix (can_review_justice_role). */
export function visiblePendingApplications(
  rows: JMRow[], jr: LegalViewer['justiceRole'], isOwner: boolean,
): JMRow[] {
  return rows.filter((r) => r.status === 'pending' && canReviewJusticeRole(jr, isOwner, r.requested_justice_role))
}

/* ── Applications (cards + review drawer) ───────────────────────────────────── */
export function ApplicationsSection({ rows, reload }: { rows: JMRow[]; reload: () => void }) {
  const { profile, justiceRole } = useAuth()
  const isOwnerFlag = !!profile?.is_owner
  const jr = narrowJusticeRole(justiceRole)
  const visible = visiblePendingApplications(rows, jr, isOwnerFlag)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const reviewing = visible.find((r) => r.id === reviewId) ?? null
  const decidedRows = rows
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => Date.parse(b.decided_at ?? b.updated_at) - Date.parse(a.decided_at ?? a.updated_at))
    .slice(0, 8)

  const decide = async (row: JMRow, decision: 'approve' | 'reject' | 'request_correction') => {
    let note: string | null = null
    if (decision !== 'approve') {
      note = await uiPrompt('Note for the applicant.', { title: decision === 'reject' ? 'Reject request' : 'Request correction' })
      if (note === null) return
    } else if (!(await uiConfirm(
      `Approve ${row.display_name} as ${justiceRoleLabel(row.requested_justice_role)} (${AGENCY_LABEL[row.requested_agency as JusticeAgency]})? This activates their justice access.`,
      { title: 'Approve justice membership', confirmText: 'Approve' },
    ))) return
    const res = await rpc('review_justice_membership_request', {
      p_request: row.id, p_decision: decision,
      p_final_agency: decision === 'approve' ? row.requested_agency : undefined,
      p_final_role: decision === 'approve' ? row.requested_justice_role : undefined,
      p_applicant_note: note ?? undefined,
    })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Decision recorded.', 'success'); setReviewId(null); reload() }
  }

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Membership applications"
        subtitle="Only applications you may decide are shown — ADA by DA/AG/Owner, DA by AG/Owner, AG and Judge by the Owner."
      />
      {visible.length === 0 ? (
        <EmptyState title="No applications waiting on you" hint="New DOJ and Judiciary applications appear here for review." />
      ) : (
        <div className="grid gap-2">
          {visible.map((r) => (
            <Card key={r.id} pad="sm">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-white">{r.display_name}</h3>
                <Badge tone="accent">{justiceRoleAbbr(r.requested_justice_role)} · {AGENCY_LABEL[r.requested_agency as JusticeAgency]}</Badge>
                {r.justice_identifier && <span className="font-mono text-xs text-slate-400">{r.justice_identifier}</span>}
                <span className="text-xs text-slate-400">{r.submitted_at ? fmtDateTime(r.submitted_at) : ''}</span>
                <span className="flex-1" />
                <Button size="sm" onClick={() => setReviewId(r.id)}>Review application</Button>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-300">{r.reason}</p>
            </Card>
          ))}
        </div>
      )}

      {decidedRows.length > 0 && (
        <Card pad="sm">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Recent decisions</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {decidedRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                <span className="font-semibold text-slate-200">{r.display_name}</span>
                <span className="text-slate-400">{justiceRoleAbbr(r.requested_justice_role)}</span>
                <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'danger' : 'warn'}>
                  {r.status.replace(/_/g, ' ')}
                </Badge>
                <span className="text-slate-400">{r.decided_at ? fmtDateTime(r.decided_at) : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!reviewing} onClose={() => setReviewId(null)} wide>
        {reviewing && (
          <div className="p-6">
            <ModalHeader title={`Review — ${reviewing.display_name}`} onClose={() => setReviewId(null)} />
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-slate-400">Requested role</dt>
                <dd className="text-slate-200">{justiceRoleLabel(reviewing.requested_justice_role)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-400">Agency</dt>
                <dd className="text-slate-200">{AGENCY_LABEL[reviewing.requested_agency as JusticeAgency]}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-400">Identifier</dt>
                <dd className="font-mono text-slate-200">{reviewing.justice_identifier ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-400">Submitted</dt>
                <dd className="text-slate-200">{reviewing.submitted_at ? fmtDateTime(reviewing.submitted_at) : '—'}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-slate-400">Reason</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{reviewing.reason}</p>
            </div>
            {reviewing.additional_notes && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-slate-400">Additional notes</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{reviewing.additional_notes}</p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void decide(reviewing, 'approve')}>Approve</Button>
              <Button onClick={() => void decide(reviewing, 'request_correction')}>Request correction</Button>
              <Button variant="danger" onClick={() => void decide(reviewing, 'reject')}>Reject</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}

/* ── Roster (grouped by role, DA/AG/Owner management) ───────────────────────── */
const ROSTER_ROLE_ORDER = ['attorney_general', 'district_attorney', 'assistant_district_attorney', 'judge']

export function RosterSection() {
  const { profile, justiceRole } = useAuth()
  const isOwnerFlag = !!profile?.is_owner
  const jr = narrowJusticeRole(justiceRole)
  const { entries, reload } = useJusticeDirectory()

  // Same matrix the server enforces on set_justice_membership_active —
  // mirrored via the model so managers only see actions they can complete.
  const canDeactivate = (target: string) => canReviewJusticeRole(jr, isOwnerFlag, target)

  const setActive = async (e: JusticeDirEntry) => {
    const ok = await uiConfirm(
      `${e.active ? 'Deactivate' : 'Reactivate'} ${e.display_name}'s ${justiceRoleLabel(e.justice_role)} membership?`,
      { title: e.active ? 'Deactivate membership' : 'Reactivate membership' },
    )
    if (!ok) return
    const res = await rpc('set_justice_membership_active', { p_target: e.user_id, p_active: !e.active })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Membership updated.', 'success'); reload() }
  }

  // Owner-only correction for a member approved into the wrong organization:
  // deactivates the justice membership (history preserved) and files a pending
  // CID membership request through the normal Command approval matrix.
  const moveToCid = async (e: JusticeDirEntry) => {
    const reason = await uiPrompt(
      `Move ${e.display_name} out of DOJ/Judiciary to CID?\n\nTheir justice membership is deactivated (history preserved) and a pending CID membership request (Detective) is created — Command still approves the final role and department before any access is granted. Unresolved assigned legal work blocks the move.`,
      { title: 'Organization correction', placeholder: 'Reason, e.g. "Approved into the wrong organization"', confirmText: 'Move to CID' },
    )
    if (reason === null || !reason.trim()) { if (reason !== null) toast('A reason is required.', 'warn'); return }
    const res = await rpc('correct_membership_organization', {
      p_target: e.user_id, p_direction: 'justice_to_cid', p_reason: reason.trim(),
      p_requested_bureau: 'LSB', p_requested_role: 'detective',
    })
    if (res.error) { toast(`Correction failed: ${res.error.message}`, 'danger'); return }
    toast(`${e.display_name} moved to CID intake — membership request pending Command approval`, 'warn')
    reload()
  }

  if (entries.length === 0) {
    return <EmptyState title="No justice members yet" hint="Approved DOJ and Judiciary members appear here." />
  }

  const groups = ROSTER_ROLE_ORDER
    .map((role) => ({ role, members: entries.filter((e) => e.justice_role === role) }))
    .concat([{ role: 'other', members: entries.filter((e) => !ROSTER_ROLE_ORDER.includes(e.justice_role)) }])
    .filter((g) => g.members.length > 0)

  return (
    <section className="space-y-3">
      <SectionHeader
        title="DOJ & Judiciary personnel"
        subtitle="Every membership change is verified and recorded."
      />
      {groups.map((g) => (
        <div key={g.role} className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            {g.role === 'other' ? 'Other' : justiceRoleLabel(g.role)}
            <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{g.members.length}</span>
          </h3>
          <div className="grid gap-2">
            {g.members.map((e) => (
              <Card key={e.user_id} pad="sm" className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{e.display_name}</span>
                <Badge tone={e.active ? 'good' : 'danger'}>{e.active ? 'Active' : 'Inactive'}</Badge>
                {e.justice_identifier && <span className="font-mono text-xs text-slate-400">{e.justice_identifier}</span>}
                <span className="flex-1" />
                {canDeactivate(e.justice_role) && (
                  <Button size="sm" onClick={() => void setActive(e)}>{e.active ? 'Deactivate' : 'Reactivate'}</Button>
                )}
                {isOwnerFlag && e.active && (
                  <Button size="sm" onClick={() => void moveToCid(e)}>Move to CID…</Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
