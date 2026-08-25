'use client'

/** Submit Field Intelligence.
 *
 *  ── Progressive disclosure ─────────────────────────────────────────────────
 *  One long form asking every officer about gang colours, package counts and
 *  registered owners would be abandoned halfway. So the form starts as four
 *  questions — what, when, where, and your report number — and the detailed
 *  fields for a person, vehicle, organization, location or seizure appear only
 *  when the officer says there is one. An officer who saw a car and nothing
 *  else fills in a plate and sends it.
 *
 *  ── Nothing here is required except a summary ─────────────────────────────
 *  Patrol reports what they actually know. A vehicle with no plate, a person
 *  with no name, a stash house with no postal — each is still worth having, and
 *  demanding the rest would either lose the report or invite invention. The
 *  database agrees: `summary` is the only thing a submitted report must have.
 *
 *  ── Drafts ─────────────────────────────────────────────────────────────────
 *  The draft row is created the moment the form opens, so a part added before
 *  the first save has a parent to attach to and a refresh cannot lose it.
 *  Edits autosave a second after typing stops. A draft carries no FI number —
 *  numbers are issued at submit.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import {
  AUTHORABLE_SOURCES, BASIS, BASIS_LABEL, ITEM_CATEGORIES, JURISDICTIONS,
  JURISDICTION_LABEL, SOURCE_LABEL,
  ITEM_CATEGORY_LABEL, LOCATION_KINDS, LOCATION_KIND_LABEL, ORG_ROLES,
  ORG_ROLE_LABEL, ORG_TYPES, ORG_TYPE_LABEL, TIME_PRECISION, TIME_PRECISION_LABEL,
  WEIGHT_UNITS, addPart, createDraft, discardDraft, loadSubmissionParts,
  normalizedGrams, removePart, saveDraft, submitDraft, submitProblem, weightProblem,
  type SubmissionParts,
} from '@/lib/fieldSubmissions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EvidencePanel } from './EvidencePanel'

interface Draft {
  summary: string
  details: string
  observed_precision: string
  observed_at: string
  observed_to: string
  mdt_reference: string
  jurisdiction: string
  source_type: string
}

const EMPTY: Draft = {
  summary: '', details: '', observed_precision: 'unknown',
  observed_at: '', observed_to: '', mdt_reference: '', jurisdiction: '',
  source_type: 'detective',
}

const NO_PARTS: SubmissionParts = { persons: [], vehicles: [], orgs: [], locations: [], items: [] }

/** A datetime-local value -> an ISO string the database will accept, or null. */
const iso = (v: string): string | null => (v ? new Date(v).toISOString() : null)

/** The structured intelligence form.
 *
 *  One form for both authors. A patrol officer reaches it from their portal; an
 *  investigator reaches it from the Intelligence workspace through "New
 *  intelligence". They produce the same kind of record, which is the entire
 *  point of there being one Intelligence entity: the difference between them is
 *  who is recorded as the author and where the information came from, and the
 *  database decides both.
 *
 *  `asInvestigator` only adds the source picker. A patrol officer is not shown
 *  it because their record is a patrol record by definition -- the database
 *  stamps it whatever the client sends. */
export function FieldSubmitForm({ onDone, asInvestigator = false }: {
  onDone: () => void
  asInvestigator?: boolean
}) {
  const [id, setId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [parts, setParts] = useState<SubmissionParts>(NO_PARTS)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const dirty = useRef(false)

  // The draft row exists before the officer types anything, so every "+ Add"
  // has a parent to hang off and nothing is held only in browser memory.
  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        const { id: newId, error } = await createDraft()
        if (cancelled) return
        if (error || !newId) { toast(error || 'Could not start a report.', 'danger'); return }
        setId(newId)
      })()
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [])

  const refreshParts = useCallback(async (sid: string) => {
    const p = await loadSubmissionParts(sid)
    setParts(p)
  }, [])

  // Autosave a second after typing stops. A patrol officer should not have to
  // remember to save, and a closed tab should not cost them the report.
  useEffect(() => {
    if (!id || !dirty.current) return
    const t = window.setTimeout(() => {
      void (async () => {
        setSaving('saving')
        const err = await saveDraft(id, {
          summary: draft.summary || null,
          details: draft.details || null,
          observed_precision: draft.observed_precision,
          observed_at: iso(draft.observed_at),
          observed_to: draft.observed_precision === 'range' ? iso(draft.observed_to) : null,
          mdt_reference: draft.mdt_reference || null,
          jurisdiction: draft.jurisdiction || null,
          // Ignored by the database for a patrol officer, whose record is a
          // patrol record however the client asks.
          source_type: draft.source_type,
        })
        dirty.current = false
        setSaving(err ? 'idle' : 'saved')
        if (err) toast(err, 'danger')
      })()
    }, 1000)
    return () => window.clearTimeout(t)
  }, [id, draft])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    dirty.current = true
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const send = async () => {
    if (!id) return
    const problem = submitProblem({
      summary: draft.summary,
      observed_precision: draft.observed_precision,
      observed_at: iso(draft.observed_at),
      observed_to: draft.observed_precision === 'range' ? iso(draft.observed_to) : null,
      jurisdiction: draft.jurisdiction || null,
    })
    if (problem) { toast(problem, 'warn'); return }
    setSending(true)
    // Flush anything still pending before the row becomes read-only.
    const saveErr = await saveDraft(id, {
      summary: draft.summary, details: draft.details || null,
      observed_precision: draft.observed_precision,
      observed_at: iso(draft.observed_at),
      observed_to: draft.observed_precision === 'range' ? iso(draft.observed_to) : null,
      mdt_reference: draft.mdt_reference || null, jurisdiction: draft.jurisdiction || null,
    })
    if (saveErr) { setSending(false); toast(saveErr, 'danger'); return }
    const err = await submitDraft(id)
    setSending(false)
    if (err) { toast(err, 'danger'); return }
    toast('Sent to CID/SIB. You can follow it under My Reports.', 'success')
    onDone()
  }

  const discard = async () => {
    if (!id) { onDone(); return }
    const err = await discardDraft(id)
    if (err) { toast(err, 'danger'); return }
    onDone()
  }

  const add = async (
    table: Parameters<typeof addPart>[0], row: Record<string, unknown>,
  ) => {
    if (!id) return
    const err = await addPart(table, { submission_id: id, ...row } as never)
    if (err) { toast(err, 'danger'); return }
    setOpen(null)
    await refreshParts(id)
  }

  const drop = async (table: Parameters<typeof removePart>[0], partId: string) => {
    if (!id) return
    const err = await removePart(table, partId)
    if (err) { toast(err, 'danger'); return }
    await refreshParts(id)
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-white">Submit field intelligence</h2>
          <span className="text-xs text-slate-500">
            {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Draft saved' : 'Draft'}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {asInvestigator && (
            <Field label="Where did this come from?"
              hint="What kind of information this is. Frozen once the record is sent.">
              {(fid) => (
                <Select id={fid} value={draft.source_type}
                  onChange={(e) => set('source_type', e.target.value)}>
                  {AUTHORABLE_SOURCES.map((v) => (
                    <option key={v} value={v}>{SOURCE_LABEL[v]}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="What happened?" hint="One or two lines is fine. This is the only thing required.">
            {(fid) => (
              <Textarea id={fid} rows={3} value={draft.summary}
                onChange={(e) => set('summary', e.target.value)}
                placeholder="Saw three males in Drenger Blade colours loading crates into a van behind the warehouse." />
            )}
          </Field>
          <Field label="Anything else worth knowing?" hint="Optional.">
            {(fid) => (
              <Textarea id={fid} rows={2} value={draft.details}
                onChange={(e) => set('details', e.target.value)} />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When?">
              {(fid) => (
                <Select id={fid} value={draft.observed_precision}
                  onChange={(e) => set('observed_precision', e.target.value)}>
                  {TIME_PRECISION.map((p) => (
                    <option key={p} value={p}>{TIME_PRECISION_LABEL[p]}</option>
                  ))}
                </Select>
              )}
            </Field>
            {draft.observed_precision !== 'unknown' && (
              <Field label={draft.observed_precision === 'range' ? 'From' : 'Time'}>
                {(fid) => (
                  <Input id={fid} type="datetime-local" value={draft.observed_at}
                    onChange={(e) => set('observed_at', e.target.value)} />
                )}
              </Field>
            )}
            {draft.observed_precision === 'range' && (
              <Field label="To">
                {(fid) => (
                  <Input id={fid} type="datetime-local" value={draft.observed_to}
                    onChange={(e) => set('observed_to', e.target.value)} />
                )}
              </Field>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          What was involved?
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Add only what you actually saw. Missing details are normal — a car with no
          plate or a person with no name is still worth reporting.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {([
            ['person', '+ Person'], ['vehicle', '+ Vehicle'], ['org', '+ Gang / MC'],
            ['location', '+ Location'], ['item', '+ Item / Seizure'],
          ] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={open === k ? 'primary' : 'ghost'}
              onClick={() => setOpen(open === k ? null : k)}>{label}</Button>
          ))}
        </div>

        {open === 'person' && <PersonForm onAdd={(r) => void add('field_submission_persons', r)} />}
        {open === 'vehicle' && <VehicleForm onAdd={(r) => void add('field_submission_vehicles', r)} />}
        {open === 'org' && <OrgForm onAdd={(r) => void add('field_submission_orgs', r)} />}
        {open === 'location' && <LocationForm onAdd={(r) => void add('field_submission_locations', r)} />}
        {open === 'item' && <ItemForm onAdd={(r) => void add('field_submission_items', r)} />}

        <PartList parts={parts} onRemove={(t, pid) => void drop(t, pid)} />
      </Card>

      {id && <EvidencePanel submissionId={id} />}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your report / MDT number" hint="Optional. A reference to your own paperwork — it does not become a CID case number.">
            {(fid) => (
              <Input id={fid} value={draft.mdt_reference}
                onChange={(e) => set('mdt_reference', e.target.value)} placeholder="26-12345" />
            )}
          </Field>
          <Field label="Where did this happen?" hint="Required. This decides which detectives see it — not your agency, since SAHP works both.">
            {(fid) => (
              <Select id={fid} value={draft.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)}>
                <option value="">Choose…</option>
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{JURISDICTION_LABEL[j]}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void send()} disabled={sending || !id}>
            {sending ? 'Sending…' : 'Send to CID / SIB'}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={sending}>Finish later</Button>
          <Button variant="ghost" onClick={() => void discard()} disabled={sending}>Discard</Button>
          <span className="text-xs text-slate-500">
            Once sent, a report cannot be edited — it is the record of what you reported.
          </span>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The detail forms. Each collects one claim and hands it up; none of them keeps
// state beyond its own fields, so opening and closing one is free.
// ---------------------------------------------------------------------------

function BasisField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="How do you know?" hint="Seeing it yourself and being told are different, and neither means confirmed.">
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {BASIS.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
        </Select>
      )}
    </Field>
  )
}

const PANEL = 'mt-3 grid gap-3 rounded-xl border border-white/10 bg-ink-950/40 p-3 sm:grid-cols-2'

function PersonForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ full_name: '', alias: '', description: '', phone: '', org_name: '', org_role: '', reason: '', basis: 'observed' })
  return (
    <div className={PANEL}>
      <Field label="Name (if known)">{(id) => <Input id={id} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />}</Field>
      <Field label="Alias / street name">{(id) => <Input id={id} value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} />}</Field>
      <Field label="Description" hint="Use this when you do not have a name.">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <Field label="Phone">{(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      <Field label="Gang / MC / crew">{(id) => <Input id={id} value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} />}</Field>
      <Field label="Their role there">
        {(id) => (
          <Select id={id} value={f.org_role} onChange={(e) => setF({ ...f, org_role: e.target.value })}>
            <option value="">Not stated</option>
            {ORG_ROLES.map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Why are they relevant?">{(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      <BasisField value={f.basis} onChange={(v) => setF({ ...f, basis: v })} />
      <div className="sm:col-span-2">
        <Button size="sm" variant="primary" onClick={() => onAdd({ ...f, org_role: f.org_role || null })}>Add person</Button>
      </div>
    </div>
  )
}

function VehicleForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ plate: '', make: '', model: '', color: '', secondary_color: '', description: '', registered_owner: '', occupants: '', org_name: '', reason: '', basis: 'observed' })
  return (
    <div className={PANEL}>
      <Field label="Plate" hint="Leave blank if you did not get it.">{(id) => <Input id={id} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} />}</Field>
      <Field label="Model">{(id) => <Input id={id} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />}</Field>
      <Field label="Make">{(id) => <Input id={id} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} />}</Field>
      <Field label="Colour">{(id) => <Input id={id} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />}</Field>
      <Field label="Second colour">{(id) => <Input id={id} value={f.secondary_color} onChange={(e) => setF({ ...f, secondary_color: e.target.value })} />}</Field>
      <Field label="Occupants">{(id) => <Input id={id} value={f.occupants} onChange={(e) => setF({ ...f, occupants: e.target.value })} />}</Field>
      <Field label="Gang / MC association">{(id) => <Input id={id} value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} />}</Field>
      <Field label="Why is it relevant?">{(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      <BasisField value={f.basis} onChange={(v) => setF({ ...f, basis: v })} />
      <div className="sm:col-span-2">
        <Button size="sm" variant="primary" onClick={() => onAdd(f)}>Add vehicle</Button>
      </div>
    </div>
  )
}

function OrgForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ name: '', org_type: 'unknown', colors: '', symbols: '', clothing: '', territory: '', leadership: '', members: '', basis: 'observed' })
  return (
    <div className={PANEL}>
      <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label="Type">
        {(id) => (
          <Select id={id} value={f.org_type} onChange={(e) => setF({ ...f, org_type: e.target.value })}>
            {ORG_TYPES.map((t) => <option key={t} value={t}>{ORG_TYPE_LABEL[t]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Colours">{(id) => <Input id={id} value={f.colors} onChange={(e) => setF({ ...f, colors: e.target.value })} />}</Field>
      <Field label="Symbols / patches">{(id) => <Input id={id} value={f.symbols} onChange={(e) => setF({ ...f, symbols: e.target.value })} />}</Field>
      <Field label="Clothing">{(id) => <Input id={id} value={f.clothing} onChange={(e) => setF({ ...f, clothing: e.target.value })} />}</Field>
      <Field label="Territory / hangouts">{(id) => <Input id={id} value={f.territory} onChange={(e) => setF({ ...f, territory: e.target.value })} />}</Field>
      <Field label="Leadership">{(id) => <Input id={id} value={f.leadership} onChange={(e) => setF({ ...f, leadership: e.target.value })} />}</Field>
      <Field label="Members / associates seen">{(id) => <Input id={id} value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} />}</Field>
      <BasisField value={f.basis} onChange={(v) => setF({ ...f, basis: v })} />
      <div className="sm:col-span-2">
        <Button size="sm" variant="primary" onClick={() => onAdd(f)}>Add organization</Button>
      </div>
    </div>
  )
}

function LocationForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ kind: 'general_area', postal: '', street: '', description: '', org_name: '', observed_what: '', basis: 'observed' })
  return (
    <div className={PANEL}>
      <Field label="What kind of place?">
        {(id) => (
          <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {LOCATION_KINDS.map((k) => <option key={k} value={k}>{LOCATION_KIND_LABEL[k]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Postal">{(id) => <Input id={id} value={f.postal} onChange={(e) => setF({ ...f, postal: e.target.value })} />}</Field>
      <Field label="Street / area">{(id) => <Input id={id} value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} />}</Field>
      <Field label="Property description">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <Field label="Associated gang / MC">{(id) => <Input id={id} value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} />}</Field>
      <Field label="What did you see there?">{(id) => <Input id={id} value={f.observed_what} onChange={(e) => setF({ ...f, observed_what: e.target.value })} />}</Field>
      <BasisField value={f.basis} onChange={(v) => setF({ ...f, basis: v })} />
      <div className="sm:col-span-2">
        <Button size="sm" variant="primary" onClick={() => onAdd(f)}>Add location</Button>
      </div>
    </div>
  )
}

function ItemForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    category: 'narcotics', description: '', quantity: '', weight_value: '', weight_unit: '',
    suspected_substance: '', packaging: '', package_count: '',
    seized_from_person: '', seized_from_vehicle: '', seized_from_location: '', basis: 'observed',
  })
  const wv = f.weight_value ? Number(f.weight_value) : null
  const grams = normalizedGrams(wv, f.weight_unit || null)
  // A number with no unit is not a measurement. Catching it here means the
  // officer gets a sentence rather than the check constraint's raw complaint.
  const weightIssue = weightProblem(wv, f.weight_unit || null)

  return (
    <div className={PANEL}>
      <Field label="What is it?">
        {(id) => (
          <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABEL[c]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Description">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <Field label="Quantity">{(id) => <Input id={id} type="number" min="0" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />}</Field>
      <Field label="Weight" hint={grams != null ? `Recorded as ${grams.toFixed(2)} g — your figure is kept as entered.` : 'A number needs a unit.'}>
        {(id) => (
          <div className="flex gap-2">
            <Input id={id} type="number" min="0" step="any" value={f.weight_value}
              onChange={(e) => setF({ ...f, weight_value: e.target.value })} />
            <Select value={f.weight_unit} onChange={(e) => setF({ ...f, weight_unit: e.target.value })} className="w-24">
              <option value="">Unit</option>
              {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        )}
      </Field>
      {f.category === 'narcotics' && <>
        <Field label="Suspected substance" hint="Suspected, not confirmed.">{(id) => <Input id={id} value={f.suspected_substance} onChange={(e) => setF({ ...f, suspected_substance: e.target.value })} />}</Field>
        <Field label="Packaging">{(id) => <Input id={id} value={f.packaging} onChange={(e) => setF({ ...f, packaging: e.target.value })} />}</Field>
        <Field label="Number of packages">{(id) => <Input id={id} type="number" min="0" value={f.package_count} onChange={(e) => setF({ ...f, package_count: e.target.value })} />}</Field>
      </>}
      <Field label="Taken from (person)">{(id) => <Input id={id} value={f.seized_from_person} onChange={(e) => setF({ ...f, seized_from_person: e.target.value })} />}</Field>
      <Field label="Taken from (vehicle)">{(id) => <Input id={id} value={f.seized_from_vehicle} onChange={(e) => setF({ ...f, seized_from_vehicle: e.target.value })} />}</Field>
      <Field label="Taken from (location)">{(id) => <Input id={id} value={f.seized_from_location} onChange={(e) => setF({ ...f, seized_from_location: e.target.value })} />}</Field>
      <BasisField value={f.basis} onChange={(v) => setF({ ...f, basis: v })} />
      <div className="sm:col-span-2">
        {weightIssue && <p className="mb-2 text-xs text-amber-300">{weightIssue}</p>}
        <Button size="sm" variant="primary" disabled={!!weightIssue} onClick={() => onAdd({
          category: f.category, description: f.description || null,
          quantity: f.quantity ? Number(f.quantity) : null,
          weight_value: wv, weight_unit: f.weight_unit || null,
          suspected_substance: f.suspected_substance || null,
          packaging: f.packaging || null,
          package_count: f.package_count ? Number(f.package_count) : null,
          seized_from_person: f.seized_from_person || null,
          seized_from_vehicle: f.seized_from_vehicle || null,
          seized_from_location: f.seized_from_location || null,
          basis: f.basis,
        })}>Add item</Button>
      </div>
    </div>
  )
}

/** Everything added so far, so the officer can see the report taking shape and
 *  take a part back out before sending. */
function PartList({ parts, onRemove }: {
  parts: SubmissionParts
  onRemove: (t: Parameters<typeof removePart>[0], id: string) => void
}) {
  const rows: Array<{ table: Parameters<typeof removePart>[0]; id: string; label: string }> = [
    ...parts.persons.map((p) => ({ table: 'field_submission_persons' as const, id: p.id, label: `Person — ${[p.full_name, p.alias, p.description].filter(Boolean).join(' / ') || 'unidentified'}` })),
    ...parts.vehicles.map((v) => ({ table: 'field_submission_vehicles' as const, id: v.id, label: `Vehicle — ${[v.plate, v.color, v.model].filter(Boolean).join(' ') || 'no details'}` })),
    ...parts.orgs.map((o) => ({ table: 'field_submission_orgs' as const, id: o.id, label: `Organization — ${o.name || ORG_TYPE_LABEL[o.org_type]}` })),
    ...parts.locations.map((l) => ({ table: 'field_submission_locations' as const, id: l.id, label: `${LOCATION_KIND_LABEL[l.kind]} — ${[l.postal, l.street].filter(Boolean).join(' ') || 'no address'}` })),
    ...parts.items.map((i) => ({ table: 'field_submission_items' as const, id: i.id, label: `${ITEM_CATEGORY_LABEL[i.category]} — ${[i.suspected_substance, i.description, i.weight_value ? `${i.weight_value}${i.weight_unit}` : ''].filter(Boolean).join(' ') || 'no details'}` })),
  ]
  if (!rows.length) return null
  return (
    <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-slate-200">{r.label}</span>
          <button onClick={() => onRemove(r.table, r.id)}
            className="shrink-0 text-xs font-semibold text-rose-300 hover:text-rose-200">Remove</button>
        </li>
      ))}
    </ul>
  )
}
