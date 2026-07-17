'use client'

/** CID Legal Requests — the investigator side of the DOJ legal-review system.
 *  Queues (drafts, awaiting CID review, returned, submitted, My Warrants /
 *  My Subpoenas), plus the File Warrant Request and File Subpoena forms. The
 *  case selector only offers cases the officer can already access (RLS), the
 *  suspect/recipient comes from the canonical Persons registry, and every
 *  create/submit is a definer RPC. Deep link: /legal?request=<id>. */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { Drafts, type Draft } from '@/lib/drafts'
import { timeAgo } from '@/lib/format'
import { SUBPOENA_FIELDS, SUBPOENA_TYPES, SOCIAL_PLATFORMS, WARRANT_FIELDS, WARRANT_TYPES, type SubpoenaType, type WarrantType } from '@/lib/justice'
import { toast } from '@/lib/toast'
import { dispositionFor, OP_GROUP_LABEL, type OpGroup } from '@/lib/legalWorkflow'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { LegalRequestDetail } from '@/components/justice/LegalRequestDetail'
import { CardQueueSection, buildLegalViewer, useLegalRequests } from '@/components/justice/legalShared'

/** Canonical operational groups in the order the investigator should triage
 *  them (spec §7). Each request lands in exactly ONE group via dispositionFor,
 *  so a request never double-appears (e.g. "My Warrants" + "Submitted to DOJ"). */
const GROUP_ORDER: OpGroup[] = [
  'needs_action', 'returned_to_you', 'available_to_claim', 'assigned_to_you',
  'waiting_cid', 'waiting_doj', 'waiting_prosecution', 'waiting_judge',
  'issued_active', 'service_return_pending', 'completed', 'closed',
]

export function LegalView() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading legal requests…</p>}>
      <LegalViewInner />
    </Suspense>
  )
}

function LegalViewInner() {
  const auth = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const openId = params.get('request')
  const [creating, setCreating] = useState<null | 'warrant' | 'subpoena'>(null)
  const { requests, loading } = useLegalRequests()

  const open = (id: string) => router.push(`/legal?request=${encodeURIComponent(id)}`)
  const back = () => router.push('/legal')

  // Bucket every request into its ONE canonical operational group (the model
  // resolves supervisor-actionable vs waiting, claim eligibility and awareness).
  const viewer = buildLegalViewer(auth)
  const now = useNow()
  const grouped = useMemo(() => {
    const map = new Map<OpGroup, typeof requests>()
    for (const r of requests) {
      const g = dispositionFor(r, viewer, now).group
      const bucket = map.get(g)
      if (bucket) bucket.push(r)
      else map.set(g, [r])
    }
    return map
    // `viewer` is recreated each render but is fully determined by the auth
    // fields below; `now` is render-stable (useNow). requests drives the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, now, auth.profile?.id, auth.justiceRole, auth.isOwner])

  if (openId) return <LegalRequestDetail requestId={openId} onBack={back} />
  if (creating) {
    return (
      <CreateRequestForm
        kind={creating}
        onCancel={() => setCreating(null)}
        onCreated={(id) => { setCreating(null); open(id) }}
      />
    )
  }

  const active = GROUP_ORDER.filter((g) => (grouped.get(g)?.length ?? 0) > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Legal Requests"
        subtitle="Warrant and subpoena requests you filed or can act on."
        actions={
          <>
            <Button variant="primary" onClick={() => setCreating('warrant')}>+ File Warrant Request</Button>
            <Button variant="primary" onClick={() => setCreating('subpoena')}>+ File Subpoena</Button>
          </>
        }
      />
      {loading && <p className="text-sm text-slate-400">Loading legal requests…</p>}
      {!loading && active.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-sm text-slate-400">
          No legal requests yet — file a warrant request or subpoena above.
        </p>
      )}
      {active.map((g) => (
        <CardQueueSection
          key={g}
          title={OP_GROUP_LABEL[g]}
          rows={grouped.get(g) ?? []}
          viewer={viewer}
          now={now}
          onOpen={open}
        />
      ))}
    </div>
  )
}

/* ---- Create form (warrant request / subpoena) ----------------------------- */

type SlimCase = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'bureau' | 'originating_bureau'>
type SlimPerson = Pick<Tables<'persons'>, 'id' | 'name' | 'alias'>

/** Never-lose-work stash for the create form (same Drafts scheme as report
 *  editors: `legal:new:<kind>`). Restore is always user-triggered. */
interface LegalDraftData {
  title: string
  priority: string
  narrative: string
  subtype: SubpoenaType
  warrantSubtype: WarrantType
  recipientType: 'player' | 'entity'
  recipientName: string
  form: Record<string, string>
  caseId: string
  personId: string
}

function CreateRequestForm({ kind, onCancel, onCreated }: {
  kind: 'warrant' | 'subpoena'
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const [cases, setCases] = useState<SlimCase[]>([])
  const [persons, setPersons] = useState<SlimPerson[]>([])
  const [caseQuery, setCaseQuery] = useState('')
  const [personQuery, setPersonQuery] = useState('')
  const [caseId, setCaseId] = useState('')
  const [personId, setPersonId] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [narrative, setNarrative] = useState('')
  const [subtype, setSubtype] = useState<SubpoenaType>('testimony')
  const [warrantSubtype, setWarrantSubtype] = useState<WarrantType>('arrest_warrant')
  const [recipientType, setRecipientType] = useState<'player' | 'entity'>('player')
  const [recipientName, setRecipientName] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // Draft recovery: an existing stash surfaces as a banner (read once,
  // lazily — never auto-filled); Restore applies it, Discard clears it.
  const draftKey = `legal:new:${kind}`
  const [pendingDraft, setPendingDraft] = useState<Draft<LegalDraftData> | null>(() => Drafts.load<LegalDraftData>(draftKey))
  const restoreDraft = () => {
    if (!pendingDraft) return
    const d = pendingDraft.data
    setTitle(d.title); setPriority(d.priority); setNarrative(d.narrative)
    setSubtype(d.subtype); setWarrantSubtype(d.warrantSubtype ?? 'arrest_warrant')
    setRecipientType(d.recipientType); setRecipientName(d.recipientName)
    setForm(d.form); setCaseId(d.caseId); setPersonId(d.personId)
    setPendingDraft(null)
  }
  const discardDraft = () => { Drafts.clear(draftKey); setPendingDraft(null) }

  // Stash while typing (write-only effect — no state changes). Pristine forms
  // never save, so an unrestored draft is not overwritten by an empty mount.
  const hasContent = !!(title.trim() || narrative.trim() || recipientName.trim() || caseId || personId || Object.keys(form).length)
  useEffect(() => {
    if (!hasContent) return
    Drafts.save(draftKey, { title, priority, narrative, subtype, warrantSubtype, recipientType, recipientName, form, caseId, personId } satisfies LegalDraftData)
  }, [draftKey, hasContent, title, priority, narrative, subtype, warrantSubtype, recipientType, recipientName, form, caseId, personId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cs, ps] = await Promise.all([
          list('cases', { select: 'id,case_number,title,bureau,originating_bureau', order: 'created_at', ascending: false }) as unknown as Promise<SlimCase[]>,
          list('persons', { select: 'id,name,alias', order: 'name' }) as unknown as Promise<SlimPerson[]>,
        ])
        if (cancelled) return
        setCases(cs); setPersons(ps)
      } catch { /* pickers degrade to empty */ }
    })()
    return () => { cancelled = true }
  }, [])

  const filteredCases = useMemo(() => {
    const q = caseQuery.trim().toLowerCase()
    const base = q
      ? cases.filter((c) => c.case_number.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q))
      : cases
    return base.slice(0, 30)
  }, [cases, caseQuery])
  const filteredPersons = useMemo(() => {
    const q = personQuery.trim().toLowerCase()
    const base = q
      ? persons.filter((p) => p.name.toLowerCase().includes(q) || (p.alias ?? '').toLowerCase().includes(q))
      : persons
    return base.slice(0, 30)
  }, [persons, personQuery])

  const selectedCase = cases.find((c) => c.id === caseId)
  const needsBureauResolution = !!selectedCase && !['LSB', 'BCB', 'SAB'].includes(selectedCase.bureau)
    && !['LSB', 'BCB', 'SAB'].includes(selectedCase.originating_bureau ?? '')
  const spec = kind === 'subpoena' ? SUBPOENA_FIELDS[subtype] : WARRANT_FIELDS[warrantSubtype]
  // Search warrants may target a place/property/vehicle with no suspect — the
  // server accepts a search-target-only search warrant, so the suspect is
  // optional there (arrest warrants still require it).
  const suspectOptional = kind === 'warrant' && warrantSubtype === 'search_warrant'

  const setF = (k: string, val: string) => setForm((f) => ({ ...f, [k]: val }))

  const suggestTitle = () => {
    const person = persons.find((p) => p.id === personId)
    if (kind === 'warrant' && person && selectedCase && !title.trim()) {
      const label = warrantSubtype === 'search_warrant' ? 'Search Warrant' : 'Arrest Warrant'
      setTitle(`${label} — ${person.name} (${selectedCase.case_number})`)
    }
  }

  const create = async () => {
    if (!caseId) { toast('Select a case.', 'warn'); return }
    if (!title.trim()) { toast('A title is required.', 'warn'); return }
    if (!narrative.trim()) { toast(`A ${kind === 'warrant' ? 'description / justification' : 'reason for subpoena'} is required.`, 'warn'); return }
    if (kind === 'warrant') {
      if (!suspectOptional && !personId) { toast('Search and select the suspect from the Persons registry.', 'warn'); return }
      // Mirror the server rule: a search warrant needs a subject OR at least
      // one search target.
      if (suspectOptional && !personId && !String(form.search_targets ?? '').trim()) {
        toast('A search warrant needs a subject or at least one search target.', 'warn'); return
      }
    }
    if (kind === 'subpoena') {
      if (recipientType === 'player' && !personId) { toast('Search and select the player recipient.', 'warn'); return }
      if (recipientType === 'entity' && !recipientName.trim()) { toast('A recipient name is required.', 'warn'); return }
    }
    const missing = spec.filter((f) => f.req && !String(form[f.key] ?? '').trim())
    if (missing.length) { toast(`Required: ${missing.map((f) => f.label).join(', ')}`, 'warn'); return }
    setBusy(true)
    const res = await rpc('create_legal_request', {
      p_case: caseId,
      p_request_type: kind,
      p_subtype: kind === 'warrant' ? warrantSubtype : subtype,
      p_title: title.trim(),
      p_priority: kind === 'warrant' ? priority : undefined,
      p_narrative: narrative,
      p_person: (kind === 'warrant' || recipientType === 'player') ? (personId || undefined) : undefined,
      p_recipient_type: kind === 'subpoena' ? recipientType : undefined,
      p_recipient_name: kind === 'subpoena' && recipientType === 'entity' ? recipientName.trim() : undefined,
      p_form: form,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    Drafts.clear(draftKey)
    toast('Draft created — add supporting items, then submit for CID review.', 'success')
    if (res.data) onCreated(res.data.id)
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <Button onClick={onCancel}>← Cancel</Button>
        <h2 className="text-lg font-bold text-white">{kind === 'warrant' ? 'File Warrant Request' : 'File Subpoena'}</h2>
      </div>

      {pendingDraft && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">Draft from {timeAgo(pendingDraft.at)} found — restore your unsaved {kind === 'warrant' ? 'warrant request' : 'subpoena'}?</span>
          <Button size="sm" variant="secondary" onClick={restoreDraft}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
        </div>
      )}

      <Field label="Case" required>
        {(id) => (
          <div className="space-y-1.5">
            <Input id={id} value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} placeholder="Search case number or title…" />
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Select case">
              <option value="">Choose a case…</option>
              {filteredCases.map((c) => (
                <option key={c.id} value={c.id}>{c.case_number} — {c.title ?? 'Untitled'} ({c.bureau}{c.bureau === 'JTF' && c.originating_bureau ? ` · origin ${c.originating_bureau}` : ''})</option>
              ))}
            </Select>
          </div>
        )}
      </Field>
      {needsBureauResolution && (
        <p className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
          This JTF case has no originating bureau on record — a CID supervisor must set it (case Overview) before
          this request can be submitted to DOJ.
        </p>
      )}

      {kind === 'warrant' && (
        <Field label="Warrant Type" required>
          {(id) => (
            <Select id={id} value={warrantSubtype} onChange={(e) => { setWarrantSubtype(e.target.value as WarrantType); setForm({}) }}>
              {WARRANT_TYPES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </Select>
          )}
        </Field>
      )}
      {kind === 'subpoena' && (
        <>
          <Field label="Subpoena Type" required>
            {(id) => (
              <Select id={id} value={subtype} onChange={(e) => { setSubtype(e.target.value as SubpoenaType); setForm({}) }}>
                {SUBPOENA_TYPES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Recipient Type" required>
            {(id) => (
              <Select id={id} value={recipientType} onChange={(e) => setRecipientType(e.target.value as 'player' | 'entity')}>
                <option value="player">Player</option>
                <option value="entity">Other — Business / Entity</option>
              </Select>
            )}
          </Field>
        </>
      )}

      {(kind === 'warrant' || recipientType === 'player') && (
        <Field label={kind === 'warrant' ? (suspectOptional ? 'Subject (optional for search warrants)' : 'Search Suspect') : 'Search Player'} required={!suspectOptional}>
          {(id) => (
            <div className="space-y-1.5">
              <Input id={id} value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} placeholder="Search by name or alias…" />
              <Select value={personId} onChange={(e) => { setPersonId(e.target.value) }} onBlur={suggestTitle} aria-label="Select person">
                <option value="">Choose from the Persons registry…</option>
                {filteredPersons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.alias ? ` “${p.alias}”` : ''}</option>)}
              </Select>
            </div>
          )}
        </Field>
      )}
      {kind === 'subpoena' && recipientType === 'entity' && (
        <Field label="Recipient Name" required>
          {(id) => <Input id={id} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Business or entity name" />}
        </Field>
      )}

      <Field label={kind === 'warrant' ? 'Warrant Title' : 'Title'} required>
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'warrant' ? (warrantSubtype === 'search_warrant' ? 'Search Warrant — target (case)' : 'Arrest Warrant — name (case)') : 'Subpoena — records sought'} />}
      </Field>
      {kind === 'warrant' && (
        <Field label="Priority" required>
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {['Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}
        </Field>
      )}
      <Field label={kind === 'warrant' ? 'Description / Justification' : 'Reason for Subpoena'} required>
        {(id) => <Textarea id={id} rows={5} value={narrative} onChange={(e) => setNarrative(e.target.value)} />}
      </Field>

      {spec.map((f) => (
        <Field key={f.key} label={f.label} required={f.req}>
          {(id) => f.key === 'platform' ? (
            <Select id={id} value={form[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)}>
              <option value="">Choose…</option>
              {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          ) : f.kind === 'textarea' ? (
            <Textarea id={id} rows={3} value={form[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)} />
          ) : (
            <Input id={id} type={f.kind === 'datetime' ? 'datetime-local' : 'text'} value={form[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)} />
          )}
        </Field>
      ))}

      <Button variant="primary" className="w-full" disabled={busy} onClick={() => void create()}>
        Create draft
      </Button>
      <p className="text-xs text-slate-500">
        The draft stays editable until you submit it for CID supervisor review. Supporting evidence, attachments,
        finalized reports and links are selected on the draft’s Packet tab.
      </p>
    </div>
  )
}
