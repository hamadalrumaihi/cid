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
  askOfficer, awaitingReviewer, claimSubmission, decideSubmission, isOpen,
  loadMessages, loadReviewNotes, loadReviewQueue, rerouteSubmission, reviewNext,
  reviewPrompt, type FieldMessageRow, type FieldReviewNoteRow,
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
  const [next, setNext] = useState('')
  const [note, setNote] = useState('')
  const id = submission.id

  const load = useCallback(async () => {
    const [p, e, m, n] = await Promise.all([
      loadSubmissionParts(id), loadEvidence(id), loadMessages(id), loadReviewNotes(id),
    ])
    setParts(p); setEvidence(e); setMessages(m); setNotes(n)
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
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">What was reported</h4>
        <ClaimList parts={parts} />
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
        </div>

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

function ClaimList({ parts }: { parts: SubmissionParts }) {
  const rows: string[] = [
    ...parts.persons.map((p) => `Person — ${[p.full_name, p.alias, p.description].filter(Boolean).join(' / ') || 'unidentified'}${p.org_name ? ` · ${p.org_name}${p.org_role ? ` (${p.org_role})` : ''}` : ''} · ${p.basis}`),
    ...parts.vehicles.map((v) => `Vehicle — ${[v.plate, v.color, v.model].filter(Boolean).join(' ') || 'no details'}${v.org_name ? ` · ${v.org_name}` : ''} · ${v.basis}`),
    ...parts.orgs.map((o) => `Organization — ${o.name || o.org_type}${o.territory ? ` · ${o.territory}` : ''} · ${o.basis}`),
    ...parts.locations.map((l) => `${l.kind.replace(/_/g, ' ')} — ${[l.postal, l.street, l.description].filter(Boolean).join(' ') || 'no address'} · ${l.basis}`),
    ...parts.items.map((i) => `${i.category.replace(/_/g, ' ')} — ${[i.suspected_substance, i.description].filter(Boolean).join(' ')}${i.weight_value ? ` · ${i.weight_value}${i.weight_unit} (${Number(i.weight_grams ?? 0).toFixed(0)} g)` : ''} · ${i.basis}`),
  ]
  if (!rows.length) {
    return <p className="mt-2 text-sm text-slate-500">No structured claims — the summary is the whole report.</p>
  }
  return (
    <ul className="mt-2 space-y-1 text-sm text-slate-300">
      {rows.map((r) => <li key={r} className="rounded bg-ink-950/50 px-3 py-1.5">{r}</li>)}
    </ul>
  )
}
