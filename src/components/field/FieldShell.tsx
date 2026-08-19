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

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <header className="border-b border-white/10 bg-ink-900/60">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-base font-bold sm:text-lg">Field Intelligence</h1>
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-blue-300/70">
              {agencyName || 'Partner agency'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6" aria-label="Field Intelligence">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setScreen(t.id)}
              aria-current={screen === t.id ? 'page' : undefined}
              className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
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
            <Card>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
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

            <Card>
              <h2 className="text-base font-semibold text-white">
                Send information to CID&nbsp;/&nbsp;SIU
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                Report what you have seen on patrol — people, vehicles, gangs and
                motorcycle clubs, criminal locations and seizures. Investigators review it
                and decide what it means; you do not need to know which unit or case it
                belongs to.
              </p>
              <div className="mt-4">
                <Button variant="primary" onClick={() => setScreen('submit')}>
                  Submit Intelligence
                </Button>
              </div>
            </Card>

            {needsAnswer.length > 0 && (
              <Card>
                <h2 className="text-sm font-semibold text-amber-200">
                  {needsAnswer.length === 1 ? 'An investigator has a question' : `${needsAnswer.length} questions for you`}
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  Open {needsAnswer.length === 1 ? 'it' : 'them'} under My Reports.
                </p>
              </Card>
            )}

            <SubmissionList
              rows={sent.slice(0, 5)} title="Recent reports"
              empty="Nothing sent yet. Anything useful you have seen is worth reporting."
            />
          </>
        )}

        {screen === 'submit' && (
          <FieldSubmitForm onDone={() => { setScreen('reports') }} />
        )}

        {screen === 'reports' && (
          <SubmissionList
            rows={sent} title="My reports"
            empty="Nothing sent yet."
          />
        )}

        {screen === 'drafts' && (
          <SubmissionList
            rows={drafts} title="Drafts"
            empty="No unfinished reports. Drafts save themselves as you type, so nothing is lost if you close the tab."
          />
        )}
      </div>
    </main>
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
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              {m.from_reviewer ? 'Investigator' : 'You'} · {fmtDateTime(m.created_at)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-200">{m.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Your answer…" disabled={busy} />
        <Button size="sm" variant="primary" disabled={busy || !body.trim()}
          onClick={() => void send()}>Send</Button>
      </div>
    </div>
  )
}

function SubmissionList({ rows, title, empty }: {
  rows: FieldSubmissionRow[]; title: string; empty: string
}) {
  return (
    <Card pad="none" className="overflow-hidden">
      <div className="border-b border-white/5 px-5 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      </div>
      {!rows.length ? (
        <EmptyState title="Nothing here" hint={empty} className="m-4" />
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-slate-300">{submissionRef(r)}</span>
                <Badge tone={r.status === 'needs_info' ? 'warn' : r.status === 'rejected' ? 'neutral' : 'accent'}>
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
              {r.status === 'needs_info' && <OfficerThread submissionId={r.id} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
