'use client'

/** Read-only dossier sections: Summary (facts + routing), Review (review
 *  history + returns), Decision (approval/denial + assignment), Service &
 *  Return (fulfilment event cards), Activity (full timeline + participants).
 *  All interpretation comes from the deterministic legalWorkflow model —
 *  nothing here re-derives stage or status logic. */
import type { Tables } from '@/lib/database.types'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { fulfilmentLabel, reviewStatusLabel, type LegalRequest } from '@/lib/justice'
import {
  fulfilmentEvents, humanize, laneThatAdvanced, routingExplanation,
  type FulfilmentEvent, type LegalDisposition, type LegalViewer,
} from '@/lib/legalWorkflow'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { StatusChip } from '../legalShared'
import { Row, type ActionRow } from './dossierShared'

type NameFn = (id: string | null | undefined) => string

/* ── Summary ──────────────────────────────────────────────────────────────── */
export function SummarySection({ r, name, viewer, disposition, caseLinkable }: {
  r: LegalRequest
  name: NameFn
  viewer: LegalViewer
  disposition: LegalDisposition
  caseLinkable: boolean
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card pad="sm">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Request</h3>
        <Row label="Case">
          {r.case_id && caseLinkable ? (
            <EntityLink kind="case" id={r.case_id} label={`${r.case_number_snapshot ?? 'Case'}${r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}`} />
          ) : (
            <>{r.case_number_snapshot ?? '—'}{r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}</>
          )}
        </Row>
        <Row label="Responsible bureau">{r.responsible_bureau}</Row>
        <Row label="Approval route">{(r.approval_route ?? '—').toUpperCase()}</Row>
        <Row label="Priority">{r.priority ?? '—'}</Row>
        <Row label={r.request_type === 'warrant' ? 'Suspect' : 'Recipient'}>
          {r.request_type === 'subpoena' && r.recipient_type === 'entity'
            ? (r.recipient_name ?? '—')
            : (r.person_name_snapshot ?? '—')}
        </Row>
        <Row label="Requesting detective">{name(r.created_by)}</Row>
        <Row label="CID supervisor">{name(r.cid_reviewed_by)}</Row>
        <Row label="Assigned ADA">{name(r.assigned_ada_id)}</Row>
        <Row label="Assigned Judge">{name(r.assigned_judge_id)}</Row>
      </Card>
      <Card pad="sm">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Timeline</h3>
        <Row label="Created">{fmtDateTime(r.created_at)}</Row>
        <Row label="Submitted to CID">{fmtDateTime(r.submitted_to_cid_at)}</Row>
        <Row label="Submitted to DOJ">{fmtDateTime(r.submitted_to_doj_at)}</Row>
        <Row label="Submitted to Judge">{fmtDateTime(r.submitted_to_judge_at)}</Row>
        <Row label="Expires">{fmtDateTime(r.expires_at)}</Row>
        {r.request_type === 'subpoena' && <Row label="Response deadline">{fmtDateTime(r.response_deadline)}</Row>}
      </Card>
      <Card pad="sm" className="lg:col-span-2">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Where this stands</h3>
        <p className="text-sm text-slate-200">
          <span className="font-semibold text-white">{disposition.stageLabel}</span>
          <span aria-hidden className="text-slate-500"> · </span>
          <span>{disposition.statusLabel}</span>
          {disposition.responsibleRoleLabel !== '—' && (
            <span className="text-slate-300"> — awaiting {disposition.responsibleRoleLabel}</span>
          )}
        </p>
        <p className="mt-1 text-sm text-slate-400">{routingExplanation(r, viewer)}</p>
      </Card>
    </div>
  )
}

/* ── Review ───────────────────────────────────────────────────────────────── */
/** Review history: every recorded status transition and public note (internal
 *  prosecutor notes are column-revoked server-side and never reach this list). */
export function ReviewSection({ actions, name }: { actions: ActionRow[]; name: NameFn }) {
  const reviewActions = actions.filter((a) => a.from_status || a.to_status || a.public_note)
  const returns = reviewActions.filter((a) => a.to_status?.startsWith('returned'))
  return (
    <div className="space-y-4">
      {returns.length > 0 && (
        <Card pad="sm" className="border-amber-500/20">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-300">
            Returns ({returns.length})
          </h3>
          <WorkflowTimeline dense entries={returns.map((a): TimelineEntry => ({
            id: a.id,
            title: humanize(a.action),
            actor: name(a.actor_id),
            at: a.created_at,
            from: a.from_status ? reviewStatusLabel(a.from_status) : null,
            to: a.to_status ? reviewStatusLabel(a.to_status) : null,
            note: a.public_note,
          }))} />
        </Card>
      )}
      <Card pad="sm">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Review history</h3>
        <WorkflowTimeline
          entries={reviewActions.map((a): TimelineEntry => ({
            id: a.id,
            title: humanize(a.action),
            actor: name(a.actor_id),
            at: a.created_at,
            from: a.from_status ? reviewStatusLabel(a.from_status) : null,
            to: a.to_status ? reviewStatusLabel(a.to_status) : null,
            note: a.public_note,
          }))}
          empty="No review actions recorded yet."
        />
      </Card>
    </div>
  )
}

/* ── Decision ─────────────────────────────────────────────────────────────── */
export function DecisionSection({ r, name }: { r: LegalRequest; name: NameFn }) {
  const lane = laneThatAdvanced(r)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card pad="sm">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Decision record</h3>
        {r.decision ? (
          <>
            <Row label="Decision">{`${humanize(r.decision)} by ${name(r.decided_by)}${r.decided_at ? ` · ${fmtDateTime(r.decided_at)}` : ''}`}</Row>
            {r.decision_note && <Row label="Decision note">{r.decision_note}</Row>}
            {r.judicial_conditions && <Row label="Conditions">{r.judicial_conditions}</Row>}
            <Row label="Issued">{r.issued_at ? `${fmtDateTime(r.issued_at)} by ${name(r.issued_by)}` : '—'}</Row>
            <Row label="Expires">{fmtDateTime(r.expires_at)}</Row>
            {r.request_type === 'subpoena' && <Row label="Response deadline">{fmtDateTime(r.response_deadline)}</Row>}
          </>
        ) : (
          <p className="py-1 text-sm text-slate-400">
            No decision has been recorded yet — this request is at {reviewStatusLabel(r.review_status).toLowerCase()}.
          </p>
        )}
      </Card>
      <Card pad="sm">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Assignment</h3>
        <Row label="Assigned ADA">{name(r.assigned_ada_id)}</Row>
        <Row label="Assigned Judge">{name(r.assigned_judge_id)}</Row>
        <Row label="CID supervisor">{name(r.cid_reviewed_by)}</Row>
        {lane && (
          <p className="mt-2 text-xs text-slate-400">
            {lane === 'judicial'
              ? 'Advanced via the judicial lane — claimed directly from DOJ intake without a prosecutor hand-off.'
              : 'Advanced via the prosecutorial lane.'}
          </p>
        )}
      </Card>
    </div>
  )
}

/* ── Service & Return ─────────────────────────────────────────────────────── */
export function ServiceSection({ r, name }: { r: LegalRequest; name: NameFn }) {
  const warrant = r.request_type === 'warrant'
  const events = fulfilmentEvents(r)
  return (
    <div className="space-y-4">
      <Card pad="sm">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Fulfilment status</h3>
        <div className="flex flex-wrap items-center gap-2 py-1">
          <StatusChip label={fulfilmentLabel(r.fulfilment_status)} tone="blue" />
          {!warrant && <StatusChip label={`Service: ${humanize(r.service_status)}`} tone="slate" />}
          {!warrant && <StatusChip label={`Compliance: ${humanize(r.compliance_status)}`} tone="slate" />}
        </div>
        <Row label="Expires">{fmtDateTime(r.expires_at)}</Row>
        {!warrant && <Row label="Response deadline">{fmtDateTime(r.response_deadline)}</Row>}
      </Card>
      {events.length === 0 ? (
        <Card pad="sm">
          <p className="text-sm text-slate-400">
            No {warrant ? 'issuance, execution or return' : 'issuance, service or compliance'} events recorded yet.
          </p>
        </Card>
      ) : (
        <ol className="space-y-2" aria-label="Service and return events">
          {events.map((e: FulfilmentEvent) => (
            <li key={e.id}>
              <Card pad="sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-white">{e.label}</span>
                  {e.at && <span className="text-xs text-slate-400">{fmtDateTime(e.at)}</span>}
                  {e.byId && <span className="text-xs text-slate-400">by {name(e.byId)}</span>}
                </div>
                {e.detail.map((d) => (
                  <p key={d.label} className="mt-1 text-sm text-slate-300">
                    <span className="text-xs font-semibold text-slate-400">{d.label}: </span>
                    <span className="whitespace-pre-wrap">{d.value}</span>
                  </p>
                ))}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/* ── Activity ─────────────────────────────────────────────────────────────── */
export function ActivitySection({ actions, participants, name }: {
  actions: ActionRow[]
  participants: Tables<'legal_request_participants'>[]
  name: NameFn
}) {
  return (
    <div className="space-y-4">
      <Card pad="sm">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Full activity</h3>
        <WorkflowTimeline entries={actions.map((a): TimelineEntry => ({
          id: a.id,
          title: humanize(a.action),
          actor: name(a.actor_id),
          at: a.created_at,
          from: a.from_status ? reviewStatusLabel(a.from_status) : null,
          to: a.to_status ? reviewStatusLabel(a.to_status) : null,
          note: a.public_note,
        }))} />
      </Card>
      <Card pad="sm">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Participants</h3>
        <ul className="space-y-1.5">
          {participants.map((p) => (
            <li key={`${p.user_id}:${p.participant_role}`} className={`flex flex-wrap items-center gap-2 text-sm ${p.removed_at ? 'opacity-50' : ''}`}>
              <span className="font-semibold text-white">{name(p.user_id)}</span>
              <span className="text-xs text-slate-400">{humanize(p.participant_role)}</span>
              <span className="text-xs text-slate-400">added {fmtDate(p.added_at)}</span>
              {p.removed_at && <StatusChip label={`ended ${fmtDate(p.removed_at)}`} tone="rose" />}
            </li>
          ))}
          {participants.length === 0 && <li className="text-sm text-slate-400">No participants yet.</li>}
        </ul>
      </Card>
    </div>
  )
}
