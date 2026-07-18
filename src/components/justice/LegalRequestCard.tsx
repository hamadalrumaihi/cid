'use client'

/** A legal-request CARD — the card-based replacement for the flat chip row.
 *  Everything shown here is derived from the rule-based model
 *  (dispositionFor): the human stage (never a raw review_status), who owns the
 *  next action, what that action is called, and whether the viewer may act /
 *  claim / is merely aware. Awareness-only is always visually de-emphasised so
 *  bureau visibility never masquerades as assigned work.
 *
 *  Reuses the Card surface + DeadlineChip; matches the NarcoticsRegistryCard
 *  idiom (one focusable, keyboard-accessible ≥44px target per record). */
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import {
  activeDeadline, dispositionFor, formatTarget, humanize,
  type LegalReqLike, type LegalViewer,
} from '@/lib/legalWorkflow'
import { ClassificationBadge } from './legalShared'

export type LegalCardRequest = LegalReqLike & {
  id: string
  request_number: string | null
  title: string | null
  person_name_snapshot: string | null
  recipient_name: string | null
  recipient_type: string | null
  case_number_snapshot: string | null
}

export interface LegalRequestCardProps {
  request: LegalCardRequest
  viewer: LegalViewer
  now: number
  onOpen: () => void
  /** Friendly case label to show instead of the raw snapshot number. */
  caseLabel?: string
  /** Show the classification chip when the request is non-standard. */
  showClassification?: boolean
}

/** Small label/value pair for the card's meta block. */
function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="flex-shrink-0 text-slate-500">{label}</dt>
      <dd className={`min-w-0 truncate text-slate-300 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

/** Next-action pill tone. viewerCanAct is the only prominent (solid accent)
 *  state; claimable reads as an outlined "available"; awareness/waiting stay
 *  muted and never look like urgent work. */
function actionTone(d: { viewerCanAct: boolean; viewerCanClaim: boolean }): string {
  // Dark ink on the accent (the SectionTabs active-tab treatment) — white on
  // the user-selectable accent fails the 4.5:1 contrast floor for small text.
  if (d.viewerCanAct) return 'bg-badge-500 text-ink-950'
  if (d.viewerCanClaim) return 'border border-badge-500/40 bg-badge-500/10 text-blue-200'
  return 'bg-white/5 text-slate-400'
}

export function LegalRequestCard({
  request, viewer, now, onOpen, caseLabel, showClassification = false,
}: LegalRequestCardProps) {
  const d = dispositionFor(request, viewer, now)
  const deadline = activeDeadline(request)
  const typeLine = request.subtype
    ? `${humanize(request.request_type)} · ${humanize(request.subtype)}`
    : humanize(request.request_type)
  const label = `Open request ${request.request_number ?? ''} ${request.title ?? ''}`.trim()

  return (
    <Card
      pad="sm"
      interactive
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      className="w-full cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{typeLine}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-white">{request.title ?? 'Untitled request'}</h3>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {request.request_number && <span className="font-mono text-xs text-blue-300">{request.request_number}</span>}
          {showClassification && request.classification && request.classification !== 'standard' && (
            <ClassificationBadge value={request.classification} />
          )}
        </div>
      </div>

      <dl className="mt-2 space-y-1 text-xs">
        {request.case_number_snapshot && (
          <Meta label="Case" value={caseLabel ?? request.case_number_snapshot} mono={!caseLabel} />
        )}
        <Meta label="Target" value={formatTarget(request)} />
        {request.responsible_bureau && <Meta label="Bureau" value={request.responsible_bureau} />}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-slate-300">{d.stageLabel}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="text-slate-400">{d.responsibleRoleLabel}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${actionTone(d)}`}>
          {d.awarenessOnly && <span className="mr-1 text-[13px] leading-none" aria-hidden="true">◦</span>}
          {d.nextAction}
        </span>
        {deadline && <DeadlineChip at={deadline.at} kind={deadline.kind} now={now} />}
      </div>
    </Card>
  )
}
