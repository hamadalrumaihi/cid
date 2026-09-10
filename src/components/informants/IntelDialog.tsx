'use client'

/** Add or edit a piece of source intelligence → `ci_intel_create` /
 *  `ci_intel_update` + `ci_intel_links_set`. Shared with the case workspace's
 *  CI Intelligence tab (Client B imports this module): open it with a `ciId`
 *  (profile), or with a `caseId` and no `ciId` (case tab) and it offers the
 *  caller's own sources to pick from — `ci_list` returns exactly those.
 *
 *  Corroboration carries the one explainer everywhere it appears: reliability
 *  is what the source said and how they have held up; corroboration is what
 *  the investigation confirmed. Mentions are RLS-scoped registry picks
 *  (`EntityPicker`); the server refuses a hidden target (`bad_link`). */
import { useEffect, useState } from 'react'
import type { Json } from '@/lib/database.types'
import type { EntityHit } from '@/lib/entitySearch'
import { KIND_LABEL, type SuggestKind } from '@/lib/entity'
import { toast } from '@/lib/toast'
import {
  CI_CORROBORATION, CI_CORROBORATION_EXPLAINER, CI_CORROBORATION_LABEL, CI_RELIABILITY, CI_RELIABILITY_LABEL,
  CI_SENSITIVITY, CI_SENSITIVITY_LABEL, ciIntelCreate, ciIntelLinksSet, ciIntelUpdate, ciRefused, fetchCiList,
  type CiIntelInput, type CiIntelLinkInput, type CiIntelRow, type CiListRow,
} from '@/lib/ci'
import { EntityPicker } from '@/components/entity/EntityPicker'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CasePicker, fromLocalInput, nowLocalInput, toLocalInput } from './ciShared'

/** Registry kinds a mention may point at (the CHECK's 'evidence' / 'media'
 *  have no picker — they are linked from the case surfaces, not typed here). */
const MENTION_KINDS = ['person', 'vehicle', 'gang', 'place', 'narcotic'] as const satisfies readonly SuggestKind[]
type MentionKind = (typeof MENTION_KINDS)[number]

export interface IntelMention { kind: MentionKind; hit: EntityHit }

export interface IntelDialogProps {
  open: boolean
  onClose: () => void
  /** The source. Omit (case tab) to choose among the caller's own sources. */
  ciId?: string | null
  /** Prefills / locks the case (case tab). */
  caseId?: string | null
  caseLabel?: string | null
  /** Edit mode: the existing row (+ its mentions, when the caller has them). */
  intel?: CiIntelRow | null
  initialMentions?: IntelMention[]
  onSaved?: (intelId: string) => void
}

export function IntelDialog({ open, onClose, ciId, caseId, caseLabel, intel, initialMentions, onSaved }: IntelDialogProps) {
  const editing = !!intel
  const [ci, setCi] = useState(ciId ?? intel?.ci_id ?? '')
  const [sources, setSources] = useState<CiListRow[] | null>(null)
  const [summary, setSummary] = useState(intel?.summary ?? '')
  const [body, setBody] = useState(intel?.body ?? '')
  const [receivedAt, setReceivedAt] = useState(intel ? toLocalInput(intel.received_at) : nowLocalInput())
  const [reliability, setReliability] = useState(intel?.reliability ?? 'unknown')
  const [corroboration, setCorroboration] = useState(intel?.corroboration ?? 'unverified')
  const [sensitivity, setSensitivity] = useState(intel?.sensitivity ?? 'sensitive')
  const [followUp, setFollowUp] = useState(intel?.follow_up_required ?? false)
  const [followUpDone, setFollowUpDone] = useState(!!intel?.follow_up_done_at)
  const [notes, setNotes] = useState(intel?.handler_notes ?? '')
  const [caseHit, setCaseHit] = useState<EntityHit | null>(
    caseId ? { id: caseId, label: caseLabel ?? 'Selected case' } : intel?.case_id ? { id: intel.case_id, label: 'Linked case' } : null,
  )
  const [mentions, setMentions] = useState<IntelMention[]>(initialMentions ?? [])
  const [mentionKind, setMentionKind] = useState<MentionKind>('person')
  const [err, setErr] = useState<string | undefined>()

  // Case-tab mode: the caller's own sources (RLS-bounded — a member with no
  // CI standing gets an empty list and the dialog says so).
  useEffect(() => {
    if (!open || ciId || editing) return
    let live = true
    void fetchCiList({}, 100).then((rows) => { if (live) setSources(rows) })
    return () => { live = false }
  }, [open, ciId, editing])

  const dirty = () => (editing
    ? summary !== intel.summary || body !== (intel.body ?? '') || notes !== (intel.handler_notes ?? '')
    : summary.trim() !== '' || body.trim() !== '' || notes.trim() !== '' || mentions.length > 0)

  const links = (): CiIntelLinkInput[] => mentions.map((m) => ({ kind: m.kind, target_id: m.hit.id }))

  const submit = async () => {
    const target = ciId ?? ci
    if (!target) { setErr('Choose a source.'); return }
    if (summary.trim().length < 3) { setErr('A summary is required.'); return }
    const received = fromLocalInput(receivedAt)
    if (!received) { setErr('When was this received?'); return }
    setErr(undefined)
    if (editing) {
      const patch: Record<string, Json> = {
        summary: summary.trim(), body: body.trim() || null, received_at: received, reliability, sensitivity,
        follow_up_required: followUp, handler_notes: notes.trim() || null, case_id: caseHit?.id ?? null,
        follow_up_done_at: followUp && followUpDone ? (intel.follow_up_done_at ?? new Date().toISOString()) : null,
      }
      const r = await ciIntelUpdate(intel.id, patch)
      if (ciRefused(r)) return
      const l = await ciIntelLinksSet(intel.id, links())
      if (ciRefused(l)) return
      toast('Intelligence updated.', 'success')
      onSaved?.(intel.id)
      onClose()
      return
    }
    const input: CiIntelInput = {
      summary: summary.trim(), body: body.trim() || null, caseId: caseHit?.id ?? null, receivedAt: received,
      reliability, corroboration, sensitivity, followUpRequired: followUp, handlerNotes: notes.trim() || null, links: links(),
    }
    const r = await ciIntelCreate(target, input)
    if (ciRefused(r)) return
    toast('Intelligence added.', 'success')
    onSaved?.(r.id)
    onClose()
  }

  const addMention = (hit: EntityHit | null) => {
    if (!hit || mentions.some((m) => m.kind === mentionKind && m.hit.id === hit.id)) return
    setMentions((m) => [...m, { kind: mentionKind, hit }])
  }

  return (
    <Modal open={open} onClose={onClose} dirty={dirty} wide>
      <div className="p-5">
        <ModalHeader title={editing ? 'Edit intelligence' : 'Add intelligence'} onClose={onClose} />
        <div className="space-y-3">
          {!ciId && !editing && (
            <Field label="Source" required error={!ci ? err : undefined}
              hint={sources && !sources.length ? 'No source is assigned to you.' : undefined}>
              {(id) => (
                <Select id={id} value={ci} onChange={(e) => setCi(e.target.value)}>
                  <option value="">{sources === null ? 'Loading…' : 'Select a source…'}</option>
                  {(sources ?? []).map((r) => <option key={r.id} value={r.id}>{r.ci_number}{r.alias ? ` · ${r.alias}` : ''}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Summary" required error={(ciId || ci) && err && summary.trim().length < 3 ? err : undefined}>
            {(id) => <Input id={id} value={summary} onChange={(e) => setSummary(e.target.value)} invalid={!!err && summary.trim().length < 3} placeholder="One line: what the source reported" />}
          </Field>
          <Field label="Detail">
            {(id) => <Textarea id={id} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The report as received — who, what, where, when" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Received" required>
              {(id) => <Input id={id} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />}
            </Field>
            {caseId ? (
              <Field label="Case">{(id) => <span id={id} className="block min-h-11 rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-slate-200">{caseLabel ?? 'Selected case'}</span>}</Field>
            ) : (
              <CasePicker value={caseHit} onChange={setCaseHit} hint="Only cases you can read are offered; the link is created on save." />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Source reliability" hint="What the source said and how they have held up.">
              {(id) => (
                <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                  {CI_RELIABILITY.map((v) => <option key={v} value={v}>{CI_RELIABILITY_LABEL[v]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Corroboration" hint={editing ? 'Change it from the intelligence row (audited separately).' : CI_CORROBORATION_EXPLAINER}>
              {(id) => (
                <Select id={id} value={corroboration} onChange={(e) => setCorroboration(e.target.value)} disabled={editing}>
                  {CI_CORROBORATION.map((v) => <option key={v} value={v}>{CI_CORROBORATION_LABEL[v]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Sensitivity">
              {(id) => (
                <Select id={id} value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
                  {CI_SENSITIVITY.map((v) => <option key={v} value={v}>{CI_SENSITIVITY_LABEL[v]}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="h-4 w-4" />
              Follow-up required
            </label>
            {editing && followUp && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={followUpDone} onChange={(e) => setFollowUpDone(e.target.checked)} className="h-4 w-4" />
                Follow-up done
              </label>
            )}
          </div>
          <Field label="Handler notes" hint="Stays inside the compartment; never part of a release.">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>

          <fieldset className="space-y-2 rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-400">Mentions</legend>
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Field label="Kind">
                {(id) => (
                  <Select id={id} value={mentionKind} onChange={(e) => setMentionKind(e.target.value as MentionKind)}>
                    {MENTION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k].one[0].toUpperCase() + KIND_LABEL[k].one.slice(1)}</option>)}
                  </Select>
                )}
              </Field>
              <EntityPicker key={mentionKind} kind={mentionKind} label={`Add ${KIND_LABEL[mentionKind].one}`} value={null} onChange={addMention}
                exclude={new Set(mentions.filter((m) => m.kind === mentionKind).map((m) => m.hit.id))} peek={false} />
            </div>
            {mentions.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Mentioned records">
                {mentions.map((m) => (
                  <li key={`${m.kind}:${m.hit.id}`}>
                    <Badge tone="neutral" className="min-h-7 gap-1.5 pr-1">
                      <span className="text-slate-400">{KIND_LABEL[m.kind].one}</span> {m.hit.label}
                      <button type="button" aria-label={`Remove ${m.hit.label}`} className="grid h-5 w-5 place-items-center rounded hover:bg-white/10"
                        onClick={() => setMentions((xs) => xs.filter((x) => !(x.kind === m.kind && x.hit.id === m.hit.id)))}>×</button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>{editing ? 'Save changes' : 'Add intelligence'}</Button>
        </div>
      </div>
    </Modal>
  )
}
