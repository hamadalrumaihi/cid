'use client'

/** One undercover operation — the record, and what the procedure still asks.
 *
 *  The layout follows the procedure's own order rather than the schema's:
 *  what is outstanding, then the recording and its 72-hour floor (§3), then
 *  the §5 notification record, then §7 compromise, then §8 command oversight.
 *  A Detective reading this top to bottom is reading their duties in the order
 *  the document states them.
 *
 *  Every write here is either an ordinary RLS-checked UPDATE or one of the
 *  three definer RPCs. The buttons below are cosmetic: `uc_writable` and
 *  `uc_command` decide, and they decide again server-side on every call. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list, rpc, update } from '@/lib/db'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { bureauLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import {
  UC_ALIAS_AUDIENCE_NOTE, UC_COMMAND_ACTIONS, UC_RETENTION_HOURS, isUcOpen, notificationCompleteness,
  retentionInfo, ucObligations, ucRecordingLabel, ucReviewLabel, ucStatusLabel,
  type UcCommandAction, type UcCommandActionId, type UcCriminalActivity, type UcOperation,
} from '@/lib/undercover'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { GuideHelpLink } from '@/components/guides/GuideHelpLink'
import { CriminalActivityDialog } from './CriminalActivityDialog'
import { CompromisedDialog } from './CompromisedDialog'

const SECTION = 'text-[13px] font-semibold text-white'

export function OperationDetail({ op, isCommand, isMine, onBack, onChanged }: {
  op: UcOperation
  isCommand: boolean
  isMine: boolean
  onBack: () => void
  onChanged: () => void
}) {
  const vActivity = useTableVersion('uc_criminal_activity')
  const vActions = useTableVersion('uc_command_actions')
  const [reports, setReports] = useState<UcCriminalActivity[]>([])
  const [actions, setActions] = useState<UcCommandAction[]>([])
  const [dialog, setDialog] = useState<'criminal' | 'compromised' | null>(null)
  const now = useNow()

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      list('uc_criminal_activity', { eq: { operation_id: op.id }, order: 'occurred_at', ascending: false })
        .catch(() => [] as UcCriminalActivity[]),
      list('uc_command_actions', { eq: { operation_id: op.id }, order: 'created_at', ascending: false })
        .catch(() => [] as UcCommandAction[]),
    ])
    setReports(r)
    setActions(a)
  }, [op.id])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, vActivity, vActions])

  const ret = retentionInfo(op, now)
  const obligations = useMemo(() => ucObligations(op), [op])
  const outstanding = obligations.filter((o) => o.outstanding)
  // The detective may edit while the operation is open; Command may always
  // act. Mirrors private.uc_writable, which is the actual gate.
  const canEdit = isCommand || (isMine && isUcOpen(op))

  return (
    <section className="view-in space-y-5">
      <PageHeader
        title={op.alias ? `Operation — ${op.alias}` : 'Undercover operation'}
        subtitle={`${bureauLabel(op.bureau)} · ${officerName(op.detective_id) || 'Detective'}`}
        actions={
          <>
            <GuideHelpLink
              slug="undercover-procedure"
              label="Procedure"
              title="Open the CID Undercover Operations Procedure"
            />
            <Button className="min-h-[44px] sm:min-h-0" onClick={onBack}>Back</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={op.status === 'compromised' ? 'danger' : op.status === 'active' ? 'good' : 'neutral'}>
          {ucStatusLabel(op.status)}
        </Badge>
        {op.criminal_activity && (
          <Badge tone="warn" title="Reported under §5 — a notification duty, not a finding.">
            Criminal activity reported
          </Badge>
        )}
        {op.command_review_status !== 'not_required' && (
          <Badge tone="accent">{ucReviewLabel(op.command_review_status)}</Badge>
        )}
      </div>

      {/* What is still owed, first. */}
      {outstanding.length > 0 && (
        <Card pad="md" className="border-amber-500/25 bg-amber-500/5">
          <h2 className={SECTION}>Outstanding under the procedure</h2>
          <ul className="mt-2 space-y-1">
            {outstanding.map((o) => (
              <li key={o.id} className="text-sm text-amber-100">• {o.label}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-200/80">
            These are reporting steps the procedure requires. They are not findings, and nothing here records misconduct.
          </p>
        </Card>
      )}

      <RecordingCard op={op} canEdit={canEdit} onChanged={onChanged} retentionText={
        ret.state === 'not_started'
          ? `The ${UC_RETENTION_HOURS}-hour retention period begins when the session concludes.`
          : ret.state === 'holding'
            ? `Retain the recording until ${fmtDateTime(ret.until!)} — ${ret.hoursLeft}h remaining.`
            : `The ${UC_RETENTION_HOURS}-hour minimum retention period has elapsed. The procedure requires nothing further; it does not require deletion.`
      } />

      <Card pad="md" className="space-y-3">
        <h2 className={SECTION}>The operation</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fact label="Detective">{officerName(op.detective_id) || '—'}</Fact>
          <Fact label="Bureau">{bureauLabel(op.bureau)}</Fact>
          <Fact label="Undercover identity">
            {op.alias || <span className="text-slate-500">None recorded</span>}
          </Fact>
          <Fact label="Started">{op.started_at ? fmtDateTime(op.started_at) : '—'}</Fact>
          <Fact label="Ended">{op.ended_at ? fmtDateTime(op.ended_at) : '—'}</Fact>
          <Fact label="Command review">{ucReviewLabel(op.command_review_status)}</Fact>
        </dl>
        {op.alias && (
          <p className="text-[11px] text-slate-500">{UC_ALIAS_AUDIENCE_NOTE}</p>
        )}
        {op.objective && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Objective</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-300">{op.objective}</p>
          </div>
        )}
        {op.end_reason && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Termination / withdrawal reason</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-300">{op.end_reason}</p>
          </div>
        )}
        {op.compromised_at && (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2">
            <p className="text-sm font-semibold text-rose-200">
              Compromised {fmtDateTime(op.compromised_at)}
              {op.withdrawn ? ' · withdrew from the operation' : ' · did not withdraw'}
            </p>
            {op.compromise_note && <p className="mt-1 text-xs text-rose-200/90">{op.compromise_note}</p>}
          </div>
        )}
      </Card>

      {/* §5 */}
      <Card pad="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={SECTION}>Criminal activity notifications (§5)</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Detectives MUST notify their Bureau Lead and CID Command after participating in criminal activity
              of any kind, and submit the full session recording to CID Command. Recording it here is a reporting
              duty — it is not a disciplinary finding.
            </p>
          </div>
          {canEdit && (
            <Button className="min-h-[44px] sm:min-h-0" onClick={() => setDialog('criminal')}>
              Report criminal activity
            </Button>
          )}
        </div>
        {!reports.length ? (
          <EmptyState title="No criminal activity reported for this operation." />
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => {
              const c = notificationCompleteness(r)
              return (
                <li key={r.id} className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                  <p className="text-sm text-slate-200">{r.description}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {fmtDateTime(r.occurred_at)}
                    {r.incident_reference ? ` · ${r.incident_reference}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={r.bureau_lead_notified_at ? 'good' : 'warn'}>
                      Bureau Lead {r.bureau_lead_notified_at ? 'notified' : 'not notified'}
                    </Badge>
                    <Badge tone={r.command_notified_at ? 'good' : 'warn'}>
                      CID Command {r.command_notified_at ? 'notified' : 'not notified'}
                    </Badge>
                    <Badge tone={r.recording_submitted_at ? 'good' : 'warn'}>
                      Recording {r.recording_submitted_at ? 'submitted' : 'not submitted'}
                    </Badge>
                  </div>
                  {!c.complete && (
                    <p className="mt-2 text-[11px] text-amber-200">
                      Still outstanding: {c.outstanding.length} of 3 notification requirements.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* §7 */}
      {canEdit && !op.compromised_at && (
        <Card pad="md" className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={SECTION}>Safety and operational integrity (§7)</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              If an operation becomes compromised, withdraw when reasonably possible and notify CID Command.
            </p>
          </div>
          <Button variant="danger" className="min-h-[44px] sm:min-h-0" onClick={() => setDialog('compromised')}>
            Mark operation compromised
          </Button>
        </Card>
      )}

      {/* §8 */}
      <CommandCard
        op={op}
        actions={actions}
        isCommand={isCommand}
        onChanged={() => { onChanged(); void load() }}
      />

      {dialog === 'criminal' && (
        <CriminalActivityDialog
          op={op}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onChanged(); void load() }}
        />
      )}
      {dialog === 'compromised' && (
        <CompromisedDialog
          op={op}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onChanged() }}
        />
      )}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-200">{children}</dd>
    </div>
  )
}

/** §3 — the recording answer and the retention floor. */
function RecordingCard({ op, canEdit, onChanged, retentionText }: {
  op: UcOperation
  canEdit: boolean
  onChanged: () => void
  retentionText: string
}) {
  const [note, setNote] = useState(op.recording_note ?? '')
  const [busy, setBusy] = useState(false)

  const setStatus = useCallback(async (status: 'confirmed' | 'unavailable') => {
    if (busy) return
    // §3: a technical failure must come with an explanation. The schema
    // enforces it too (uc_operations_unavailable_needs_note) — this is the
    // friendly half of the same rule.
    if (status === 'unavailable' && !note.trim()) {
      toast('Explain the circumstances — §3 requires an explanation when a recording is unavailable.', 'warn')
      return
    }
    setBusy(true)
    const res = await update('uc_operations', op.id, {
      recording_status: status,
      recording_note: status === 'unavailable' ? note.trim() : (note.trim() || null),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(status === 'confirmed' ? 'Recording confirmed.' : 'Recorded as unavailable, with your explanation.', 'success')
    onChanged()
  }, [busy, note, op.id, onChanged])

  return (
    <Card pad="md" className="space-y-3">
      <h2 className={SECTION}>Recording and retention (§3)</h2>

      <div role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-100">Recording Required</p>
        <p className="mt-1 text-xs text-amber-200/90">
          Undercover Detectives are required to record the entire undercover session.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={op.recording_status === 'confirmed' ? 'good' : op.recording_status === 'unavailable' ? 'warn' : 'neutral'}>
          {ucRecordingLabel(op.recording_status)}
        </Badge>
        {op.recording_submitted_at && (
          <Badge tone="good">Submitted to Command {fmtDate(op.recording_submitted_at)}</Badge>
        )}
      </div>

      <p className="text-sm text-slate-300">{retentionText}</p>
      <p className="text-[11px] text-slate-500">
        The portal tracks the {UC_RETENTION_HOURS}-hour minimum only. It does not delete recordings, and the
        procedure does not require deletion.
      </p>

      {op.recording_note && op.recording_status === 'unavailable' && (
        <div className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Explanation</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-300">{op.recording_note}</p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-2 border-t border-white/5 pt-3">
          <Field
            label="Explanation (required if unavailable)"
            hint="§3 — if a recording is lost, corrupted or otherwise unavailable, notify CID Command and explain the circumstances."
          >
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="min-h-[44px] sm:min-h-0"
              disabled={busy}
              onClick={() => void setStatus('confirmed')}
            >
              Recording confirmed
            </Button>
            <Button
              className="min-h-[44px] sm:min-h-0"
              disabled={busy}
              onClick={() => void setStatus('unavailable')}
            >
              Recording unavailable
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** §8 — the oversight record, and Command's actions on it. */
function CommandCard({ op, actions, isCommand, onChanged }: {
  op: UcOperation
  actions: UcCommandAction[]
  isCommand: boolean
  onChanged: () => void
}) {
  const [action, setAction] = useState<UcCommandActionId>('request_recording')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const needsNote = UC_COMMAND_ACTIONS.find((a) => a.id === action)?.needsNote ?? false

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const res = await rpc('uc_command_act', { p_op: op.id, p_action: action, p_note: note.trim() || null })
    setBusy(false)
    const body = res.data as { ok?: boolean; message?: string } | null
    if (res.error) { toast(res.error.message, 'danger'); return }
    if (body && body.ok === false) { toast(body.message ?? 'Refused.', 'warn'); return }
    toast('Recorded.', 'success')
    setNote('')
    onChanged()
  }, [busy, op.id, action, note, onChanged])

  return (
    <Card pad="md" className="space-y-3">
      <h2 className={SECTION}>Command oversight (§8)</h2>
      <p className="text-xs text-slate-400">
        Every command action is recorded against this operation and audited. Command actions never change the
        underlying case.
      </p>

      {!actions.length ? (
        <EmptyState title="No command action recorded." />
      ) : (
        <ul className="space-y-1.5">
          {actions.map((a) => (
            <li key={a.id} className="text-sm text-slate-300">
              <span className="font-semibold text-white">
                {UC_COMMAND_ACTIONS.find((x) => x.id === a.action)?.label ?? a.action}
              </span>
              <span className="text-slate-500"> · {officerName(a.actor_id) || 'Command'} · {fmtDateTime(a.created_at)}</span>
              {a.note && <p className="mt-0.5 text-xs text-slate-400">{a.note}</p>}
            </li>
          ))}
        </ul>
      )}

      {isCommand ? (
        <div className="space-y-2 border-t border-white/5 pt-3">
          <Field label="Action">
            {(id) => (
              <Select id={id} value={action} onChange={(e) => setAction(e.target.value as UcCommandActionId)}>
                {UC_COMMAND_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label={needsNote ? 'Note (required)' : 'Note'}>
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button
            variant="primary"
            className="min-h-[44px] sm:min-h-0"
            disabled={busy || (needsNote && !note.trim())}
            loading={busy}
            onClick={() => void run()}
          >
            Record command action
          </Button>
        </div>
      ) : (
        <Notice text="Command actions are held by CID Command (Deputy Director, Director, Owner)." />
      )}
    </Card>
  )
}
