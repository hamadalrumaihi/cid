'use client'

/** Guided legal-request wizard — the investigator landing's creation path,
 *  replacing the long linear create form. Steps (contract §10):
 *  type cards → case & target → charges → type-specific details (+ structured
 *  search-warrant targets) → evidence → narrative & justification (standard of
 *  proof + probable-cause statement) → review & submit.
 *
 *  Backend behaviour is preserved exactly: creation is the create_legal_request
 *  definer RPC (verbatim args), draft edits stay on update_legal_draft,
 *  submission on submit_legal_request_to_cid (carrying p_change_summary on a
 *  returned-request resubmission — required from any returned_* state — and
 *  the explicit p_material_change declaration after a judge return), and
 *  structured targets ride the existing add_legal_exhibit flow with the new
 *  kinds + per-target p_rationale. Phase 4 adds the structured charges
 *  (legal_set_charges right after create and on every edit-mode save — P4-03),
 *  the packet exhibits from the case records plus "Add new evidence" (host
 *  upload → legal_add_evidence_and_exhibit, which creates the case media row
 *  AND the exhibit in one step — P4-08), and the warrant basis fields that
 *  live in form_data (P4-04). Validation is the pure legalWizardIssues model —
 *  the exact client mirror of the server checks; the server revalidates all
 *  of it. Case/person/target pickers are bounded server-backed searches
 *  (ilikeAny + limit 20) — RLS scopes every row; nothing here decides access.
 *
 *  EDIT mode ({ mode: 'edit' }) revises an existing draft/returned request —
 *  the dossier's own draft editor (RequestSection) remains the in-dossier
 *  entry path; this is the landing's guided alternative, the only place the
 *  charge set is edited, and the surface that captures the change summary on
 *  resubmission. */
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/auth'
import { ScaleIcon } from '@/components/shell/icons'
import type { Json, Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { loadCaseCharges, proposeCaseCharge, type CaseChargeRow } from '@/lib/caseCharges'
import { CASE_MEDIA_CATEGORIES } from '@/lib/caseMedia'
import { suggestEntities } from '@/lib/entity'
import { searchLegalRequestHits, searchPersonHits, searchPlaceHits, searchVehicleHits } from '@/lib/entitySearch'
import { fmConfigured } from '@/lib/fivemanage'
import { adoptLegacyDraft, clearDraft, saveDraft, type LoadedDraft } from '@/lib/userDrafts'
import { timeAgo } from '@/lib/format'
import {
  CLASSIFICATIONS, SOCIAL_PLATFORMS, STANDARDS_OF_PROOF, SUBPOENA_FIELDS, SUBPOENA_TYPES,
  WARRANT_FIELDS, WARRANT_TYPES, isEditableDraft,
  type LegalRequest, type SubpoenaType, type WarrantType,
} from '@/lib/justice'
import {
  CID_ROUTING_BUREAUS, LEGAL_WIZARD_STEPS, ROUTING_SOURCE_LABEL,
  STRUCTURED_TARGET_KINDS, STRUCTURED_TARGET_KIND_LABEL,
  appendSearchTargetLine, canSetResponsibleBureau, humanize, isRoutingBureau,
  legalWizardAdvisories, legalWizardDraftIssues, legalWizardIssues, resolveResponsibleBureau,
  structuredTargetLine, subtypeRequiresPerson, subtypeSupportsStructuredTargets,
  type LegalWizardInput, type RoutingBureau, type RoutingSource, type StructuredTargetKind,
} from '@/lib/legalWorkflow'
import { penalSearch } from '@/lib/penal'
import { bureauLabel, bureauShort } from '@/lib/roles'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import type { UploadedFile } from '@/lib/uppyFivemanage'
import { usePenalCode } from '@/lib/usePenalCode'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { RelatedGuidance } from '@/components/sops/RelatedGuidance'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { RelatedRecordPicker } from '@/components/shared/RelatedRecordPicker'
import { Row, exhibitSources, sanitizeStash, useCaseRecordsFor, type DraftShape } from '@/components/justice/dossier/dossierShared'
import { legalSubmitChecklist } from '@/components/justice/dossier/legalP4Shim'
import { fieldLabel, type RevisionItem } from '@/components/justice/dossier/RevisionChecklist'
import { readJsonRpc } from '@/components/justice/dossier/rpcJson'

/** The host-upload panel (Uppy) loads only when the Evidence step opens with
 *  a configured FiveManage key — the same seam MediaTab uses (P4-08 reuses
 *  its transit; persistence here is the legal_add_evidence_and_exhibit RPC). */
const MediaUploadPanel = dynamic(() => import('@/components/cases/tabs/MediaUploadPanel').then((m) => m.MediaUploadPanel), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-6">
      <Skeleton className="mx-auto h-9 w-56 rounded-lg" />
    </div>
  ),
})

export type LegalWizardEntry = { mode: 'create' } | { mode: 'edit'; requestId: string }

/* ── Plain-language type descriptions (fictional RP workflow, not legal advice) */
const WARRANT_DESC: Record<WarrantType, string> = {
  arrest_warrant: 'Ask a Judge to authorise taking a named suspect into custody. Requires a suspect from the Persons registry.',
  search_warrant: 'Ask a Judge to authorise searching people, vehicles, places or property. Targets can be typed registry records.',
}
const SUBPOENA_DESC: Record<SubpoenaType, string> = {
  testimony: 'Compel a person to appear and give testimony for the case.',
  document_production: 'Compel a person or business to hand over documents or records.',
  medical_records: 'Request patient records from a medical provider or facility.',
  financial_records: 'Request account or transaction records from a financial institution.',
  phone_records: 'Request call or subscriber records for a phone number.',
  surveillance_cctv: 'Request camera footage for a location and time window.',
  employment_records: 'Request personnel or payroll records from an employer.',
  housing_records: 'Request tenancy or property records for an address.',
  social_media_accounts: 'Request in-city platform account records (Birdy / InstaPic).',
  other: 'Any other records request — you describe the record type yourself.',
}
const SUBPOENA_GROUPS: { label: string; types: SubpoenaType[] }[] = [
  { label: 'People', types: ['testimony'] },
  { label: 'Records', types: ['document_production', 'medical_records', 'financial_records', 'phone_records', 'employment_records', 'housing_records'] },
  { label: 'Digital & surveillance', types: ['surveillance_cctv', 'social_media_accounts'] },
  { label: 'Other', types: ['other'] },
]
const subpoenaLabel = (t: SubpoenaType): string => SUBPOENA_TYPES.find(([v]) => v === t)?.[1] ?? humanize(t)

/* ── Local shapes ─────────────────────────────────────────────────────────── */
/** Responsible-bureau resolution snapshot (resolveResponsibleBureau). */
interface CaseRouting { bureau: RoutingBureau | null; source: RoutingSource | null }
/** Raw case fields the second-phase (division-lookup) resolution needs. */
interface CaseRoutingCtx {
  bureau: string
  originating_bureau: string | null
  lead_detective_id: string | null
  created_by: string | null
}
/** PickedRecord plus the optional mugshot for the picker's thumb rows. It is
 *  never stashed (asPick strips it) — a restored pick just falls back to the
 *  initials thumb. */
type ThumbPick = PickedRecord & { thumbUrl?: string | null }
interface CasePick extends PickedRecord {
  number: string
  /** null = not evaluated (edit mode, legacy stash, or the division lookup is
   *  still in flight); {bureau: null} = definitively unresolved (blocks). */
  routing: CaseRouting | null
  routingCtx?: CaseRoutingCtx
}
interface TargetDraft { kind: StructuredTargetKind; sourceId: string; label: string; rationale: string }
/** A packet exhibit chosen before the draft exists (create mode) —
 *  attached with add_legal_exhibit right after create_legal_request. */
interface ExhibitDraft { kind: string; sourceId: string | null; label: string; url?: string }
/** New evidence uploaded/pasted before the draft exists — persisted with
 *  legal_add_evidence_and_exhibit right after create (host-first: the URL
 *  already exists on the media host, so nothing is lost if create fails). */
interface EvidenceDraft { title: string; type: MediaType; url: string; category: string; rationale: string }
type MediaType = Tables<'media'>['type']
const MEDIA_TYPE_OPTIONS: readonly [MediaType, string][] = [['image', 'Image'], ['video', 'Video'], ['document', 'Document']]
/** Selected case charges → counts (the legal_set_charges payload). */
type ChargeSel = Record<string, number>
/** Quick-preview (peek) type per structured-target kind. prior_legal_request
 *  has no preview type — those rows render plain, on purpose (a sealed prior
 *  is labelled by number alone and a peek would have nothing safe to add). */
const TARGET_PEEK: Partial<Record<StructuredTargetKind, 'person' | 'vehicle' | 'place'>> = {
  person_record: 'person', vehicle: 'vehicle', place: 'place',
}
type FieldSpec = { key: string; label: string; req?: boolean; kind?: 'textarea' | 'datetime' }

/** Never-lose-work stash for the CREATE flow (same key family as the old
 *  form: `legal:new:<kind>`; restore is always user-triggered). */
interface WizardStash {
  subtype: string | null
  caseSel: CasePick | null
  personSel: PickedRecord | null
  recipientType: 'player' | 'entity'
  recipientName: string
  title: string; priority: string; narrative: string; classification: string
  form: Record<string, string>
  targets: TargetDraft[]
  charges?: ChargeSel
  exhibits?: ExhibitDraft[]
  evidence?: EvidenceDraft[]
}

/** localStorage is user-editable — coerce a recovered stash back into the
 *  exact controlled-input shapes so a stale/malformed one can't break state. */
function asPick(v: unknown): PickedRecord | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return null
  return { id: o.id, label: o.label, ...(typeof o.sublabel === 'string' ? { sublabel: o.sublabel } : {}) }
}
function asRouting(v: unknown): CaseRouting | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const bureau = typeof o.bureau === 'string' && isRoutingBureau(o.bureau) ? o.bureau : null
  if (!bureau) return null // unresolved/malformed stashes re-evaluate via routingCtx
  const source = typeof o.source === 'string' && o.source in ROUTING_SOURCE_LABEL ? (o.source as RoutingSource) : null
  return { bureau, source }
}
function asCasePick(v: unknown): CasePick | null {
  const base = asPick(v)
  if (!base) return null
  const o = v as Record<string, unknown>
  // Backward-tolerant: legacy stashes carried `bureauWarning: boolean` — they
  // coerce to routing: null (unevaluated) and re-resolve when a ctx exists.
  const ctx = o.routingCtx && typeof o.routingCtx === 'object' ? (o.routingCtx as Record<string, unknown>) : null
  return {
    ...base,
    number: typeof o.number === 'string' ? o.number : '',
    routing: asRouting(o.routing),
    ...(ctx && typeof ctx.bureau === 'string' ? {
      routingCtx: {
        bureau: ctx.bureau,
        originating_bureau: typeof ctx.originating_bureau === 'string' ? ctx.originating_bureau : null,
        lead_detective_id: typeof ctx.lead_detective_id === 'string' ? ctx.lead_detective_id : null,
        created_by: typeof ctx.created_by === 'string' ? ctx.created_by : null,
      },
    } : {}),
  }
}
function asCharges(v: unknown): ChargeSel {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .filter(([, n]) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999)
    .map(([k, n]) => [k, n as number]))
}
function asExhibits(v: unknown): ExhibitDraft[] {
  if (!Array.isArray(v)) return []
  return v.filter((e): e is ExhibitDraft => !!e && typeof e === 'object'
    && typeof (e as ExhibitDraft).kind === 'string' && typeof (e as ExhibitDraft).label === 'string')
    .map((e) => ({ kind: e.kind, sourceId: typeof e.sourceId === 'string' ? e.sourceId : null, label: e.label, ...(typeof e.url === 'string' ? { url: e.url } : {}) }))
}
function asEvidence(v: unknown): EvidenceDraft[] {
  if (!Array.isArray(v)) return []
  return v.filter((e): e is EvidenceDraft => !!e && typeof e === 'object'
    && typeof (e as EvidenceDraft).title === 'string' && typeof (e as EvidenceDraft).url === 'string'
    && MEDIA_TYPE_OPTIONS.some(([t]) => t === (e as EvidenceDraft).type))
    .map((e) => ({ title: e.title, type: e.type, url: e.url, category: typeof e.category === 'string' ? e.category : '', rationale: typeof e.rationale === 'string' ? e.rationale : '' }))
}
function asTargets(v: unknown): TargetDraft[] {
  if (!Array.isArray(v)) return []
  return v.filter((t): t is TargetDraft =>
    !!t && typeof t === 'object' &&
    (STRUCTURED_TARGET_KINDS as readonly string[]).includes(String((t as TargetDraft).kind)) &&
    typeof (t as TargetDraft).sourceId === 'string' && typeof (t as TargetDraft).label === 'string',
  ).map((t) => ({ kind: t.kind, sourceId: t.sourceId, label: t.label, rationale: typeof t.rationale === 'string' ? t.rationale : '' }))
}

/* ── Shared field renderer (same control set as the dossier draft editor) ──── */
function SpecField({ f, required, hint, value, onChange }: {
  f: FieldSpec
  required?: boolean
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={f.label} required={required ?? f.req} hint={hint}>
      {(id) => f.key === 'platform' ? (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      ) : f.kind === 'textarea' ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} type={f.kind === 'datetime' ? 'datetime-local' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

function TypeCard({ label, desc, selected, onSelect }: {
  label: string; desc: string; selected: boolean; onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`min-h-[64px] rounded-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500 ${
        selected ? 'border-badge-500/60 bg-badge-500/10' : 'border-white/5 bg-ink-900/60 hover:border-white/15'
      }`}
    >
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-xs text-slate-400">{desc}</p>
    </button>
  )
}

/* ── The wizard ───────────────────────────────────────────────────────────── */
export function LegalCreateWizard({ entry, onCancel, onDone }: {
  entry: LegalWizardEntry
  onCancel: () => void
  /** Called with the request id after a successful create/save/submit. */
  onDone: (id: string) => void
}) {
  const { profile } = useAuth()
  const me = profile?.id ?? null
  const isEdit = entry.mode === 'edit'
  const editId = isEdit ? entry.requestId : null

  const [row, setRow] = useState<LegalRequest | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready'>(editId ? 'loading' : 'ready')

  const [requestType, setRequestType] = useState<'warrant' | 'subpoena' | null>(null)
  const [subtype, setSubtype] = useState<string | null>(null)
  const [caseSel, setCaseSel] = useState<CasePick | null>(null)
  const [personSel, setPersonSel] = useState<ThumbPick | null>(null)
  const [recipientType, setRecipientType] = useState<'player' | 'entity'>('player')
  const [recipientName, setRecipientName] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [narrative, setNarrative] = useState('')
  const [classification, setClassification] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<TargetDraft[]>([])
  // Edit mode holds EVERY exhibit row (targets are the structured subset).
  const [savedExhibits, setSavedExhibits] = useState<Tables<'legal_request_exhibits'>[]>([])
  const savedTargets = savedExhibits.filter((e) => (STRUCTURED_TARGET_KINDS as readonly string[]).includes(e.exhibit_type))
  // Charges (P4-03): the case's charges + the selected subset with counts.
  // Loaded rows are keyed by case so a case switch reads as "loading" without
  // an effect having to clear state.
  const [loadedCharges, setLoadedCharges] = useState<{ caseId: string; rows: CaseChargeRow[] } | null>(null)
  const [chargeSel, setChargeSel] = useState<ChargeSel>({})
  const [chargeQuery, setChargeQuery] = useState('')
  const [addingCharge, setAddingCharge] = useState(false)
  const { ready: penalReady } = usePenalCode()
  // Evidence (P4-08): pending packet picks + new uploads (create mode only —
  // edit mode attaches immediately).
  const [pendingExhibits, setPendingExhibits] = useState<ExhibitDraft[]>([])
  const [pendingEvidence, setPendingEvidence] = useState<EvidenceDraft[]>([])
  const [evForm, setEvForm] = useState<{ title: string; type: MediaType; url: string; category: string; rationale: string }>({ title: '', type: 'image', url: '', category: '', rationale: '' })
  const [uploadActive, setUploadActive] = useState(0)
  // Unresolved revision items (P4-06) listed on the review step in edit mode.
  const [revisionItems, setRevisionItems] = useState<RevisionItem[]>([])
  const [changeSummary, setChangeSummary] = useState('')
  const [materialChange, setMaterialChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [attempted, setAttempted] = useState(false)

  /* ── Edit mode: load the request + its structured targets ─────────────────── */
  const [seedJson, setSeedJson] = useState('')
  useEffect(() => {
    if (!editId) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await list('legal_requests', { eq: { id: editId } })
        if (cancelled) return
        const r = rows[0] ?? null
        setRow(r)
        if (r) {
          setRequestType(r.request_type as 'warrant' | 'subpoena')
          setSubtype(r.subtype)
          setCaseSel({
            id: r.case_id ?? '', number: r.case_number_snapshot ?? '',
            label: `${r.case_number_snapshot ?? '—'} — ${r.case_title_snapshot ?? 'Untitled'}`,
            routing: null, // edit mode never re-evaluates — the request carries responsible_bureau
          })
          setPersonSel(r.person_id ? { id: r.person_id, label: r.person_name_snapshot ?? 'Person' } : null)
          setRecipientType(r.recipient_type === 'entity' ? 'entity' : 'player')
          setRecipientName(r.recipient_name ?? '')
          setTitle(r.title); setPriority(r.priority ?? 'Medium'); setNarrative(r.narrative ?? '')
          setClassification(r.classification)
          const seededForm = (r.form_data && typeof r.form_data === 'object' && !Array.isArray(r.form_data))
            ? Object.fromEntries(Object.entries(r.form_data as Record<string, unknown>)
                .filter(([k]) => !k.startsWith('_')).map(([k, val]) => [k, String(val ?? '')]))
            : {}
          setForm(seededForm)
          setSeedJson(JSON.stringify({
            title: r.title, priority: r.priority ?? 'Medium', narrative: r.narrative ?? '',
            classification: r.classification, form: seededForm,
          } satisfies DraftShape))
          const [ex, ch, ri] = await Promise.all([
            list('legal_request_exhibits', { eq: { legal_request_id: editId }, order: 'created_at' }),
            list('legal_request_charges', { eq: { legal_request_id: editId }, order: 'created_at' }).catch(() => []),
            list('legal_request_revision_items', { eq: { legal_request_id: editId }, order: 'created_at' }).catch(() => []),
          ])
          if (!cancelled) {
            setSavedExhibits(ex)
            setChargeSel(Object.fromEntries(ch.map((c) => [c.case_charge_id, c.counts])))
            setRevisionItems(ri)
          }
        }
        if (!cancelled) setLoadState('ready')
      } catch { if (!cancelled) { setRow(null); setLoadState('ready') } }
    })()
    return () => { cancelled = true }
  }, [editId])

  /* ── Never-lose-work stashes (restore is always user-triggered) ───────────── */
  // CREATE: same key family as the old form (`legal:new:<kind>`), now on the
  // per-user DB-backed layer; a stash left by the old shared-key code is
  // adopted once and the shared key cleared.
  const stashKey = !isEdit && requestType ? `legal:new:${requestType}` : null
  const [pendingStash, setPendingStash] = useState<LoadedDraft<WizardStash> | null>(null)
  const loadedStashKey = useRef<string | null>(null)
  useEffect(() => {
    if (!stashKey || loadedStashKey.current === stashKey) return
    loadedStashKey.current = stashKey
    void adoptLegacyDraft<WizardStash>(stashKey).then((d) => {
      if (loadedStashKey.current === stashKey) setPendingStash(d)
    })
  }, [stashKey])
  const hasContent = !!(title.trim() || narrative.trim() || recipientName.trim()
    || caseSel || personSel || targets.length || Object.keys(form).length
    || Object.keys(chargeSel).length || pendingExhibits.length || pendingEvidence.length)
  useEffect(() => {
    if (!stashKey || !hasContent) return
    void saveDraft(stashKey, {
      subtype, caseSel, personSel, recipientType, recipientName,
      title, priority, narrative, classification, form, targets,
      charges: chargeSel, exhibits: pendingExhibits, evidence: pendingEvidence,
    } satisfies WizardStash)
  }, [stashKey, hasContent, subtype, caseSel, personSel, recipientType, recipientName, title, priority, narrative, classification, form, targets, chargeSel, pendingExhibits, pendingEvidence])
  const restoreStash = () => {
    const d = pendingStash?.data
    if (!d) return
    if (typeof d.subtype === 'string') setSubtype(d.subtype)
    setCaseSel(asCasePick(d.caseSel)); setPersonSel(asPick(d.personSel))
    setRecipientType(d.recipientType === 'entity' ? 'entity' : 'player')
    setRecipientName(typeof d.recipientName === 'string' ? d.recipientName : '')
    const s = sanitizeStash(d, '')
    setTitle(s.title); setPriority(s.priority || 'Medium'); setNarrative(s.narrative)
    setClassification(s.classification); setForm(s.form)
    setTargets(asTargets(d.targets))
    setChargeSel(asCharges(d.charges))
    setPendingExhibits(asExhibits(d.exhibits))
    setPendingEvidence(asEvidence(d.evidence))
    setPendingStash(null)
  }
  const discardStash = () => { if (stashKey) void clearDraft(stashKey); setPendingStash(null) }

  // EDIT: the dossier's key + shape (`legal:edit:<id>`, DraftShape) so a stash
  // typed in either editor is recoverable from the other.
  const [editPending, setEditPending] = useState<LoadedDraft<DraftShape> | null>(null)
  const loadedEditKey = useRef<string | null>(null)
  useEffect(() => {
    if (!editId || loadedEditKey.current === editId) return
    loadedEditKey.current = editId
    void adoptLegacyDraft<DraftShape>(`legal:edit:${editId}`).then((d) => {
      if (loadedEditKey.current === editId) setEditPending(d)
    })
  }, [editId])
  useEffect(() => {
    if (!editId || !seedJson) return
    const shape: DraftShape = { title, priority, narrative, classification, form }
    if (JSON.stringify(shape) === seedJson) return
    void saveDraft(`legal:edit:${editId}`, shape)
  }, [editId, seedJson, title, priority, narrative, classification, form])

  /* ── Bounded server-backed pickers (entity_suggest; RLS scopes rows) ──────── */
  // Cases: the shared suggestion arm finds candidates (blank ⇒ the most
  // recent), then ONE in:{id} hydration reads the routing columns the
  // responsible-bureau chain needs. Server order is kept.
  const searchCases = useCallback(async (q: string): Promise<CasePick[]> => {
    type Row = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'bureau' | 'originating_bureau' | 'lead_detective_id' | 'created_by'>
    const select = 'id,case_number,title,bureau,originating_bureau,lead_detective_id,created_by'
    const term = q.trim()
    let rows: Row[]
    if (term.length < 2) {
      rows = (await list('cases', { select, order: 'created_at', ascending: false, limit: 20 })) as unknown as Row[]
    } else {
      const hits = await suggestEntities('case', term, 20)
      if (!hits.length) return []
      const fetched = (await list('cases', { select, in: { id: hits.map((h) => h.id) } })) as unknown as Row[]
      const byId = new Map(fetched.map((c) => [c.id, c]))
      rows = hits.map((h) => byId.get(h.id)).filter((c): c is Row => !!c)
    }
    return rows.map((c) => {
      // First pass on the fields already on the row (bureau → responsible
      // bureau → case-number prefix). An unresolved pick keeps routing: null
      // and the division-lookup effect below finishes the chain on selection.
      const quick = resolveResponsibleBureau({ bureau: c.bureau, originating_bureau: c.originating_bureau, case_number: c.case_number })
      return {
        id: c.id,
        number: c.case_number,
        label: `${c.case_number} — ${c.title ?? 'Untitled'}`,
        sublabel: c.bureau === 'JTF' && c.originating_bureau ? `JTF · origin ${bureauShort(c.originating_bureau)}` : bureauShort(c.bureau),
        routing: quick.bureau ? quick : null,
        routingCtx: { bureau: c.bureau, originating_bureau: c.originating_bureau, lead_detective_id: c.lead_detective_id, created_by: c.created_by },
      }
    })
  }, [])

  /* ── Second-phase routing resolution (CREATE mode) ─────────────────────────
   * When bureau, responsible bureau AND case-number prefix all failed, the
   * chain falls to the lead detective's / creator's division — fetched here
   * (RLS allows reading member profiles), then resolveResponsibleBureau
   * re-runs with them. Covers picker selections and restored stashes alike.
   * UX preview only: the server chain re-derives, persists and enforces. */
  useEffect(() => {
    if (isEdit) return
    const pick = caseSel
    if (!pick || pick.routing || !pick.routingCtx) return
    const ctx = pick.routingCtx
    let cancelled = false
    void (async () => {
      let leadDivision: string | null = null
      let creatorDivision: string | null = null
      try {
        const ids = [...new Set([ctx.lead_detective_id, ctx.created_by].filter((x): x is string => !!x))]
        if (ids.length) {
          const profs = (await list('profiles', { select: 'id,division', in: { id: ids } })) as unknown as Pick<Tables<'profiles'>, 'id' | 'division'>[]
          leadDivision = profs.find((p) => p.id === ctx.lead_detective_id)?.division ?? null
          creatorDivision = profs.find((p) => p.id === ctx.created_by)?.division ?? null
        }
      } catch { /* unreadable roster — the chain resolves on what it has */ }
      if (cancelled) return
      const resolved = resolveResponsibleBureau({
        bureau: ctx.bureau, originating_bureau: ctx.originating_bureau,
        case_number: pick.number, leadDivision, creatorDivision,
      })
      setCaseSel((cur) => (cur && cur.id === pick.id ? { ...cur, routing: resolved } : cur))
    })()
    return () => { cancelled = true }
  }, [isEdit, caseSel])
  // Persons: the shared entity_suggest arm (name / alias / phone; merged
  // tombstones never offered). Suggest rows carry no mugshot — the picker's
  // thumb falls back to initials.
  const searchPersons = useCallback(async (q: string): Promise<ThumbPick[]> => {
    const hits = await searchPersonHits(q)
    return hits.map((p) => ({ id: p.id, label: p.label, ...(p.sublabel ? { sublabel: p.sublabel } : {}), thumbUrl: p.thumbUrl ?? null }))
  }, [])

  /* ── Charges (P4-03): the case's charges, refreshed when the case changes ── */
  const caseId = caseSel?.id || null
  const [chargesTick, setChargesTick] = useState(0)
  useEffect(() => {
    if (!caseId) return
    let cancelled = false
    const forCase = caseId
    void loadCaseCharges(forCase)
      .then((rows) => { if (!cancelled) setLoadedCharges({ caseId: forCase, rows }) })
      .catch(() => { if (!cancelled) setLoadedCharges({ caseId: forCase, rows: [] }) })
    return () => { cancelled = true }
  }, [caseId, chargesTick])
  const caseCharges: CaseChargeRow[] | null = caseId && loadedCharges?.caseId === caseId ? loadedCharges.rows : null
  // A case change drops selections that belong to the old case (create mode
  // only — the case is fixed while revising).
  const prevCaseId = useRef<string | null>(null)
  useEffect(() => {
    if (prevCaseId.current && prevCaseId.current !== caseId && !isEdit) { setChargeSel({}); setPendingExhibits([]); setPendingEvidence([]) }
    prevCaseId.current = caseId
  }, [caseId, isEdit])
  const toggleCharge = (c: CaseChargeRow) =>
    setChargeSel((sel) => {
      if (sel[c.id]) { const next = { ...sel }; delete next[c.id]; return next }
      return { ...sel, [c.id]: c.counts }
    })
  const setChargeCounts = (id: string, n: number) =>
    setChargeSel((sel) => (sel[id] ? { ...sel, [id]: Math.min(999, Math.max(1, n || 1)) } : sel))
  // "Add a charge": the penal picker proposes a case charge (the same
  // ordinary casework write ChargesTab makes) — then it is selectable here.
  const addCaseCharge = async (chargeId: string) => {
    if (!caseId) return
    setBusy(true)
    const err = await proposeCaseCharge(caseId, chargeId)
    if (err) { setBusy(false); toast(err, 'danger'); return }
    const rows = await loadCaseCharges(caseId).catch(() => null)
    setBusy(false)
    if (rows) {
      setLoadedCharges({ caseId, rows })
      const added = rows.find((r) => r.charge_id === chargeId && r.status !== 'withdrawn' && r.status !== 'dismissed')
      if (added) setChargeSel((sel) => ({ ...sel, [added.id]: sel[added.id] ?? added.counts }))
    } else setChargesTick((t) => t + 1)
    setChargeQuery('')
    setAddingCharge(false)
    toast('Charge added to the case and selected.', 'success')
  }
  const chargeItems = Object.entries(chargeSel).map(([case_charge_id, counts]) => ({ case_charge_id, counts }))
  const persistCharges = async (requestId: string): Promise<string | null> => {
    const res = readJsonRpc(await rpc('legal_set_charges', { p_request: requestId, p_items: chargeItems as unknown as Json }))
    return res.ok ? null : (res.message ?? 'Could not save the charges.')
  }

  /* ── Evidence (P4-08): case records for the packet picker + new uploads ─── */
  const caseRecords = useCaseRecordsFor(caseId, caseSel?.number || null, !!caseId)
  const attachExhibit = async (requestId: string, e: ExhibitDraft) => rpc('add_legal_exhibit', {
    p_request: requestId, p_type: e.kind, p_source_id: e.sourceId ?? undefined,
    ...(e.url ? { p_meta: { url: e.url } } : {}),
  })
  const attachEvidence = async (requestId: string, e: EvidenceDraft) => readJsonRpc(await rpc('legal_add_evidence_and_exhibit', {
    p_request: requestId, p_title: e.title, p_type: e.type, p_external_url: e.url,
    p_category: e.category || undefined, p_rationale: e.rationale || undefined,
  }))
  const pickExhibit = async (kind: string, sourceId: string | null, label: string, url?: string) => {
    const draft: ExhibitDraft = { kind, sourceId, label, ...(url ? { url } : {}) }
    if (!isEdit) {
      if (pendingExhibits.some((x) => x.kind === kind && x.sourceId === sourceId && x.url === url)) return
      setPendingExhibits((x) => [...x, draft])
      return
    }
    if (!row) return
    setBusy(true)
    const res = await attachExhibit(row.id, draft)
    setBusy(false)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Could not attach the exhibit.', 'danger'); return }
    const saved = res.data
    setSavedExhibits((x) => [...x, saved])
    toast('Exhibit added.', 'success')
  }
  const addEvidence = async (e: EvidenceDraft) => {
    if (!isEdit) { setPendingEvidence((x) => [...x, e]); return }
    if (!row) return
    setBusy(true)
    const res = await attachEvidence(row.id, e)
    setBusy(false)
    if (!res.ok) { toast(res.message ?? 'Could not add the evidence.', 'danger'); return }
    const ex = await list('legal_request_exhibits', { eq: { legal_request_id: row.id }, order: 'created_at' }).catch(() => null)
    if (ex) setSavedExhibits(ex)
    toast('Evidence added to the case and attached.', 'success')
  }
  // Host-first (the MediaTab seam): the file is already on the host when
  // this runs; the case media row + exhibit are the RPC's job.
  const handleUploaded = async (f: UploadedFile) => {
    const type: MediaType = f.kind === 'video' ? 'video' : f.kind === 'audio' ? 'fivemanage' : 'image'
    await addEvidence({ title: f.name.replace(/\.[a-z0-9]+$/i, '') || f.name, type, url: f.url, category: evForm.category, rationale: evForm.rationale.trim() })
  }
  const onQueueChange = useCallback((active: number) => setUploadActive(active), [])
  const addPastedEvidence = async () => {
    const url = safeUrl(evForm.url)
    if (!url) { toast('Enter a valid http(s) URL.', 'warn'); return }
    const title = evForm.title.trim() || url.replace(/^https?:\/\//, '').slice(0, 60)
    await addEvidence({ title, type: evForm.type, url, category: evForm.category, rationale: evForm.rationale.trim() })
    setEvForm((f) => ({ ...f, title: '', url: '' }))
  }
  const removeSavedExhibit = async (e: Tables<'legal_request_exhibits'>) => {
    const ok = await uiConfirm(`Remove “${e.display_title}” from the packet?`, { title: 'Remove exhibit', confirmText: 'Remove' })
    if (!ok) return
    const res = await rpc('remove_legal_exhibit', { p_exhibit: e.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    setSavedExhibits((x) => x.filter((t) => t.id !== e.id))
  }

  /* ── Structured search-warrant targets ────────────────────────────────────── */
  const [tKind, setTKind] = useState<StructuredTargetKind>('person_record')
  const [tSel, setTSel] = useState<ThumbPick | null>(null)
  const [tRationale, setTRationale] = useState('')
  const targetSearch = useCallback(async (q: string): Promise<ThumbPick[]> => {
    if (tKind === 'person_record') return searchPersons(q)
    if (tKind === 'vehicle') return searchVehicleHits(q)
    if (tKind === 'place') return searchPlaceHits(q)
    // prior_legal_request — RLS already scopes which requests come back. The
    // shared arm finds candidates; one in:{id} read fetches subtype and
    // classification for the labels.
    const hits = await searchLegalRequestHits(q, { exclude: editId ? new Set([editId]) : undefined })
    if (!hits.length) return []
    const rows = (await list('legal_requests', {
      select: 'id,request_number,title,subtype,classification', in: { id: hits.map((h) => h.id) },
    })) as unknown as Pick<Tables<'legal_requests'>, 'id' | 'request_number' | 'title' | 'subtype' | 'classification'>[]
    const byId = new Map(rows.map((r) => [r.id, r]))
    return hits
      .map((h) => byId.get(h.id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      // A sealed prior is labelled by its number alone — the new request's
      // audience is broader than the sealed one's, so its title never rides
      // along into chips or the mirrored search_targets text (same discipline
      // as the server's default exhibit title).
      .map((r) => ({
        id: r.id,
        label: r.classification === 'sealed' ? r.request_number : `${r.request_number} — ${r.title}`,
        sublabel: r.classification === 'sealed' ? `${humanize(r.subtype)} · Sealed` : humanize(r.subtype),
      }))
  }, [tKind, searchPersons, editId])

  /** Mirror one structured target into the legacy free-text field — the server
   *  and the court packet read search_targets, so typed targets always show. */
  const mirrorLine = (kind: StructuredTargetKind, label: string) =>
    setForm((f) => ({
      ...f,
      search_targets: appendSearchTargetLine(String(f.search_targets ?? ''), structuredTargetLine({ kind, label })),
    }))

  const addTarget = async () => {
    if (!tSel) { toast('Choose a record to add as a target.', 'warn'); return }
    if (!isEdit) {
      setTargets((t) => [...t, { kind: tKind, sourceId: tSel.id, label: tSel.label, rationale: tRationale.trim() }])
      mirrorLine(tKind, tSel.label)
    } else if (row) {
      setBusy(true)
      const res = await rpc('add_legal_exhibit', {
        p_request: row.id, p_type: tKind, p_source_id: tSel.id,
        p_rationale: tRationale.trim() || undefined,
      })
      setBusy(false)
      if (res.error || !res.data) { toast(res.error?.message ?? 'Could not attach the target.', 'danger'); return }
      const saved = res.data
      setSavedExhibits((x) => [...x, saved])
      mirrorLine(tKind, saved.display_title)
      toast('Target attached.', 'success')
    }
    setTSel(null); setTRationale('')
  }
  const removeSavedTarget = async (e: Tables<'legal_request_exhibits'>) => {
    const ok = await uiConfirm(`Remove target “${e.display_title}”?`, { title: 'Remove target', confirmText: 'Remove' })
    if (!ok) return
    const res = await rpc('remove_legal_exhibit', { p_exhibit: e.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    setSavedExhibits((x) => x.filter((t) => t.id !== e.id))
  }

  /* ── Derivations (pure model) ─────────────────────────────────────────────── */
  const steps = isEdit ? LEGAL_WIZARD_STEPS.filter((s) => s.id !== 'type') : LEGAL_WIZARD_STEPS
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const isReturned = !!row && row.review_status.startsWith('returned_by')
  const input: LegalWizardInput = {
    requestType: requestType ?? 'warrant',
    subtype,
    caseId: caseSel?.id ?? '',
    personId: personSel?.id ?? '',
    recipientType, recipientName, title, priority, narrative, form,
    // Resolution ran (create mode): a bureau permits, null blocks with a clear
    // fix path. Absent while unknown / in edit mode — the server still enforces.
    ...(!isEdit && caseSel?.routing ? { routingBureau: caseSel.routing.bureau } : {}),
    // P4-03 / P4-04 / P4-06: the basis fields live in `form`; the model reads
    // them there. Charges are advisory; the change summary is required when
    // resubmitting from any returned_* state.
    charges: chargeItems,
    isResubmission: isEdit && isReturned,
    changeSummary,
  }
  const currentIssues = legalWizardIssues(step.id, input)
  const currentAdvisories = legalWizardAdvisories(step.id, input)
  const reviewIssues = legalWizardIssues('review', input)
  const reviewAdvisories = legalWizardAdvisories('review', input)
  const unresolvedItems = revisionItems.filter((i) => !i.resolved_at)
  const exhibitCount = isEdit ? savedExhibits.length : pendingExhibits.length + pendingEvidence.length + targets.length
  const reviewChecklist = legalSubmitChecklist({
    requestType: requestType ?? 'warrant', subtype, title, narrative, priority, form, exhibitCount,
  })
  const firstBlocked = steps.findIndex((s) => legalWizardIssues(s.id, input).length > 0)
  const maxReachable = firstBlocked === -1 ? steps.length - 1 : firstBlocked
  const requiresPerson = subtypeRequiresPerson(requestType ?? '', subtype)
  const supportsTargets = subtypeSupportsStructuredTargets(requestType ?? '', subtype)
  const spec: FieldSpec[] = requestType === 'warrant'
    ? WARRANT_FIELDS[subtype as WarrantType] ?? []
    : requestType === 'subpoena' ? SUBPOENA_FIELDS[subtype as SubpoenaType] ?? [] : []
  // A judge return fast-tracks (P4-01): the corrected resubmission goes
  // STRAIGHT back to the judicial queue unless the investigator explicitly
  // declares a material change below. Bureau / SIB-command returns and first
  // submissions enter bureau review as always.
  const isFastReturn = !!row && row.review_status === 'returned_by_judge'
  // Review readout: the resolved responsible bureau (permanent-bureau cases
  // resolve with source 'bureau'); while revising, the stamped column.
  const editRoutingRaw = row?.responsible_bureau ?? null
  const reviewRouting: RoutingBureau | null = !isEdit
    ? (caseSel?.routing?.bureau ?? null)
    : (isRoutingBureau(editRoutingRaw) ? editRoutingRaw : null)

  /* ── Inline responsible-bureau repair (unresolved case, supervisor viewer) ──
   * Cosmetic gate only — resolve_case_originating_bureau re-validates the
   * caller (Senior Detective+ sets; DD+ changes with a reason). */
  const [routingPick, setRoutingPick] = useState('')
  const [routingBusy, setRoutingBusy] = useState(false)
  const setResponsibleBureau = async () => {
    if (!caseSel || routingBusy) return
    if (!isRoutingBureau(routingPick)) { toast('Choose Major Crimes or Street Crimes.', 'warn'); return }
    const bureau: RoutingBureau = routingPick
    setRoutingBusy(true)
    const res = await rpc('resolve_case_originating_bureau', { p_case: caseSel.id, p_bureau: bureau })
    setRoutingBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setCaseSel((cur) => (cur && cur.id === caseSel.id
      ? {
          ...cur,
          routing: { bureau, source: 'originating' },
          ...(cur.routingCtx ? { routingCtx: { ...cur.routingCtx, originating_bureau: bureau } } : {}),
        }
      : cur))
    setRoutingPick('')
    toast(`Responsible bureau set to ${bureauLabel(bureau)} — legal requests on this case route there.`, 'success')
  }

  /* ── Step navigation (focus moves to the step heading on change) ──────────── */
  const headingRef = useRef<HTMLHeadingElement>(null)
  const prevStep = useRef(stepIdx)
  useEffect(() => {
    if (prevStep.current !== stepIdx) headingRef.current?.focus()
    prevStep.current = stepIdx
  }, [stepIdx])

  const next = () => {
    if (currentIssues.length) { setAttempted(true); return }
    // Deterministic title suggestion (old form parity) on entering Narrative.
    if (steps[stepIdx + 1]?.id === 'narrative' && requestType === 'warrant' && !title.trim() && personSel && caseSel) {
      const label = subtype === 'search_warrant' ? 'Search Warrant' : 'Arrest Warrant'
      setTitle(`${label} — ${personSel.label}${caseSel.number ? ` (${caseSel.number})` : ''}`)
    }
    setAttempted(false)
    setStepIdx((i) => Math.min(i + 1, steps.length - 1))
  }
  const prev = () => { setAttempted(false); setStepIdx((i) => Math.max(i - 1, 0)) }

  const chooseType = (rt: 'warrant' | 'subpoena', st: string) => {
    setRequestType(rt)
    if (st !== subtype) { setForm({}); setTargets([]) }
    setSubtype(st)
  }

  /* ── Actions (existing definer RPCs, verbatim) ────────────────────────────── */
  const createRequest = async (submit: boolean) => {
    if (!requestType || !subtype) return
    const issues = submit ? legalWizardIssues('review', input) : legalWizardDraftIssues(input)
    if (issues.length) { setAttempted(true); toast(issues[0], 'warn'); return }
    setBusy(true)
    const res = await rpc('create_legal_request', {
      p_case: caseSel?.id ?? '',
      p_request_type: requestType,
      p_subtype: subtype,
      p_title: title.trim(),
      p_priority: requestType === 'warrant' ? priority : undefined,
      p_narrative: narrative,
      p_person: (requestType === 'warrant' || recipientType === 'player') ? (personSel?.id || undefined) : undefined,
      p_recipient_type: requestType === 'subpoena' ? recipientType : undefined,
      p_recipient_name: requestType === 'subpoena' && recipientType === 'entity' ? recipientName.trim() : undefined,
      p_form: form,
      p_classification: classification || undefined,
    })
    if (res.error || !res.data) {
      setBusy(false)
      toast(res.error?.message ?? 'Could not create the request.', 'danger')
      return
    }
    const id = res.data.id
    let targetFailures = 0
    for (const t of targets) {
      const tr = await rpc('add_legal_exhibit', {
        p_request: id, p_type: t.kind, p_source_id: t.sourceId,
        p_rationale: t.rationale || undefined,
      })
      if (tr.error) targetFailures++
    }
    // Packet exhibits + new evidence chosen before the draft existed, then
    // the charge set (legal_set_charges replaces the whole set — P4-03).
    let exhibitFailures = 0
    for (const e of pendingExhibits) { const er = await attachExhibit(id, e); if (er.error) exhibitFailures++ }
    for (const e of pendingEvidence) { const er = await attachEvidence(id, e); if (!er.ok) exhibitFailures++ }
    const chargeErr = chargeItems.length ? await persistCharges(id) : null
    let submitted = false
    if (submit) {
      const sr = await rpc('submit_legal_request_to_cid', { p_request: id })
      if (sr.error) toast(`Draft created, but submission failed: ${sr.error.message}`, 'warn')
      else submitted = true
    }
    setBusy(false)
    if (stashKey) void clearDraft(stashKey)
    if (targetFailures) toast(`${targetFailures} structured target(s) could not be attached — add them on the request's Supporting section.`, 'warn')
    if (exhibitFailures) toast(`${exhibitFailures} supporting item(s) could not be attached — add them on the request's Supporting section.`, 'warn')
    if (chargeErr) toast(`Draft created, but the charges were not saved: ${chargeErr}`, 'warn')
    toast(
      submitted
        ? 'Request submitted for bureau review.'
        : 'Draft created — add supporting items, then submit for bureau review.',
      'success',
    )
    onDone(id)
  }

  const saveEdit = async (submit: boolean) => {
    if (!row) return
    if (submit) {
      const issues = legalWizardIssues('review', input)
      if (issues.length) { setAttempted(true); toast(issues[0], 'warn'); return }
    }
    setBusy(true)
    const res = await rpc('update_legal_draft', {
      p_request: row.id,
      p_title: title.trim() || undefined,
      p_priority: priority || undefined,
      p_narrative: narrative,
      p_classification: classification || undefined,
      p_form: form,
      // update_legal_draft coalesces — a person can be replaced, never cleared.
      p_person: personSel && personSel.id !== row.person_id ? personSel.id : undefined,
      p_recipient_type: requestType === 'subpoena' ? recipientType : undefined,
      p_recipient_name: requestType === 'subpoena' && recipientType === 'entity' ? (recipientName.trim() || undefined) : undefined,
    })
    if (res.error) { setBusy(false); toast(res.error.message, 'danger'); return }
    // Every edit-mode save replaces the charge set (P4-03).
    const chargeErr = await persistCharges(row.id)
    if (chargeErr) { setBusy(false); toast(`Draft saved, but the charges were not: ${chargeErr}`, 'danger'); return }
    if (!submit) {
      setBusy(false)
      void clearDraft(`legal:edit:${row.id}`)
      toast('Draft saved.', 'success')
      onDone(row.id)
      return
    }
    const sr = await rpc('submit_legal_request_to_cid', {
      p_request: row.id,
      p_change_summary: isReturned && changeSummary.trim() ? changeSummary.trim() : undefined,
      p_material_change: isFastReturn ? materialChange : undefined,
    })
    setBusy(false)
    if (sr.error) { toast(sr.error.message, 'danger'); return }
    void clearDraft(`legal:edit:${row.id}`)
    toast(
      isFastReturn && !materialChange
        ? 'Resubmitted — the corrected request returned directly to the judicial queue.'
        : 'Submitted for bureau review.',
      'success',
    )
    onDone(row.id)
  }

  /* ── Gate the edit path (server re-checks; this is honest UX) ─────────────── */
  if (loadState === 'loading') return <Notice text="Loading request…" />
  if (isEdit && (!row || row.created_by !== me || !isEditableDraft(row))) {
    return (
      <EmptyState
        icon={<ScaleIcon className="h-5 w-5" />}
        title="Request not editable"
        hint="This request does not exist, is outside your access, or is no longer in an editable state."
        action={{ label: 'Back to legal requests', onClick: onCancel }}
      />
    )
  }

  const targetItems = !isEdit
    ? targets.map((t, i) => ({
        key: `pending-${i}`, kind: t.kind, label: t.label, rationale: t.rationale,
        onRemove: () => setTargets((x) => x.filter((_, j) => j !== i)),
      }))
    : savedTargets.map((e) => ({
        key: e.id, kind: e.exhibit_type as StructuredTargetKind, label: e.display_title,
        rationale: e.rationale ?? '',
        onRemove: () => void removeSavedTarget(e),
      }))

  return (
    /* One centred column for the whole workflow -- header, stepper, restore
       banners, form card and navigation. Before this the root was full width
       and only SOME children were capped at max-w-3xl, none of them centred,
       so the form sat hard against the left edge with the rest of the row
       empty. Centring the CONTAINER only: nothing inside is text-centred,
       because a centred label above a left-aligned input reads as a mistake. */
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeader
        eyebrow="Legal requests"
        title={isEdit ? 'Revise legal request' : 'File legal request'}
        subtitle={isEdit && row
          ? `${row.request_number} — ${row.title}`
          : 'A guided draft — requirements are checked before submission.'}
        actions={<Button onClick={onCancel}>Cancel</Button>}
      />

      {/* Warrant and subpoena guidance, if any has been written and linked to
          this work. Placed before the stepper because the standard to meet is
          something you read BEFORE drafting, not after being refused. */}
      <RelatedGuidance route="legal" />

      {/* ── Stepper (keyboard: every reachable step is a real button) ───────── */}
      <ol aria-label="Wizard steps" className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const on = i === stepIdx
          const reachable = i <= maxReachable
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={on ? 'step' : undefined}
                disabled={!reachable && !on}
                onClick={() => { setAttempted(false); setStepIdx(i) }}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? 'border-badge-500/60 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="font-mono tabular-nums" aria-hidden>{i + 1}</span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>

      {/* ── Never-lose-work restore banners (user-triggered, never auto) ────── */}
      {!isEdit && pendingStash && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">Draft from {timeAgo(pendingStash.at)} found — restore your unsaved {requestType === 'subpoena' ? 'subpoena' : 'warrant request'}?</span>
          <Button size="sm" variant="secondary" onClick={restoreStash}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardStash}>Discard</Button>
        </div>
      )}
      {isEdit && row && editPending && editPending.at > Date.parse(row.updated_at) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">
            An unsaved draft from {timeAgo(editPending.at)} was found on this device (newer than the saved request).
          </span>
          <Button size="sm" variant="secondary" onClick={() => {
            const s = sanitizeStash(editPending.data, row.classification)
            setTitle(s.title || row.title); setPriority(s.priority || row.priority || 'Medium')
            setNarrative(s.narrative); setClassification(s.classification); setForm(s.form)
            setEditPending(null)
          }}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={() => { void clearDraft(`legal:edit:${row.id}`); setEditPending(null) }}>Discard</Button>
        </div>
      )}

      <div className="space-y-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-white outline-none">
          Step {stepIdx + 1} of {steps.length} — {step.label}
        </h2>

        {/* ── Step 0: type picker ─────────────────────────────────────────── */}
        {step.id === 'type' && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-white">
                Warrants — decided by a Judge
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {WARRANT_TYPES.map(([v, l]) => (
                  <TypeCard
                    key={v} label={l} desc={WARRANT_DESC[v]}
                    selected={requestType === 'warrant' && subtype === v}
                    onSelect={() => chooseType('warrant', v)}
                  />
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold text-white">
                Subpoenas — decided by a Judge after bureau review
              </h3>
              {SUBPOENA_GROUPS.map((g) => (
                <div key={g.label} className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-500">{g.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {g.types.map((t) => (
                      <TypeCard
                        key={t} label={subpoenaLabel(t)} desc={SUBPOENA_DESC[t]}
                        selected={requestType === 'subpoena' && subtype === t}
                        onSelect={() => chooseType('subpoena', t)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        {/* ── Step 1: case & target ───────────────────────────────────────── */}
        {step.id === 'case_target' && (
          <Card pad="sm" className="space-y-3">
            {isEdit ? (
              <Field label="Case" hint="The case cannot change after the draft is created.">
                {(id) => <Input id={id} value={caseSel?.label ?? '—'} readOnly disabled />}
              </Field>
            ) : (
              <RecordSearchPicker<CasePick>
                label="Case" required value={caseSel} onChange={setCaseSel} search={searchCases}
                placeholder="Search case number or title…"
                hint="Only cases you can already access are offered."
              />
            )}
            {/* Responsible-bureau readout for JTF-assigned cases: a derived
                resolution is informational (the server persists it on create);
                an unresolved one offers the supervisor the inline fix — the
                issues model already blocks Continue until it is set. */}
            {!isEdit && caseSel?.routing?.bureau
              && (caseSel.routing.source === 'case_number' || caseSel.routing.source === 'lead_detective' || caseSel.routing.source === 'creator') && (
              <p className="text-xs text-slate-400">
                Legal routing: <span className="font-semibold text-slate-200">{bureauShort(caseSel.routing.bureau)}</span> — derived
                from {ROUTING_SOURCE_LABEL[caseSel.routing.source]}. It is recorded on the case when the request is created.
              </p>
            )}
            {!isEdit && caseSel?.routing && caseSel.routing.bureau === null && (
              canSetResponsibleBureau(profile?.role, profile?.is_owner) ? (
                <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-200">
                    This case needs a responsible bureau for legal routing — select the bureau whose
                    leadership reviews its legal requests.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-44">
                      <Field label="Responsible bureau">
                        {(id) => (
                          <Select id={id} value={routingPick} onChange={(e) => setRoutingPick(e.target.value)}>
                            <option value="">Choose…</option>
                            {CID_ROUTING_BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <Button disabled={routingBusy || !routingPick} onClick={() => void setResponsibleBureau()}>
                      {routingBusy ? 'Setting…' : 'Set responsible bureau'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-xs text-amber-200">
                  This case needs a responsible bureau for legal routing. A CID supervisor (Senior Detective
                  or above) must select Major Crimes or Street Crimes before legal requests can proceed.
                </p>
              )
            )}
            {requestType === 'subpoena' && (
              <Field label="Recipient type" required>
                {(id) => (
                  <Select id={id} value={recipientType} onChange={(e) => setRecipientType(e.target.value as 'player' | 'entity')}>
                    <option value="player">Player</option>
                    <option value="entity">Other — Business / Entity</option>
                  </Select>
                )}
              </Field>
            )}
            {(requestType === 'warrant' || recipientType === 'player') && (
              <RecordSearchPicker
                label={requestType === 'warrant'
                  ? (requiresPerson ? 'Suspect' : 'Subject (optional for search warrants)')
                  : 'Recipient (player)'}
                required={requiresPerson || (requestType === 'subpoena' && recipientType === 'player')}
                value={personSel} onChange={setPersonSel} search={searchPersons}
                getThumb={(p) => p.thumbUrl}
                peekType="person"
                placeholder="Search by name or alias…"
                hint={isEdit && row?.person_id
                  ? 'The linked person can be replaced, not removed, while revising.'
                  : 'Chosen from the Persons registry.'}
              />
            )}
            {requestType === 'subpoena' && recipientType === 'entity' && (
              <Field label="Recipient name" required>
                {(id) => <Input id={id} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Business or entity name" />}
              </Field>
            )}
          </Card>
        )}

        {/* ── Step: charges (P4-03) — from the case's charges, or add one ──── */}
        {step.id === 'charges' && (
          <div className="space-y-4">
            <Card pad="sm" className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-white">Charges on this request</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Pick from the case&rsquo;s charges. Each is stored with its statute snapshot and printed on the approved instrument.
                  {isEdit ? ' Saved with the draft.' : ' Saved when the draft is created.'}
                </p>
              </div>
              {caseCharges === null && <p className="text-sm text-slate-400">Loading case charges…</p>}
              {caseCharges?.length === 0 && !addingCharge && (
                <p className="text-sm text-slate-400">This case has no charges yet — add one below.</p>
              )}
              {!!caseCharges?.length && (
                <ul className="space-y-1.5" aria-label="Case charges">
                  {caseCharges.map((c) => {
                    const on = !!chargeSel[c.id]
                    const closed = c.status === 'withdrawn' || c.status === 'dismissed'
                    const inputId = `charge-${c.id}`
                    return (
                      <li key={c.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${on ? 'border-badge-500/40 bg-badge-500/5' : 'border-white/10 bg-ink-950/50'} ${closed ? 'opacity-60' : ''}`}>
                        <label className="flex min-h-[40px] min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input type="checkbox" checked={on} disabled={closed && !on} onChange={() => toggleCharge(c)} className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-badge-500" />
                          <span className="min-w-0">
                            <span className="block text-sm text-white">
                              <span className="font-mono text-badge-200">{c.code ?? '—'}</span> {c.offense}
                            </span>
                            <span className="block text-xs text-slate-400">{c.charge_class} · {humanize(c.status)} · on the case ×{c.counts}</span>
                          </span>
                        </label>
                        {on && (
                          <label className="flex items-center gap-1.5 text-xs text-slate-400" htmlFor={inputId}>
                            Counts
                            <Input id={inputId} type="number" min={1} max={999} value={chargeSel[c.id]} onChange={(e) => setChargeCounts(c.id, Number(e.target.value))} className="w-20" />
                          </label>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {currentAdvisories.length > 0 && (
                <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  {currentAdvisories.map((x) => <p key={x}>{x}</p>)}
                </div>
              )}
              {!addingCharge ? (
                <Button disabled={!caseId} onClick={() => setAddingCharge(true)}>+ Add a charge from the penal code</Button>
              ) : (
                <div className="space-y-2 rounded-lg border border-white/10 bg-ink-950/50 p-3">
                  <Field label="Search the penal code" hint="Adding a charge here proposes it on the case (the same record ChargesTab creates), then selects it.">
                    {(id) => (
                      <Input
                        id={id} value={chargeQuery} onChange={(e) => setChargeQuery(e.target.value)}
                        placeholder={penalReady ? 'Code, title or class…' : 'Loading penal code…'} disabled={!penalReady} autoComplete="off"
                      />
                    )}
                  </Field>
                  {penalReady && chargeQuery.trim() && (
                    <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label="Penal code matches">
                      {penalSearch(chargeQuery).slice(0, 25).map((pc) => (
                        <li key={pc.id}>
                          <button type="button" disabled={busy} onClick={() => void addCaseCharge(pc.id)}
                            className="block min-h-[40px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-60">
                            <span className="font-mono text-badge-200">{pc.code}</span>{' '}
                            <span className="font-semibold text-white">{pc.title}</span>
                            <span className="ml-2 text-xs text-slate-400">{pc.level}{pc.rico ? ' · RICO' : ''}{pc.modifier ? ' · modifier' : ''}</span>
                          </button>
                        </li>
                      ))}
                      {penalSearch(chargeQuery).length === 0 && <li className="text-sm text-slate-400">No matches.</li>}
                    </ul>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setAddingCharge(false); setChargeQuery('') }}>Done</Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── Step: type-specific details (+ structured targets) ──────────── */}
        {step.id === 'details' && (
          <div className="space-y-4">
            <Card pad="sm" className="space-y-3">
              {spec.length === 0 && <p className="text-sm text-slate-400">This request type has no additional fields.</p>}
              {spec.filter((f) => f.key !== 'standard_of_proof' && f.key !== 'pc_statement').map((f) => (
                <SpecField
                  key={f.key} f={f}
                  required={f.key === 'search_targets' ? !personSel : f.req}
                  hint={f.key === 'search_targets'
                    ? 'Required unless a subject is selected. Structured targets below mirror a line here automatically — this text is what reviewers and the court packet read.'
                    : undefined}
                  value={form[f.key] ?? ''}
                  onChange={(v) => setForm((x) => ({ ...x, [f.key]: v }))}
                />
              ))}
            </Card>
            {supportsTargets && (
              <Card pad="sm" className="space-y-3">
                <h3 className="text-[13px] font-semibold text-white">Structured search targets</h3>
                <p className="text-xs text-slate-400">
                  Attach registry records as typed targets, each with its own rationale.
                  {isEdit ? ' Targets attach immediately to this request.' : ' Targets are attached when the draft is created.'}
                </p>
                {targetItems.length > 0 && (
                  <ul className="space-y-1.5">
                    {targetItems.map((t) => (
                      <li key={t.key} className="flex items-start gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
                        <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-slate-500">
                          {STRUCTURED_TARGET_KIND_LABEL[t.kind]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-200">{t.label}</span>
                          {t.rationale && <span className="block text-xs text-slate-400">{t.rationale}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={t.onRemove}
                          aria-label={`Remove target ${t.label}`}
                          className="min-h-[40px] px-1 text-xs font-semibold text-rose-300 hover:text-rose-200"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                  <Field label="Target kind">
                    {(id) => (
                      <Select id={id} value={tKind} onChange={(e) => { setTKind(e.target.value as StructuredTargetKind); setTSel(null) }}>
                        {STRUCTURED_TARGET_KINDS.map((k) => <option key={k} value={k}>{STRUCTURED_TARGET_KIND_LABEL[k]}</option>)}
                      </Select>
                    )}
                  </Field>
                  <RecordSearchPicker<ThumbPick>
                    // Remount per kind (the Intel-tab idiom): a kind switch
                    // must not keep the previous kind's rows under the new
                    // kind's peek type or reuse its typed query.
                    key={tKind}
                    label="Record" value={tSel} onChange={setTSel} search={targetSearch}
                    placeholder={`Search ${STRUCTURED_TARGET_KIND_LABEL[tKind].toLowerCase()}s…`}
                    {...(TARGET_PEEK[tKind] ? { peekType: TARGET_PEEK[tKind] } : {})}
                    {...(tKind === 'person_record' ? { getThumb: (h: ThumbPick) => h.thumbUrl } : {})}
                  />
                </div>
                <Field label="Rationale — why this target belongs on the warrant">
                  {(id) => <Textarea id={id} rows={2} value={tRationale} onChange={(e) => setTRationale(e.target.value)} />}
                </Field>
                <Button disabled={busy || !tSel} onClick={() => void addTarget()}>+ Add target</Button>
              </Card>
            )}
          </div>
        )}

        {/* ── Step: evidence (P4-08) — packet picks + add new ─────────────── */}
        {step.id === 'evidence' && (() => {
          const listed = isEdit
            ? savedExhibits.filter((e) => !(STRUCTURED_TARGET_KINDS as readonly string[]).includes(e.exhibit_type))
                .map((e) => ({ key: e.id, kind: e.exhibit_type, label: e.display_title, onRemove: () => void removeSavedExhibit(e) }))
            : [
                ...pendingExhibits.map((e, i) => ({ key: `x-${i}`, kind: e.kind, label: e.label, onRemove: () => setPendingExhibits((x) => x.filter((_, j) => j !== i)) })),
                ...pendingEvidence.map((e, i) => ({ key: `n-${i}`, kind: 'new evidence', label: e.title, onRemove: () => setPendingEvidence((x) => x.filter((_, j) => j !== i)) })),
              ]
          return (
            <div className="space-y-4">
              <Card pad="sm" className="space-y-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-white">Supporting items — reviewers see ONLY these</h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Evidence, attachments, finalized reports and case media from this case.
                    {isEdit ? ' Items attach immediately.' : ' Items are attached when the draft is created.'}
                  </p>
                </div>
                {listed.length > 0 && (
                  <ul className="space-y-1.5" aria-label="Selected supporting items">
                    {listed.map((e) => (
                      <li key={e.key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
                        <span className="text-xs font-medium text-slate-400">{humanize(e.kind)}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-200">{e.label}</span>
                        <button type="button" onClick={e.onRemove} aria-label={`Remove ${e.label}`} className="min-h-[40px] px-1 text-xs font-semibold text-rose-300 hover:text-rose-200">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                {!caseId ? (
                  <p className="text-sm text-slate-400">Select a case first.</p>
                ) : (
                  <RelatedRecordPicker
                    sources={exhibitSources(caseRecords)}
                    onPick={(kind, opt) => void pickExhibit(kind, opt.id, opt.label)}
                    onAddLink={(url) => void pickExhibit('external_link', null, url, url)}
                  />
                )}
              </Card>
              <Card pad="sm" className="space-y-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-white">Add new evidence</h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Uploads become case media (custody preserved on the case) and attach here in one step.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Category">
                    {(id) => (
                      <Select id={id} value={evForm.category} onChange={(e) => setEvForm((f) => ({ ...f, category: e.target.value }))}>
                        <option value="">Uncategorized</option>
                        {CASE_MEDIA_CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Why it belongs on the request" hint="Optional — applied to each item added below.">
                    {(id) => <Input id={id} value={evForm.rationale} onChange={(e) => setEvForm((f) => ({ ...f, rationale: e.target.value }))} />}
                  </Field>
                </div>
                {!caseId ? null : fmConfigured() ? (
                  <MediaUploadPanel onUploaded={handleUploaded} onQueueChange={onQueueChange} />
                ) : (
                  <p className="rounded-lg bg-white/5 p-3 text-xs text-slate-400">
                    File upload is not configured (NEXT_PUBLIC_FIVEMANAGE_API_KEY) — paste a hosted URL below instead.
                  </p>
                )}
                <details open={!fmConfigured()}>
                  <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-300">Or paste a hosted URL</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
                    <Field label="Title">{(id) => <Input id={id} value={evForm.title} onChange={(e) => setEvForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Dashcam still" />}</Field>
                    <Field label="URL">{(id) => <Input id={id} value={evForm.url} onChange={(e) => setEvForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" className="font-mono text-xs" />}</Field>
                    <Field label="Type">
                      {(id) => (
                        <Select id={id} value={evForm.type} onChange={(e) => setEvForm((f) => ({ ...f, type: e.target.value as MediaType }))}>
                          {MEDIA_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      )}
                    </Field>
                    <div className="flex items-end"><Button disabled={busy || !caseId} onClick={() => void addPastedEvidence()}>Add</Button></div>
                  </div>
                </details>
                {uploadActive > 0 && <p className="text-xs text-amber-200">{uploadActive} upload{uploadActive === 1 ? '' : 's'} in progress — wait before continuing.</p>}
              </Card>
            </div>
          )
        })()}

        {/* ── Step: narrative & justification ─────────────────────────────── */}
        {step.id === 'narrative' && (
          <Card pad="sm" className="space-y-3">
            <Field label={requestType === 'warrant' ? 'Warrant title' : 'Title'} required>
              {(id) => (
                <Input
                  id={id} value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={requestType === 'warrant'
                    ? (subtype === 'search_warrant' ? 'Search Warrant — target (case)' : 'Arrest Warrant — name (case)')
                    : 'Subpoena — records sought'}
                />
              )}
            </Field>
            {requestType === 'warrant' && (
              <Field label="Priority" required>
                {(id) => (
                  <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {['Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                )}
              </Field>
            )}
            {requestType === 'warrant' && (
              <>
                {/* P4-04: both live in form_data; the server refuses a warrant
                    submission without them. */}
                <Field label="Standard of proof" required hint="The standard the request must meet; the statement below has to support it.">
                  {(id) => (
                    <Select id={id} value={form.standard_of_proof ?? ''} onChange={(e) => setForm((x) => ({ ...x, standard_of_proof: e.target.value }))}>
                      <option value="">Choose…</option>
                      {STANDARDS_OF_PROOF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Probable-cause statement" required hint="The facts, in order, that establish the standard — what was seen, by whom, and how it ties the target to the offence.">
                  {(id) => <Textarea id={id} rows={6} value={form.pc_statement ?? ''} onChange={(e) => setForm((x) => ({ ...x, pc_statement: e.target.value }))} />}
                </Field>
              </>
            )}
            <Field label={requestType === 'warrant' ? 'Description / justification' : 'Reason for subpoena'} required>
              {(id) => <Textarea id={id} rows={6} value={narrative} onChange={(e) => setNarrative(e.target.value)} />}
            </Field>
            <Field label="Classification" hint="Leave on the default unless the request must be restricted. Sealed requests keep an explicit-assignment audience.">
              {(id) => (
                <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {!isEdit && <option value="">Default for this type</option>}
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              )}
            </Field>
          </Card>
        )}

        {/* ── Step 4: review & submit ──────────────────────────────────────── */}
        {step.id === 'review' && (
          <div className="space-y-3">
            <Card pad="sm" className="space-y-2">
              <Row label="Type">{humanize(requestType)} · {humanize(subtype)}</Row>
              <Row label="Case">{caseSel?.label ?? '—'}</Row>
              {reviewRouting && <Row label="Legal routing">{bureauShort(reviewRouting)} — Bureau Lead review</Row>}
              <Row label={requestType === 'warrant' ? 'Subject' : 'Recipient'}>
                {requestType === 'subpoena' && recipientType === 'entity'
                  ? (recipientName.trim() || '—')
                  /* update_legal_draft can replace but never clear the person,
                     so a cleared picker falls back to the saved subject. */
                  : (personSel?.label ?? row?.person_name_snapshot ?? '—')}
              </Row>
              {requestType === 'warrant' && <Row label="Priority">{priority}</Row>}
              <Row label="Classification">{classification ? humanize(classification) : 'Default for this type'}</Row>
              <Row label="Title">{title.trim() || '—'}</Row>
              {requestType === 'warrant' && (
                <>
                  <Row label="Standard of proof">{STANDARDS_OF_PROOF.find(([v]) => v === form.standard_of_proof)?.[1] ?? '—'}</Row>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">Probable-cause statement</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{(form.pc_statement ?? '').trim() || '—'}</p>
                  </div>
                </>
              )}
              <div>
                <p className="text-xs font-semibold text-slate-400">
                  {requestType === 'warrant' ? 'Description / justification' : 'Reason for subpoena'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{narrative.trim() || '—'}</p>
              </div>
              {spec.filter((f) => f.key !== 'standard_of_proof' && f.key !== 'pc_statement' && String(form[f.key] ?? '').trim()).map((f) => (
                <Row key={f.key} label={f.label}>
                  <span className="whitespace-pre-wrap">{form[f.key]}</span>
                </Row>
              ))}
              <div>
                <p className="text-xs font-semibold text-slate-400">Charges ({chargeItems.length})</p>
                {chargeItems.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">None selected.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-200">
                    {chargeItems.map((c) => {
                      const cc = caseCharges?.find((x) => x.id === c.case_charge_id)
                      return <li key={c.case_charge_id}><span className="font-mono text-badge-200">{cc?.code ?? '—'}</span> {cc?.offense ?? 'Charge'} ×{c.counts}</li>
                    })}
                  </ul>
                )}
              </div>
              <Row label="Supporting items">{exhibitCount}</Row>
              {targetItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400">Structured targets</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-200">
                    {targetItems.map((t) => (
                      <li key={t.key}>{STRUCTURED_TARGET_KIND_LABEL[t.kind]}: {t.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            {/* Server-mirror checklist (the same rows the dossier preview shows). */}
            <Card pad="sm" className="space-y-1.5">
              <h3 className="text-[13px] font-semibold text-white">Requirements</h3>
              <ul className="space-y-1">
                {reviewChecklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2 text-sm">
                    <span className={c.ok ? 'text-emerald-300' : c.blocking ? 'text-rose-300' : 'text-amber-300'} aria-hidden>
                      {c.ok ? '✓' : c.blocking ? '✗' : '⚠'}
                    </span>
                    <span className={c.ok ? 'text-slate-300' : 'text-slate-200'}>{c.label}</span>
                    {!c.ok && !c.blocking && <span className="text-xs text-amber-300/80">the reviewer must record an override for an empty packet</span>}
                  </li>
                ))}
              </ul>
            </Card>
            {isEdit && isReturned && (
              <Card pad="sm" className="space-y-3">
                {unresolvedItems.length > 0 && (
                  <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                    <p className="font-semibold">{unresolvedItems.length} requested revision{unresolvedItems.length === 1 ? ' is' : 's are'} still unresolved:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {unresolvedItems.map((i) => <li key={i.id}><span className="font-semibold">{fieldLabel(i.field)}</span> — {i.note}</li>)}
                    </ul>
                    <p className="mt-1 text-amber-200/80">Mark them resolved from the request&rsquo;s dossier, or resubmit and let the reviewer see them open.</p>
                  </div>
                )}
                {isFastReturn && (
                  <>
                    <p className="text-xs text-slate-300">
                      A corrected request returns directly to the judicial queue. Check below only if you
                      made a material change.
                    </p>
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={materialChange}
                        onChange={(e) => setMaterialChange(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-badge-500"
                      />
                      I made a material change (requires renewed bureau review)
                    </label>
                  </>
                )}
                <Field
                  label="What changed since the last version?"
                  required
                  hint="Required on every resubmission — saved with the new version so reviewers can see what changed at a glance."
                >
                  {(id) => <Textarea id={id} rows={3} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />}
                </Field>
              </Card>
            )}
            {reviewIssues.length > 0 && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <p className="font-semibold">Still needed before you can submit:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {reviewIssues.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            )}
            {reviewAdvisories.length > 0 && (
              <div role="status" className="rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-xs text-slate-300">
                <p className="font-semibold text-slate-200">Worth a look (does not block):</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {reviewAdvisories.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Current-step issues (shown after an attempted Continue) ─────── */}
        {attempted && step.id !== 'review' && currentIssues.length > 0 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            <ul className="list-disc space-y-0.5 pl-4">
              {currentIssues.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        )}

        {/* ── Navigation ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
          <Button onClick={prev} disabled={stepIdx === 0}>← Back</Button>
          {step.id !== 'review' ? (
            <Button variant="primary" disabled={step.id === 'evidence' && uploadActive > 0} onClick={next}>Continue</Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {isEdit ? (
                <>
                  <Button disabled={busy} onClick={() => void saveEdit(false)}>Save draft</Button>
                  <Button variant="primary" disabled={busy || uploadActive > 0} onClick={() => void saveEdit(true)}>
                    {isReturned ? 'Resubmit for review' : 'Submit for bureau review'}
                  </Button>
                </>
              ) : (
                <>
                  <Button disabled={busy || uploadActive > 0} onClick={() => void createRequest(false)}>Save as draft</Button>
                  <Button variant="primary" disabled={busy || uploadActive > 0} onClick={() => void createRequest(true)}>
                    Create &amp; submit for bureau review
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
