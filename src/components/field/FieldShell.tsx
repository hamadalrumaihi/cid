'use client'

/** The Field Intelligence workspace — the whole interface a SAHP, BCSO or LSPD
 *  officer sees.
 *
 *  ── Why this is a separate shell, not AppShell with things hidden ──────────
 *  A patrol officer is not a detective with fewer permissions; they have a
 *  different job. Rendering the CID sidebar with twenty locked tabs would tell
 *  them exactly what exists and that they may not have it, which is both a
 *  worse interface and a small disclosure in itself. So `children` — every CID
 *  route — is never rendered for this state at all.
 *
 *  That is a presentation decision. It is NOT what keeps them out of the case
 *  files: `private.is_active()` is false for a field officer, and every CID
 *  policy asks for it. The boundary was proven table by table against the live
 *  database in 20260910120000_field_officers.sql. Hiding a nav item has never
 *  been the security model here and is not one now.
 *
 *  ── Navigation is local state, not routes ──────────────────────────────────
 *  Four screens, no deep-linking requirement, and using the CID router would
 *  mean registering routes that must then be defended against CID users
 *  wandering in. Local state has no such surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fmtDateTime } from '@/lib/format'
import {
  fieldStatusLabel, fieldStatusMeaning, isEditableByOfficer, loadMySubmissions,
  submissionRef, type FieldSubmissionRow,
} from '@/lib/fieldSubmissions'
import { loadMessages, replyAsOfficer, type FieldMessageRow } from '@/lib/fieldReview'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { FieldSubmitForm } from './FieldSubmitForm'

const AGENCY_NAME: Record<string, string> = {
  SAHP: 'San Andreas Highway Patrol',
  BCSO: 'Blaine County Sheriff’s Office',
  LSPD: 'Los Santos Police Department',
}

type Screen = 'home' | 'submit' | 'reports' | 'drafts'

const TABS: Array<{ id: Screen; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'submit', label: 'Submit Intelligence' },
  { id: 'reports', label: 'My Reports' },
  { id: 'drafts', label: 'Drafts' },
]

/** The sent-report statuses, folded into the four buckets an author actually
 *  tracks. Labels reuse the registry's own words (lib/fieldSubmissions
 *  STATUS_LABEL) so the tiles, the filter chips and the badges never disagree.
 *  'draft' is deliberately absent — drafts have their own screen and row. */
type BucketId = 'sent' | 'reviewing' | 'needs_info' | 'done'

const BUCKETS: Array<{ id: BucketId; label: string; statuses: readonly string[] }> = [
  { id: 'sent', label: 'Sent', statuses: ['new'] },
  { id: 'reviewing', label: 'Being reviewed', statuses: ['reviewing'] },
  { id: 'needs_info', label: 'Question for you', statuses: ['needs_info'] },
  // Three terminal states, one bucket: reviewed, acted on, or filed — each
  // means "nothing more is needed from you".
  { id: 'done', label: 'Reviewed', statuses: ['reviewed', 'actionable', 'archived'] },
]

/** Name, callsign, rank and agency, as one line. The callsign and rank come
 *  from the APPOINTMENT (command-set) rather than from profiles.badge_number,
 *  which the account holder can edit — attribution should not be self-declared. */
function identityLine(
  name: string | null | undefined, callsign: string | null,
  agency: string, rank: string | null,
): string {
  return [name || 'Officer', callsign, agency, rank].filter(Boolean).join(' · ')
}

export function FieldShell() {
  const { profile, field, signOut } = useAuth()
  const [screen, setScreen] = useState<Screen>('home')
  const [rows, setRows] = useState<FieldSubmissionRow[] | null>(null)
  // My Reports can arrive pre-filtered from a dashboard tile; picking the tab
  // directly always shows everything.
  const [reportFilter, setReportFilter] = useState<BucketId | null>(null)
  // A draft picked to resume. Cleared whenever navigation starts fresh.
  const [resumeDraft, setResumeDraft] = useState<FieldSubmissionRow | null>(null)

  const agency = field?.agency ?? ''
  const agencyName = AGENCY_NAME[agency] ?? agency

  const refresh = useCallback(async () => { setRows(await loadMySubmissions()) }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, screen])

  const drafts = (rows ?? []).filter((r) => isEditableByOfficer(r.status))
  const sent = (rows ?? []).filter((r) => !isEditableByOfficer(r.status))
  const needsAnswer = sent.filter((r) => r.status === 'needs_info')

  const bucketCount = (b: (typeof BUCKETS)[number]) =>
    sent.filter((r) => b.statuses.includes(r.status)).length
  const activeBucket = BUCKETS.find((b) => b.id === reportFilter) ?? null
  const reportRows = activeBucket
    ? sent.filter((r) => activeBucket.statuses.includes(r.status))
    : sent

  const goTo = (s: Screen) => { setReportFilter(null); setResumeDraft(null); setScreen(s) }
  const openReports = (f: BucketId | null) => { setResumeDraft(null); setReportFilter(f); setScreen('reports') }
  const startNew = () => { setResumeDraft(null); setScreen('submit') }
  const resume = (r: FieldSubmissionRow) => { setResumeDraft(r); setScreen('submit') }

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <header className="border-b border-white/10 bg-ink-900/60">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-base font-bold sm:text-lg">Field Intelligence</h1>
            <p className="truncate text-xs font-medium text-slate-500">
              {agencyName || 'Partner agency'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6" aria-label="Field Intelligence">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => goTo(t.id)}
              aria-current={screen === t.id ? 'page' : undefined}
              className={`inline-flex min-h-11 flex-shrink-0 items-center rounded-lg px-3 py-1.5 text-sm font-semibold transition lg:min-h-9 ${
                screen === t.id ? 'bg-badge-500/15 text-white' : 'text-slate-400 hover:bg-white/5'
              }`}>
              {t.label}
              {t.id === 'drafts' && drafts.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-500">{drafts.length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        {screen === 'home' && (
          <>
            {needsAnswer.length > 0 && (
              <section aria-label="Needs your information"
                className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-amber-200">
                  {needsAnswer.length === 1
                    ? 'An investigator needs your information'
                    : `${needsAnswer.length} reports need your information`}
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  A report cannot move on until you answer.
                </p>
                <div className="mt-3">
                  <Button variant="warn" onClick={() => openReports('needs_info')}>
                    {needsAnswer.length === 1
                      ? `Answer now · ${submissionRef(needsAnswer[0])}`
                      : 'Answer now'}
                  </Button>
                </div>
              </section>
            )}

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-semibold text-white">
                  My reports
                </h2>
                <span className="text-xs text-slate-400">Tap a count to see those reports</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BUCKETS.map((b) => {
                  const n = bucketCount(b)
                  const hot = b.id === 'needs_info' && n > 0
                  return (
                    <button key={b.id} type="button" onClick={() => openReports(b.id)}
                      className={`min-h-11 rounded-lg border p-3 text-left transition hover:bg-white/5 ${
                        hot ? 'border-amber-500/25 bg-amber-500/5' : 'border-white/10 bg-ink-950/40'
                      }`}>
                      <span className={`block text-2xl font-bold tabular-nums ${
                        hot ? 'text-amber-300' : 'text-white'
                      }`}>{rows ? n : '—'}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-slate-400">{b.label}</span>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card>
              <h2 className="text-base font-semibold text-white">
                Send information to CID&nbsp;/&nbsp;SIB
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                Report what you have seen on patrol — people, vehicles, gangs and
                motorcycle clubs, criminal locations and seizures. Investigators review it
                and decide what it means; you do not need to know which unit or case it
                belongs to.
              </p>
              <div className="mt-4">
                <Button variant="primary" onClick={startNew}>
                  Submit new report
                </Button>
              </div>
            </Card>

            {drafts.length > 0 && (
              <SubmissionList
                rows={drafts.slice(0, 3)} title="Unfinished drafts" onResume={resume}
                empty="No unfinished reports."
                footer={drafts.length > 3 ? (
                  <Button variant="ghost" onClick={() => goTo('drafts')}>
                    All {drafts.length} drafts
                  </Button>
                ) : null}
              />
            )}

            <Card>
              <h2 className="text-[13px] font-semibold text-white">
                How this works
              </h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-300">
                <li>
                  <span className="font-semibold text-white">After you send a report</span>,
                  an investigator reads it. You will see its status change here — and if it
                  was useful, it may show as being acted on or kept on file.
                </li>
                <li>
                  <span className="font-semibold text-white">“Question for you”</span> means
                  an investigator needs something only you can answer before going further.
                  Open the report and reply — that is all.
                </li>
                <li>
                  <span className="font-semibold text-white">Drafts</span> save themselves
                  as you type, so nothing is lost if you close the tab. A draft is yours
                  alone until you send it; once sent, it cannot be edited.
                </li>
              </ul>
            </Card>

            <Card>
              <h2 className="text-[13px] font-semibold text-white">
                Reporting officer
              </h2>
              <p className="mt-1 text-base font-semibold text-white">
                {identityLine(profile?.display_name, field?.callsign ?? null, agency, field?.officer_rank ?? null)}
              </p>
              {field?.unit && <p className="text-sm text-slate-400">{field.unit}</p>}
              <p className="mt-3 text-xs text-slate-500">
                Your name, callsign and agency are attached to everything you submit, and
                are set by CID rather than typed in — so a report can always be traced
                back to the officer who actually made it.
              </p>
            </Card>
          </>
        )}

        {screen === 'submit' && (
          <FieldSubmitForm key={resumeDraft?.id ?? 'new'} resume={resumeDraft ?? undefined}
            onDone={() => { setResumeDraft(null); setScreen('reports') }} />
        )}

        {screen === 'reports' && (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter my reports">
              <FilterChip active={!activeBucket} onClick={() => setReportFilter(null)}>
                All · {sent.length}
              </FilterChip>
              {BUCKETS.map((b) => (
                <FilterChip key={b.id} active={reportFilter === b.id}
                  onClick={() => setReportFilter(b.id)}>
                  {b.label} · {bucketCount(b)}
                </FilterChip>
              ))}
            </div>
            <SubmissionList
              rows={reportRows} title={activeBucket ? `My reports — ${activeBucket.label}` : 'My reports'}
              empty={activeBucket ? 'No reports here right now.' : 'Nothing sent yet.'}
            />
          </>
        )}

        {screen === 'drafts' && (
          <SubmissionList
            rows={drafts} title="Drafts" onResume={resume}
            empty="No unfinished reports. Drafts save themselves as you type, so nothing is lost if you close the tab."
          />
        )}
      </div>
    </main>
  )
}

/** A report-list filter pill. Local to this shell on purpose — the CID portal
 *  filters with DataTable; this portal keeps its own small idiom. */
function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex min-h-11 flex-shrink-0 items-center rounded-full border px-3 py-1.5 text-sm font-semibold transition lg:min-h-9 ${
        active
          ? 'border-badge-500/40 bg-badge-500/15 text-white'
          : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'
      }`}>
      {children}
    </button>
  )
}

/** The question a reviewer asked, and the officer's answer.
 *
 *  Shown only while the report is in 'needs_info', which is exactly when the
 *  INSERT policy allows the officer to write — so the control appears precisely
 *  when it would work. The officer sees this thread and nothing else of the
 *  review: internal notes live in a table their account cannot read at all. */
function OfficerThread({ submissionId }: { submissionId: string }) {
  const [messages, setMessages] = useState<FieldMessageRow[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setMessages(await loadMessages(submissionId))
  }, [submissionId])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const send = async () => {
    setBusy(true)
    const err = await replyAsOfficer(submissionId, body)
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setBody('')
    await refresh()
    toast('Answer sent.', 'success')
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <p className="text-xs font-medium text-slate-500">
              {m.from_reviewer ? 'Investigator' : 'You'} · {fmtDateTime(m.created_at)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-200">{m.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Your answer…" disabled={busy} />
        <Button variant="primary" disabled={busy || !body.trim()}
          onClick={() => void send()}>Send</Button>
      </div>
    </div>
  )
}

function SubmissionList({ rows, title, empty, onResume, footer }: {
  rows: FieldSubmissionRow[]; title: string; empty: string
  /** When given, drafts get a Resume button that reopens them in the form. */
  onResume?: (r: FieldSubmissionRow) => void
  footer?: React.ReactNode
}) {
  return (
    <Card pad="none" className="overflow-hidden">
      <div className="border-b border-white/5 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-white">{title}</h2>
      </div>
      {!rows.length ? (
        <EmptyState title="Nothing here" hint={empty} className="m-4" />
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-slate-300">{submissionRef(r)}</span>
                <Badge tone={r.status === 'needs_info' ? 'warn' : 'accent'}>
                  {fieldStatusLabel(r.status)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-white">{r.summary || 'No summary yet'}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {fieldStatusMeaning(r.status)}
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                {r.submitted_at ? `Sent ${fmtDateTime(r.submitted_at)}` : `Started ${fmtDateTime(r.created_at)}`}
              </p>
              {onResume && isEditableByOfficer(r.status) && (
                <div className="mt-2">
                  <Button onClick={() => onResume(r)}>Resume draft</Button>
                </div>
              )}
              {r.status === 'needs_info' && <OfficerThread submissionId={r.id} />}
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="border-t border-white/5 px-5 py-2">{footer}</div>}
    </Card>
  )
}
