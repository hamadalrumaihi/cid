'use client'

/** Field Intelligence Review — the CID/SIU workspace for reports from patrol.
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
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import {
  FIELD_ROUTE_LABEL, fieldStatusLabel, loadSubmissionParts, submissionRef,
  type FieldSubmissionRow, type SubmissionParts,
} from '@/lib/fieldSubmissions'
import {
  VERDICTS, VERDICT_LABEL, VERDICT_MEANING, VERDICT_TONE,
  askOfficer, awaitingReviewer, claimSubmission, decideClaim, decideSubmission,
  isOpen, loadClaimProgress, loadMessages, loadReviewNotes, loadReviewQueue,
  loadVerdicts, progressLabel, rerouteSubmission, reviewNext, reviewPrompt,
  linkClaim, linkFor, loadClaimLinks, loadMatches, publishSubmission,
  verdictFor, type ClaimKind, type ClaimProgress, type EntityMatch,
  type FieldClaimLinkRow, type FieldMessageRow, type FieldReviewNoteRow,
  type FieldVerdictRow, type MatchResult, type Verdict,
} from '@/lib/fieldReview'
import { evidenceLabel, evidenceUrl, loadEvidence, type FieldEvidenceRow } from '@/lib/fieldEvidence'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { uiPrompt } from '@/components/ui/dialog'

const NO_PARTS: SubmissionParts = { persons: [], vehicles: [], orgs: [], locations: [], items: [] }

export function FieldReviewView() {
  const { state } = useAuth()
  const [rows, setRows] = useState<FieldSubmissionRow[] | null>(null)
  const [openOnly, setOpenOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const v = useTableVersion('field_submissions')

  const refresh = useCallback(async () => { setRows(await loadReviewQueue()) }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v])

  if (state !== 'in') return <Notice text="Sign in to review field intelligence." />

  const all = rows ?? []
  const shown = openOnly ? all.filter((r) => isOpen(r.status)) : all
  const current = all.find((r) => r.id === selected) ?? null

  return (
    <div className="space-y-5">
      <Card>
        <PageHeader
          title="📻 Field Intelligence Review"
          subtitle="Reports from SAHP, BCSO and LSPD officers. Review what was sent, decide what it means."
        />
      </Card>

      {current ? (
        <SubmissionDetail
          submission={current}
          onBack={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      ) : (
        <Card pad="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              {openOnly ? 'Needing a decision' : 'All reports'}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setOpenOnly(!openOnly)}>
              {openOnly ? 'Show all' : 'Show only open'}
            </Button>
          </div>
          {rows === null ? (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : !shown.length ? (
            <EmptyState
              title={openOnly ? 'Nothing waiting' : 'No reports yet'}
              hint={openOnly
                ? 'Every submitted report has been decided. Switch to “Show all” for the history.'
                : 'Field officers have not sent anything yet. Appoint them under Command Center → Field Intelligence Officers.'}
              className="m-4"
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {shown.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)}
                    className="w-full px-5 py-3 text-left transition hover:bg-white/5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm text-slate-300">{submissionRef(r)}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone="neutral">{r.snap_agency}</Badge>
                        {r.route !== 'unsure' && <Badge tone="accent">{r.route.toUpperCase()}</Badge>}
                        <Badge tone={r.status === 'needs_info' ? 'warn' : 'accent'}>
                          {fieldStatusLabel(r.status)}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-white">{r.summary}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[r.snap_callsign, r.snap_rank].filter(Boolean).join(' · ')}
                      {r.submitted_at && ` · sent ${timeAgo(r.submitted_at)}`}
                      {reviewPrompt(r) && ` · ${reviewPrompt(r)}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function SubmissionDetail({ submission, onBack, onChanged }: {
  submission: FieldSubmissionRow
  onBack: () => void
  onChanged: () => void
}) {
  const [parts, setParts] = useState<SubmissionParts>(NO_PARTS)
  const [evidence, setEvidence] = useState<FieldEvidenceRow[]>([])
  const [messages, setMessages] = useState<FieldMessageRow[]>([])
  const [notes, setNotes] = useState<FieldReviewNoteRow[]>([])
  const [verdicts, setVerdicts] = useState<FieldVerdictRow[]>([])
  const [links, setLinks] = useState<FieldClaimLinkRow[]>([])
  const [progress, setProgress] = useState<ClaimProgress | null>(null)
  const [next, setNext] = useState('')
  const [note, setNote] = useState('')
  const id = submission.id

  const load = useCallback(async () => {
    const [p, e, m, n, v, pr, lk] = await Promise.all([
      loadSubmissionParts(id), loadEvidence(id), loadMessages(id), loadReviewNotes(id),
      loadVerdicts(id), loadClaimProgress(id), loadClaimLinks(id),
    ])
    setParts(p); setEvidence(e); setMessages(m); setNotes(n)
    setVerdicts(v); setProgress(pr); setLinks(lk)
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

  const reroute = async () => {
    const to = submission.route === 'siu' ? 'cid' : 'siu'
    const reason = await uiPrompt(
      `Send ${submissionRef(submission)} to ${to.toUpperCase()}?`,
      { title: 'Reroute', placeholder: 'Reason (recorded in the audit log)', confirmText: 'Reroute' },
    )
    if (!reason?.trim()) return
    await after(await rerouteSubmission(id, to, reason), `Routed to ${to.toUpperCase()}.`)
  }

  const ask = async () => {
    const q = await uiPrompt(
      'The officer sees this question and can reply. Internal notes stay internal.',
      { title: 'Ask the officer', placeholder: 'Do you have a clearer image of the plate?', confirmText: 'Send' },
    )
    if (!q?.trim()) return
    await after(await askOfficer(id, q), 'Question sent to the officer.')
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
              {' — '}{officerName(submission.officer_id) ?? "Officer"}
            </p>
            <p className="text-xs text-slate-500">
              {submission.submitted_at && `Sent ${fmtDateTime(submission.submitted_at)}`}
              {submission.mdt_reference && ` · their report ${submission.mdt_reference}`}
              {` · routed: ${FIELD_ROUTE_LABEL[submission.route as 'cid' | 'siu' | 'unsure']}`}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onBack}>Back to queue</Button>
        </div>
        {submission.details && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{submission.details}</p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">What was reported</h4>
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
          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Evidence</h4>
          <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">
                  {evidenceLabel(e)}
                  <span className="ml-2 text-[11px] uppercase tracking-wider text-slate-500">
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

      <Card>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Decide</h4>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost"
            onClick={() => void (async () => {
              await after(await claimSubmission(id), 'Assigned to you.')
            })()}>
            Take it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void ask()}>Ask the officer</Button>
          <Button size="sm" variant="ghost" onClick={() => void reroute()}>
            Reroute to {submission.route === 'siu' ? 'CID' : 'SIU'}
          </Button>
          <Button size="sm" variant="ghost"
            onClick={() => void (async () => {
              await after(await publishSubmission(id),
                'Added to the intelligence database, with this report as its source.')
            })()}>
            Add to intelligence
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Adding to intelligence creates one tip carrying this report&rsquo;s number, plus a
          link for each claim you matched to an existing record. It creates no new
          persons, vehicles, gangs or cases &mdash; and never a case.
        </p>

        {edges.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Move to">
              {(fid) => (
                <Select id={fid} value={next} onChange={(e) => setNext(e.target.value)}>
                  <option value="">Choose an outcome…</option>
                  {edges.map((s) => <option key={s} value={s}>{fieldStatusLabel(s)}</option>)}
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
            This report is settled. Nothing moves out of {fieldStatusLabel(submission.status)}.
          </p>
        )}
      </Card>

      <Card>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Thread with the officer
          {awaitingReviewer(messages) && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              REPLY WAITING
            </span>
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
                <p className="text-[11px] uppercase tracking-wider text-slate-500">
                  {m.from_reviewer ? 'CID/SIU' : 'Reporting officer'} · {fmtDateTime(m.created_at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
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
                <p className="text-[11px] uppercase tracking-wider text-slate-500">
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
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
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
