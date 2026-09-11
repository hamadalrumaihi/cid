'use client'

/** Associations — the reviewable links between one registry record and
 *  another (`public.entity_associations`, migration 20261106120000).
 *
 *  The registry could already tie a person to a person and a gang to a block,
 *  but not one organisation to another, and not an organisation to a property
 *  except through `places.controlling_gang_id` — a single-valued CONTROL
 *  claim, which is the wrong statement to make when all anyone observed was
 *  two organisations' branding on one shopfront. This section is where that
 *  observation goes instead, and the wording is the point:
 *
 *   · an association lands on PENDING INVESTIGATION and is labelled, in
 *     words, as an observation and not a finding — pending rows sort first
 *     and carry the notice;
 *   · `unconfirmed_association` reads as "Unconfirmed Association" and
 *     nothing else. No copy here says alliance, merger or control unless an
 *     investigator chose that claim;
 *   · the person who recorded it is the SUBMITTER. That is not an assignment
 *     and not a finding of fact; the decision line names who ruled, when and
 *     why, or says plainly that nobody has.
 *
 *  Every write is an RPC (lib/associations) and every refusal is the
 *  server's: the buttons below are cosmetic, `entity_associations_sel` and
 *  `private.perm_dispatch('entity_association')` are the authority. Reads
 *  follow BOTH endpoints, so an association can never be the thing that
 *  reveals a record the viewer may not see. */
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  ASSOCIATION_CLAIMS, ASSOCIATION_CONFIDENCE, ASSOCIATION_SOURCE_TYPES, amendPatch, associationConfidenceLabel,
  associationKindLabel, associationSourceLabel, claimLabel, claimMeaning, createAssociation, decideAssociation,
  decisionNeedsReason, isPendingAssociation, updateAssociation, useAssociations,
  type AssociationClaim, type AssociationConfidence, type AssociationKind, type AssociationRow, type AssociationSourceType,
  type AssociationStatus,
} from '@/lib/associations'
import { deleteRecord } from '@/lib/deleteRecord'
import { searchEntities } from '@/lib/entitySearch'
import { fmtDateTime } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EntityLink, type EntityKind as LinkKind } from '@/components/ui/EntityLink'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { RecordSearchPicker, type PickedRecord } from './RecordSearchPicker'

/** The kinds the shared entity search can offer (entitySearch has no
 *  `indicator` arm). An indicator association recorded elsewhere still
 *  READS here — this list only bounds what the picker can create. */
const PICKABLE_KINDS = ['gang', 'person', 'place', 'vehicle', 'narcotic', 'account'] as const
type PickableKind = (typeof PICKABLE_KINDS)[number]

/** Registry kinds that have a dossier to deep-link to (ui/EntityLink). */
const LINKABLE: Record<string, LinkKind | undefined> = {
  gang: 'gang', person: 'person', place: 'place', vehicle: 'vehicle', narcotic: 'narcotic',
}

const PENDING_NOTE = 'Pending investigation — an observation on the record, not a finding.'

const fmtDay = (iso: string | null): string => {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/* ── Small building blocks (module scope for the static-components lint) ── */

/** The far end of the association: a deep link when the kind has a dossier,
 *  otherwise the label as the server resolved it. A null label means RLS
 *  answered nothing for that id — say so, never invent a name. */
function OtherRecord({ row }: { row: AssociationRow }) {
  const kind = LINKABLE[row.other_kind]
  if (!row.other_label) {
    return <span className="text-sm text-slate-400">{associationKindLabel(row.other_kind)} — access restricted.</span>
  }
  if (!kind) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="neutral">{associationKindLabel(row.other_kind)}</Badge>
        <span className="text-sm font-semibold text-white">{row.other_label}</span>
      </span>
    )
  }
  return <EntityLink kind={kind} id={row.other_id} label={row.other_label} title={`Open ${row.other_label}`} />
}

/** subject → claim → object, in the direction the row was recorded. The
 *  record this section is shown on is named plainly; the other end links. */
function ClaimLine({ row, label }: { row: AssociationRow; label: string }) {
  const here = <span className="text-sm font-semibold text-slate-200">{label}</span>
  const there = <OtherRecord row={row} />
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.direction === 'object' ? there : here}
      <span aria-hidden className="text-slate-500">→</span>
      <Badge tone="accent" title={claimMeaning(row.association)}>{claimLabel(row.association)}</Badge>
      <span aria-hidden className="text-slate-500">→</span>
      {row.direction === 'object' ? here : there}
    </div>
  )
}

/** Who recorded the observation, and when. Deliberately worded: this is the
 *  submitter, not an assigned investigator and not a decision. */
function SubmitterLine({ row }: { row: AssociationRow }) {
  return (
    <p className="text-[11px] text-slate-400" title="The member who recorded this observation. This is not an assignment and not a finding.">
      Submitted by <span className="text-slate-300">{row.created_by_name || 'Unknown member'}</span> · {fmtDateTime(row.created_at)}
    </p>
  )
}

function DecisionLine({ row }: { row: AssociationRow }) {
  if (!row.decided_at) {
    return <p className="text-[11px] text-slate-400">No investigator has ruled on this yet.</p>
  }
  return (
    <div className="text-[11px] text-slate-400">
      <p>
        {associationStatusVerb(row.status)} by <span className="text-slate-300">{row.decided_by_name || 'Unknown member'}</span> · {fmtDateTime(row.decided_at)}
      </p>
      {row.decision_note && <p className="mt-0.5 text-slate-300">“{row.decision_note}”</p>}
    </div>
  )
}

function associationStatusVerb(status: string): string {
  switch (status) {
    case 'confirmed': return 'Confirmed'
    case 'rejected': return 'Rejected'
    case 'historical': return 'Retired as historical'
    default: return 'Decided'
  }
}

/** Amend the descriptive fields only — note, confidence, source, dates. The
 *  claim and the status move through a decision, never through here. */
function AmendForm({ row, onDone, onCancel }: { row: AssociationRow; onDone: () => void; onCancel: () => void }) {
  const [note, setNote] = useState(row.note ?? '')
  const [confidence, setConfidence] = useState(row.confidence ?? '')
  const [sourceType, setSourceType] = useState(row.source_type ?? '')
  const [firstObserved, setFirstObserved] = useState(row.first_observed ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const patch = amendPatch(row, {
      note, confidence, source_type: sourceType, first_observed: firstObserved,
    })
    if (!patch) { onCancel(); return }
    setBusy(true)
    const res = await updateAssociation(row.id, patch)
    setBusy(false)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Association amended', 'success')
    onDone()
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Confidence">
          {(id) => (
            <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              <option value="">—</option>
              {ASSOCIATION_CONFIDENCE.map((c) => <option key={c} value={c}>{associationConfidenceLabel(c)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Source type">
          {(id) => (
            <Select id={id} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="">—</option>
              {ASSOCIATION_SOURCE_TYPES.map((s) => <option key={s} value={s}>{associationSourceLabel(s)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="First observed">
          {(id) => <Input id={id} type="date" value={firstObserved} onChange={(e) => setFirstObserved(e.target.value)} />}
        </Field>
      </div>
      <Field label="Note">
        {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was observed, and where…" />}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>Save amendment</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function AssociationCard({ row, label, canDecide, mayAmend, onChanged }: {
  row: AssociationRow
  label: string
  canDecide: boolean
  mayAmend: boolean
  onChanged: () => void
}) {
  const [amending, setAmending] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = isPendingAssociation(row)

  const decide = async (status: AssociationStatus, prompt: string, confirmText: string) => {
    let note: string | null = null
    if (decisionNeedsReason(status)) {
      // The RPC refuses a confirm or a reject without a reason — collect it
      // before spending the round trip, and let the server say so anyway.
      const answer = await uiPrompt(prompt, { title: confirmText, placeholder: 'Why?…', confirmText })
      if (answer === null) return
      if (!answer.trim()) { toast('A reason is required to confirm or reject an association.', 'warn'); return }
      note = answer
    } else if (!(await uiConfirm(prompt, { title: confirmText, confirmText }))) return

    setBusy(true)
    const res = await decideAssociation(row.id, status, { note })
    setBusy(false)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(`Association ${status === 'pending_investigation' ? 'reopened' : associationStatusVerb(status).toLowerCase()}`, 'success')
    onChanged()
  }

  const withdraw = async () => {
    await deleteRecord('entity_associations', { id: row.id }, {
      label: 'this association',
      confirmTitle: 'Withdraw association',
      confirmMessage: 'Withdraw this association? It goes to the Trash. If the link was recorded in good faith and simply does not hold, Reject it instead — that keeps the decision on the record.',
      confirmText: 'Withdraw',
      after: onChanged,
    })
  }

  return (
    <Card pad="sm" className={pending ? 'border-amber-500/25' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <ClaimLine row={row} label={label} />
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge domain="entityAssociation" value={row.status} />
            {row.confidence && <StatusBadge domain="confidence" value={row.confidence} title={`Confidence: ${associationConfidenceLabel(row.confidence)}`} />}
            {row.source_type && <Badge tone="neutral">{associationSourceLabel(row.source_type)}</Badge>}
            {row.first_observed && <span className="text-[11px] text-slate-400">First observed {fmtDay(row.first_observed)}</span>}
            {row.last_confirmed && <span className="text-[11px] text-slate-400">Last confirmed {fmtDay(row.last_confirmed)}</span>}
          </div>
        </div>
      </div>

      {pending && <p className="mt-2 text-[11px] font-semibold text-amber-200">{PENDING_NOTE}</p>}
      {row.note && <p className="mt-2 max-w-[68ch] whitespace-pre-wrap text-xs text-slate-300">{row.note}</p>}

      <div className="mt-2 space-y-0.5 border-t border-white/5 pt-2">
        <SubmitterLine row={row} />
        <DecisionLine row={row} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canDecide && row.status !== 'confirmed' && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void decide('confirmed', 'Confirm this association? A reason is required and is kept on the record.', 'Confirm')}>Confirm</Button>
        )}
        {canDecide && row.status !== 'rejected' && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void decide('rejected', 'Reject this association? A reason is required and is kept on the record.', 'Reject')}>Reject</Button>
        )}
        {canDecide && row.status !== 'historical' && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void decide('historical', 'Mark this association historical? Use this when it was true and no longer is.', 'Mark historical')}>Mark historical</Button>
        )}
        {canDecide && !pending && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide('pending_investigation', 'Reopen this association? It returns to Pending Investigation and the recorded decision is cleared.', 'Reopen')}>Reopen</Button>
        )}
        {mayAmend && !amending && <Button variant="ghost" size="sm" onClick={() => setAmending(true)}>Amend</Button>}
        {mayAmend && <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onClick={() => void withdraw()}>Withdraw</Button>}
      </div>

      {amending && <AmendForm row={row} onDone={() => { setAmending(false); onChanged() }} onCancel={() => setAmending(false)} />}
    </Card>
  )
}

/* ── Record an association ──────────────────────────────────────────────── */

function RecordAssociationForm({ kind, id, label, exclude, onCreated }: {
  kind: AssociationKind
  id: string
  label: string
  exclude: ReadonlySet<string>
  onCreated: () => void
}) {
  const [otherKind, setOtherKind] = useState<PickableKind>('gang')
  const [picked, setPicked] = useState<PickedRecord | null>(null)
  const [claim, setClaim] = useState<AssociationClaim>('unconfirmed_association')
  const [confidence, setConfidence] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [firstObserved, setFirstObserved] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const search = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const hits = await searchEntities(otherKind, q, { exclude })
    return hits.map((h) => ({ id: h.id, label: h.label, ...(h.sublabel ? { sublabel: h.sublabel } : {}) }))
  }, [otherKind, exclude])

  const submit = async () => {
    if (!picked) return
    setBusy(true)
    const res = await createAssociation({
      subjectKind: kind,
      subjectId: id,
      objectKind: otherKind,
      objectId: picked.id,
      association: claim,
      note,
      confidence: (confidence || null) as AssociationConfidence | null,
      sourceType: (sourceType || null) as AssociationSourceType | null,
      firstObserved,
    })
    setBusy(false)
    if (!res.ok) { toast(res.message, 'danger'); return }
    // An identical live pair is RETURNED, never duplicated — say which
    // happened rather than claiming a new record either way.
    toast(
      res.data.created === false
        ? res.data.message || 'That association is already recorded.'
        : 'Association recorded — pending investigation.',
      res.data.created === false ? 'warn' : 'success',
    )
    setPicked(null); setNote(''); setFirstObserved('')
    onCreated()
  }

  return (
    <Card pad="sm" className="space-y-2">
      <h4 className="text-[13px] font-semibold text-white">Record an association</h4>
      <p className="text-[11px] text-slate-400">
        It lands on Pending Investigation for someone to rule on. Recording an observation is not a finding, and
        “Unconfirmed Association” claims nothing about the nature of the link.
      </p>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Record type">
          {(fid) => (
            <Select id={fid} value={otherKind} onChange={(e) => { setOtherKind(e.target.value as PickableKind); setPicked(null) }}>
              {PICKABLE_KINDS.map((k) => <option key={k} value={k}>{associationKindLabel(k)}</option>)}
            </Select>
          )}
        </Field>
        <RecordSearchPicker
          label={`Associate ${label} with`}
          placeholder="Search the registry…"
          value={picked}
          onChange={setPicked}
          search={search}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Claim">
          {(fid) => (
            <Select id={fid} value={claim} onChange={(e) => setClaim(e.target.value as AssociationClaim)}>
              {ASSOCIATION_CLAIMS.map((c) => <option key={c} value={c}>{claimLabel(c)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Confidence">
          {(fid) => (
            <Select id={fid} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              <option value="">—</option>
              {ASSOCIATION_CONFIDENCE.map((c) => <option key={c} value={c}>{associationConfidenceLabel(c)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Source type">
          {(fid) => (
            <Select id={fid} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="">—</option>
              {ASSOCIATION_SOURCE_TYPES.map((s) => <option key={s} value={s}>{associationSourceLabel(s)}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="First observed">
          {(fid) => <Input id={fid} type="date" value={firstObserved} onChange={(e) => setFirstObserved(e.target.value)} />}
        </Field>
        <Field label="Note" hint="What was actually observed — the note is the claim's evidence.">
          {(fid) => <Textarea id={fid} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Both sets of colours on the same shopfront, 14th…" />}
        </Field>
      </div>
      <p className="text-[11px] text-amber-200">{claimMeaning(claim)}</p>
      <Button variant="primary" size="sm" disabled={!picked} loading={busy} onClick={() => void submit()}>Record association</Button>
    </Card>
  )
}

/* ── Section ────────────────────────────────────────────────────────────── */

export interface AssociationsSectionProps {
  kind: AssociationKind
  id: string
  /** The record this section is shown on, for the claim line and the picker. */
  label: string
  className?: string
}

/** The cosmetic gates, taken as props so the panel can be rendered (and
 *  tested) without an AuthProvider — the *Panel convention the entity
 *  components already use. */
export interface AssociationsPanelProps extends AssociationsSectionProps {
  canCreate: boolean
  canDecide: boolean
  /** The viewer, for the author half of "author or command". */
  viewerId: string | null
  isCommand: boolean
}

export function AssociationsSection(props: AssociationsSectionProps) {
  const { profile } = useAuth()
  const { perms, can } = usePermissions()
  // Cosmetic only. The global matrix cells answer create / decide; amending
  // and withdrawing are the author's or command's call, which the matrix
  // reports as record-dependent — so the control shows for the submitter and
  // for command, and `private.assoc_author_or_command` decides for real.
  return (
    <AssociationsPanel
      {...props}
      canCreate={can('create', 'entity_association') !== false}
      canDecide={can('decide', 'entity_association') !== false}
      viewerId={profile?.id ?? null}
      isCommand={perms.access_class === 'command' || perms.access_class === 'owner'}
    />
  )
}

export function AssociationsPanel({ kind, id, label, className = '', canCreate, canDecide, viewerId, isCommand }: AssociationsPanelProps) {
  const { rows, loading, error, refresh } = useAssociations(kind, id)
  const [adding, setAdding] = useState(false)

  const pending = useMemo(() => rows.filter(isPendingAssociation).length, [rows])
  const exclude = useMemo(() => new Set([id, ...rows.map((r) => r.other_id)]), [id, rows])

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Associations</h3>
          <Badge>{rows.length}</Badge>
          {pending > 0 && <Badge tint="bg-amber-500/15 text-amber-300">{pending} pending</Badge>}
        </div>
        {canCreate && !adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>Record an association</Button>
        )}
      </div>

      {adding && canCreate && (
        <RecordAssociationForm
          kind={kind}
          id={id}
          label={label}
          exclude={exclude}
          onCreated={() => { setAdding(false); void refresh() }}
        />
      )}

      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : loading ? (
        <ListSkeleton count={3} />
      ) : !rows.length ? (
        <EmptyState
          title="No associations recorded"
          hint={canCreate
            ? 'Record one when two records are observed linked — it is filed as pending investigation, never as a finding.'
            : 'Associations are only visible to members who can see both records they name.'}
        />
      ) : (
        <>
          {pending > 0 && (
            <Notice text={`${pending} association${pending === 1 ? '' : 's'} awaiting investigation. ${PENDING_NOTE}`} />
          )}
          <div className="space-y-2">
            {rows.map((row) => (
              <AssociationCard
                key={row.id}
                row={row}
                label={label}
                canDecide={canDecide}
                mayAmend={isCommand || (!!row.created_by && row.created_by === viewerId)}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
