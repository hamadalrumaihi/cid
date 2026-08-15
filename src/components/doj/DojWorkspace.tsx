'use client'

/** DOJ workspace — the role-aware mode of the /legal route for justice
 *  members (prosecutor / judge / attorney general). Minimal by design: DOJ
 *  access exists ONLY to review legal requests created from CID cases — no
 *  DOJ cases, evidence, or registries. Every list filters CLIENT-side over
 *  rows RLS already authorised, and every write is a definer RPC (the server
 *  re-checks authority, state, and conflicts on each call).
 *
 *  Lists are compact table-like rows (DojQueueList), not card tiles. Sealed
 *  rows the viewer can't see never arrive; sealed rows that do arrive render
 *  number + type only (the sealed-list convention). */
import { useState } from 'react'
import { rpc } from '@/lib/db'
import type { LegalRequest } from '@/lib/justice'
import { toast } from '@/lib/toast'
import { SectionHeader } from '@/components/ui/PageHeader'
import { DojQueueList } from './DojQueueList'
import { DojAdmin } from './DojAdmin'
import { JusticePickerModal } from './JusticePickerModal'
import { RecusalBanner, isRecusalError } from './RecusalBanner'

export type DojViewId = 'queue' | 'judicial' | 'mine' | 'returned' | 'decided' | 'admin'
export type DojRole = 'prosecutor' | 'attorney_general' | 'judge'

const TERMINAL = ['approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded']

export interface DojLists {
  queue: LegalRequest[]
  judicial: LegalRequest[]
  mine: LegalRequest[]
  returned: LegalRequest[]
  decided: LegalRequest[]
}

/** One derivation for the tab counts AND the panel contents (LegalView calls
 *  it once per render over the shared loaded set). */
export function deriveDojLists(requests: LegalRequest[], myId: string | null): DojLists {
  const asc = (a: string | null, b: string | null) =>
    (a ? Date.parse(a) : Infinity) - (b ? Date.parse(b) : Infinity)
  return {
    queue: requests
      .filter((r) => r.review_status === 'prosecutor_queue')
      .sort((a, b) => asc(a.queue_entered_at ?? a.submitted_to_doj_at, b.queue_entered_at ?? b.submitted_to_doj_at)),
    judicial: requests
      .filter((r) => r.review_status === 'submitted_to_judge')
      .sort((a, b) => asc(a.submitted_to_judge_at, b.submitted_to_judge_at)),
    mine: requests.filter((r) =>
      !!myId
      && ((r.review_status === 'prosecutor_review' && r.assigned_prosecutor_id === myId)
        || (r.review_status === 'judicial_review' && r.assigned_judge_id === myId))),
    returned: requests
      .filter((r) => ['returned_by_prosecutor', 'returned_by_judge'].includes(r.review_status))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    decided: requests
      .filter((r) => TERMINAL.includes(r.review_status))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
  }
}

/** Which DOJ tabs each role gets (judges skip the prosecutor queue; only the
 *  AG gets Administration). */
export function dojViewsForRole(role: DojRole): { id: DojViewId; label: string }[] {
  const views: { id: DojViewId; label: string }[] = []
  if (role !== 'judge') views.push({ id: 'queue', label: 'Queue' })
  views.push({ id: 'judicial', label: 'Judicial queue' })
  if (role !== 'attorney_general') views.push({ id: 'mine', label: 'My requests' })
  views.push({ id: 'returned', label: 'Returned' }, { id: 'decided', label: 'Decided' })
  if (role === 'attorney_general') views.push({ id: 'admin', label: 'Administration' })
  return views
}

export function DojWorkspace({ view, role, myId, lists, requests, onOpen, reload }: {
  view: DojViewId
  role: DojRole
  myId: string | null
  lists: DojLists
  /** The full RLS-scoped set (the Administration panel reads held work from it). */
  requests: LegalRequest[]
  onOpen: (id: string) => void
  reload: () => void
}) {
  const [conflict, setConflict] = useState<string | null>(null)
  const [assign, setAssign] = useState<{ seat: 'prosecutor' | 'judge'; request: LegalRequest } | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)

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

  const claimAsProsecutor = (r: LegalRequest) =>
    act(() => rpc('legal_claim_prosecutor', { p_request: r.id }), 'Claimed — the request is yours to review.', r.id)
  const claimAsJudge = (r: LegalRequest) =>
    act(() => rpc('claim_legal_request_as_judge', { p_request: r.id }), 'Claimed for judicial review.', r.id)

  const submitAssign = async (v: { userId: string; reason: string }) => {
    if (!assign) return
    setAssignBusy(true)
    if (assign.seat === 'prosecutor') {
      await act(
        () => rpc('legal_assign_prosecutor', {
          p_request: assign.request.id, p_prosecutor: v.userId, p_reason: v.reason || undefined,
        }),
        'Prosecutor assigned.',
      )
    } else {
      await act(
        () => rpc('assign_judge', { p_request: assign.request.id, p_judge: v.userId }),
        'Judge assigned.',
      )
    }
    setAssignBusy(false)
    setAssign(null)
  }

  return (
    <div className="space-y-4">
      {conflict && <RecusalBanner message={conflict} onDismiss={() => setConflict(null)} />}

      {view === 'queue' && (
        <>
          <SectionHeader
            title="Prosecutor queue"
            subtitle={role === 'attorney_general'
              ? 'One shared queue, oldest first. Assignment is yours; sealed requests reach the bench only through you.'
              : 'One shared queue, oldest first. Claiming is atomic — if a request vanishes, a colleague claimed it first.'}
          />
          <DojQueueList
            rows={lists.queue}
            onOpen={onOpen}
            ageOf={(r) => r.queue_entered_at ?? r.submitted_to_doj_at}
            ageLabel="queued"
            empty="The prosecutor queue is empty."
            action={(r) => {
              if (role === 'prosecutor') {
                if (r.classification === 'sealed' || r.created_by === myId) return null
                return { label: 'Claim', onRun: claimAsProsecutor }
              }
              if (role === 'attorney_general') {
                return { label: 'Assign…', variant: 'secondary', onRun: async () => setAssign({ seat: 'prosecutor', request: r }) }
              }
              return null
            }}
          />
        </>
      )}

      {view === 'judicial' && (
        <>
          <SectionHeader
            title="Judicial queue"
            subtitle={role === 'judge'
              ? 'Requests cleared by prosecutorial review, oldest first. Sealed requests require formal assignment.'
              : 'Requests awaiting judicial pickup or assignment, oldest first.'}
          />
          <DojQueueList
            rows={lists.judicial}
            onOpen={onOpen}
            ageOf={(r) => r.submitted_to_judge_at}
            ageLabel="waiting"
            empty="Nothing is awaiting judicial review."
            action={(r) => {
              if (role === 'judge') {
                if (r.classification === 'sealed' || r.created_by === myId || r.assigned_judge_id) return null
                return { label: 'Claim', onRun: claimAsJudge }
              }
              if (role === 'attorney_general') {
                return { label: 'Assign…', variant: 'secondary', onRun: async () => setAssign({ seat: 'judge', request: r }) }
              }
              return null
            }}
          />
        </>
      )}

      {view === 'mine' && (
        <>
          <SectionHeader
            title="My requests"
            subtitle="Work you currently hold — prosecutorial reviews you claimed and judicial reviews assigned to you."
          />
          <DojQueueList
            rows={lists.mine}
            onOpen={onOpen}
            ageOf={(r) => r.prosecutor_claimed_at ?? r.submitted_to_judge_at ?? r.updated_at}
            ageLabel="held"
            empty="You hold no requests right now."
            action={(r) => ({
              label: r.review_status === 'judicial_review' ? 'Decide' : 'Review',
              onRun: async () => onOpen(r.id),
            })}
          />
        </>
      )}

      {view === 'returned' && (
        <>
          <SectionHeader
            title="Returned"
            subtitle="Requests returned to the investigator for corrections. Resubmission re-enters CID review, then the queue."
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
            subtitle="Approved, denied, declined, withdrawn, cancelled, and superseded requests — the archive. Issuance itself stays a CID act."
          />
          <DojQueueList
            rows={lists.decided}
            onOpen={onOpen}
            ageOf={(r) => r.updated_at}
            ageLabel="decided"
            empty="No decided requests yet."
          />
        </>
      )}

      {view === 'admin' && role === 'attorney_general' && (
        <DojAdmin requests={requests} onOpen={onOpen} reload={reload} onConflict={setConflict} />
      )}

      {assign && (
        <JusticePickerModal
          seat={assign.seat}
          title={assign.seat === 'prosecutor' ? `Assign a prosecutor — ${assign.request.request_number}` : `Assign a judge — ${assign.request.request_number}`}
          hint={assign.request.classification === 'sealed'
            ? 'Sealed request — formal assignment is the only path to the bench.'
            : 'Formal assignment by the Attorney General. Conflicted members are refused server-side.'}
          reasonMode={assign.seat === 'judge' ? 'none' : assign.request.assigned_prosecutor_id ? 'required' : 'optional'}
          busy={assignBusy}
          excludeIds={[assign.request.created_by, assign.request.assigned_prosecutor_id ?? ''].filter(Boolean)}
          onSubmit={(v) => void submitAssign(v)}
          onClose={() => setAssign(null)}
        />
      )}
    </div>
  )
}
