'use client'

/** Justice portal — the DOJ/Judiciary working surface. One view, four seats:
 *  ADA (bureau queue + assigned requests), DA (approvals, coverage, personnel,
 *  reassignment), AG (executive review + DA/ADA management), Judge (assigned
 *  judicial reviews only). Hiding sections is cosmetic — every list is
 *  RLS-scoped and every action is a definer RPC. Justice-only users get this
 *  view as their whole portal (no CID shell); dual-identity users reach it
 *  from the CID sidebar. */
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useTableVersion } from '@/lib/realtime'
import {
  AGENCY_LABEL, JMR_COLS, justiceRoleAbbr, justiceRoleLabel,
  type JusticeAgency, type LegalRequest,
} from '@/lib/justice'
import { fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Select } from '@/components/ui/Field'
import { LegalRequestDetail } from './LegalRequestDetail'
import { QueueSection, StatusChip, useJusticeDirectory, useLegalRequests } from './legalShared'

const DECIDED = new Set(['approved', 'denied', 'withdrawn'])

export function JusticePortalView() {
  const { profile, justiceRole, justice } = useAuth()
  const me = profile?.id ?? null
  const isOwnerFlag = !!profile?.is_owner
  const [openId, setOpenId] = useState<string | null>(null)
  const { requests } = useLegalRequests()

  const role = justiceRole
  const canManage = role === 'district_attorney' || role === 'attorney_general' || isOwnerFlag

  if (!role && !isOwnerFlag) {
    return (
      <p className="rounded-lg border border-white/10 bg-ink-900/60 p-4 text-sm text-slate-400">
        The Justice portal is for active DOJ and Judiciary members. Your account has no active justice membership.
      </p>
    )
  }

  if (openId) return <LegalRequestDetail requestId={openId} onBack={() => setOpenId(null)} />

  const mine = (r: LegalRequest) => r.assigned_ada_id === me
  const judgeMine = (r: LegalRequest) => r.assigned_judge_id === me

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={role ? `${justiceRoleLabel(role)} (${justiceRoleAbbr(role)})` : 'Owner oversight'} tone="blue" />
        {justice?.justice_identifier && <span className="font-mono text-xs text-slate-500">{justice.justice_identifier}</span>}
        {justice && <span className="text-xs text-slate-500">{AGENCY_LABEL[justice.agency]}</span>}
      </div>

      {role === 'judge' ? (
        <>
          <QueueSection title="Assigned for Judicial Review" onOpen={setOpenId}
            rows={requests.filter((r) => judgeMine(r) && r.review_status === 'judicial_review')}
            empty="No requests are assigned to you." />
          <QueueSection title="Returned for Revision" onOpen={setOpenId}
            rows={requests.filter((r) => judgeMine(r) && r.review_status === 'returned_by_judge')} />
          <QueueSection title="Recently Decided" onOpen={setOpenId}
            rows={requests.filter((r) => judgeMine(r) && DECIDED.has(r.review_status)).slice(0, 15)} />
        </>
      ) : (
        <>
          {(role === 'assistant_district_attorney' || role === 'district_attorney') && (
            <>
              <QueueSection title="Assigned to Me" onOpen={setOpenId}
                rows={requests.filter((r) => mine(r) && r.review_status === 'ada_review')}
                empty="Nothing is assigned to you." />
              <QueueSection title="Awaiting DA / AG / Judge" onOpen={setOpenId}
                rows={requests.filter((r) => mine(r) && ['da_review', 'ag_review', 'submitted_to_judge', 'judicial_review'].includes(r.review_status))} />
              <QueueSection title="Returned to CID" onOpen={setOpenId}
                rows={requests.filter((r) => mine(r) && r.review_status.startsWith('returned'))} />
            </>
          )}
          {canManage && (
            <>
              <QueueSection title="Unassigned / Blocked Requests" onOpen={setOpenId}
                rows={requests.filter((r) => r.review_status === 'submitted_to_doj')}
                empty="No requests are waiting for manual assignment." />
              {role === 'district_attorney' && (
                <QueueSection title="DA Approval Queue" onOpen={setOpenId}
                  rows={requests.filter((r) => r.review_status === 'da_review')} />
              )}
              {role === 'attorney_general' && (
                <>
                  <QueueSection title="AG Approval Queue" onOpen={setOpenId}
                    rows={requests.filter((r) => r.review_status === 'ag_review')} />
                  <QueueSection title="DOJ Executive Review" onOpen={setOpenId}
                    rows={requests.filter((r) => !DECIDED.has(r.review_status) && r.submitted_to_doj_at !== null)} />
                </>
              )}
            </>
          )}
          <QueueSection title="Recently Decided" onOpen={setOpenId}
            rows={requests.filter((r) => DECIDED.has(r.review_status)).slice(0, 15)} />
        </>
      )}

      {role !== 'judge' && <CoverageBoard canManage={canManage} />}
      {canManage && <JusticeApprovals />}
      {canManage && <JusticePersonnel />}
    </div>
  )
}

/* ---- Bureau coverage board (§12) ------------------------------------------ */

function CoverageBoard({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Array<{
    bureau: string; primary_ada_id: string | null; primary_ada_name: string | null
    acting_id: string | null; acting_name: string | null; acting_role: string | null
    supporting: unknown; covered: boolean
  }>>([])
  const v = useTableVersion('prosecutor_bureau_assignments')
  const [tick, setTick] = useState(0)
  const { entries } = useJusticeDirectory()
  const prosecutors = entries.filter((e) => e.active && e.justice_role === 'assistant_district_attorney')

  useEffect(() => {
    let cancelled = false
    void rpc('doj_bureau_coverage', {} as never).then((r) => {
      if (!cancelled && !r.error && r.data) setRows(r.data)
    })
    return () => { cancelled = true }
  }, [v, tick])

  const assign = async (bureau: string, type: 'primary' | 'acting' | 'supporting', adaId: string) => {
    const target = entries.find((e) => e.user_id === adaId)
    if (!target) return
    const ok = await uiConfirm(`Make ${target.display_name} the ${type} prosecutor for ${bureau}?`, { title: 'Assign prosecutor' })
    if (!ok) return
    const res = type === 'primary'
      ? await rpc('set_primary_ada', { p_prosecutor: adaId, p_bureau: bureau as 'LSB' })
      : type === 'acting'
        ? await rpc('set_acting_ada', { p_prosecutor: adaId, p_bureau: bureau as 'LSB' })
        : await rpc('assign_ada_to_bureau', { p_prosecutor: adaId, p_bureau: bureau as 'LSB', p_type: 'supporting' })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Assignment recorded.', 'success'); setTick((t) => t + 1) }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Bureau ADA Coverage</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((b) => {
          const supporting = Array.isArray(b.supporting) ? (b.supporting as { id: string; name: string }[]) : []
          return (
            <div key={b.bureau} className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-white">{b.bureau}</span>
                <StatusChip label={b.covered ? 'Covered' : 'No routing ADA'} tone={b.covered ? 'emerald' : 'rose'} />
              </div>
              <p className="text-xs text-slate-400">Primary: <span className="text-slate-200">{b.primary_ada_name ?? 'None'}</span></p>
              <p className="text-xs text-slate-400">Acting: <span className="text-slate-200">{b.acting_name ? `${b.acting_name}${b.acting_role === 'district_attorney' ? ' (DA)' : ''}` : 'None'}</span></p>
              <p className="text-xs text-slate-400">Supporting: <span className="text-slate-200">{supporting.length ? supporting.map((s) => s.name).join(', ') : 'None'}</span></p>
              {!b.covered && (
                <p className="mt-2 rounded border border-rose-500/20 bg-rose-500/5 p-2 text-[11px] text-rose-200">
                  {b.bureau} currently has no assigned ADA. A District Attorney or Owner must assign a primary or acting
                  ADA before standard legal requests can be submitted to DOJ.
                </p>
              )}
              {canManage && prosecutors.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {(['primary', 'acting', 'supporting'] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="w-16 capitalize">{t}</span>
                      <Select value="" onChange={(e) => { if (e.target.value) void assign(b.bureau, t, e.target.value) }}>
                        <option value="">Assign…</option>
                        {prosecutors.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
                      </Select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && <p className="text-sm text-slate-500">Coverage unavailable.</p>}
      </div>
    </section>
  )
}

/* ---- Justice membership approvals (DA→ADA, AG→DA/ADA, Owner→all — §8) ---- */

function JusticeApprovals() {
  const { profile, justiceRole } = useAuth()
  const isOwnerFlag = !!profile?.is_owner
  const [rows, setRows] = useState<Tables<'justice_membership_requests'>[]>([])
  const v = useTableVersion('justice_membership_requests')
  const [tick, setTick] = useState(0)

  useEffect(() => {
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
  }, [v, tick])

  const pending = rows.filter((r) => r.status === 'pending')
  // The matrix the SERVER enforces; mirrored here so reviewers only see
  // requests they can actually decide.
  const canDecide = (requested: string) =>
    isOwnerFlag
    || (requested === 'assistant_district_attorney' && (justiceRole === 'district_attorney' || justiceRole === 'attorney_general'))
    || (requested === 'district_attorney' && justiceRole === 'attorney_general')
  const visible = pending.filter((r) => canDecide(r.requested_justice_role))

  const decide = async (row: Tables<'justice_membership_requests'>, decision: 'approve' | 'reject' | 'request_correction') => {
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
    else { toast('Decision recorded.', 'success'); setTick((t) => t + 1) }
  }

  if (visible.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Justice Membership Requests</h3>
      <div className="space-y-2">
        {visible.map((r) => (
          <div key={r.id} className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-white">{r.display_name}</span>
              <StatusChip label={`${justiceRoleAbbr(r.requested_justice_role)} · ${AGENCY_LABEL[r.requested_agency as JusticeAgency]}`} tone="blue" />
              {r.justice_identifier && <span className="font-mono text-xs text-slate-500">{r.justice_identifier}</span>}
              <span className="text-xs text-slate-500">{r.submitted_at ? fmtDateTime(r.submitted_at) : ''}</span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{r.reason}</p>
            {r.additional_notes && <p className="mt-1 text-xs text-slate-500">{r.additional_notes}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={() => void decide(r, 'approve')}>Approve</Button>
              <Button onClick={() => void decide(r, 'request_correction')}>Request correction</Button>
              <Button onClick={() => void decide(r, 'reject')}>Reject</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---- DOJ personnel (DA/AG/Owner) ------------------------------------------ */

function JusticePersonnel() {
  const { profile, justiceRole } = useAuth()
  const isOwnerFlag = !!profile?.is_owner
  const { entries, reload } = useJusticeDirectory()

  const canDeactivate = (target: string) =>
    isOwnerFlag
    || (target === 'assistant_district_attorney' && (justiceRole === 'district_attorney' || justiceRole === 'attorney_general'))
    || (target === 'district_attorney' && justiceRole === 'attorney_general')

  const setActive = async (e: { user_id: string; display_name: string; justice_role: string; active: boolean }) => {
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
  const moveToCid = async (e: { user_id: string; display_name: string }) => {
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

  if (entries.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">DOJ &amp; Judiciary Personnel</h3>
      <div className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.user_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <span className="text-sm font-semibold text-white">{e.display_name}</span>
            <StatusChip label={justiceRoleLabel(e.justice_role)} tone="blue" />
            <StatusChip label={e.active ? 'Active' : 'Inactive'} tone={e.active ? 'emerald' : 'rose'} />
            {e.justice_identifier && <span className="font-mono text-xs text-slate-500">{e.justice_identifier}</span>}
            <span className="flex-1" />
            {canDeactivate(e.justice_role) && (
              <Button onClick={() => void setActive(e)}>{e.active ? 'Deactivate' : 'Reactivate'}</Button>
            )}
            {isOwnerFlag && e.active && (
              <Button onClick={() => void moveToCid(e)}>Move to CID…</Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
