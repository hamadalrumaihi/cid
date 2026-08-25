'use client'

/** New/Edit person modal — vanilla persons.js openPersonModal(), extended for
 *  the intelligence schema (20260729010000): identity fields (phone/dob/
 *  classification/confidence/priority/lifecycle), the structured identity
 *  jsonb (aliases / street names / license ids as one-per-line inputs),
 *  review scheduling (next review + lead detective), and the structured BOLO
 *  block (reason/risk/instructions/expiry; issued_by/at stamped when the flag
 *  is newly raised). Legacy fields — status text, CCW/VCH/felonies, notes,
 *  and the repeatable Known Properties rows — are preserved verbatim, as is
 *  the gang-preservation guard, now picker-shaped: the current gang_id/lead id
 *  is seeded synchronously under a placeholder label, upgraded by one bounded
 *  in:{id} lookup, and never nulled by a slow or failed read.
 *  Mounted fresh per open. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Json, Tables, TablesInsert } from '@/lib/database.types'
import { deleteWithUndo, insert, list, rpc, update } from '@/lib/db'
import { clearDraft, loadDraft, saveDraft, useDraftState } from '@/lib/userDrafts'
import { useAuth } from '@/lib/auth'
import { searchGangHits, searchMemberHits, type EntityHit } from '@/lib/entitySearch'
import { useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { useSiu } from '@/lib/useSiu'
import { reserveVisibility, restrictPreview } from '@/lib/siuVisibility'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { HelpTip } from '@/components/ui/HelpTip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SaveState } from '@/components/ui/SaveState'
import { DuplicateMatchNotice, type DuplicateMatch } from '@/components/shared/DuplicateMatches'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
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

/** Advisory row state for the lead-detective picker — inactive/LOA officers
 *  stay visible but badged and unselectable (searchMemberHits meta flags; the
 *  gangModals idiom). */
const memberDisabled = (h: EntityHit): string | null =>
  h.meta?.active === 'false' ? 'Inactive' : h.meta?.loa === 'true' ? 'On LOA' : null

/** Everything the CREATE form types — stashed under `person:new` (userDrafts:
 *  per-user local mirror + DB row) so a refresh mid-entry loses nothing.
 *  Create mode only, by contract: an edit's source of truth is the row, and
 *  restoring a stale stash over it would silently revert other detectives'
 *  work. Key order must match the draftJson literal below (JSON equality). */
interface PersonDraftShape {
  name: string; alias: string; phone: string; dob: string; gangId: string
  status: string; classification: string; confidence: string; priority: string
  lifecycle: string; mugshot: string; idAliases: string; idStreet: string
  idLicenses: string; ccw: boolean; vch: string; felonies: string; notes: string
  nextReview: string; leadId: string; bolo: boolean; boloReason: string
  boloRisk: string; boloInstructions: string; boloExpires: string
  props: PersonProperty[]
}

const PERSON_DRAFT_KEY = 'person:new'

const EMPTY_PERSON_DRAFT: PersonDraftShape = {
  name: '', alias: '', phone: '', dob: '', gangId: '',
  status: 'Person of Interest', classification: '', confidence: '', priority: '',
  lifecycle: 'active', mugshot: '', idAliases: '', idStreet: '',
  idLicenses: '', ccw: false, vch: '0', felonies: '0', notes: '',
  nextReview: '', leadId: '', bolo: false, boloReason: '',
  boloRisk: '', boloInstructions: '', boloExpires: '',
  props: [],
}
const EMPTY_PERSON_DRAFT_JSON = JSON.stringify(EMPTY_PERSON_DRAFT)

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
  /** Create mode only: called with the inserted row (before onSaved) so the
   *  opener can chain — e.g. auto-linking the new person to a case. */
  onCreated?: (row: PersonRow, opts: { siuOnly: boolean }) => void
  onClose: () => void
  onSaved: () => void
}

export function PersonModal({ record, prefillName, onCreated, onClose, onSaved }: PersonModalProps) {
  const { profile, canDelete } = useAuth()
  const siu = useSiu()
  // A new record created by somebody with SIU standing needs a deliberate
  // visibility choice -- SIU Only by default, because an SIU-created record
  // must never appear in CID by accident. Null for everybody else, and for
  // every edit: this is a decision made once, at creation.
  const offerVisibility = !record && siu.canAccess
  const [siuChoice, setSiuChoice] =
    useState<'siu_only' | 'cid' | null>(offerVisibility ? 'siu_only' : null)
  // Identity
  const [name, setName] = useState(record?.name || prefillName || '')
  const [alias, setAlias] = useState(record?.alias || '')
  const [phone, setPhone] = useState(record?.phone || '')
  const [dob, setDob] = useState(record?.dob?.slice(0, 10) || '')
  const [gangId, setGangId] = useState(record?.gang_id || '')
  // Resolved gang name for the picker's collapsed row; null = not yet resolved
  // (a bounded in:{id} lookup below upgrades the placeholder).
  const [gangLabel, setGangLabel] = useState<string | null>(null)
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

  // ── Draft protection (create mode only) ──────────────────────────────────
  // Not for the quick-add prefill either: that flow is a deliberate one-shot
  // and must neither restore an unrelated stash nor overwrite one.
  const draftable = !record && !prefillName
  const draftState = useDraftState(draftable ? PERSON_DRAFT_KEY : '')
  const [draftBanner, setDraftBanner] = useState(false)
  const applyDraft = useCallback((s: PersonDraftShape) => {
    setName(s.name); setAlias(s.alias); setPhone(s.phone); setDob(s.dob)
    setGangId(s.gangId); setGangLabel(null) // restored id → re-resolve its label
    setStatus(s.status); setClassification(s.classification); setConfidence(s.confidence)
    setPriority(s.priority); setLifecycle(s.lifecycle); setMugshot(s.mugshot)
    setIdAliases(s.idAliases); setIdStreet(s.idStreet); setIdLicenses(s.idLicenses)
    setCcw(s.ccw); setVch(s.vch); setFelonies(s.felonies); setNotes(s.notes)
    setNextReview(s.nextReview); setLeadId(s.leadId); setBolo(s.bolo)
    setBoloReason(s.boloReason); setBoloRisk(s.boloRisk); setBoloInstructions(s.boloInstructions)
    setBoloExpires(s.boloExpires); setProps(Array.isArray(s.props) ? s.props : [])
  }, [])
  const draftJson = JSON.stringify({
    name, alias, phone, dob, gangId,
    status, classification, confidence, priority,
    lifecycle, mugshot, idAliases, idStreet,
    idLicenses, ccw, vch, felonies, notes,
    nextReview, leadId, bolo, boloReason,
    boloRisk, boloInstructions, boloExpires,
    props,
  } satisfies PersonDraftShape)
  const draftJsonRef = useRef(draftJson)
  useEffect(() => { draftJsonRef.current = draftJson })
  // Restore once on mount — never over something already typed.
  useEffect(() => {
    if (!draftable) return
    let live = true
    void loadDraft<PersonDraftShape>(PERSON_DRAFT_KEY).then((d) => {
      if (!live || !d?.data || draftJsonRef.current !== EMPTY_PERSON_DRAFT_JSON) return
      applyDraft({ ...EMPTY_PERSON_DRAFT, ...d.data })
      setDraftBanner(true)
    })
    return () => { live = false }
  }, [draftable, applyDraft])
  // Autosave while there is content; clear (once) when typed back to empty so
  // an emptied form doesn't keep re-restoring. Drafts only — nothing here
  // touches the persons table.
  const wroteDraft = useRef(false)
  useEffect(() => {
    if (!draftable) return
    if (draftJson === EMPTY_PERSON_DRAFT_JSON) {
      if (wroteDraft.current) { wroteDraft.current = false; void clearDraft(PERSON_DRAFT_KEY) }
      return
    }
    wroteDraft.current = true
    void saveDraft(PERSON_DRAFT_KEY, JSON.parse(draftJson) as PersonDraftShape)
  }, [draftable, draftJson])
  const discardDraft = () => {
    wroteDraft.current = false
    void clearDraft(PERSON_DRAFT_KEY)
    applyDraft(EMPTY_PERSON_DRAFT)
    setDraftBanner(false)
  }

  // ── Picker values (FK-preservation guard, picker-shaped) ────────────────
  // The string ids stay the form state (draft shape unchanged); the pickers
  // render a derived hit. An id whose label hasn't resolved keeps a
  // placeholder — the FK itself is never dropped by a slow or failed read.
  const gangValue = useMemo<EntityHit | null>(
    () => (gangId ? { id: gangId, label: gangLabel ?? '(current gang — loading…)' } : null),
    [gangId, gangLabel])
  useEffect(() => {
    if (!gangId || gangLabel !== null) return
    let live = true
    void list('gangs', { select: 'id,name', in: { id: [gangId] } })
      .then((r) => {
        const n = (r as unknown as { id: string; name: string }[])[0]?.name
        if (live && n) setGangLabel(n)
      })
      .catch(() => { /* keep the placeholder — the id is preserved */ })
    return () => { live = false }
  }, [gangId, gangLabel])

  // Lead-detective picker runs on the shared roster cache (searchMemberHits)
  // — warm it once; the label below re-resolves when it lands.
  const rosterProfiles = useProfilesStore((s) => s.profiles)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (!rosterLoaded) void useProfilesStore.getState().fetch() }, [rosterLoaded])
  const leadValue = useMemo<EntityHit | null>(() => {
    if (!leadId) return null
    const p = rosterProfiles.find((x) => x.id === leadId)
    return { id: leadId, label: p?.display_name || '(current lead)', thumbUrl: p?.avatar_url ?? null }
  }, [leadId, rosterProfiles])

  // Duplicate hint at create time — debounced name search through the indexed,
  // RLS-safe `search_persons` RPC (the LinkAssociateModal pattern). Purely
  // advisory: it never blocks Save; the merge flow handles real duplicates.
  const [dupes, setDupes] = useState<DuplicateMatch[]>([])
  useEffect(() => {
    if (record) return // edit mode — the record IS the existing one
    const q = name.trim()
    let live = true
    const t = window.setTimeout(async () => {
      if (q.length < 2) { if (live) setDupes([]); return }
      const res = await rpc('search_persons', { p_q: q, p_limit: 5 })
      const hits = (res.data ?? []).map((h) => h.id)
      if (!hits.length) { if (live) setDupes([]); return }
      const rows = await list('persons', { select: 'id,name,alias,lifecycle', in: { id: hits } })
        .then((r) => r as unknown as Pick<PersonRow, 'id' | 'name' | 'alias' | 'lifecycle'>[])
        .catch(() => [] as Pick<PersonRow, 'id' | 'name' | 'alias' | 'lifecycle'>[])
      if (!live) return
      setDupes(rows
        .filter((r) => r.lifecycle !== 'merged')
        .slice(0, 3)
        .map((r) => ({ type: 'person', id: r.id, label: r.name || 'Person', sublabel: r.alias ? `“${r.alias}”` : undefined })))
    }, 400)
    return () => { live = false; window.clearTimeout(t) }
  }, [name, record])

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
    if (!record && siuChoice) {
      // The ledger row is written FIRST, against an id we choose here, so a
      // record created SIU Only is never visible to CID -- not even for the
      // moment between the insert landing and a restriction being applied.
      // siu_visibility.entity_id deliberately carries no foreign key, which is
      // what makes writing it ahead of the record possible.
      const newId = crypto.randomUUID()
      if (siuChoice === 'siu_only') {
        try {
          await reserveVisibility('person', newId, 'siu_only',
            'Created in the SIB workspace as SIB Only.')
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), 'danger')
          return
        }
      }
      payload.id = newId
    }
    const res = record ? await update('persons', record.id, payload) : await insert('persons', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    if (draftable) { wroteDraft.current = false; void clearDraft(PERSON_DRAFT_KEY) }
    const created = !record ? res.data?.[0] : undefined
    if (created && onCreated) onCreated(created, { siuOnly: siuChoice === 'siu_only' })
    toast(record ? 'Person updated'
      : siuChoice === 'siu_only' ? 'Person created, SIB Only. CID cannot see it.'
      : 'Person created', 'success')
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
        <ModalHeader
          title={record ? 'Edit Person' : (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              New Person
              {draftable && <SaveState status={draftState.status} lastSavedAt={draftState.lastSavedAt} />}
            </span>
          )}
          onClose={onClose}
        />
        {draftBanner && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-amber-200">Draft restored — your unsaved entry from last time.</p>
            <span className="flex items-center gap-1">
              <button type="button" onClick={discardDraft} className="rounded-md px-2 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 hover:text-white">Discard draft</button>
              <button type="button" onClick={() => setDraftBanner(false)} aria-label="Dismiss restored-draft notice" className="grid h-8 w-8 place-items-center rounded-md text-amber-200/70 hover:bg-amber-500/10 hover:text-white">✕</button>
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            {(id) => (
              <>
                <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />
                {!record && <DuplicateMatchNotice matches={dupes} />}
              </>
            )}
          </Field>
          <Field label="Alias">{(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0100" />}</Field>
          <Field label="Date of birth">{(id) => <Input id={id} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />}</Field>
          <RecordSearchPicker<EntityHit>
            label="Gang"
            placeholder="Search gangs…"
            value={gangValue}
            onChange={(v) => { setGangId(v?.id ?? ''); setGangLabel(v?.label ?? null) }}
            search={searchGangHits}
            peekType="gang"
          />
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
          {offerVisibility && (
            <fieldset className="sm:col-span-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-violet-300">
                Who can see this record
                {/* Canonical compartment sentence (lib/siuVisibility) — the
                    same wording the restrict confirmation uses. */}
                <HelpTip label="About who can see this record" guide="siu">
                  <p>Decided once, at creation. If you pick <span className="font-semibold text-white">SIB Only</span>: {restrictPreview()}</p>
                </HelpTip>
              </legend>
              <div className="mt-1 space-y-1.5">
                {([
                  ['siu_only', 'SIB Only',
                   'Recommended. CID cannot see it at all — not in search, the graph, counts or exports.'],
                  ['cid', 'Shared with CID',
                   'An ordinary registry record, visible to every active investigator.'],
                ] as const).map(([v, label, hint]) => (
                  <label key={v} className="flex cursor-pointer gap-2.5">
                    <input
                      type="radio"
                      name="siu-visibility"
                      checked={siuChoice === v}
                      onChange={() => setSiuChoice(v)}
                      className="mt-0.5 accent-violet-400"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-white">{label}</span>
                      <span className="block text-xs text-slate-400">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Field label="Notes" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>

          <GroupLabel>Review</GroupLabel>
          <Field label="Next review date">
            {(id) => <Input id={id} type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />}
          </Field>
          <RecordSearchPicker<EntityHit>
            label="Lead detective"
            placeholder="Search name, badge or bureau…"
            value={leadValue}
            onChange={(v) => setLeadId(v?.id ?? '')}
            search={async (q) => searchMemberHits(q)}
            getThumb={(h) => h.thumbUrl}
            getDisabled={memberDisabled}
          />

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
