'use client'

/** Field Intelligence Review — the CID/SIB workspace for reports from patrol.
 *
 *  This is what replaced the Odyssey ticket queue. It is not the same thing
 *  renamed: a ticket was a request to open a case, and a field submission is
 *  structured intelligence that a reviewer turns into records, or does not.
 *
 *  ── Reviewers do not edit reports ──────────────────────────────────────────
 *  Every action here is an RPC that audits itself, and CID has no UPDATE policy
 *  on field_submissions at all — so a reviewer cannot rewrite what an officer
 *  said and then review it. They decide, reroute, and ask. That asymmetry is
 *  deliberate: the report is the officer's account.
 *
 *  ── Two places to write, and only one reaches the officer ──────────────────
 *  A decision note is reviewer-private (field_submission_reviews, is_active()
 *  only). A message is the thread the officer reads. The UI keeps them visibly
 *  apart because putting internal reasoning in front of the person it is about
 *  is the failure worth designing against.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import {
  RELIABILITIES, RELIABILITY_LABEL, RELIABILITY_MEANING, URGENCIES, URGENCY_LABEL,
  gradeSubmission, isExternalSource, jurisdictionLabel,
  loadSubmissionParts, reliabilityLabel, reviewerStatusLabel, sourceLabel,
  submissionRef, urgencyLabel, urgencyTone,
  type FieldSubmissionRow, type Reliability, type SubmissionParts, type Urgency,
} from '@/lib/fieldSubmissions'
import {
  ARCHIVE_REASONS, DELETED_FILTER, NON_ROW_FILTERS, QUEUE_FILTERS, QUEUE_LABEL, SIU_FILTERS,
  SIU_FILTER_LABEL, VERDICTS, VERDICT_LABEL, VERDICT_MEANING, VERDICT_TONE,
  archiveSubmission, askOfficer, assignSubmission, assignmentLine, awaitingReviewer,
  claimSubmission, commentSubmission, deleteSubmission, loadRepeats, readyToValidate,
  rejectSubmission, repeatLine, restoreSubmission,
  searchSubmissions, undeleteSubmission, validateSubmission, validationStale, withdrawValidation,
  countsSummary, decideClaim, decideSubmission, loadAssignments,
  loadClaimProgress, loadCounts, loadMessages, loadReviewNotes, loadReviewQueue,
  loadVerdicts, matchesFilter, progressLabel, releaseSubmission, reviewNext, reviewPrompt,
  linkClaim, linkFor, loadClaimLinks, loadMatches,
  verdictFor, type ClaimKind, type ClaimProgress, type EntityMatch,
  type FieldAssignmentRow, type FieldClaimLinkRow, type FieldMessageRow,
  type FieldReviewNoteRow, type FieldVerdictRow, type MatchResult,
  type QueueFilter, type RepeatSignal, type SiuFilter, type SubmissionCounts,
  type Verdict,
} from '@/lib/fieldReview'
import { evidenceLabel, evidenceUrl, loadEvidence, type FieldEvidenceRow } from '@/lib/fieldEvidence'
import { FieldAccessQueue, countPending, useAccessRequests } from './FieldAccessQueue'
import { FieldAccessRoster, useFieldRoster } from './FieldAccessRoster'
import { IntelActions } from './IntelActions'
import { IntelGroups, IntelGroupsList } from './IntelGroups'
import { SiuPanel } from './SiuPanel'
import { FieldSubmitForm } from './FieldSubmitForm'
import { ExternalSourcesPanel, useExternalSourceCount } from './ExternalSourcesPanel'
import { siuCategoryLabel, siuStateLabel, siuStateTone } from '@/lib/fieldSiu'
import { canRejectIntel, canRestoreIntel, canValidateIntel, useSiu, type CidViewer } from '@/lib/permissions'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { RelatedGuidance } from '@/components/sops/RelatedGuidance'
import { RecordHistory } from '@/components/shared/RecordHistory'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { uiPrompt } from '@/components/ui/dialog'

const NO_PARTS: SubmissionParts = { persons: [], vehicles: [], orgs: [], locations: [], items: [] }

export function FieldReviewView() {
  const { state, profile, isCommand, isOwner } = useAuth()
  const me = profile?.id ?? null
  // Deep link: `/tools?tool=field-review&record=<id>` (notifications, the SIB
  // cross-link). The workspace carries the generic `record` param under this
  // tool's own `submission` seed (toolsModel RECORD_PARAM + the URL mirror),
  // and this view reads whichever spelling is present -- at mount, and again
  // if the URL changes while it stays mounted.
  const sp = useSearchParams()
  const seed = sp.get('submission') ?? sp.get('record')
  // `/intelligence?source=<id>` opens an external source's detail (search
  // palette hits, notifications, the case Intel tab) on the External
  // Sources registry tab.
  const sourceSeed = sp.get('source')
  const [rows, setRows] = useState<FieldSubmissionRow[] | null>(null)
  const [counts, setCounts] = useState<Record<string, SubmissionCounts>>({})
  const [selected, setSelected] = useState<string | null>(seed)
  const [tab, setTab] = useState<
    QueueFilter | SiuFilter | typeof DELETED_FILTER | 'access' | 'legacy' | 'external'>(sourceSeed ? 'external' : 'unclaimed')
  const [writing, setWriting] = useState(false)
  // Search is a MODE, not another filter. A reviewer searching has stopped
  // asking "what is in my queue" and started asking "where is that report", and
  // the answer must not depend on which tab they happened to be on -- least of
  // all for an archived record, which is exactly the one somebody searches for.
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Map<string, string[]> | null>(null)
  // field_submissions is not published (its rows carry the report text); the
  // shadow table field_submission_events (P6-06) is -- status, assignee and
  // SIB state only, RLS-filtered -- so the queue follows server changes.
  const v = useTableVersion('field_submission_events')
  const access = useAccessRequests()
  const roster = useFieldRoster()
  const siu = useSiu()

  const refresh = useCallback(async () => {
    const [q, c] = await Promise.all([loadReviewQueue(), loadCounts()])
    setRows(q); setCounts(c)
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v])
  useEffect(() => {
    if (!seed) return
    const t = window.setTimeout(() => setSelected(seed), 0)
    return () => window.clearTimeout(t)
  }, [seed])
  useEffect(() => {
    if (!sourceSeed) return
    const t = window.setTimeout(() => { setSelected(null); setTab('external') }, 0)
    return () => window.clearTimeout(t)
  }, [sourceSeed])
  const externalCount = useExternalSourceCount(state === 'in')

  // Debounced, because the search reaches seven tables and a reviewer types
  // faster than that deserves.
  useEffect(() => {
    const q = query.trim()
    const t = window.setTimeout(() => {
      if (q.length < 2) { setHits(null); return }
      void searchSubmissions(q).then(setHits).catch(() => setHits(new Map()))
    }, 250)
    return () => window.clearTimeout(t)
  }, [query, v])

  if (state !== 'in') return <Notice text="Sign in to review field intelligence." />

  const all = rows ?? []
  const searching = hits !== null
  const shown = tab === 'access' || tab === 'legacy' || tab === 'external'
    ? []
    // Searching spans every queue INCLUDING the archive, and deliberately keeps
    // the deleted out -- a deleted record is only ever in the Deleted list.
    : searching
      ? all.filter((r) => hits.has(r.id) && !r.deleted_at)
      : all.filter((r) => matchesFilter(r, tab, me))
  const current = all.find((r) => r.id === selected) ?? null
  const pending = countPending(access.rows ?? [])

  // Counts on the tabs so a reviewer can see where the work is without opening
  // each queue. Only the ones that mean "somebody is waiting" are counted; a
  // number on "All" or "Processed" is trivia.
  const countFor = (f: QueueFilter | SiuFilter | typeof DELETED_FILTER): number | undefined =>
    f === 'all' || f === 'processed' || (NON_ROW_FILTERS as readonly string[]).includes(f) ? undefined
      : all.filter((r) => matchesFilter(r, f, me)).length

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Intelligence"
          subtitle="Everything that comes into CID as information — patrol, detectives, surveillance and outside agencies. Review what arrived, decide what it means."
          actions={!writing ? (
            <Button variant="primary" onClick={() => setWriting(true)}>
              + New intelligence
            </Button>
          ) : undefined}
        />
        {/* Whichever documents have declared themselves relevant to this work.
            Renders nothing until one does, which is the honest state today. */}
        <RelatedGuidance route="field" className="mt-3 border-t border-white/5 pt-3" />
      </div>

      {/* The same structured form a patrol officer fills in. An investigator
          writing something down produces the same kind of record -- that is
          what "one Intelligence entity" means in practice, and it is why the
          separate "submit a tip" page is gone. */}
      {writing && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-white">
              New intelligence
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>Cancel</Button>
          </div>
          <FieldSubmitForm asInvestigator onDone={() => { setWriting(false); void refresh() }} />
        </Card>
      )}

      {!current && (
        <Card>
          <Field label="Search intelligence"
            hint="Looks through the report, the people, vehicles, organisations, places and items named in it, and the thread with the officer. Archived records are included — that is the point of archiving rather than deleting.">
            {(fid) => (
              <div className="flex gap-2">
                <Input id={fid} value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="A name, a plate, a street, an FI number…" />
                {query && (
                  <Button size="sm" variant="ghost" onClick={() => setQuery('')}>Clear</Button>
                )}
              </div>
            )}
          </Field>
        </Card>
      )}

      {!current && !searching && (
        <SectionTabs
          idBase="field-review"
          ariaLabel="Field Intelligence queues"
          active={tab}
          onChange={setTab}
          tabs={[
            ...QUEUE_FILTERS.map((f) => ({
              id: f as QueueFilter | SiuFilter | 'access' | 'legacy' | 'external',
              label: QUEUE_LABEL[f],
              count: countFor(f),
            })),
            // Same table, same reports: SIB is a specialist detachment inside
            // CID, so these are filters rather than a second application.
            ...(siu.isAgent ? SIU_FILTERS.map((f) => ({
              id: f as QueueFilter | SiuFilter | 'access' | 'legacy' | 'external',
              label: SIU_FILTER_LABEL[f],
              count: countFor(f),
            })) : []),
            // The Owner is the only reader who can see a deleted record at
            // all, and this is the only place one appears -- so that undoing a
            // deletion does not depend on whoever made it.
            ...(isOwner ? [{
              id: DELETED_FILTER as QueueFilter | SiuFilter | 'access' | 'legacy' | 'external',
              label: 'Deleted',
              count: countFor(DELETED_FILTER),
            }] : []),
            // Not a queue: access is immediate. This is the record of who can
            // send us intelligence, and it belongs where the reports arrive.
            {
              id: 'access' as const,
              label: 'Submitter access',
              count: (roster.rows ?? []).filter((r) => r.standing_active).length,
            },
            // A registry, not a queue: crawled web pages (platform upgrade
            // §2.6). UNVERIFIED INTELLIGENCE until an analyst verifies one;
            // the count is the live rows this viewer can see.
            {
              id: 'external' as const,
              label: 'External Sources',
              count: externalCount,
            },
            // Only while genuinely undecided requests from before self-service
            // still exist. Nothing files new ones, so this tab disappears for
            // good once the last one is answered.
            ...(pending > 0 ? [{
              id: 'legacy' as const,
              label: 'Legacy requests',
              count: pending,
              marker: true,
              markerLabel: 'Requests filed before access became immediate',
            }] : []),
          ]}
        />
      )}

      {!current && tab === 'external' ? (
        <ExternalSourcesPanel seed={sourceSeed} />
      ) : !current && tab === 'access' ? (
        <FieldAccessRoster rows={roster.rows} onChanged={() => void roster.refresh()} />
      ) : !current && tab === 'legacy' ? (
        <FieldAccessQueue rows={access.rows} onChanged={() => void access.refresh()} />
      ) : !current && !searching && tab === 'groups' ? (
        // Live intel groups (P6-03) -- a list of groups, not of submissions.
        <IntelGroupsList onOpen={(id) => setSelected(id)} />
      ) : current ? (
        <SubmissionDetail
          submission={current}
          counts={counts[current.id]}
          onBack={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      ) : (
        <Card pad="none" className="overflow-hidden">
          <div className="border-b border-white/5 px-5 py-3">
            <h3 className="text-[13px] font-semibold text-white">
              {searching ? `Search — ${shown.length} record${shown.length === 1 ? '' : 's'}`
                : tab === 'access' ? 'Submitter access'
                : tab === 'legacy' ? 'Legacy requests'
                : tab in QUEUE_LABEL ? QUEUE_LABEL[tab as QueueFilter]
                : SIU_FILTER_LABEL[tab as SiuFilter]}
            </h3>
            {searching && (
              <p className="mt-0.5 text-xs text-slate-500">
                Across every queue, archived included.
              </p>
            )}
          </div>
          {rows === null ? (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : !shown.length ? (
            <EmptyState
              title={searching ? 'Nothing matched' : 'Nothing here'}
              hint={searching
                ? 'No record you can open mentions that — in its own text or in anything named in it.'
                : tab === 'mine'
                ? 'Nothing is assigned to you. Claim a report from the Unclaimed queue.'
                : 'No reports match this queue. Try “All”.'}
              className="m-4"
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {shown.map((r) => (
                <ReportCard key={r.id} r={r} counts={counts[r.id]} me={me}
                  isCommand={isCommand}
                  matched={hits?.get(r.id)}
                  onOpen={() => setSelected(r.id)}
                  onChanged={() => void refresh()} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

/** One report as it reads in a queue: what it is, what is in it, and who has
 *  it. Claim is offered here rather than only inside the report because the
 *  decision to pick something up is made from the list. */
function ReportCard({ r, counts, me, isCommand, matched, onOpen, onChanged }: {
  r: FieldSubmissionRow
  counts: SubmissionCounts | undefined
  me: string | null
  isCommand: boolean
  /** Why this row is in a search result. Without it a reviewer is looking at a
   *  report whose summary says nothing about what they searched for, left to
   *  guess whether the search is broken. */
  matched?: string[]
  onOpen: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const summary = countsSummary(counts)
  const holder = r.assigned_to ? (officerName(r.assigned_to) ?? 'another investigator') : null

  const claim = async () => {
    setBusy(true)
    const err = await claimSubmission(r.id)
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    toast('Claimed. It is yours now.', 'success')
    onChanged()
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="font-mono text-sm text-slate-300 hover:text-white">
          {submissionRef(r)}
        </button>
        <span className="flex flex-wrap items-center gap-2">
          {/* An external report is badged by the agency that sent it; anything
              written inside CID is badged by what kind of information it is. */}
          <Badge tone="neutral">
            {isExternalSource(r.source_type) ? r.snap_agency : sourceLabel(r.source_type)}
          </Badge>
          {r.urgency && <Badge tone={urgencyTone(r.urgency)}>{urgencyLabel(r.urgency)}</Badge>}
          <Badge tone="accent">{jurisdictionLabel(r.jurisdiction)}</Badge>
          <Badge tone={r.status === 'needs_info' ? 'warn' : r.status === 'rejected' ? 'neutral' : 'accent'}>
            {reviewerStatusLabel(r.status)}
          </Badge>
          {/* The explicit mark (P6-05), not the derived condition: a reviewer
              said so, and their name is on the record. */}
          {r.validated_at && <Badge tone="good">Validated</Badge>}
          {/* A workflow indicator, never "confirmed SIB case" -- the wording
              comes from siuStateLabel so the two cannot drift apart. */}
          {r.siu_state && (
            <Badge tone={siuStateTone(r.siu_state)}>
              {siuStateLabel(r.siu_state)}
              {r.siu_category ? ` · ${siuCategoryLabel(r.siu_category)}` : ''}
            </Badge>
          )}
        </span>
      </div>
      {matched && matched.length > 0 && (
        <p className="mt-1 text-xs text-emerald-300/80">
          Matched {matched.join(', ')}
        </p>
      )}
      <button onClick={onOpen} className="mt-1 block w-full text-left">
        <p className="truncate text-sm text-white">{r.summary}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {[r.snap_callsign, r.snap_rank].filter(Boolean).join(' · ')}
          {r.submitted_at && ` · sent ${timeAgo(r.submitted_at)}`}
          {reviewPrompt(r) && ` · ${reviewPrompt(r)}`}
        </p>
        {summary && <p className="mt-0.5 text-xs text-slate-400">{summary}</p>}
      </button>
      {r.delete_reason && (
        <p className="mt-0.5 text-xs text-rose-300/80">Deleted — “{r.delete_reason}”</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">
          {holder
            ? `${r.assigned_to === me ? 'Yours' : holder}${r.assigned_at ? ` since ${timeAgo(r.assigned_at)}` : ''}`
            : 'Unclaimed'}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onOpen}>Open</Button>
        {!r.assigned_to && !r.deleted_at && (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void claim()}>
            {busy ? 'Claiming…' : 'Claim'}
          </Button>
        )}
        {isCommand && !r.deleted_at && <AssignButton submission={r} onChanged={onChanged} />}
        {/* Only the Owner ever sees a deleted record, and this is the only
            place one appears. */}
        {r.deleted_at && (
          <Button size="sm" variant="ghost" onClick={() => void (async () => {
            const err = await undeleteSubmission(r.id)
            if (err) { toast(err, 'danger'); return }
            toast('Restored. It is back in the queues.', 'success')
            onChanged()
          })()}>
            Undo delete
          </Button>
        )}
      </div>
    </li>
  )
}

/** Command handing a report out. The eligible list is drawn from the roster and
 *  the RPC re-checks it: a detective who cannot see the report's jurisdiction is
 *  refused server-side even if this list somehow offered them. */
function AssignButton({ submission, onChanged }: {
  submission: FieldSubmissionRow
  onChanged: () => void
}) {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchProfiles() }, 0)
    return () => window.clearTimeout(t)
  }, [fetchProfiles])

  const eligible = profiles.filter((p) => p.active && !p.removed_at
    && p.id !== submission.assigned_to)

  const send = async () => {
    if (!who) { toast('Choose an investigator.', 'warn'); return }
    let reason: string | undefined
    if (submission.assigned_to) {
      const said = await uiPrompt(
        `${officerName(submission.assigned_to) ?? 'The current investigator'} has this report. Say why it is moving.`,
        { title: 'Reassign', placeholder: 'e.g. Workload — they are on the Vespucci case.', confirmText: 'Reassign' },
      )
      if (!said?.trim()) return
      reason = said
    }
    const err = await assignSubmission(submission.id, who, reason)
    if (err) { toast(err, 'danger'); return }
    toast('Assigned.', 'success')
    setOpen(false); setWho('')
    onChanged()
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {submission.assigned_to ? 'Reassign' : 'Assign'}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <Select value={who} onChange={(e) => setWho(e.target.value)} className="text-xs">
        <option value="">Investigator…</option>
        {eligible.map((p) => (
          <option key={p.id} value={p.id}>{p.display_name || p.id}</option>
        ))}
      </Select>
      <Button size="sm" variant="primary" onClick={() => void send()}>Confirm</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  )
}

function SubmissionDetail({ submission, counts, onBack, onChanged }: {
  submission: FieldSubmissionRow
  /** The queue's per-record counts -- carries the derived validation flag. */
  counts: SubmissionCounts | undefined
  onBack: () => void
  onChanged: () => void
}) {
  const { profile, isCommand } = useAuth()
  // The cosmetic mirror's view of the viewer. The RPCs re-check every one of
  // these; this only decides which buttons are worth drawing.
  const viewer: CidViewer | null = profile
    ? { id: profile.id, role: profile.role, division: profile.division, active: profile.active, is_owner: profile.is_owner }
    : null
  const [parts, setParts] = useState<SubmissionParts>(NO_PARTS)
  const [evidence, setEvidence] = useState<FieldEvidenceRow[]>([])
  const [messages, setMessages] = useState<FieldMessageRow[]>([])
  const [notes, setNotes] = useState<FieldReviewNoteRow[]>([])
  // The reason lives only in the reviewer-private notes (never on the row,
  // which the submitter reads): the latest "Rejected: …" note carries it.
  const rejectReason = submission.status === 'rejected'
    ? (notes.find((n) => n.note.startsWith('Rejected: '))?.note.slice('Rejected: '.length) ?? null)
    : null
  const [verdicts, setVerdicts] = useState<FieldVerdictRow[]>([])
  const [links, setLinks] = useState<FieldClaimLinkRow[]>([])
  const [progress, setProgress] = useState<ClaimProgress | null>(null)
  const [history, setHistory] = useState<FieldAssignmentRow[]>([])
  const [repeats, setRepeats] = useState<RepeatSignal[]>([])
  const [next, setNext] = useState('')
  const [note, setNote] = useState('')
  const id = submission.id

  const load = useCallback(async () => {
    const [p, e, m, n, v, pr, lk, hist, rep] = await Promise.all([
      loadSubmissionParts(id), loadEvidence(id), loadMessages(id), loadReviewNotes(id),
      loadVerdicts(id), loadClaimProgress(id), loadClaimLinks(id), loadAssignments(id),
      loadRepeats(id).catch(() => []),
    ])
    setParts(p); setEvidence(e); setMessages(m); setNotes(n)
    setVerdicts(v); setProgress(pr); setLinks(lk); setHistory(hist); setRepeats(rep)
  }, [id])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    toast(ok, 'success')
    await load()
    onChanged()
  }

  const openEvidence = async (e: FieldEvidenceRow) => {
    const href = await evidenceUrl(e)
    if (!href) { toast('That attachment could not be opened.', 'danger'); return }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const ask = async () => {
    const q = await uiPrompt(
      'The officer sees this question and can reply. Internal notes stay internal.',
      { title: 'Ask the officer', placeholder: 'Do you have a clearer image of the plate?', confirmText: 'Send' },
    )
    if (!q?.trim()) return
    await after(await askOfficer(id, q), 'Question sent to the officer.')
  }

  const release = async () => {
    const why = await uiPrompt(
      'Whoever picks this up next reads this. "Not my area" and "I know the suspect" '
      + 'are very different reasons to hand a report back.',
      { title: 'Release this report', placeholder: 'Why are you releasing it?', confirmText: 'Release' },
    )
    if (!why?.trim()) return
    await after(await releaseSubmission(id, why), 'Released. It is back in the unclaimed queue.')
  }

  const archive = async () => {
    const why = await uiPrompt(
      'Archiving takes it out of the active queues and keeps everything — the '
      + 'evidence, the claims, the verdicts, who reported it. It stays searchable '
      + 'and can be restored.',
      {
        title: 'Archive this record',
        placeholder: `Why? e.g. ${ARCHIVE_REASONS[0]}`,
        confirmText: 'Archive',
      },
    )
    if (!why?.trim()) return
    await after(await archiveSubmission(id, why), 'Archived. It stays searchable.')
  }

  const restore = async () => {
    const rejected = submission.status === 'rejected'
    const why = await uiPrompt(
      'It comes back as "being reviewed" — somebody is looking again. The reason '
      + `it was ${rejected ? 'rejected' : 'archived'} stays on the record.`,
      {
        title: rejected ? 'Restore a rejected record' : 'Restore from the archive',
        placeholder: 'Why now? (optional)', confirmText: 'Restore',
      },
    )
    // An empty reason is fine here; a cancelled dialog is not.
    if (why === null) return
    await after(await restoreSubmission(id, why), 'Restored.')
  }

  const reject = async () => {
    const why = await uiPrompt(
      'Rejecting says this should not be treated as intelligence. The officer '
      + 'sees "Closed" and never the reason; reviewers see both. Nothing is '
      + 'deleted, and a Bureau Lead or above can restore it. If the information '
      + 'is simply not useful right now, archive it instead.',
      { title: 'Reject this record', placeholder: 'Say why it is rejected.', confirmText: 'Reject' },
    )
    if (!why?.trim()) return
    await after(await rejectSubmission(id, why), 'Rejected. The officer sees it as closed.')
  }

  const validate = async () => {
    const note = await uiPrompt(
      'Validating says every claim has a verdict and the source is graded. Your '
      + 'name goes on the record with the note. A later verdict change does not '
      + 'take the mark off — the record says "claims changed since" instead.',
      { title: 'Mark as validated', placeholder: 'What was checked, and against what?', confirmText: 'Validate' },
    )
    if (!note?.trim()) return
    await after(await validateSubmission(id, note), 'Validated.')
  }

  const unvalidate = async () => {
    const note = await uiPrompt(
      'The mark comes off and the reason stays in the internal notes.',
      { title: 'Withdraw validation', placeholder: 'Why is the validation withdrawn?', confirmText: 'Withdraw' },
    )
    if (!note?.trim()) return
    await after(await withdrawValidation(id, note), 'Validation withdrawn.')
  }

  const drop = async () => {
    const why = await uiPrompt(
      'Delete is for a record that should not exist — a test entry, a double '
      + 'submission, something filed by mistake. If the information is simply not '
      + 'useful, archive it instead: that keeps everything and can be undone.',
      { title: 'Delete this record', placeholder: 'Why should this record not exist?', confirmText: 'Delete' },
    )
    if (!why?.trim()) return
    await after(await deleteSubmission(id, why), 'Deleted.')
    onBack()
  }

  const edges = reviewNext(submission.status)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm text-slate-300">{submissionRef(submission)}</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">{submission.summary}</h3>
            <p className="mt-1 text-xs text-slate-400">
              {[submission.snap_callsign, submission.snap_agency, submission.snap_rank, submission.snap_unit]
                .filter(Boolean).join(' · ')}
              {/* The snapshot first: it is taken at submit time and survives the
                  account being removed or permanently deleted, so a report keeps
                  saying who filed it rather than degrading to "Deleted Member". */}
              {' — '}{submission.snap_officer_name
                ?? officerName(submission.officer_id) ?? 'Officer'}
            </p>
            <p className="text-xs text-slate-500">
              {submission.submitted_at && `Sent ${fmtDateTime(submission.submitted_at)}`}
              {submission.mdt_reference && ` · their report ${submission.mdt_reference}`}
              {` · ${jurisdictionLabel(submission.jurisdiction)}`}
              {` · ${sourceLabel(submission.source_type)}`}
            </p>
            {submission.archive_reason && (
              <p className="text-xs text-amber-300/80">
                Archived — “{submission.archive_reason}”
              </p>
            )}
            {/* Reviewer-facing only. The submitter's surface (FieldShell)
                never renders this row and never reads the reason. */}
            {submission.status === 'rejected' && (
              <p className="text-xs text-slate-400">
                Rejected{submission.rejected_by ? ` by ${officerName(submission.rejected_by) ?? 'a reviewer'}` : ''}
                {submission.rejected_at ? ` on ${fmtDateTime(submission.rejected_at)}` : ''}
                {rejectReason ? ` — “${rejectReason}”` : ''}
              </p>
            )}
            {submission.validated_at && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Badge tone="good">Validated</Badge>
                <span>
                  by {officerName(submission.validated_by) ?? 'a reviewer'} on {fmtDateTime(submission.validated_at)}
                  {validationStale(submission, counts) && ' · claims changed since'}
                </span>
              </p>
            )}
            {readyToValidate(submission, counts) && (
              <p className="mt-1 text-xs text-emerald-300/90">
                Ready to validate — every claim is decided and the source is graded.
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onBack}>Back to queue</Button>
        </div>
        {submission.details && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{submission.details}</p>
        )}
        {/* Have we heard this before? Three unremarkable reports naming the same
            person are not three unremarkable reports -- and nobody notices that
            reading them a week apart, which is why it is said here rather than
            left for somebody to work out. */}
        {repeats.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[13px] font-semibold text-amber-300">
              Seen before
            </p>
            <ul className="mt-1 space-y-0.5">
              {repeats.map((rp) => (
                <li key={`${rp.kind}-${rp.label}-${rp.basis}`} className="text-sm text-amber-100">
                  {repeatLine(rp)}
                  <span className="text-xs text-amber-200/70"> — {rp.records.join(', ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-white">What was reported</h4>
          {progress && <span className="text-xs text-slate-500">{progressLabel(progress)}</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Decide each claim on its own. Confirming a plate says nothing about whether
          the person driving it belongs to the club the officer named.
        </p>
        <ClaimList parts={parts} verdicts={verdicts} links={links}
          onDecide={(kind, claimId, verdict) => void (async () => {
            await after(await decideClaim(kind, claimId, verdict), 'Verdict recorded.')
          })()}
          onLink={(kind, claimId, m) => void (async () => {
            await after(await linkClaim(kind, claimId, m.kind, m.id),
              `Matched to the existing ${m.kind}.`)
          })()} />
      </Card>

      {evidence.length > 0 && (
        <Card>
          <h4 className="text-[13px] font-semibold text-white">Evidence</h4>
          <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">
                  {evidenceLabel(e)}
                  <span className="ml-2 text-xs font-medium text-slate-500">
                    {e.kind === 'upload' ? 'file' : e.is_medal ? 'medal' : 'link'}
                  </span>
                </span>
                <button onClick={() => void openEvidence(e)}
                  className="shrink-0 text-xs font-semibold text-blue-300 hover:text-blue-200">Open</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* What acting on the record actually looks like: a case, a link to one
          somebody already opened, a surveillance entry, the source behind it.
          Placed above the SIB panel because it is the CID path, and below the
          decision controls because the decision comes first. */}
      <IntelActions submission={submission}
        onChanged={() => { void load(); onChanged() }} />

      {/* Related records (P6-03): "part of group X", the suggestion panel
          and the group actions. A group never merges or edits a member. */}
      <IntelGroups submission={submission}
        onChanged={() => { void load(); onChanged() }} />

      <SiuPanel submission={submission} parts={parts}
        onChanged={() => { void load(); onChanged() }} />

      <Card>
        <h4 className="text-[13px] font-semibold text-white">
          Assignment
        </h4>
        <p className="mt-1 text-sm text-slate-300">
          {submission.assigned_to
            ? `${officerName(submission.assigned_to) ?? 'An investigator'} has this report`
              + (submission.assigned_at ? ` — since ${fmtDateTime(submission.assigned_at)}` : '')
            : 'Nobody has this report yet.'}
        </p>
        {/* Append-only server-side. A handover adds a line; it never edits one,
            so who held the report when a decision was made stays readable. */}
        {history.length > 0 && (
          <ul className="mt-3 space-y-1 border-l border-white/10 pl-3">
            {history.map((a) => (
              <li key={a.id} className="text-xs text-slate-400">
                <span className="text-slate-300">{assignmentLine(a, (u) => officerName(u) ?? 'Someone')}</span>
                {' · '}{fmtDateTime(a.created_at)}
                {a.reason && <span className="block text-slate-500">“{a.reason}”</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h4 className="text-[13px] font-semibold text-white">Decide</h4>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Only one of these is ever the honest offer: an unheld report can be
              taken, a held one can be handed back. Showing "Take it" on a report
              somebody else has would be an offer the database refuses. */}
          {!submission.assigned_to ? (
            <Button size="sm" variant="ghost"
              onClick={() => void (async () => {
                await after(await claimSubmission(id), 'Assigned to you.')
              })()}>
              Take it
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => void release()}>
              Release
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void ask()}>Ask the officer</Button>
          {/* Grading is a REVIEWER's judgement. An officer reporting what they
              saw is not the person to say how reliable it is, and somebody
              grading their own account grades it high -- so the RPC takes it
              from whoever is reviewing, not from the author. */}
          <Select value={submission.urgency ?? ''} aria-label="Urgency" className="text-xs"
            onChange={(e) => void (async () => {
              await after(await gradeSubmission(id, e.target.value as Urgency), 'Urgency set.')
            })()}>
            <option value="">Urgency…</option>
            {URGENCIES.map((u) => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
          </Select>
          <Select value={submission.reliability ?? ''} aria-label="Reliability" className="text-xs"
            onChange={(e) => void (async () => {
              await after(await gradeSubmission(id, undefined, e.target.value as Reliability),
                'Reliability set.')
            })()}>
            <option value="">Reliability…</option>
            {RELIABILITIES.map((r) => <option key={r} value={r}>{RELIABILITY_LABEL[r]}</option>)}
          </Select>
          {/* Archive is the normal way a record leaves the queue: everything
              is kept and it can be undone. It is offered next to the review
              actions because that is where the decision is actually made. */}
          {canRestoreIntel(submission.status, viewer) ? (
            <Button size="sm" variant="ghost" onClick={() => void restore()}>
              {submission.status === 'rejected' ? 'Restore' : 'Restore from archive'}
            </Button>
          ) : submission.status !== 'archived' && submission.status !== 'rejected' ? (
            <Button size="sm" variant="ghost" onClick={() => void archive()}>Archive</Button>
          ) : null}
          {/* Reject is the rarer thing that is not archive. Restoring one is
              command's call, so the button above only appears for them --
              the RPC refuses everybody else regardless. */}
          {canRejectIntel(submission.status) && (
            <Button size="sm" variant="ghost" onClick={() => void reject()}>Reject</Button>
          )}
          {canValidateIntel(submission.status) && (
            submission.validated_at ? (
              <Button size="sm" variant="ghost" onClick={() => void unvalidate()}>
                Withdraw validation
              </Button>
            ) : (
              <Button size="sm" variant={readyToValidate(submission, counts) ? 'primary' : 'ghost'}
                onClick={() => void validate()}>
                Validate
              </Button>
            )
          )}
          {/* Deleting is not tidying up. It is for a record that should not
              exist -- and the server refuses it outright the moment anything
              depends on the record, naming what is in the way. */}
          {isCommand && (
            <Button size="sm" variant="danger" onClick={() => void drop()}>Delete</Button>
          )}
          {/* "Add to intelligence" is gone. It copied this record into a second
              one so it could "become intelligence" -- but it already IS
              intelligence, and the copy existed only because there were two
              systems. The claim matches you make are the part that mattered,
              and they are recorded where you make them. */}
        </div>
        {submission.reliability && (
          <p className="mt-2 text-xs text-slate-500">
            {/* Spelled out because it is the distinction most easily lost:
                reliability grades the SOURCE, a verdict grades one CLAIM. A
                confirmed source can still say something that is wrong. */}
            <b className="text-slate-400">{reliabilityLabel(submission.reliability)}</b>
            {' — '}{RELIABILITY_MEANING[submission.reliability as Reliability] ?? ''}
            {' This grades the source, not any individual claim below.'}
          </p>
        )}

        {edges.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Move to">
              {(fid) => (
                <Select id={fid} value={next} onChange={(e) => setNext(e.target.value)}>
                  <option value="">Choose an outcome…</option>
                  {edges.map((s) => <option key={s} value={s}>{reviewerStatusLabel(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Internal note" hint="Reviewer-only. The officer never sees this — send a message instead.">
              {(fid) => <Textarea id={fid} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="sm:col-span-2">
              <Button variant="primary" disabled={!next}
                onClick={() => void (async () => {
                  const err = await decideSubmission(id, next as never, note)
                  if (!err) { setNext(''); setNote('') }
                  await after(err, 'Recorded.')
                })()}>
                Record decision
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            This report is settled. Nothing moves out of {reviewerStatusLabel(submission.status)}
            {submission.status === 'rejected' ? ' except a restore by a Bureau Lead or above' : ''}.
          </p>
        )}
      </Card>

      <Composer submissionId={id} onDone={() => void load()} />

      <Card>
        <h4 className="text-[13px] font-semibold text-white">
          Thread with the officer
          {awaitingReviewer(messages) && (
            <Badge tone="warn" className="ml-2">Reply waiting</Badge>
          )}
        </h4>
        {!messages.length ? (
          <p className="mt-2 text-sm text-slate-500">Nothing asked yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${
                m.from_reviewer ? 'bg-white/5 text-slate-200' : 'bg-blue-500/10 text-blue-100'
              }`}>
                <p className="text-xs font-medium text-slate-500">
                  {m.from_reviewer ? 'CID/SIB' : 'Reporting officer'} · {fmtDateTime(m.created_at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Field-level versions of the record itself (record_versions, P8-04):
          the officer's edits before and after submission. Restore is the
          officer's own live row only — can_record decides; asked on mount. */}
      <Card>
        <h4 className="text-[13px] font-semibold text-white">Record history</h4>
        <p className="mt-1 text-xs text-slate-500">Every save to this record, field by field — who changed what, and when.</p>
        <div className="mt-2">
          <RecordHistory kind="field_submission" id={id} onRestored={() => { void load(); onChanged() }} />
        </div>
      </Card>

      <Card>
        <h4 className="text-[13px] font-semibold text-white">
          Internal notes
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Reviewer-only. Enforced by the database, not by this panel — the officer&rsquo;s
          account has no access to this table at all.
        </p>
        {!notes.length ? (
          <p className="mt-2 text-sm text-slate-500">No notes yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {notes.map((nte) => (
              <li key={nte.id} className="rounded-lg bg-ink-950/60 px-3 py-2 text-sm text-slate-300">
                <p className="text-xs font-medium text-slate-500">
                  {officerName(nte.author_id) ?? "Reviewer"} · {fmtDateTime(nte.created_at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{nte.note}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** One place to write, two destinations (P6-02). The toggle is the whole
 *  difference: a private note lands in the reviewers' table the officer's
 *  account cannot read; a message lands in the thread the officer reads. The
 *  default is private, because the failure worth designing against is
 *  internal reasoning ending up in front of the person it is about. Neither
 *  moves the status -- asking a question that needs an answer is "Ask the
 *  officer" above, which does. */
function Composer({ submissionId, onDone }: {
  submissionId: string
  onDone: () => void
}) {
  const [toOfficer, setToOfficer] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    const err = await commentSubmission(submissionId, body, toOfficer)
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setBody('')
    toast(toOfficer ? 'Message sent to the officer.' : 'Note saved.', 'success')
    onDone()
  }

  const chip = (on: boolean, label: string) => (
    <button type="button" aria-pressed={toOfficer === on}
      onClick={() => setToOfficer(on)}
      className={`min-h-9 rounded-full border px-3 py-1 text-xs font-semibold transition ${
        toOfficer === on
          ? 'border-badge-500/40 bg-badge-500/15 text-white'
          : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'
      }`}>
      {label}
    </button>
  )

  return (
    <Card>
      <h4 className="text-[13px] font-semibold text-white">Write</h4>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Who reads this">
        {chip(false, 'Private note to reviewers')}
        {chip(true, 'Message the officer')}
      </div>
      <div className="mt-3">
        <Field label={toOfficer ? 'Message' : 'Note'}
          hint={toOfficer
            ? 'The reporting officer reads this in their thread. It does not change the status — use “Ask the officer” when you need an answer.'
            : 'Reviewer-only. The officer’s account has no access to this table at all.'}>
          {(fid) => (
            <Textarea id={fid} rows={3} value={body} disabled={busy}
              onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant={toOfficer ? 'primary' : 'secondary'} disabled={busy || !body.trim()}
          onClick={() => void send()}>
          {busy ? 'Saving…' : toOfficer ? 'Send to officer' : 'Save note'}
        </Button>
      </div>
    </Card>
  )
}

/** Every claim in the report, each independently decidable.
 *
 *  This is the point of the phase: confirming that a plate was seen says
 *  nothing about whether the person driving it belongs to the MC the officer
 *  named. Deciding the report as one thing loses the true claims to protect
 *  against the unconfirmed one, or keeps the unconfirmed one to save the true
 *  ones. Neither is what a reviewer means.
 *
 *  A verdict is written to a separate table and never touches the claim row --
 *  the officer's account stays exactly as they wrote it. */
function ClaimList({ parts, verdicts, links, onDecide, onLink }: {
  parts: SubmissionParts
  verdicts: FieldVerdictRow[]
  links: FieldClaimLinkRow[]
  onDecide: (kind: ClaimKind, id: string, verdict: Verdict) => void
  onLink: (kind: ClaimKind, id: string, match: EntityMatch) => void
}) {
  const rows: Array<{ kind: ClaimKind; id: string; label: string; basis: string }> = [
    ...parts.persons.map((p) => ({
      kind: 'person' as const, id: p.id, basis: p.basis,
      label: `Person — ${[p.full_name, p.alias, p.description].filter(Boolean).join(' / ') || 'unidentified'}${p.org_name ? ` · ${p.org_name}${p.org_role ? ` (${p.org_role})` : ''}` : ''}`,
    })),
    ...parts.vehicles.map((v) => ({
      kind: 'vehicle' as const, id: v.id, basis: v.basis,
      label: `Vehicle — ${[v.plate, v.color, v.model].filter(Boolean).join(' ') || 'no details'}${v.org_name ? ` · ${v.org_name}` : ''}`,
    })),
    ...parts.orgs.map((o) => ({
      kind: 'org' as const, id: o.id, basis: o.basis,
      label: `Organization — ${o.name || o.org_type}${o.territory ? ` · ${o.territory}` : ''}`,
    })),
    ...parts.locations.map((l) => ({
      kind: 'location' as const, id: l.id, basis: l.basis,
      label: `${l.kind.replace(/_/g, ' ')} — ${[l.postal, l.street, l.description].filter(Boolean).join(' ') || 'no address'}`,
    })),
    ...parts.items.map((i) => ({
      kind: 'item' as const, id: i.id, basis: i.basis,
      label: `${i.category.replace(/_/g, ' ')} — ${[i.suspected_substance, i.description].filter(Boolean).join(' ')}${i.weight_value ? ` · ${i.weight_value}${i.weight_unit} (${Number(i.weight_grams ?? 0).toFixed(0)} g)` : ''}`,
    })),
  ]

  if (!rows.length) {
    return <p className="mt-2 text-sm text-slate-500">No structured claims — the summary is the whole report.</p>
  }

  return (
    <ul className="mt-2 space-y-2">
      {rows.map((r) => {
        const v = verdictFor(verdicts, r.kind, r.id)
        const current = v?.verdict as Verdict | undefined
        const linked = linkFor(links, r.kind, r.id)
        return (
          <li key={r.id} className="rounded-lg bg-ink-950/50 px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 text-sm text-slate-200">{r.label}</span>
              {current && (
                <Badge tone={VERDICT_TONE[current]}>{VERDICT_LABEL[current]}</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {r.basis === 'observed' ? 'Officer saw this'
                : r.basis === 'reported' ? 'Officer was told this'
                : 'Basis not stated'}
              {current && ` · ${VERDICT_MEANING[current]}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VERDICTS.map((verdict) => (
                <button key={verdict} onClick={() => onDecide(r.kind, r.id, verdict)}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                    current === verdict
                      ? 'bg-white/15 text-white'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  }`}>
                  {VERDICT_LABEL[verdict]}
                </button>
              ))}
            </div>
            {linked
              ? <p className="mt-1.5 text-[11px] text-emerald-300">Matched to an existing record.</p>
              : <ClaimMatches kind={r.kind} claimId={r.id}
                  onLink={(m) => onLink(r.kind, r.id, m)} />}
          </li>
        )
      })}
    </ul>
  )
}

/** Possible existing records for one claim, and how often it has been reported
 *  before.
 *
 *  Loaded on demand rather than for every claim on open: matching runs four
 *  different searches over persons, vehicles, gangs and places, and a reviewer
 *  skimming a queue does not need all of them speculatively.
 *
 *  Repetition is shown as a count and nothing more. Three officers reporting
 *  the same plate is a reason to look, not evidence — they may all be repeating
 *  one rumour, and presenting frequency as corroboration is how that becomes a
 *  fact nobody checked. */
function ClaimMatches({ kind, claimId, onLink }: {
  kind: ClaimKind
  claimId: string
  onLink: (match: EntityMatch) => void
}) {
  const [result, setResult] = useState<MatchResult | null>(null)
  const [busy, setBusy] = useState(false)

  const look = async () => {
    setBusy(true)
    const r = await loadMatches(kind, claimId)
    setBusy(false)
    setResult(r)
  }

  if (!result) {
    return (
      <button onClick={() => void look()} disabled={busy}
        className="mt-1.5 text-[11px] font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-50">
        {busy ? 'Searching…' : 'Look for an existing record'}
      </button>
    )
  }

  if (!result.matchable) {
    return <p className="mt-1.5 text-[11px] text-slate-500">Nothing to match this against.</p>
  }

  return (
    <div className="mt-1.5">
      {result.also_reported > 0 && (
        <p className="text-[11px] text-amber-300">
          Also named in {result.also_reported} other submission
          {result.also_reported === 1 ? '' : 's'} — worth a look, not corroboration.
        </p>
      )}
      {!result.matches.length ? (
        <p className="text-[11px] text-slate-500">
          No existing record matches. Nothing is created automatically.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {result.matches.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-slate-300">
                {m.label}
                {m.exact && <span className="ml-1.5 text-emerald-300">exact</span>}
              </span>
              <button onClick={() => onLink(m)}
                className="shrink-0 text-[11px] font-semibold text-blue-300 hover:text-blue-200">
                Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
