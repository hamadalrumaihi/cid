'use client'

/** New/Edit person modal — vanilla persons.js openPersonModal(), extended for
 *  the intelligence schema (20260729010000): identity fields (phone/dob/
 *  classification/confidence/priority/lifecycle), the structured identity
 *  jsonb (aliases / street names / license ids as one-per-line inputs),
 *  review scheduling (next review + lead detective), and the structured BOLO
 *  block (reason/risk/instructions/expiry; issued_by/at stamped when the flag
 *  is newly raised). Legacy fields — status text, CCW/VCH/felonies, notes,
 *  and the repeatable Known Properties rows — are preserved verbatim, as is
 *  the gang-preservation guard (a stale gangs cache can't null gang_id).
 *  Mounted fresh per open. */
import { useState } from 'react'
import type { Json, Tables, TablesInsert } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { activeProfiles, officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  CONFIDENCE_LEVELS, PERSON_CLASSIFICATIONS, PERSON_LIFECYCLES, PERSON_PRIORITIES,
  classificationLabel, confidenceLabel, lifecycleLabel, parsePersonIdentity, priorityLabel,
} from './personIntel'

export type PersonRow = Tables<'persons'>
export type GangRow = Tables<'gangs'>

/** Everything the modal edits — a structural subset of PersonRow so the
 *  registry can hand over its projected rows and the profile/BOLO screens can
 *  keep passing full rows. */
export type PersonEditRecord = Pick<PersonRow,
  | 'id' | 'name' | 'alias' | 'gang_id' | 'status' | 'ccw' | 'bolo' | 'vch' | 'felony_count'
  | 'mugshot_url' | 'notes' | 'properties' | 'phone' | 'dob' | 'classification' | 'confidence'
  | 'priority' | 'lifecycle' | 'identity' | 'next_review_at' | 'lead_detective_id'
  | 'bolo_reason' | 'bolo_risk' | 'bolo_instructions' | 'bolo_expires_at'>

export interface PersonProperty { address: string; type: string; notes: string }

const PROPERTY_TYPES = ['Residence', 'Stash House', 'Front Business', 'Safehouse', 'Warehouse', 'Vehicle', 'Other']

export const parseProperties = (j: Json | null): PersonProperty[] =>
  Array.isArray(j)
    ? j.map((x) => (x && typeof x === 'object' ? (x as unknown as Partial<PersonProperty>) : {}))
        .map((x) => ({ address: x.address || '', type: x.type || 'Residence', notes: x.notes || '' }))
    : []

/** Cascade-null references restored by undo (vanilla persons.js:86). */
export const PERSON_NULL_REFS = [
  { table: 'gang_members' as const, column: 'person_id' },
  { table: 'vehicles' as const, column: 'owner_id' },
]

const splitLines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean)

/** Uppercase section rule inside the form grid. Module-scope (static). */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 border-t border-white/5 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 sm:col-span-2">
      {children}
    </p>
  )
}

interface PersonModalProps {
  record: PersonEditRecord | null
  /** Quick-add prefill for the "no persons match" inline create. */
  prefillName?: string
  gangs: Pick<GangRow, 'id' | 'name'>[]
  onClose: () => void
  onSaved: () => void
}

export function PersonModal({ record, prefillName, gangs, onClose, onSaved }: PersonModalProps) {
  const { profile, canDelete } = useAuth()
  // Identity
  const [name, setName] = useState(record?.name || prefillName || '')
  const [alias, setAlias] = useState(record?.alias || '')
  const [phone, setPhone] = useState(record?.phone || '')
  const [dob, setDob] = useState(record?.dob?.slice(0, 10) || '')
  const [gangId, setGangId] = useState(record?.gang_id || '')
  const [status, setStatus] = useState(record?.status || 'Person of Interest')
  const [classification, setClassification] = useState(record?.classification || '')
  const [confidence, setConfidence] = useState(record?.confidence || '')
  const [priority, setPriority] = useState(record?.priority || '')
  const [lifecycle, setLifecycle] = useState(record?.lifecycle || 'active')
  const [mugshot, setMugshot] = useState(record?.mugshot_url || '')
  // Structured identity jsonb — unedited keys (occupation/distinguishing/notes)
  // are preserved via the parsed base.
  const [identityBase] = useState(() => parsePersonIdentity(record?.identity ?? null))
  const [idAliases, setIdAliases] = useState(() => (identityBase.aliases ?? []).join('\n'))
  const [idStreet, setIdStreet] = useState(() => (identityBase.street_names ?? []).join('\n'))
  const [idLicenses, setIdLicenses] = useState(() => (identityBase.license_ids ?? []).join('\n'))
  // Criminal profile (legacy)
  const [ccw, setCcw] = useState(!!record?.ccw)
  const [vch, setVch] = useState(String(record?.vch ?? 0))
  const [felonies, setFelonies] = useState(String(record?.felony_count ?? 0))
  const [notes, setNotes] = useState(record?.notes || '')
  // Review
  const [nextReview, setNextReview] = useState(record?.next_review_at?.slice(0, 10) || '')
  const [leadId, setLeadId] = useState(record?.lead_detective_id || '')
  // BOLO
  const [bolo, setBolo] = useState(!!record?.bolo)
  const [boloReason, setBoloReason] = useState(record?.bolo_reason || '')
  const [boloRisk, setBoloRisk] = useState(record?.bolo_risk || '')
  const [boloInstructions, setBoloInstructions] = useState(record?.bolo_instructions || '')
  const [boloExpires, setBoloExpires] = useState(record?.bolo_expires_at?.slice(0, 10) || '')
  const [props, setProps] = useState<PersonProperty[]>(() => parseProperties(record?.properties ?? null))

  const gangKnown = !gangId || gangs.some((g) => g.id === gangId)
  const detectives = activeProfiles()
  const leadKnown = !leadId || detectives.some((p) => p.id === leadId)

  const setProp = (i: number, patch: Partial<PersonProperty>) =>
    setProps((rows) => rows.map((r, x) => (x === i ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    const payload: TablesInsert<'persons'> = {
      name: name.trim(),
      alias: alias.trim() || null,
      phone: phone.trim() || null,
      dob: dob || null,
      gang_id: gangId || null,
      status: status.trim() || null,
      classification: classification || null,
      confidence: confidence || null,
      priority: priority || null,
      lifecycle,
      ccw, bolo,
      vch: Number(vch) || 0,
      felony_count: Number(felonies) || 0,
      mugshot_url: mugshot.trim() || null,
      notes: notes.trim() || null,
      next_review_at: nextReview || null,
      lead_detective_id: leadId || null,
      bolo_reason: boloReason.trim() || null,
      bolo_risk: boloRisk || null,
      bolo_instructions: boloInstructions.trim() || null,
      bolo_expires_at: boloExpires || null,
      identity: {
        ...identityBase,
        aliases: splitLines(idAliases),
        street_names: splitLines(idStreet),
        license_ids: splitLines(idLicenses),
      } as unknown as Json,
      properties: props
        .map((p) => ({ address: p.address.trim(), type: p.type, notes: p.notes.trim() }))
        .filter((p) => p.address || p.notes) as unknown as Json,
    }
    // Stamp issuance only when the flag is newly raised — an edit while the
    // BOLO stays up keeps the original issuer/time.
    if (bolo && !record?.bolo) {
      payload.bolo_issued_by = profile?.id ?? null
      payload.bolo_issued_at = new Date().toISOString()
    }
    const res = record ? await update('persons', record.id, payload) : await insert('persons', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Person updated' : 'Person created', 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    if (!(await uiConfirm(`Delete person "${record.name}"?`, { confirmText: 'Delete' }))) return
    onClose()
    // Snapshot the FULL row for the undo re-insert — `record` may be a
    // projected registry row, and undoing from it would drop columns.
    const full = await list('persons', { in: { id: [record.id] } }).catch(() => [] as PersonRow[])
    await deleteWithUndo('persons', full[0] ?? (record as PersonRow), {
      label: `Person "${record.name}"`, noConfirm: true, after: onSaved, setNullRefs: PERSON_NULL_REFS,
    })
  }

  const dirty = () =>
    name.trim() !== (record?.name || prefillName || '') || alias.trim() !== (record?.alias || '') ||
    phone.trim() !== (record?.phone || '') || dob !== (record?.dob?.slice(0, 10) || '') ||
    notes.trim() !== (record?.notes || '') || gangId !== (record?.gang_id || '') ||
    classification !== (record?.classification || '') || lifecycle !== (record?.lifecycle || 'active') ||
    bolo !== !!record?.bolo || boloReason.trim() !== (record?.bolo_reason || '')

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Person`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Alias">{(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0100" />}</Field>
          <Field label="Date of birth">{(id) => <Input id={id} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />}</Field>
          <Field label="Gang">
            {(id) => (
              <Select id={id} value={gangId} onChange={(e) => setGangId(e.target.value)}>
                <option value="">— no gang —</option>
                {!gangKnown && <option value={gangId}>(current gang — loading…)</option>}
                {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Status" hint="Free-text legacy status (e.g. Person of Interest).">
            {(id) => <Input id={id} value={status} onChange={(e) => setStatus(e.target.value)} />}
          </Field>
          <Field label="Classification">
            {(id) => (
              <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
                <option value="">— unclassified —</option>
                {PERSON_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{classificationLabel(c)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Record confidence">
            {(id) => (
              <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                <option value="">— unset —</option>
                {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{confidenceLabel(c)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">— unset —</option>
                {PERSON_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Lifecycle" hint={record?.lifecycle === 'merged' ? 'Merged tombstone — managed by the merge flow.' : undefined}>
            {(id) => (
              <Select id={id} value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}>
                {PERSON_LIFECYCLES.map((l) => <option key={l} value={l}>{lifecycleLabel(l)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Mugshot URL" className="sm:col-span-2">
            {(id) => <Input id={id} value={mugshot} onChange={(e) => setMugshot(e.target.value)} />}
          </Field>

          <GroupLabel>Structured identity</GroupLabel>
          <Field label="Known aliases" hint="One per line.">
            {(id) => <Textarea id={id} rows={3} value={idAliases} onChange={(e) => setIdAliases(e.target.value)} />}
          </Field>
          <Field label="Street names" hint="One per line.">
            {(id) => <Textarea id={id} rows={3} value={idStreet} onChange={(e) => setIdStreet(e.target.value)} />}
          </Field>
          <Field label="License / ID numbers" hint="One per line." className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={2} value={idLicenses} onChange={(e) => setIdLicenses(e.target.value)} />}
          </Field>

          <GroupLabel>Criminal profile</GroupLabel>
          <Field label="CCW">
            {(id) => (
              <Select id={id} value={ccw ? 'true' : 'false'} onChange={(e) => setCcw(e.target.value === 'true')}>
                <option value="false">No</option><option value="true">Yes</option>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VCH">{(id) => <Input id={id} type="number" value={vch} onChange={(e) => setVch(e.target.value)} />}</Field>
            <Field label="Felonies">{(id) => <Input id={id} type="number" value={felonies} onChange={(e) => setFelonies(e.target.value)} />}</Field>
          </div>
          <Field label="Notes" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>

          <GroupLabel>Review</GroupLabel>
          <Field label="Next review date">
            {(id) => <Input id={id} type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />}
          </Field>
          <Field label="Lead detective">
            {(id) => (
              <Select id={id} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">— unassigned —</option>
                {!leadKnown && <option value={leadId}>{officerName(leadId) || '(current lead)'}</option>}
                {detectives.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </Select>
            )}
          </Field>

          <GroupLabel>BOLO</GroupLabel>
          <Field label="Active BOLO" className={bolo ? undefined : 'sm:col-span-2'}>
            {(id) => (
              <Select id={id} value={bolo ? 'true' : 'false'} onChange={(e) => setBolo(e.target.value === 'true')}>
                <option value="false">No</option><option value="true">Yes — be on the lookout</option>
              </Select>
            )}
          </Field>
          {bolo && (
            <>
              <Field label="Risk level">
                {(id) => (
                  <Select id={id} value={boloRisk} onChange={(e) => setBoloRisk(e.target.value)}>
                    <option value="">— unset —</option>
                    {PERSON_PRIORITIES.map((r) => <option key={r} value={r}>{priorityLabel(r)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Reason" className="sm:col-span-2">
                {(id) => <Input id={id} value={boloReason} onChange={(e) => setBoloReason(e.target.value)} placeholder="Why officers should be on the lookout" />}
              </Field>
              <Field label="Approach instructions">
                {(id) => <Input id={id} value={boloInstructions} onChange={(e) => setBoloInstructions(e.target.value)} placeholder="e.g. do not approach alone" />}
              </Field>
              <Field label="Expires">
                {(id) => <Input id={id} type="date" value={boloExpires} onChange={(e) => setBoloExpires(e.target.value)} />}
              </Field>
            </>
          )}

          <GroupLabel>Known properties</GroupLabel>
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-end">
              <button type="button" onClick={() => setProps((r) => [...r, { address: '', type: 'Residence', notes: '' }])} className="text-xs font-semibold text-blue-300 transition hover:text-blue-200">+ Add property</button>
            </div>
            <div className="space-y-2">
              {props.map((pr, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2">
                  <input value={pr.address} onChange={(e) => setProp(i, { address: e.target.value })} placeholder="Address / location" aria-label={`Property ${i + 1} address`} className="min-w-[10rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" />
                  <select value={pr.type} onChange={(e) => setProp(i, { type: e.target.value })} aria-label={`Property ${i + 1} type`} className="rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500">
                    {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input value={pr.notes} onChange={(e) => setProp(i, { notes: e.target.value })} placeholder="Notes (optional)" aria-label={`Property ${i + 1} notes`} className="min-w-[8rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" />
                  <button type="button" aria-label="Remove property" onClick={() => setProps((r) => r.filter((_, x) => x !== i))} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" className="flex-1" onAction={save}>
            {record ? 'Save changes' : 'Create person'}
          </Button>
          {record && canDelete && (
            <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
