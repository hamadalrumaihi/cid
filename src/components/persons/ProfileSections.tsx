'use client'

/** Person dossier — overview cards (intelligence summary, investigation
 *  status), the structured identity sheet, and the activity timeline. Pure
 *  presentation plus the small editor modals that write the persons row; all
 *  data comes in through props from PersonProfile's per-section loaders. */
import { useMemo, useState } from 'react'
import type { Json } from '@/lib/database.types'
import { update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { copyText, fmtDate } from '@/lib/format'
import { parseIntelSummary } from '@/lib/jsonShapes'
import { officerName } from '@/lib/profiles'
import { priorityTint, statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea, inputCls } from '@/components/ui/Field'
import { ConfidenceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { humanize } from '@/components/gangs/gangIntel'
import {
  PERSON_REVIEW_DAYS, PERSON_SUMMARY_SECTIONS, classificationLabel, parsePersonIdentity, reviewDueState,
} from './personIntel'
import type { PersonRow } from './PersonModal'

/** Labeled key-value row — same idiom as the gang dossier's KV. */
export function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="min-w-0 text-right text-sm text-slate-200">{children}</span>
    </div>
  )
}

const REVIEW_STATE_TINT: Record<string, string> = {
  fresh: 'bg-emerald-500/15 text-emerald-300',
  due: 'bg-amber-500/15 text-amber-300',
  stale: 'bg-rose-500/15 text-rose-300',
  unreviewed: 'bg-slate-500/20 text-slate-300',
}

// ── Intelligence summary (structured sections + preserved legacy notes) ──────
export function PersonIntelligenceSummary({ person, canEdit, onEdit }: { person: PersonRow; canEdit: boolean; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const summary = useMemo(() => parseIntelSummary(person.intelligence_summary), [person.intelligence_summary])
  const sections = PERSON_SUMMARY_SECTIONS.filter((s) => summary[s.key])
  const hasStructured = sections.length > 0
  const notes = (person.notes ?? '').trim()
  const shownSections = expanded ? sections : sections.slice(0, 3)

  const copyAll = () => {
    const parts = sections.map((s) => `${s.label}\n${summary[s.key]}`)
    if (notes) parts.push(`Original notes\n${notes}`)
    copyText(parts.join('\n\n'), 'Intelligence summary')
  }

  return (
    <Card pad="lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Intelligence summary</h3>
        <div className="flex items-center gap-1.5">
          {(hasStructured || notes) && <button onClick={copyAll} title="Copy summary" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">Copy</button>}
          {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-blue-200 hover:bg-white/10">Edit</button>}
        </div>
      </div>

      {hasStructured ? (
        <div className="space-y-3">
          {shownSections.map((s) => (
            <div key={s.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-300/70">{s.label}</p>
              <p className="mt-0.5 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{summary[s.key]}</p>
            </div>
          ))}
          {sections.length > 3 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-blue-300 hover:text-blue-200">
              {expanded ? 'Show less' : `Show ${sections.length - 3} more section${sections.length - 3 === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      ) : notes ? (
        <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{notes}</p>
      ) : (
        <p className="text-sm text-slate-400">No intelligence summary recorded yet.{canEdit ? ' Use Edit to add structured sections.' : ''}</p>
      )}

      {/* Legacy notes are preserved verbatim and stay reachable once structured
          sections exist — never rewritten or discarded. */}
      {hasStructured && notes && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <button onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">
            {showRaw ? '▾' : '▸'} Original notes
          </button>
          {showRaw && <p className="mt-1.5 max-w-[68ch] whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{notes}</p>}
        </div>
      )}
    </Card>
  )
}

/** Structured-summary editor — writes intelligence_summary jsonb ONLY. The
 *  legacy `notes` column is never touched here (edit it via the person form). */
export function SummaryEditorModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const [summary, setSummary] = useState<Record<string, string>>(() => parseIntelSummary(person.intelligence_summary))
  const [busy, setBusy] = useState(false)
  const initial = useMemo(() => JSON.stringify(parseIntelSummary(person.intelligence_summary)), [person.intelligence_summary])

  const save = async () => {
    setBusy(true)
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(summary)) if (v.trim()) clean[k] = v.trim()
    const res = await update('persons', person.id, { intelligence_summary: clean as unknown as Json })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Intelligence summary saved', 'success')
    onSaved()
  }

  return (
    <Modal open wide onClose={onClose} dirty={() => JSON.stringify(summary) !== initial}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`Intelligence — ${person.name}`} onClose={onClose} />
        <div className="space-y-2">
          {PERSON_SUMMARY_SECTIONS.map((s) => (
            <Field key={s.key} label={s.label}>
              {(id) => (
                <Textarea id={id} rows={2} value={summary[s.key] || ''} onChange={(e) => setSummary((cur) => ({ ...cur, [s.key]: e.target.value }))} />
              )}
            </Field>
          ))}
        </div>
        {(person.notes ?? '').trim() && (
          <p className="mt-3 text-xs text-slate-400">
            The original notes are preserved verbatim on the record and shown under “Original notes” — this editor never rewrites them.
          </p>
        )}
        <Button variant="primary" className="mt-5 w-full" loading={busy} onClick={() => void save()}>Save summary</Button>
      </div>
    </Modal>
  )
}

// ── Investigation status + actionable quality warnings ───────────────────────
export interface QualityWarningView { key: string; message: string; onFix?: () => void; fixLabel?: string }

export function InvestigationStatusCard({ person, now, warnings, canEdit, onMarkReviewed }: {
  person: PersonRow
  now: number
  warnings: QualityWarningView[]
  canEdit: boolean
  onMarkReviewed: () => void
}) {
  const lead = officerName(person.lead_detective_id)
  const reviewer = officerName(person.reviewed_by)
  const due = reviewDueState(person, now)
  return (
    <Card pad="lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Investigation status</h3>
        <Badge tint={REVIEW_STATE_TINT[due] ?? REVIEW_STATE_TINT.unreviewed} title={`Review state: ${due}`} className="uppercase">{due}</Badge>
      </div>
      <div className="divide-y divide-white/5">
        <KV label="Lead detective">{lead ?? '—'}</KV>
        <KV label="Classification">{person.classification ? classificationLabel(person.classification) : '—'}</KV>
        <KV label="Priority">{person.priority ? <Badge tint={priorityTint(person.priority)}>{humanize(person.priority)}</Badge> : '—'}</KV>
        <KV label="Lifecycle">{person.lifecycle ? <Badge tint={statusTint(person.lifecycle)}>{humanize(person.lifecycle)}</Badge> : '—'}</KV>
        <KV label="Confidence">{person.confidence ? <ConfidenceBadge confidence={person.confidence} /> : '—'}</KV>
        <KV label="Last reviewed">
          {person.reviewed_at
            ? `${fmtDate(person.reviewed_at)}${reviewer ? ` · ${reviewer}` : ''}`
            : <StaleIntelBadge reviewedAt={person.reviewed_at} now={now} thresholdDays={PERSON_REVIEW_DAYS} />}
        </KV>
        <KV label="Next review">{fmtDate(person.next_review_at)}</KV>
      </div>
      {person.review_note && (
        <p className="mt-2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-slate-300"><span className="font-semibold text-slate-400">Review note:</span> {person.review_note}</p>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">Intelligence quality</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((w) => (
              <li key={w.key} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-300">
                <span>{w.message}</span>
                {w.onFix && (
                  <button onClick={w.onFix} className="font-semibold text-blue-300 hover:text-blue-200">
                    {w.fixLabel ?? 'Fix'} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && (
        <Button variant="secondary" className="mt-3 w-full" onClick={onMarkReviewed} title="Stamp this record as reviewed now">
          ✓ Mark reviewed
        </Button>
      )}
    </Card>
  )
}

/** Explicit review stamp — the ONLY place reviewed_at/reviewed_by are written
 *  (trivial edits never move the review clock). */
export function MarkReviewedModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [note, setNote] = useState('')
  const [nextAt, setNextAt] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const res = await update('persons', person.id, {
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile?.id ?? null,
      review_note: note.trim() || null,
      next_review_at: nextAt ? new Date(`${nextAt}T00:00:00`).toISOString() : null,
    })
    setBusy(false)
    if (res.error) { toast(`Review stamp failed: ${res.error.message}`, 'danger'); return }
    toast('Marked reviewed', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note.trim() || !!nextAt}>
      <div className="p-6">
        <ModalHeader title="Mark reviewed" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">
          Stamps <span className="text-white">{person.name}</span> as reviewed by you, now. Routine edits never move the review clock — only this action does.
        </p>
        <div className="space-y-3">
          <Field label="Review note (optional)">
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was verified, what changed, what still needs work…" />}
          </Field>
          <Field label="Next review date (optional)" hint={`Leave empty to fall back to the ${PERSON_REVIEW_DAYS}-day staleness rule.`}>
            {(id) => <Input id={id} type="date" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />}
          </Field>
        </div>
        <Button variant="primary" className="mt-5 w-full" loading={busy} onClick={() => void save()}>Mark reviewed</Button>
      </div>
    </Modal>
  )
}

// ── Identity sheet (scalar columns + identity jsonb) ─────────────────────────
function chips(values: string[]) {
  if (!values.length) return <span className="text-slate-500">—</span>
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {values.map((v, i) => <span key={i} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-200">{v}</span>)}
    </span>
  )
}

export function IdentitySection({ person, canEdit, onEdit, onEditPerson }: {
  person: PersonRow
  canEdit: boolean
  onEdit: () => void
  onEditPerson: () => void
}) {
  const ident = useMemo(() => parsePersonIdentity(person.identity), [person.identity])
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card pad="lg">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Identity</h3>
          {canEdit && <Button size="sm" onClick={onEdit}>Edit identity</Button>}
        </div>
        <div className="divide-y divide-white/5">
          <KV label="Legal name">{person.name || '—'}</KV>
          <KV label="Primary alias">{person.alias ? `“${person.alias}”` : '—'}</KV>
          <KV label="Other aliases">{chips(ident.aliases.filter((a) => a !== person.alias))}</KV>
          <KV label="Street names">{chips(ident.street_names)}</KV>
          <KV label="Date of birth">{person.dob || '—'}</KV>
          <KV label="Phone">{person.phone ? <span className="font-mono">{person.phone}</span> : '—'}</KV>
          <KV label="Occupation">{ident.occupation || '—'}</KV>
        </div>
      </Card>
      <Card pad="lg">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Descriptors &amp; record</h3>
          {canEdit && <Button size="sm" onClick={onEditPerson}>Edit person</Button>}
        </div>
        <div className="divide-y divide-white/5">
          <KV label="Distinguishing features">{chips(ident.distinguishing)}</KV>
          <KV label="License / ID numbers">{chips(ident.license_ids)}</KV>
          <KV label="CCW">{person.ccw ? 'Yes' : 'No'}</KV>
          <KV label="VCH">{String(person.vch || 0)}</KV>
          <KV label="Felony count">{String(person.felony_count || 0)}</KV>
          <KV label="Added">{fmtDate(person.created_at)}</KV>
          <KV label="Updated">{fmtDate(person.updated_at)}</KV>
        </div>
        {ident.notes && (
          <p className="mt-2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-400">Identity notes:</span> {ident.notes}
          </p>
        )}
        {/* Confidence/provenance apply at the person level — there are no
            per-field provenance columns, so none are invented here. */}
        <p className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2 text-[11px] text-slate-400">
          <ConfidenceBadge confidence={person.confidence} /> applies to this record as a whole
          {officerName(person.created_by) ? <> · entered by {officerName(person.created_by)}</> : null}
        </p>
      </Card>
    </div>
  )
}

/** Small identity editor — writes the identity jsonb plus the phone/dob
 *  scalars. Multi-value fields are comma-separated (kept simple on purpose;
 *  the shape matches the migration's documented identity contract). */
export function IdentityEditorModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const ident = useMemo(() => parsePersonIdentity(person.identity), [person.identity])
  const [aliases, setAliases] = useState(ident.aliases.join(', '))
  const [streets, setStreets] = useState(ident.street_names.join(', '))
  const [occupation, setOccupation] = useState(ident.occupation)
  const [distinguishing, setDistinguishing] = useState(ident.distinguishing.join(', '))
  const [licenses, setLicenses] = useState(ident.license_ids.join(', '))
  const [notes, setNotes] = useState(ident.notes)
  const [phone, setPhone] = useState(person.phone || '')
  const [dob, setDob] = useState(person.dob || '')
  const [busy, setBusy] = useState(false)

  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

  const save = async () => {
    setBusy(true)
    const identity = {
      aliases: split(aliases),
      street_names: split(streets),
      occupation: occupation.trim(),
      distinguishing: split(distinguishing),
      license_ids: split(licenses),
      notes: notes.trim(),
    }
    const res = await update('persons', person.id, {
      identity: identity as unknown as Json,
      phone: phone.trim() || null,
      dob: dob.trim() || null,
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Identity updated', 'success')
    onSaved()
  }

  const dirty = () =>
    aliases !== ident.aliases.join(', ') || streets !== ident.street_names.join(', ')
    || occupation !== ident.occupation || distinguishing !== ident.distinguishing.join(', ')
    || licenses !== ident.license_ids.join(', ') || notes !== ident.notes
    || phone !== (person.phone || '') || dob !== (person.dob || '')

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`Identity — ${person.name}`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Other aliases" hint="Comma-separated.">{(id) => <Input id={id} value={aliases} onChange={(e) => setAliases(e.target.value)} />}</Field>
          <Field label="Street names" hint="Comma-separated.">{(id) => <Input id={id} value={streets} onChange={(e) => setStreets(e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="Date of birth">{(id) => <Input id={id} value={dob} onChange={(e) => setDob(e.target.value)} placeholder="YYYY-MM-DD" />}</Field>
          <Field label="Occupation" className="sm:col-span-2">{(id) => <Input id={id} value={occupation} onChange={(e) => setOccupation(e.target.value)} />}</Field>
          <Field label="Distinguishing features" hint="Comma-separated (tattoos, scars, build…)." className="sm:col-span-2">
            {(id) => <Input id={id} value={distinguishing} onChange={(e) => setDistinguishing(e.target.value)} />}
          </Field>
          <Field label="License / ID numbers" hint="Comma-separated." className="sm:col-span-2">
            {(id) => <Input id={id} value={licenses} onChange={(e) => setLicenses(e.target.value)} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Identity notes" hint="E.g. mugshot source, identification caveats.">
              {(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />}
            </Field>
          </div>
        </div>
        <Button variant="primary" className="mt-5 w-full" loading={busy} onClick={() => void save()}>Save identity</Button>
      </div>
    </Modal>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────
export const ACTIVITY_CAP = 40

export function ActivitySection({ entries, total, reviewedAt, now }: {
  entries: TimelineEntry[]
  total: number
  reviewedAt: string | null
  now: number
}) {
  return (
    <Card pad="lg">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Activity</h3>
        <StaleIntelBadge reviewedAt={reviewedAt} now={now} thresholdDays={PERSON_REVIEW_DAYS} />
      </div>
      <WorkflowTimeline entries={entries} empty="No recorded activity yet." />
      {total > entries.length && (
        <p className="mt-2 text-[11px] text-slate-400">{total - entries.length} earlier event{total - entries.length === 1 ? '' : 's'} not shown.</p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Derived from records visible to you. The authoritative audit trail (audit_log) is available to command/owner.</p>
    </Card>
  )
}
