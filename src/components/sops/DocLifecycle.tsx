'use client'

/** Lifecycle modals invoked from the reader's overflow menu: workflow
 *  transitions (rpc document_workflow), periodic review (document_record_review),
 *  required-reading campaigns (publish_reading_campaign / document_ack_summary /
 *  close_reading_campaign), Drive sync-conflict resolution (resolve_document_sync),
 *  and reader-facing issue reports (feedback insert). All state changes go
 *  through the governance RPCs — the client only collects reasons/dates and
 *  shows friendly errors; the server re-decides authority. */
import { useEffect, useMemo, useState } from 'react'
import type { Database, Json, Tables } from '@/lib/database.types'
import { insert, list, rpc } from '@/lib/db'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { activeProfiles, useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DiffView } from './docDiff'
import { AUDIENCE_LABEL, REVIEW_OUTCOME_LABEL, docTitle, type DocRow } from './docModel'
import type { CampaignLite } from './DocMetaRail'

type VersionRow = Tables<'documents_versions'>
type WorkflowArgs = Database['public']['Functions']['document_workflow']['Args']

const bodyOf = (d: DocRow): string => {
  const c = d.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}
const versionBody = (v: VersionRow): string => {
  const c = v.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}

/** Local-midnight date-input value → ISO, or undefined when empty. */
const dateToIso = (d: string): string | undefined => {
  if (!d) return undefined
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

/* ── Workflow transitions ────────────────────────────────────────────────── */

export type WorkflowAction = 'submit' | 'approve' | 'reject' | 'publish' | 'supersede' | 'archive'

const WORKFLOW_COPY: Record<WorkflowAction, { title: string; blurb: string; confirm: string; done: string; reason: boolean }> = {
  submit: { title: 'Submit for review', blurb: 'Sends this draft to the approvers for its collection.', confirm: 'Submit for review', done: 'Submitted for review', reason: false },
  approve: { title: 'Approve document', blurb: 'Approves this revision — it still needs a publish to go live.', confirm: 'Approve', done: 'Document approved', reason: false },
  reject: { title: 'Reject document', blurb: 'Returns this revision to draft with your reason for the author.', confirm: 'Reject', done: 'Document rejected', reason: true },
  publish: { title: 'Publish document', blurb: 'Makes this the live version for every reader.', confirm: 'Publish', done: 'Document published', reason: false },
  supersede: { title: 'Supersede document', blurb: 'Marks this document replaced — readers are pointed at the replacement.', confirm: 'Supersede', done: 'Document superseded', reason: true },
  archive: { title: 'Archive document', blurb: 'Removes this document from the active library (it stays readable in the archive).', confirm: 'Archive', done: 'Document archived', reason: true },
}

export function DocWorkflowModal({ doc, action, onClose, onDone }: {
  doc: DocRow
  action: WorkflowAction
  onClose: () => void
  onDone: () => void
}) {
  const copy = WORKFLOW_COPY[action]
  const [reason, setReason] = useState('')
  const [effective, setEffective] = useState('')
  const [replacement, setReplacement] = useState('')
  const [published, setPublished] = useState<{ id: string; name: string }[] | null>(null)

  // Emergency publish path: approval is required but hasn't happened.
  const emergency = action === 'publish' && doc.approval_required && !doc.approved_at
  const needReason = copy.reason || emergency

  // Replacement picker options (supersede only) — slim published-docs list.
  useEffect(() => {
    if (action !== 'supersede') return
    let on = true
    void (async () => {
      const rows = await list('documents', { select: 'id,name', eq: { status: 'published' }, order: 'name' }).catch(() => [])
      if (on) setPublished((rows as unknown as { id: string; name: string }[]).filter((d) => d.id !== doc.id))
    })()
    return () => { on = false }
  }, [action, doc.id])

  const run = async () => {
    const r = reason.trim()
    if (needReason && !r) { toast('A reason is required.', 'warn'); return }
    const args: WorkflowArgs = { p_document: doc.id, p_action: emergency ? 'publish_emergency' : action }
    if (r) args.p_reason = r
    if (action === 'publish') {
      const iso = dateToIso(effective)
      if (iso) args.p_effective_at = iso
    }
    if (action === 'supersede' && replacement) args.p_replacement = replacement
    const res = await rpc('document_workflow', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(emergency ? 'Emergency-published — record the approval follow-up' : copy.done, 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => reason.trim() !== ''}>
      <ModalHeader title={`${copy.title} — ${docTitle(doc.name)}`} onClose={onClose} />
      <div className="space-y-3">
        <p className="text-sm text-slate-400">{copy.blurb}</p>
        {emergency && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This document requires approval and hasn’t been approved. Publishing now is an
            <strong> emergency publish</strong> — a required reason is recorded for command review.
          </p>
        )}
        {action === 'publish' && (
          <Field label="Effective date" hint="Optional — when the procedure takes effect (defaults to now).">
            {(id) => <Input id={id} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />}
          </Field>
        )}
        {action === 'supersede' && (
          <Field label="Replaced by" hint="Optional — the published document readers should use instead.">
            {(id) => (
              <Select id={id} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">No replacement document</option>
                {(published ?? []).map((d) => <option key={d.id} value={d.id}>{docTitle(d.name)}</option>)}
              </Select>
            )}
          </Field>
        )}
        {needReason && (
          <Field label="Reason" required>
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === 'reject' ? 'What the author needs to change' : 'Why this is happening'} />}
          </Field>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={action === 'archive' || action === 'reject' ? 'danger' : emergency || action === 'supersede' ? 'warn' : 'primary'} onAction={run}>
            {emergency ? 'Emergency publish' : copy.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Periodic review ─────────────────────────────────────────────────────── */

export function RecordReviewModal({ doc, onClose, onDone }: {
  doc: DocRow
  onClose: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState('no_change')
  const [note, setNote] = useState('')
  const [nextDue, setNextDue] = useState('')

  const run = async () => {
    const args: Database['public']['Functions']['document_record_review']['Args'] = { p_document: doc.id, p_outcome: outcome }
    if (note.trim()) args.p_note = note.trim()
    const iso = dateToIso(nextDue)
    if (iso) args.p_next_due = iso
    const res = await rpc('document_record_review', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Review recorded', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => note.trim() !== ''}>
      <ModalHeader title={`Record review — ${docTitle(doc.name)}`} onClose={onClose} />
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Last reviewed {doc.reviewed_at ? fmtDate(doc.reviewed_at) : 'never'} · review due {fmtDate(doc.review_due_at)}.
        </p>
        <Field label="Outcome" required>
          {(id) => (
            <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {Object.entries(REVIEW_OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Note" hint="What the review found — shown on the document record.">
          {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Field label="Next review due" hint="Optional — leave empty to keep the current cadence.">
          {(id) => <Input id={id} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={run}>Record review</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Required-reading campaigns (managers only — the caller gates) ───────── */

interface AckSummaryRow { user_id: string; display_name: string; acknowledged_at: string | null }

export function ReadingCampaignModal({ doc, campaign, onClose, onDone }: {
  doc: DocRow
  /** The active campaign, if any (loaded by the reader). */
  campaign: CampaignLite | null
  onClose: () => void
  onDone: () => void
}) {
  const [audience, setAudience] = useState('all')
  const [targets, setTargets] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const [reason, setReason] = useState('')
  const [summary, setSummary] = useState<AckSummaryRow[] | null>(null)

  // Completion summary — manager-only RPC; this modal only opens for managers.
  useEffect(() => {
    let on = true
    void (async () => {
      const res = await rpc('document_ack_summary', { p_document: doc.id })
      if (on) setSummary(res.error ? [] : ((res.data ?? []) as AckSummaryRow[]))
    })()
    return () => { on = false }
  }, [doc.id])

  // Roster for the specific-members picker.
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (!rosterLoaded) void useProfilesStore.getState().fetch() }, [rosterLoaded])
  const roster = useMemo(() => (rosterLoaded ? activeProfiles() : []), [rosterLoaded])

  const toggleTarget = (id: string) =>
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const publish = async () => {
    const r = reason.trim()
    if (!r) { toast('A reason is required — readers see why this is required.', 'warn'); return }
    if (audience === 'specific' && !targets.length) { toast('Pick at least one member.', 'warn'); return }
    const args: Database['public']['Functions']['publish_reading_campaign']['Args'] = {
      p_document: doc.id, p_audience: audience, p_reason: r,
      p_targets: (audience === 'specific' ? targets : []) as unknown as Json,
    }
    const iso = dateToIso(deadline)
    if (iso) args.p_deadline = iso
    const res = await rpc('publish_reading_campaign', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Required-reading campaign published', 'success')
    onDone()
  }

  const closeCampaign = async () => {
    if (!campaign) return
    const r = await uiPrompt('Reason for closing this campaign', { title: 'Close campaign', confirmText: 'Close campaign' })
    if (r === null) return
    if (!r.trim()) { toast('A reason is required.', 'warn'); return }
    const res = await rpc('close_reading_campaign', { p_campaign: campaign.id, p_reason: r.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Campaign closed', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => reason.trim() !== ''}>
      <ModalHeader title={`Required reading — ${docTitle(doc.name)}`} onClose={onClose} />
      <div className="space-y-5">
        {campaign ? (
          <section className="rounded-2xl border border-white/10 bg-ink-950/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active campaign</h4>
                <p className="mt-1 text-sm text-slate-200">
                  {AUDIENCE_LABEL[campaign.audience] ?? campaign.audience}
                  {campaign.deadline ? ` · due ${fmtDate(campaign.deadline)}` : ' · no deadline'}
                  {` · opened ${fmtDate(campaign.created_at)}`}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{campaign.reason}</p>
              </div>
              <Button size="sm" onAction={closeCampaign}>Close campaign</Button>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New campaign</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Audience" required>
                {(id) => (
                  <Select id={id} value={audience} onChange={(e) => setAudience(e.target.value)}>
                    {Object.entries(AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Deadline" hint="Optional — when everyone should have read it.">
                {(id) => <Input id={id} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
              </Field>
            </div>
            {audience === 'specific' && (
              <fieldset className="rounded-lg border border-white/10 p-3">
                <legend className="px-1 text-xs font-semibold text-slate-400">Members</legend>
                {!roster.length ? (
                  <p className="text-xs text-slate-400">Loading roster…</p>
                ) : (
                  <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                    {roster.map((p) => (
                      <label key={p.id} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-slate-200 transition hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={targets.includes(p.id)}
                          onChange={() => toggleTarget(p.id)}
                          className="h-4 w-4 accent-amber-500"
                        />
                        <span className="truncate">{p.display_name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            <Field label="Reason" required hint="Readers see this with the acknowledgement request.">
              {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Material change to pursuit authorization" />}
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" onAction={publish}>Publish campaign</Button>
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Completion — v{doc.current_version_number}</h4>
          {!summary ? (
            <ListSkeleton count={3} />
          ) : !summary.length ? (
            <Notice text="No completion data yet." />
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-ink-800 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="border-b border-white/5 px-3 py-2 font-semibold">Member</th>
                    <th className="border-b border-white/5 px-3 py-2 font-semibold">Acknowledged</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.user_id}>
                      <td className="border-b border-white/5 px-3 py-1.5 text-slate-200">{r.display_name}</td>
                      <td className="border-b border-white/5 px-3 py-1.5 text-slate-400">
                        {r.acknowledged_at ? fmtDateTime(r.acknowledged_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}

/* ── Drive sync-conflict resolution ──────────────────────────────────────── */

export function ResolveSyncModal({ doc, onClose, onDone }: {
  doc: DocRow
  onClose: () => void
  onDone: () => void
}) {
  const [candidate, setCandidate] = useState<VersionRow | null | undefined>(undefined) // undefined = loading
  const [resolution, setResolution] = useState<'keep_portal' | 'accept_drive'>('keep_portal')
  const [reason, setReason] = useState('')

  useEffect(() => {
    let on = true
    void (async () => {
      const rows = await list('documents_versions', {
        eq: { document_id: doc.id, source_system: 'google_drive' },
        order: 'saved_at', ascending: false, limit: 10,
      }).catch(() => [] as VersionRow[])
      if (!on) return
      const flagged = rows.find((v) => {
        const m = v.metadata
        return !!(m && typeof m === 'object' && !Array.isArray(m) && (m as Record<string, unknown>).conflict === 'true')
      })
      setCandidate(flagged ?? rows[0] ?? null)
    })()
    return () => { on = false }
  }, [doc.id])

  const run = async () => {
    const r = reason.trim()
    if (!r) { toast('A reason is required — it’s recorded on the resolution.', 'warn'); return }
    const res = await rpc('resolve_document_sync', { p_document: doc.id, p_resolution: resolution, p_reason: r })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(resolution === 'keep_portal' ? 'Conflict resolved — portal text kept' : 'Conflict resolved — Drive text accepted', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => reason.trim() !== ''}>
      <ModalHeader title={`Resolve sync conflict — ${docTitle(doc.name)}`} onClose={onClose} />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Portal edited</p>
            <p className="mt-1 text-sm text-slate-200">{fmtDateTime(doc.updated_at)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Google Drive modified</p>
            <p className="mt-1 text-sm text-slate-200">{fmtDateTime(doc.source_modified_at ?? candidate?.saved_at ?? null)}</p>
          </div>
        </div>

        {candidate === undefined ? (
          <ListSkeleton count={3} />
        ) : candidate ? (
          <div>
            <p className="mb-2 text-xs text-slate-400">Portal text → Drive revision:</p>
            <DiffView base={bodyOf(doc)} other={versionBody(candidate)} />
          </div>
        ) : (
          <Notice text="No Drive revision is visible to compare — you can still record a resolution below." />
        )}

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-slate-400">Resolution</legend>
          <div className="space-y-1">
            {([
              ['keep_portal', 'Keep the portal text', 'The portal version stays live; Drive is told to match it.'],
              ['accept_drive', 'Accept the Drive text', 'The Drive revision replaces the portal text (the portal copy is kept as a version).'],
            ] as const).map(([value, label, hint]) => (
              <label key={value} className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 px-3 py-2 transition hover:bg-white/5">
                <input
                  type="radio"
                  name="sync-resolution"
                  value={value}
                  checked={resolution === value}
                  onChange={() => setResolution(value)}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-200">{label}</span>
                  <span className="block text-xs text-slate-400">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Reason" required hint="Recorded on the resolution for the audit trail.">
          {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="warn" onAction={run}>Resolve conflict</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Report an issue (every reader) ──────────────────────────────────────── */

const ISSUE_TYPES = [
  'Unclear', 'Outdated', 'Incorrect', 'Missing step', 'Broken link',
  'Legal concern', 'Sync problem', 'Permission problem', 'Formatting', 'Other',
] as const

export function ReportIssueModal({ doc, section, onClose }: {
  doc: DocRow
  /** Active heading id when the reader opened the modal, if any. */
  section: string | null
  onClose: () => void
}) {
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0])
  const [details, setDetails] = useState('')

  const submit = async () => {
    if (!details.trim()) { toast('Describe the issue so command can act on it.', 'warn'); return }
    const meta = `document: ${doc.id} · v${doc.current_version_number} · section: ${section ?? 'none'} · source: ${doc.source_system} · url: ${window.location.href}`
    const res = await insert('feedback', {
      kind: 'document',
      title: `[Doc] ${docTitle(doc.name)}: ${issueType}`,
      details: `${details.trim()}\n\n---\n${meta}`,
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Reported — command reviews these in the Feedback inbox.', 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={() => details.trim() !== ''}>
      <ModalHeader title={`Report an issue — ${docTitle(doc.name)}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Issue type" required>
          {(id) => (
            <Select id={id} value={issueType} onChange={(e) => setIssueType(e.target.value)}>
              {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Details" required hint="What’s wrong, and where — the document, version and section are attached automatically.">
          {(id) => <Textarea id={id} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Send report</Button>
        </div>
      </div>
    </Modal>
  )
}
