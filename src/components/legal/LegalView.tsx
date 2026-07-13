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
import { SUBPOENA_FIELDS, SUBPOENA_TYPES, SOCIAL_PLATFORMS, type SubpoenaType } from '@/lib/justice'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { LegalRequestDetail } from '@/components/justice/LegalRequestDetail'
import { QueueSection, useLegalRequests } from '@/components/justice/legalShared'

const SUPERVISOR_ROLES = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])

export function LegalView() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading legal requests…</p>}>
      <LegalViewInner />
    </Suspense>
  )
}

function LegalViewInner() {
  const { profile } = useAuth()
  const me = profile?.id ?? null
  const router = useRouter()
  const params = useSearchParams()
  const openId = params.get('request')
  const [creating, setCreating] = useState<null | 'warrant' | 'subpoena'>(null)
  const { requests, loading } = useLegalRequests()

  const open = (id: string) => router.push(`/legal?request=${encodeURIComponent(id)}`)
  const back = () => router.push('/legal')

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

  const supervisor = !!profile && (SUPERVISOR_ROLES.has(profile.role) || !!profile.is_owner)
  const mine = requests.filter((r) => r.created_by === me)
  const editableStates = new Set(['not_submitted', 'returned_by_cid', 'returned_by_ada', 'returned_by_da', 'returned_by_ag', 'returned_by_judge'])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setCreating('warrant')}>+ File Warrant Request</Button>
        <Button variant="primary" onClick={() => setCreating('subpoena')}>+ File Subpoena</Button>
      </div>
      {loading && <p className="text-sm text-slate-400">Loading legal requests…</p>}
      <QueueSection title="My Legal Drafts" onOpen={open}
        rows={mine.filter((r) => r.review_status === 'not_submitted')}
        empty="No drafts — file a warrant request or subpoena above." />
      <QueueSection title="Returned for Revision" onOpen={open}
        rows={mine.filter((r) => editableStates.has(r.review_status) && r.review_status !== 'not_submitted')} />
      {supervisor && (
        <QueueSection title="Awaiting CID Review" onOpen={open}
          rows={requests.filter((r) => r.review_status === 'cid_supervisor_review')}
          empty="Nothing is waiting for supervisor review." />
      )}
      <QueueSection title="Submitted to DOJ" onOpen={open}
        rows={requests.filter((r) => !editableStates.has(r.review_status)
          && !['cid_supervisor_review', 'approved', 'denied', 'withdrawn'].includes(r.review_status))} />
      <QueueSection title="My Warrants" onOpen={open}
        rows={mine.filter((r) => r.request_type === 'warrant')} />
      <QueueSection title="My Subpoenas" onOpen={open}
        rows={mine.filter((r) => r.request_type === 'subpoena')} />
    </div>
  )
}

/* ---- Create form (warrant request / subpoena) ----------------------------- */

type SlimCase = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'bureau' | 'originating_bureau'>
type SlimPerson = Pick<Tables<'persons'>, 'id' | 'name' | 'alias'>

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
  const [recipientType, setRecipientType] = useState<'player' | 'entity'>('player')
  const [recipientName, setRecipientName] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

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
  const spec = kind === 'subpoena' ? SUBPOENA_FIELDS[subtype] : []

  const setF = (k: string, val: string) => setForm((f) => ({ ...f, [k]: val }))

  const suggestTitle = () => {
    const person = persons.find((p) => p.id === personId)
    if (kind === 'warrant' && person && selectedCase && !title.trim()) {
      setTitle(`Arrest Warrant — ${person.name} (${selectedCase.case_number})`)
    }
  }

  const create = async () => {
    if (!caseId) { toast('Select a case.', 'warn'); return }
    if (!title.trim()) { toast('A title is required.', 'warn'); return }
    if (!narrative.trim()) { toast(`A ${kind === 'warrant' ? 'description / justification' : 'reason for subpoena'} is required.`, 'warn'); return }
    if (kind === 'warrant' && !personId) { toast('Search and select the suspect from the Persons registry.', 'warn'); return }
    if (kind === 'subpoena') {
      if (recipientType === 'player' && !personId) { toast('Search and select the player recipient.', 'warn'); return }
      if (recipientType === 'entity' && !recipientName.trim()) { toast('A recipient name is required.', 'warn'); return }
      const missing = spec.filter((f) => f.req && !String(form[f.key] ?? '').trim())
      if (missing.length) { toast(`Required: ${missing.map((f) => f.label).join(', ')}`, 'warn'); return }
    }
    setBusy(true)
    const res = await rpc('create_legal_request', {
      p_case: caseId,
      p_request_type: kind,
      p_subtype: kind === 'warrant' ? 'arrest_warrant' : subtype,
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
    toast('Draft created — add supporting items, then submit for CID review.', 'success')
    if (res.data) onCreated(res.data.id)
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <Button onClick={onCancel}>← Cancel</Button>
        <h2 className="text-lg font-bold text-white">{kind === 'warrant' ? 'File Warrant Request' : 'File Subpoena'}</h2>
      </div>

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
        <Field label={kind === 'warrant' ? 'Search Suspect' : 'Search Player'} required>
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
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'warrant' ? 'Arrest Warrant — name (case)' : 'Subpoena — records sought'} />}
      </Field>
      {kind === 'warrant' && (
        <>
          <Field label="Warrant Type" required>
            {(id) => <Select id={id} value="arrest_warrant" disabled><option value="arrest_warrant">Arrest Warrant</option></Select>}
          </Field>
          <Field label="Priority" required>
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            )}
          </Field>
        </>
      )}
      <Field label={kind === 'warrant' ? 'Description / Justification' : 'Reason for Subpoena'} required>
        {(id) => <Textarea id={id} rows={5} value={narrative} onChange={(e) => setNarrative(e.target.value)} />}
      </Field>

      {kind === 'subpoena' && spec.map((f) => (
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
