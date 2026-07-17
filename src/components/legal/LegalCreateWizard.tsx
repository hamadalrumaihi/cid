'use client'

/** Guided legal-request wizard (DOJ redesign §15, phase 3) — the investigator
 *  landing's creation path, replacing the long linear create form. Steps:
 *  type cards → case & target → type-specific details (+ structured
 *  search-warrant targets) → narrative & justification → review & submit.
 *
 *  Backend behaviour is preserved exactly: creation is the create_legal_request
 *  definer RPC (verbatim args), draft edits stay on update_legal_draft,
 *  submission on submit_legal_request_to_cid (now optionally carrying
 *  p_change_summary on a returned-request resubmission), and structured
 *  targets ride the existing add_legal_exhibit flow with the new kinds +
 *  per-target p_rationale. Validation is the pure legalWizardIssues model —
 *  the exact client mirror of the server checks; the server revalidates all
 *  of it. Case/person/target pickers are bounded server-backed searches
 *  (ilikeAny + limit 20) — RLS scopes every row; nothing here decides access.
 *
 *  EDIT mode ({ mode: 'edit' }) revises an existing draft/returned request —
 *  the dossier's own draft editor (RequestSection) remains the in-dossier
 *  entry path; this is the landing's guided alternative and the surface that
 *  captures the change summary on resubmission. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import { ilikeAny, list, rpc } from '@/lib/db'
import { Drafts, type Draft } from '@/lib/drafts'
import { timeAgo } from '@/lib/format'
import {
  CLASSIFICATIONS, SOCIAL_PLATFORMS, SUBPOENA_FIELDS, SUBPOENA_TYPES,
  WARRANT_FIELDS, WARRANT_TYPES, isEditableDraft,
  type LegalRequest, type SubpoenaType, type WarrantType,
} from '@/lib/justice'
import {
  LEGAL_WIZARD_STEPS, STRUCTURED_TARGET_KINDS, STRUCTURED_TARGET_KIND_LABEL,
  appendSearchTargetLine, humanize, legalWizardDraftIssues, legalWizardIssues,
  structuredTargetLine, subtypeRequiresPerson, subtypeSupportsStructuredTargets,
  type LegalWizardInput, type StructuredTargetKind,
} from '@/lib/legalWorkflow'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { Row, sanitizeStash, type DraftShape } from '@/components/justice/dossier/dossierShared'

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
const CID_BUREAUS = ['LSB', 'BCB', 'SAB']
interface CasePick extends PickedRecord {
  number: string
  /** JTF case with no originating bureau — a supervisor must set it before submission. */
  bureauWarning: boolean
}
interface TargetDraft { kind: StructuredTargetKind; sourceId: string; label: string; rationale: string }
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
}

/** localStorage is user-editable — coerce a recovered stash back into the
 *  exact controlled-input shapes so a stale/malformed one can't break state. */
function asPick(v: unknown): PickedRecord | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return null
  return { id: o.id, label: o.label, ...(typeof o.sublabel === 'string' ? { sublabel: o.sublabel } : {}) }
}
function asCasePick(v: unknown): CasePick | null {
  const base = asPick(v)
  if (!base) return null
  const o = v as Record<string, unknown>
  return { ...base, number: typeof o.number === 'string' ? o.number : '', bureauWarning: o.bureauWarning === true }
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
      className={`min-h-[64px] rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500 ${
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
  const [personSel, setPersonSel] = useState<PickedRecord | null>(null)
  const [recipientType, setRecipientType] = useState<'player' | 'entity'>('player')
  const [recipientName, setRecipientName] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [narrative, setNarrative] = useState('')
  const [classification, setClassification] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<TargetDraft[]>([])
  const [savedTargets, setSavedTargets] = useState<Tables<'legal_request_exhibits'>[]>([])
  const [changeSummary, setChangeSummary] = useState('')
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
            bureauWarning: false,
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
          const ex = await list('legal_request_exhibits', { eq: { legal_request_id: editId }, order: 'created_at' })
          if (!cancelled) setSavedTargets(ex.filter((e) => (STRUCTURED_TARGET_KINDS as readonly string[]).includes(e.exhibit_type)))
        }
        if (!cancelled) setLoadState('ready')
      } catch { if (!cancelled) { setRow(null); setLoadState('ready') } }
    })()
    return () => { cancelled = true }
  }, [editId])

  /* ── Never-lose-work stashes (restore is always user-triggered) ───────────── */
  // CREATE: same Drafts key family as the old form (`legal:new:<kind>`).
  const stashKey = !isEdit && requestType ? `legal:new:${requestType}` : null
  const [pendingStash, setPendingStash] = useState<Draft<WizardStash> | null>(null)
  const loadedStashKey = useRef<string | null>(null)
  useEffect(() => {
    if (!stashKey || loadedStashKey.current === stashKey) return
    loadedStashKey.current = stashKey
    setPendingStash(Drafts.load<WizardStash>(stashKey))
  }, [stashKey])
  const hasContent = !!(title.trim() || narrative.trim() || recipientName.trim()
    || caseSel || personSel || targets.length || Object.keys(form).length)
  useEffect(() => {
    if (!stashKey || !hasContent) return
    Drafts.save(stashKey, {
      subtype, caseSel, personSel, recipientType, recipientName,
      title, priority, narrative, classification, form, targets,
    } satisfies WizardStash)
  }, [stashKey, hasContent, subtype, caseSel, personSel, recipientType, recipientName, title, priority, narrative, classification, form, targets])
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
    setPendingStash(null)
  }
  const discardStash = () => { if (stashKey) Drafts.clear(stashKey); setPendingStash(null) }

  // EDIT: the dossier's key + shape (`legal:edit:<id>`, DraftShape) so a stash
  // typed in either editor is recoverable from the other.
  const [editPending, setEditPending] = useState<Draft<DraftShape> | null>(
    () => (editId ? Drafts.load<DraftShape>(`legal:edit:${editId}`) : null),
  )
  useEffect(() => {
    if (!editId || !seedJson) return
    const shape: DraftShape = { title, priority, narrative, classification, form }
    if (JSON.stringify(shape) === seedJson) return
    Drafts.save(`legal:edit:${editId}`, shape)
  }, [editId, seedJson, title, priority, narrative, classification, form])

  /* ── Bounded server-backed pickers (ilike + limit 20; RLS scopes rows) ────── */
  const searchCases = useCallback(async (q: string): Promise<CasePick[]> => {
    const or = ilikeAny(['case_number', 'title'], q)
    const rows = (await list('cases', {
      select: 'id,case_number,title,bureau,originating_bureau',
      order: 'created_at', ascending: false, limit: 20, ...(or ? { or } : {}),
    })) as unknown as Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'bureau' | 'originating_bureau'>[]
    return rows.map((c) => ({
      id: c.id,
      number: c.case_number,
      label: `${c.case_number} — ${c.title ?? 'Untitled'}`,
      sublabel: c.bureau === 'JTF' && c.originating_bureau ? `JTF · origin ${c.originating_bureau}` : c.bureau,
      bureauWarning: !CID_BUREAUS.includes(c.bureau) && !CID_BUREAUS.includes(c.originating_bureau ?? ''),
    }))
  }, [])
  const searchPersons = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const or = ilikeAny(['name', 'alias'], q)
    const rows = (await list('persons', {
      select: 'id,name,alias', order: 'name', limit: 20, ...(or ? { or } : {}),
    })) as unknown as Pick<Tables<'persons'>, 'id' | 'name' | 'alias'>[]
    return rows.map((p) => ({ id: p.id, label: p.name, ...(p.alias ? { sublabel: `“${p.alias}”` } : {}) }))
  }, [])

  /* ── Structured search-warrant targets ────────────────────────────────────── */
  const [tKind, setTKind] = useState<StructuredTargetKind>('person_record')
  const [tSel, setTSel] = useState<PickedRecord | null>(null)
  const [tRationale, setTRationale] = useState('')
  const targetSearch = useCallback(async (q: string): Promise<PickedRecord[]> => {
    if (tKind === 'person_record') return searchPersons(q)
    if (tKind === 'vehicle') {
      const or = ilikeAny(['plate', 'model'], q)
      const rows = (await list('vehicles', {
        select: 'id,plate,model,color', order: 'updated_at', ascending: false, limit: 20, ...(or ? { or } : {}),
      })) as unknown as Pick<Tables<'vehicles'>, 'id' | 'plate' | 'model' | 'color'>[]
      return rows.map((v) => ({ id: v.id, label: v.plate, sublabel: [v.model, v.color].filter(Boolean).join(' · ') || undefined }))
    }
    if (tKind === 'place') {
      const or = ilikeAny(['name', 'area'], q)
      const rows = (await list('places', {
        select: 'id,name,area,type', order: 'updated_at', ascending: false, limit: 20, ...(or ? { or } : {}),
      })) as unknown as Pick<Tables<'places'>, 'id' | 'name' | 'area' | 'type'>[]
      return rows.map((p) => ({ id: p.id, label: p.name, sublabel: [humanize(p.type), p.area].filter(Boolean).join(' · ') || undefined }))
    }
    // prior_legal_request — RLS already scopes which requests come back.
    const or = ilikeAny(['request_number', 'title'], q)
    const rows = (await list('legal_requests', {
      select: 'id,request_number,title,request_type,subtype,classification',
      order: 'created_at', ascending: false, limit: 20, ...(or ? { or } : {}),
    })) as unknown as Pick<Tables<'legal_requests'>, 'id' | 'request_number' | 'title' | 'request_type' | 'subtype' | 'classification'>[]
    return rows
      .filter((r) => r.id !== editId)
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
      setSavedTargets((x) => [...x, saved])
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
    setSavedTargets((x) => x.filter((t) => t.id !== e.id))
  }

  /* ── Derivations (pure model) ─────────────────────────────────────────────── */
  const steps = isEdit ? LEGAL_WIZARD_STEPS.filter((s) => s.id !== 'type') : LEGAL_WIZARD_STEPS
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const input: LegalWizardInput = {
    requestType: requestType ?? 'warrant',
    subtype,
    caseId: caseSel?.id ?? '',
    personId: personSel?.id ?? '',
    recipientType, recipientName, title, priority, narrative, form,
  }
  const currentIssues = legalWizardIssues(step.id, input)
  const reviewIssues = legalWizardIssues('review', input)
  const firstBlocked = steps.findIndex((s) => legalWizardIssues(s.id, input).length > 0)
  const maxReachable = firstBlocked === -1 ? steps.length - 1 : firstBlocked
  const requiresPerson = subtypeRequiresPerson(requestType ?? '', subtype)
  const supportsTargets = subtypeSupportsStructuredTargets(requestType ?? '', subtype)
  const spec: FieldSpec[] = requestType === 'warrant'
    ? WARRANT_FIELDS[subtype as WarrantType] ?? []
    : requestType === 'subpoena' ? SUBPOENA_FIELDS[subtype as SubpoenaType] ?? [] : []
  const isReturned = !!row && row.review_status.startsWith('returned_by')

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
    let submitted = false
    if (submit) {
      const sr = await rpc('submit_legal_request_to_cid', { p_request: id })
      if (sr.error) toast(`Draft created, but submission failed: ${sr.error.message}`, 'warn')
      else submitted = true
    }
    setBusy(false)
    if (stashKey) Drafts.clear(stashKey)
    if (targetFailures) toast(`${targetFailures} structured target(s) could not be attached — add them on the request's Supporting section.`, 'warn')
    toast(
      submitted
        ? 'Request submitted for CID supervisor review.'
        : 'Draft created — add supporting items, then submit for CID review.',
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
    if (!submit) {
      setBusy(false)
      Drafts.clear(`legal:edit:${row.id}`)
      toast('Draft saved.', 'success')
      onDone(row.id)
      return
    }
    const sr = await rpc('submit_legal_request_to_cid', {
      p_request: row.id,
      p_change_summary: isReturned && changeSummary.trim() ? changeSummary.trim() : undefined,
    })
    setBusy(false)
    if (sr.error) { toast(sr.error.message, 'danger'); return }
    Drafts.clear(`legal:edit:${row.id}`)
    toast('Submitted for CID supervisor review.', 'success')
    onDone(row.id)
  }

  /* ── Gate the edit path (server re-checks; this is honest UX) ─────────────── */
  if (loadState === 'loading') return <Notice text="Loading request…" />
  if (isEdit && (!row || row.created_by !== me || !isEditableDraft(row))) {
    return (
      <EmptyState
        icon="⚖️"
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
    <div className="space-y-4">
      <PageHeader
        eyebrow="Legal requests"
        title={isEdit ? 'Revise legal request' : 'File legal request'}
        subtitle={isEdit && row
          ? `${row.request_number} — ${row.title}`
          : 'A guided draft. Every requirement is revalidated by the server on submission.'}
        actions={<Button onClick={onCancel}>Cancel</Button>}
      />

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
        <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">Draft from {timeAgo(pendingStash.at)} found — restore your unsaved {requestType === 'subpoena' ? 'subpoena' : 'warrant request'}?</span>
          <Button size="sm" variant="secondary" onClick={restoreStash}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardStash}>Discard</Button>
        </div>
      )}
      {isEdit && row && editPending && editPending.at > Date.parse(row.updated_at) && (
        <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">
            An unsaved draft from {timeAgo(editPending.at)} was found on this device (newer than the saved request).
          </span>
          <Button size="sm" variant="secondary" onClick={() => {
            const s = sanitizeStash(editPending.data, row.classification)
            setTitle(s.title || row.title); setPriority(s.priority || row.priority || 'Medium')
            setNarrative(s.narrative); setClassification(s.classification); setForm(s.form)
            setEditPending(null)
          }}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={() => { Drafts.clear(`legal:edit:${row.id}`); setEditPending(null) }}>Discard</Button>
        </div>
      )}

      <div className="max-w-3xl space-y-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-white outline-none">
          Step {stepIdx + 1} of {steps.length} — {step.label}
        </h2>

        {/* ── Step 0: type picker ─────────────────────────────────────────── */}
        {step.id === 'type' && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
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
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Subpoenas — reviewed on the DOJ route (DA / AG)
              </h3>
              {SUBPOENA_GROUPS.map((g) => (
                <div key={g.label} className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
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
            {caseSel?.bureauWarning && (
              <p className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
                This JTF case has no originating bureau on record — a CID supervisor must set it (case Overview)
                before this request can be submitted to DOJ.
              </p>
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
                placeholder="Search by name or alias…"
                hint={isEdit && row?.person_id
                  ? 'The linked person can be replaced, not removed, while revising.'
                  : 'Chosen from the canonical Persons registry.'}
              />
            )}
            {requestType === 'subpoena' && recipientType === 'entity' && (
              <Field label="Recipient name" required>
                {(id) => <Input id={id} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Business or entity name" />}
              </Field>
            )}
          </Card>
        )}

        {/* ── Step 2: type-specific details (+ structured targets) ────────── */}
        {step.id === 'details' && (
          <div className="space-y-4">
            <Card pad="sm" className="space-y-3">
              {spec.length === 0 && <p className="text-sm text-slate-400">This request type has no additional fields.</p>}
              {spec.map((f) => (
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
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Structured search targets</h3>
                <p className="text-xs text-slate-400">
                  Attach registry records as typed targets, each with its own rationale.
                  {isEdit ? ' Targets attach immediately to this request.' : ' Targets are attached when the draft is created.'}
                </p>
                {targetItems.length > 0 && (
                  <ul className="space-y-1.5">
                    {targetItems.map((t) => (
                      <li key={t.key} className="flex items-start gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
                        <span className="mt-0.5 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
                  <RecordSearchPicker
                    label="Record" value={tSel} onChange={setTSel} search={targetSearch}
                    placeholder={`Search ${STRUCTURED_TARGET_KIND_LABEL[tKind].toLowerCase()}s…`}
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

        {/* ── Step 3: narrative & justification ───────────────────────────── */}
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
              <div>
                <p className="text-xs font-semibold text-slate-400">
                  {requestType === 'warrant' ? 'Description / justification' : 'Reason for subpoena'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{narrative.trim() || '—'}</p>
              </div>
              {spec.filter((f) => String(form[f.key] ?? '').trim()).map((f) => (
                <Row key={f.key} label={f.label}>
                  <span className="whitespace-pre-wrap">{form[f.key]}</span>
                </Row>
              ))}
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
            {isEdit && isReturned && (
              <Card pad="sm">
                <Field
                  label="What changed since the last version? (optional)"
                  hint="Stored on the new immutable version so reviewers see the delta at a glance."
                >
                  {(id) => <Textarea id={id} rows={3} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />}
                </Field>
              </Card>
            )}
            {reviewIssues.length > 0 && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <p className="font-semibold">Before submission the server will require:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {reviewIssues.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            )}
            {!isEdit && (
              <p className="text-xs text-slate-400">
                Supporting evidence, attachments, finalized reports and links are selected on the draft&rsquo;s
                Supporting section — you can save as a draft first and submit from there later.
              </p>
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
            <Button variant="primary" onClick={next}>Continue</Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {isEdit ? (
                <>
                  <Button disabled={busy} onClick={() => void saveEdit(false)}>Save draft</Button>
                  <Button variant="primary" disabled={busy} onClick={() => void saveEdit(true)}>
                    Submit for CID review
                  </Button>
                </>
              ) : (
                <>
                  <Button disabled={busy} onClick={() => void createRequest(false)}>Save as draft</Button>
                  <Button variant="primary" disabled={busy} onClick={() => void createRequest(true)}>
                    Create &amp; submit for CID review
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
