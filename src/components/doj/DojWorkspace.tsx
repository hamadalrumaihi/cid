'use client'

/** DOJ workspace — the role-aware mode of the /legal route for justice
 *  members (judge / attorney general). Minimal by design: DOJ access exists
 *  ONLY to review legal requests created from CID cases — no DOJ cases,
 *  evidence, or registries. Every list filters CLIENT-side over rows RLS
 *  already authorised, and every write is a definer RPC (the server re-checks
 *  authority, state, and conflicts on each call).
 *
 *  Lanes after P4-01 (no prosecutor stage anywhere):
 *   - Judicial queue — submitted_to_judge. A judge claims non-sealed rows
 *     (claim_legal_request_as_judge); RLS never hands a judge a sealed row.
 *     The Attorney General oversees the whole queue, grouped Sealed / Open.
 *   - Sealed assignment (AG only) — sealed rows waiting for assign_judge.
 *   - Mine — judicial reviews assigned to the viewer.
 *   - Returned — returned_by_judge, with the investigator.
 *   - Decided — the terminal archive.
 *  A historical 'prosecutor' membership (retired role) gets a read-only
 *  overview + the archive: no lane here offers it an action.
 *
 *  Lists are compact table-like rows (DojQueueList), not card tiles. Sealed
 *  rows the viewer can't see never arrive; sealed rows that do arrive render
 *  number + type only (the sealed-list convention). */
import { useState } from 'react'
import { rpc } from '@/lib/db'
import type { LegalRequest } from '@/lib/justice'
import { isDecidedApproved } from '@/lib/legalWorkflow'
import { toast } from '@/lib/toast'
import { SectionHeader } from '@/components/ui/PageHeader'
import { DojQueueList, type DojRowAction } from './DojQueueList'
import { DojAdmin } from './DojAdmin'
import { DojOverview } from './DojOverview'
import { JusticePickerModal } from './JusticePickerModal'
import { RecusalBanner, isRecusalError } from './RecusalBanner'

/** 'doj_overview' (not 'overview') — LegalView's dual-identity tab union
 *  already uses 'overview' for the CID landing; the ids must never collide. */
export type DojViewId = 'doj_overview' | 'judicial' | 'sealed' | 'mine' | 'returned' | 'decided' | 'admin'
/** 'prosecutor' is accepted only because the server still reports it for
 *  historical memberships — it is read-only here (L16). */
export type DojRole = 'judge' | 'attorney_general' | 'prosecutor'

/** Terminal set: the two approvals, the judge's denial, the creator's
 *  withdrawal, the administrative stops, and the retired prosecutorial
 *  `declined` (history only). */
const TERMINAL = ['approved', 'partially_approved', 'denied', 'withdrawn', 'cancelled', 'superseded', 'declined']

export interface DojLists {
  judicial: LegalRequest[]
  sealed: LegalRequest[]
  mine: LegalRequest[]
  returned: LegalRequest[]
  decided: LegalRequest[]
}

/** One derivation for the tab counts AND the panel contents (LegalView calls
 *  it once per render over the shared loaded set). */
export function deriveDojLists(requests: LegalRequest[], myId: string | null): DojLists {
  const asc = (a: string | null, b: string | null) =>
    (a ? Date.parse(a) : Infinity) - (b ? Date.parse(b) : Infinity)
  const queued = requests.filter((r) => r.review_status === 'submitted_to_judge')
  return {
    judicial: queued
      .slice()
      .sort((a, b) => asc(a.submitted_to_judge_at, b.submitted_to_judge_at)),
    // Sealed rows waiting for the Attorney General's placement (assign_judge).
    // Judges never receive these rows from RLS, so the list is empty for them.
    sealed: queued
      .filter((r) => r.classification === 'sealed' && !r.assigned_judge_id)
      .sort((a, b) => asc(a.submitted_to_judge_at, b.submitted_to_judge_at)),
    mine: requests.filter((r) =>
      !!myId
      && r.assigned_judge_id === myId
      && (r.review_status === 'judicial_review' || r.review_status === 'submitted_to_judge')),
    returned: requests
      .filter((r) => r.review_status === 'returned_by_judge')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    decided: requests
      .filter((r) => TERMINAL.includes(r.review_status))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
  }
}

/** Which DOJ tabs each role gets. Judges: queue, their own reviews, returns,
 *  archive. The Attorney General: queue oversight, sealed assignment, returns,
 *  archive, administration (never a personal review lane — the AG assigns and
 *  oversees, and never decides). A retired prosecutor membership is read-only:
 *  overview + archive. Every role lands on the Overview first. */
export function dojViewsForRole(role: DojRole): { id: DojViewId; label: string }[] {
  const views: { id: DojViewId; label: string }[] = [{ id: 'doj_overview', label: 'Overview' }]
  if (role === 'judge') {
    views.push({ id: 'judicial', label: 'Judicial queue' }, { id: 'mine', label: 'My reviews' })
    views.push({ id: 'returned', label: 'Returned' })
  } else if (role === 'attorney_general') {
    views.push({ id: 'judicial', label: 'Judicial queue' }, { id: 'sealed', label: 'Sealed assignment' })
    views.push({ id: 'returned', label: 'Returned' })
  }
  views.push({ id: 'decided', label: 'Decided' })
  if (role === 'attorney_general') views.push({ id: 'admin', label: 'Administration' })
  return views
}

export function DojWorkspace({ view, role, myId, lists, requests, onOpen, onNavigate, reload }: {
  view: DojViewId
  role: DojRole
  myId: string | null
  lists: DojLists
  /** The full RLS-scoped set (the AG overview reads sealed matters from it). */
  requests: LegalRequest[]
  onOpen: (id: string) => void
  /** Switch the workspace's own view state (the Overview panels land here). */
  onNavigate: (view: DojViewId) => void
  reload: () => void
}) {
  const [conflict, setConflict] = useState<string | null>(null)
  const [assign, setAssign] = useState<LegalRequest | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const isAG = role === 'attorney_general'
  const isJudge = role === 'judge'

  /** Run a definer RPC; a conflict/recusal refusal raises the banner with the
   *  server message verbatim (plus the toast every failure gets). */
  const act = async (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string, openId?: string) => {
    const res = await fn()
    if (res.error) {
      if (isRecusalError(res.error.message)) setConflict(res.error.message)
      toast(res.error.message, 'danger')
      return
    }
    setConflict(null)
    toast(okMsg, 'success')
    reload()
    if (openId) onOpen(openId)
  }

  const claimAsJudge = (r: LegalRequest) =>
    act(() => rpc('claim_legal_request_as_judge', { p_request: r.id }), 'Claimed for judicial review.', r.id)

  const submitAssign = async (v: { userId: string }) => {
    if (!assign) return
    setAssignBusy(true)
    await act(
      () => rpc('assign_judge', { p_request: assign.id, p_judge: v.userId }),
      'Judge assigned.',
    )
    setAssignBusy(false)
    setAssign(null)
  }

  /** The one action a queue row may carry. Mirrors the server gates exactly:
   *  a judge claims only open, unassigned, non-sealed rows they did not
   *  create; the AG assigns (the only path for sealed). Everyone else: none. */
  const queueAction = (r: LegalRequest): DojRowAction | null => {
    if (isJudge) {
      if (r.classification === 'sealed' || r.created_by === myId || r.assigned_judge_id) return null
      return { label: 'Claim', onRun: claimAsJudge }
    }
    if (isAG && !r.assigned_judge_id) {
      return {
        label: r.classification === 'sealed' ? 'Assign judge…' : 'Assign…',
        variant: r.classification === 'sealed' ? 'primary' : 'secondary',
        onRun: async () => setAssign(r),
      }
    }
    return null
  }

  const sealedQueue = lists.judicial.filter((r) => r.classification === 'sealed')
  const openQueue = lists.judicial.filter((r) => r.classification !== 'sealed')

  return (
    <div className="space-y-4">
      {conflict && <RecusalBanner message={conflict} onDismiss={() => setConflict(null)} />}

      {view === 'doj_overview' && (
        <DojOverview
          role={role}
          myId={myId}
          lists={lists}
          requests={requests}
          onOpen={onOpen}
          onNavigate={onNavigate}
        />
      )}

      {view === 'judicial' && (
        <>
          <SectionHeader
            title="Judicial queue"
            subtitle={isJudge
              ? 'Requests approved by bureau review, oldest first. Claiming is atomic — if a request vanishes, a colleague claimed it first.'
              : 'Every request awaiting a judge, oldest first. Sealed requests reach the bench only through your assignment; open ones any eligible judge may claim.'}
          />
          {isAG ? (
            <div className="space-y-4">
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white">
                  Sealed
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">{sealedQueue.length}</span>
                </h3>
                <DojQueueList
                  rows={sealedQueue}
                  onOpen={onOpen}
                  ageOf={(r) => r.submitted_to_judge_at}
                  ageLabel="waiting"
                  empty="No sealed requests are waiting for assignment."
                  action={queueAction}
                />
              </section>
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white">
                  Open
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">{openQueue.length}</span>
                </h3>
                <DojQueueList
                  rows={openQueue}
                  onOpen={onOpen}
                  ageOf={(r) => r.submitted_to_judge_at}
                  ageLabel="waiting"
                  empty="No open requests are awaiting judicial pickup."
                  action={queueAction}
                />
              </section>
            </div>
          ) : (
            <DojQueueList
              rows={openQueue}
              onOpen={onOpen}
              ageOf={(r) => r.submitted_to_judge_at}
              ageLabel="waiting"
              empty="Nothing is awaiting judicial review."
              action={queueAction}
            />
          )}
        </>
      )}

      {view === 'sealed' && isAG && (
        <>
          <SectionHeader
            title="Sealed assignment"
            subtitle="Sealed requests waiting in the judicial queue. Judges cannot self-claim these — formal assignment by you is their only path to the bench. Conflicted judges are refused server-side."
          />
          <DojQueueList
            rows={lists.sealed}
            onOpen={onOpen}
            ageOf={(r) => r.submitted_to_judge_at}
            ageLabel="waiting"
            empty="No sealed requests are waiting for assignment."
            action={queueAction}
          />
        </>
      )}

      {view === 'mine' && isJudge && (
        <>
          <SectionHeader
            title="My reviews"
            subtitle="Judicial reviews assigned to you — approve in full or in part, deny, or return for revision."
          />
          <DojQueueList
            rows={lists.mine}
            onOpen={onOpen}
            ageOf={(r) => r.submitted_to_judge_at ?? r.updated_at}
            ageLabel="held"
            empty="You hold no requests right now."
            action={(r) => ({ label: 'Decide', onRun: async () => onOpen(r.id) })}
          />
        </>
      )}

      {view === 'returned' && (
        <>
          <SectionHeader
            title="Returned"
            subtitle="Requests a judge returned to the investigator for revision. A resubmission with a change summary comes straight back to the judicial queue; a declared material change re-enters bureau review first."
          />
          <DojQueueList
            rows={lists.returned}
            onOpen={onOpen}
            ageOf={(r) => r.updated_at}
            ageLabel="returned"
            empty="No returned requests."
          />
        </>
      )}

      {view === 'decided' && (
        <>
          <SectionHeader
            title="Decided"
            subtitle="Approved, partially approved, denied, withdrawn, cancelled and superseded requests — the archive. Issuance itself stays a CID act."
          />
          <DojQueueList
            rows={lists.decided}
            onOpen={onOpen}
            ageOf={(r) => r.updated_at}
            ageLabel={'decided'}
            empty="No decided requests yet."
            action={(r) => (isDecidedApproved(r.review_status) && r.fulfilment_status === 'unissued'
              ? { label: 'Awaiting issuance', variant: 'secondary', onRun: async () => onOpen(r.id) }
              : null)}
          />
        </>
      )}

      {view === 'admin' && isAG && (
        <DojAdmin reload={reload} onConflict={setConflict} />
      )}

      {assign && (
        <JusticePickerModal
          title={`Assign a judge — ${assign.request_number}`}
          hint={assign.classification === 'sealed'
            ? 'Sealed request — formal assignment is the only path to the bench.'
            : 'Formal assignment by the Attorney General. Conflicted judges are refused server-side.'}
          busy={assignBusy}
          excludeIds={[assign.created_by]}
          onSubmit={(v) => void submitAssign(v)}
          onClose={() => setAssign(null)}
        />
      )}
    </div>
  )
}
