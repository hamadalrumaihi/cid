'use client'

/** Legal request detail — one component for every seat at the table. The
 *  action panel renders only what the current identity may do (creator edit/
 *  submit, CID supervisor review, DA/AG/Owner assignment + oversight, ADA
 *  review, judicial decision, CID fulfilment), and every action is a definer
 *  RPC — a hidden button is cosmetic, the server revalidates everything.
 *  Reviewers always see the exact immutable version (current_version_id),
 *  its frozen packet manifest, prior returns, and the signature trail. */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useTableVersion } from '@/lib/realtime'
import {
  CLASSIFICATIONS, LEGAL_ACTION_COLS, SUBPOENA_FIELDS, SOCIAL_PLATFORMS,
  fulfilmentLabel, isEditableDraft, justiceRoleLabel, reviewStatusLabel,
  type LegalExhibit, type LegalRequest, type LegalSignature, type LegalVersion,
  type SubpoenaType,
} from '@/lib/justice'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import {
  ClassificationBadge, DeadlineChip, StatusChip, reviewTone,
  useJusticeDirectory, useLegalPeople,
} from './legalShared'

type ActionRow = Pick<Tables<'legal_request_actions'>,
  'id' | 'legal_request_id' | 'version_id' | 'actor_id' | 'action' | 'from_status' | 'to_status' | 'public_note' | 'created_at'>

const SECTION_TABS = ['Overview', 'Form', 'Packet', 'History', 'Participants', 'Fulfilment'] as const
type SectionTab = (typeof SECTION_TABS)[number]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-xs font-semibold text-slate-500">{label}</span>
      <span className="text-right text-sm text-slate-200">{children}</span>
    </div>
  )
}

export function LegalRequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const { profile, justiceRole } = useAuth()
  const me = profile?.id ?? null
  const isOwnerFlag = !!profile?.is_owner
  const [r, setR] = useState<LegalRequest | null>(null)
  const [versions, setVersions] = useState<LegalVersion[]>([])
  const [exhibits, setExhibits] = useState<LegalExhibit[]>([])
  const [participants, setParticipants] = useState<Tables<'legal_request_participants'>[]>([])
  const [actions, setActions] = useState<ActionRow[]>([])
  const [signatures, setSignatures] = useState<LegalSignature[]>([])
  const [tab, setTab] = useState<SectionTab>('Overview')
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const people = useLegalPeople(requestId)
  const { entries: directory } = useJusticeDirectory()
  const v = useTableVersion('legal_requests')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await list('legal_requests', { eq: { id: requestId } })
        if (cancelled) return
        const row = rows[0] ?? null
        setR(row)
        setMissing(!row)
        if (!row) return
        const [vs, ex, pa, ac, sg] = await Promise.all([
          list('legal_request_versions', { eq: { legal_request_id: requestId }, order: 'version_number', ascending: false }),
          list('legal_request_exhibits', { eq: { legal_request_id: requestId }, order: 'created_at' }),
          list('legal_request_participants', { eq: { legal_request_id: requestId }, order: 'added_at' }),
          list('legal_request_actions', { eq: { legal_request_id: requestId }, order: 'created_at', select: LEGAL_ACTION_COLS }) as unknown as Promise<ActionRow[]>,
          list('legal_request_signatures', { eq: { legal_request_id: requestId }, order: 'signed_at' }),
        ])
        if (cancelled) return
        setVersions(vs); setExhibits(ex); setParticipants(pa); setActions(ac); setSignatures(sg)
      } catch { if (!cancelled) setMissing(true) }
    })()
    return () => { cancelled = true }
  }, [requestId, v, tick])

  const name = useCallback((id: string | null | undefined) => (id && people[id]) || (id ? 'Member' : '—'), [people])

  // Draft form state (creator editing) — re-seeded from the row via the
  // adjust-state-during-render pattern so realtime refetches never clobber
  // in-progress typing mid-status.
  const [draft, setDraft] = useState({ title: '', priority: '', narrative: '', classification: '', form: {} as Record<string, string> })
  const [seededKey, setSeededKey] = useState<string | null>(null)
  const draftKey = r ? `${r.id}:${r.review_status}` : null
  if (r && draftKey !== seededKey) {
    setSeededKey(draftKey)
    setDraft({
      title: r.title, priority: r.priority ?? '', narrative: r.narrative ?? '',
      classification: r.classification,
      form: (r.form_data && typeof r.form_data === 'object' && !Array.isArray(r.form_data))
        ? Object.fromEntries(Object.entries(r.form_data as Record<string, unknown>).filter(([k]) => !k.startsWith('_')).map(([k, val]) => [k, String(val ?? '')]))
        : {},
    })
  }

  const act = useCallback(async (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast(okMsg, 'success'); reload() }
  }, [reload])

  if (missing) {
    return (
      <div className="space-y-3">
        <Button onClick={onBack}>← Back</Button>
        <p className="rounded-lg border border-white/10 bg-ink-900/60 p-4 text-sm text-slate-400">
          This legal request does not exist or is outside your access.
        </p>
      </div>
    )
  }
  if (!r) return <p className="text-sm text-slate-400">Loading legal request…</p>

  const status = r.review_status
  const editable = !!me && r.created_by === me && isEditableDraft(r)
  const isCreator = !!me && r.created_by === me
  const cidActive = !!profile?.active
  const canCidReview = cidActive && !isCreator && status === 'cid_supervisor_review'
    && (isOwnerFlag || ['senior_detective', 'bureau_lead', 'deputy_director', 'director'].includes(profile?.role ?? ''))
  const canManage = justiceRole === 'district_attorney' || justiceRole === 'attorney_general' || isOwnerFlag
  const adaActing = !!me && r.assigned_ada_id === me && status === 'ada_review'
  const daActing = justiceRole === 'district_attorney' && status === 'da_review'
  const agActing = justiceRole === 'attorney_general' && status === 'ag_review'
  const canAssignJudge = status === 'submitted_to_judge' && (canManage || (!!me && r.assigned_ada_id === me))
  const judgeActing = !!me && r.assigned_judge_id === me && status === 'judicial_review'
  const canWithdraw = isCreator && !['approved', 'denied', 'withdrawn'].includes(status)
  const prosecutors = directory.filter((d) => d.active && (d.justice_role === 'assistant_district_attorney' || d.justice_role === 'district_attorney'))
  const judges = directory.filter((d) => d.active && d.justice_role === 'judge')
  const currentVersion = versions.find((x) => x.id === r.current_version_id) ?? versions[0] ?? null

  const promptSig = () => uiPrompt('Type your name to sign this action.', { title: 'Signature', placeholder: profile?.display_name ?? '' })

  const saveDraft = () => act(async () => rpc('update_legal_draft', {
    p_request: r.id,
    p_title: draft.title.trim() || undefined,
    p_priority: draft.priority || undefined,
    p_narrative: draft.narrative,
    p_classification: draft.classification || undefined,
    p_form: draft.form,
  }), 'Draft saved.')

  const submitToCid = async () => {
    if (r.request_type === 'subpoena') {
      const spec = SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? []
      const missingReq = spec.filter((f) => f.req && !String(draft.form[f.key] ?? '').trim())
      if (missingReq.length) { toast(`Required: ${missingReq.map((f) => f.label).join(', ')}`, 'warn'); return }
    }
    const save = await rpc('update_legal_draft', {
      p_request: r.id, p_title: draft.title.trim() || undefined, p_priority: draft.priority || undefined,
      p_narrative: draft.narrative, p_classification: draft.classification || undefined, p_form: draft.form,
    })
    if (save.error) { toast(save.error.message, 'danger'); return }
    await act(async () => rpc('submit_legal_request_to_cid', { p_request: r.id }),
      'Submitted for CID supervisor review.')
  }

  const cidDecide = async (decision: 'approve' | 'return') => {
    if (decision === 'return') {
      const note = await uiPrompt('Return note for the investigator (required).', { title: 'Return for revision' })
      if (!note?.trim()) return
      await act(() => rpc('review_legal_request_as_cid', { p_request: r.id, p_decision: 'return', p_note: note }), 'Returned to the investigator.')
      return
    }
    let override: string | null = null
    if (exhibits.length === 0) {
      override = await uiPrompt('No supporting items are selected. Record an override reason to submit anyway.', { title: 'Packet override' })
      if (!override?.trim()) return
    }
    const sig = await promptSig()
    if (sig === null) return
    await act(() => rpc('review_legal_request_as_cid', {
      p_request: r.id, p_decision: 'approve', p_override_reason: override ?? undefined, p_signature: sig || undefined,
    }), 'Approved — submitted to DOJ.')
  }

  const assignAda = async (adaId: string) => {
    const target = prosecutors.find((p) => p.user_id === adaId)
    if (!target) return
    const reason = await uiPrompt(`Assignment note / override reason (required for cross-bureau or missing-coverage assignment).`, {
      title: `Assign to ${target.display_name}`,
    })
    if (reason === null) return
    await act(() => (status === 'submitted_to_doj'
      ? rpc('submit_legal_request_to_doj', { p_request: r.id, p_ada: adaId, p_reason: reason || undefined })
      : rpc('reassign_legal_ada', { p_request: r.id, p_new_ada: adaId, p_reason: reason || undefined })),
      'Prosecutor assigned.')
  }

  const adaDecide = async (decision: 'return' | 'submit_to_judge' | 'submit_to_da' | 'submit_to_ag' | 'note') => {
    const noteLabel = decision === 'return' ? 'Return note for CID (required).'
      : decision === 'note' ? 'Internal prosecutor note (not visible to CID).' : 'Optional note.'
    const note = await uiPrompt(noteLabel, { title: 'ADA review' })
    if (note === null) return
    if ((decision === 'return' || decision === 'note') && !note.trim()) return
    let sig: string | null = ''
    if (decision.startsWith('submit')) { sig = await promptSig(); if (sig === null) return }
    await act(() => rpc('review_legal_request_as_ada', {
      p_request: r.id, p_decision: decision, p_note: note || undefined, p_signature: sig || undefined,
    }), 'Recorded.')
  }

  const daAgDecide = async (who: 'da' | 'ag', decision: string) => {
    const needNote = decision === 'return' || decision === 'deny'
    const note = await uiPrompt(needNote ? 'Note (required).' : 'Optional note.', { title: who.toUpperCase() + ' review' })
    if (note === null || (needNote && !note.trim())) return
    let sig: string | null = ''
    if (decision === 'approve' || decision === 'deny') { sig = await promptSig(); if (sig === null) return }
    const fn = who === 'da' ? 'review_legal_request_as_da' : 'review_legal_request_as_ag'
    await act(() => rpc(fn, { p_request: r.id, p_decision: decision, p_note: note || undefined, p_signature: sig || undefined }), 'Recorded.')
  }

  const assignJudgeTo = async (judgeId: string) => {
    const j = judges.find((x) => x.user_id === judgeId)
    if (!j) return
    if (!(await uiConfirm(`Assign ${j.display_name} for judicial review?`, { title: 'Assign Judge' }))) return
    await act(() => rpc('assign_judge', { p_request: r.id, p_judge: judgeId }), 'Judge assigned.')
  }

  const judgeDecide = async (decision: 'approve' | 'deny' | 'return') => {
    const needNote = decision !== 'approve'
    const note = await uiPrompt(needNote ? 'Decision note (required).' : 'Decision note (optional).', { title: 'Judicial decision' })
    if (note === null || (needNote && !note.trim())) return
    let conditions: string | null = null
    let expires: string | null = null
    if (decision === 'approve') {
      conditions = await uiPrompt('Conditions (optional).', { title: 'Judicial conditions' })
      if (conditions === null) return
      expires = await uiPrompt('Expiration date/time (optional, e.g. 2026-07-21 18:00).', { title: 'Expiration' })
      if (expires === null) return
    }
    const sig = await promptSig()
    if (sig === null) return
    const expIso = expires?.trim() ? new Date(expires.trim()).toISOString() : undefined
    if (expires?.trim() && !expIso) { toast('Could not parse that expiration date.', 'warn'); return }
    await act(() => rpc('decide_legal_request_as_judge', {
      p_request: r.id, p_decision: decision, p_note: note || undefined,
      p_conditions: conditions || undefined, p_expires_at: expIso, p_signature: sig || undefined,
    }), 'Judicial decision recorded.')
  }

  const withdraw = async () => {
    const ok = await uiConfirm('Withdraw this legal request? The record is preserved but review stops.', { title: 'Withdraw request', confirmText: 'Withdraw' })
    if (!ok) return
    await act(() => rpc('withdraw_legal_request', { p_request: r.id }), 'Request withdrawn.')
  }

  const spec = r.request_type === 'subpoena' ? (SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? []) : []
  const formEntries = Object.entries(
    (currentVersion?.form_data && typeof currentVersion.form_data === 'object' && !Array.isArray(currentVersion.form_data))
      ? (currentVersion.form_data as Record<string, unknown>) : {},
  ).filter(([k]) => !k.startsWith('_'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onBack}>← Back</Button>
        <span className="font-mono text-sm text-blue-300">{r.request_number}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{r.request_type} · {r.subtype.replaceAll('_', ' ')}</span>
        <ClassificationBadge value={r.classification} />
        <StatusChip label={reviewStatusLabel(status)} tone={reviewTone(status)} />
        <StatusChip label={fulfilmentLabel(r.fulfilment_status)} tone="slate" />
        <DeadlineChip request={r} />
      </div>
      <h2 className="text-lg font-bold text-white">{r.title}</h2>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Legal request sections">
        {SECTION_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === t ? 'bg-badge-500/20 text-blue-200' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
            <Row label="Case">{r.case_number_snapshot ?? '—'}{r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}</Row>
            <Row label="Responsible bureau">{r.responsible_bureau}</Row>
            <Row label="Approval route">{(r.approval_route ?? '—').toUpperCase()}</Row>
            <Row label="Priority">{r.priority ?? '—'}</Row>
            <Row label={r.request_type === 'warrant' ? 'Suspect' : 'Recipient'}>
              {r.request_type === 'subpoena' && r.recipient_type === 'entity'
                ? (r.recipient_name ?? '—')
                : (r.person_name_snapshot ?? '—')}
            </Row>
            <Row label="Requesting detective">{name(r.created_by)}</Row>
            <Row label="CID supervisor">{name(r.cid_reviewed_by)}</Row>
            <Row label="Assigned ADA">{name(r.assigned_ada_id)}</Row>
            <Row label="Assigned Judge">{name(r.assigned_judge_id)}</Row>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
            <Row label="Created">{new Date(r.created_at).toLocaleString()}</Row>
            <Row label="Submitted to CID">{r.submitted_to_cid_at ? new Date(r.submitted_to_cid_at).toLocaleString() : '—'}</Row>
            <Row label="Submitted to DOJ">{r.submitted_to_doj_at ? new Date(r.submitted_to_doj_at).toLocaleString() : '—'}</Row>
            <Row label="Submitted to Judge">{r.submitted_to_judge_at ? new Date(r.submitted_to_judge_at).toLocaleString() : '—'}</Row>
            <Row label="Decision">{r.decision ? `${r.decision} by ${name(r.decided_by)}${r.decided_at ? ` · ${new Date(r.decided_at).toLocaleString()}` : ''}` : '—'}</Row>
            {r.decision_note && <Row label="Decision note">{r.decision_note}</Row>}
            {r.judicial_conditions && <Row label="Conditions">{r.judicial_conditions}</Row>}
            <Row label="Issued">{r.issued_at ? `${new Date(r.issued_at).toLocaleString()} by ${name(r.issued_by)}` : '—'}</Row>
            <Row label="Expires">{r.expires_at ? new Date(r.expires_at).toLocaleString() : '—'}</Row>
            {r.request_type === 'subpoena' && <Row label="Response deadline">{r.response_deadline ? new Date(r.response_deadline).toLocaleString() : '—'}</Row>}
          </div>
          {signatures.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4 lg:col-span-2">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Signatures (version-bound)</h3>
              <ul className="space-y-1">
                {signatures.map((s) => {
                  const ver = versions.find((x) => x.id === s.version_id)
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                      <span className="font-semibold text-white">{s.signer_name_snapshot}</span>
                      <span className="text-xs text-slate-500">({justiceRoleLabel(s.signer_role_snapshot)})</span>
                      <span className="text-xs text-slate-400">{s.action.replaceAll('_', ' ')}</span>
                      <span className="font-mono text-xs text-blue-300">v{ver?.version_number ?? '?'}</span>
                      <span className="text-xs text-slate-500">{new Date(s.signed_at).toLocaleString()}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'Form' && (
        editable ? (
          <div className="max-w-2xl space-y-3 rounded-xl border border-white/10 bg-ink-900/60 p-4">
            <Field label={r.request_type === 'warrant' ? 'Warrant Title' : 'Title'} required>
              {(id) => <Input id={id} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />}
            </Field>
            {r.request_type === 'warrant' && (
              <Field label="Priority" required>
                {(id) => (
                  <Select id={id} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                    <option value="">Choose…</option>
                    {['Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Description / Justification" required>
              {(id) => <Textarea id={id} rows={5} value={draft.narrative} onChange={(e) => setDraft((d) => ({ ...d, narrative: e.target.value }))} />}
            </Field>
            {spec.map((f) => (
              <Field key={f.key} label={f.label} required={f.req}>
                {(id) => f.key === 'platform' ? (
                  <Select id={id} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))}>
                    <option value="">Choose…</option>
                    {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                ) : f.kind === 'textarea' ? (
                  <Textarea id={id} rows={3} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))} />
                ) : (
                  <Input id={id} type={f.kind === 'datetime' ? 'datetime-local' : 'text'} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))} />
                )}
              </Field>
            ))}
            <Field label="Classification">
              {(id) => (
                <Select id={id} value={draft.classification} onChange={(e) => setDraft((d) => ({ ...d, classification: e.target.value }))}>
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void saveDraft()}>Save draft</Button>
              <Button variant="primary" disabled={busy} onClick={() => void submitToCid()}>Submit for CID review</Button>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl space-y-3 rounded-xl border border-white/10 bg-ink-900/60 p-4">
            <p className="text-xs text-slate-500">
              Immutable submitted version {currentVersion ? `v${currentVersion.version_number}` : '—'} — reviewers act on exactly this content.
            </p>
            <Row label="Title">{r.title}</Row>
            {r.priority && <Row label="Priority">{r.priority}</Row>}
            <div>
              <p className="text-xs font-semibold text-slate-500">Description / Justification</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{currentVersion?.narrative ?? r.narrative ?? '—'}</p>
            </div>
            {formEntries.length > 0 && (
              <div className="space-y-1">
                {formEntries.map(([k, val]) => (
                  <Row key={k} label={k.replaceAll('_', ' ')}>{String(val ?? '—')}</Row>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {tab === 'Packet' && (
        <PacketSection r={r} exhibits={exhibits} editable={editable} busy={busy} onChanged={reload}
          manifest={(currentVersion?.packet_manifest as unknown as { title?: string; type?: string }[] | null) ?? null} />
      )}

      {tab === 'History' && (
        <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
          <ol className="space-y-2">
            {actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 border-l-2 border-badge-500/30 pl-3 text-sm">
                <span className="font-semibold text-white">{a.action.replaceAll('_', ' ')}</span>
                <span className="text-xs text-slate-400">{name(a.actor_id)}</span>
                {a.to_status && <span className="text-xs text-slate-500">→ {reviewStatusLabel(a.to_status)}</span>}
                <span className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</span>
                {a.public_note && <span className="w-full text-xs text-slate-300">“{a.public_note}”</span>}
              </li>
            ))}
            {actions.length === 0 && <li className="text-sm text-slate-500">No recorded actions.</li>}
          </ol>
        </div>
      )}

      {tab === 'Participants' && (
        <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
          <ul className="space-y-1.5">
            {participants.map((p) => (
              <li key={`${p.user_id}:${p.participant_role}`} className={`flex flex-wrap items-center gap-2 text-sm ${p.removed_at ? 'opacity-50' : ''}`}>
                <span className="font-semibold text-white">{name(p.user_id)}</span>
                <span className="text-xs text-slate-400">{p.participant_role.replaceAll('_', ' ')}</span>
                <span className="text-xs text-slate-500">added {new Date(p.added_at).toLocaleDateString()}</span>
                {p.removed_at && <StatusChip label={`ended ${new Date(p.removed_at).toLocaleDateString()}`} tone="rose" />}
              </li>
            ))}
            {participants.length === 0 && <li className="text-sm text-slate-500">No participants yet.</li>}
          </ul>
        </div>
      )}

      {tab === 'Fulfilment' && (
        <FulfilmentSection r={r} cidActive={cidActive} canManage={canManage} judgeSelf={!!me && r.assigned_judge_id === me}
          busy={busy} act={act} name={name} />
      )}

      {/* ---- role action panel ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-900/80 p-3">
        {editable && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void submitToCid()}>Submit for CID review</Button>
            <span className="text-xs text-slate-500">Draft — edit in the Form and Packet tabs, then submit.</span>
          </>
        )}
        {canCidReview && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void cidDecide('approve')}>Approve → submit to DOJ</Button>
            <Button disabled={busy} onClick={() => void cidDecide('return')}>Return for revision</Button>
          </>
        )}
        {canManage && ['submitted_to_doj', 'ada_review', 'returned_by_ada'].includes(status) && prosecutors.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            {status === 'submitted_to_doj' ? 'Assign prosecutor:' : 'Reassign prosecutor:'}
            <Select value="" onChange={(e) => { if (e.target.value) void assignAda(e.target.value) }}>
              <option value="">Choose…</option>
              {prosecutors.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name} ({justiceRoleLabel(p.justice_role)})</option>)}
            </Select>
          </label>
        )}
        {adaActing && (
          <>
            {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void adaDecide('submit_to_judge')}>Submit to Judge</Button>}
            {(r.approval_route === 'da' || r.approval_route === 'ag') && <Button variant="primary" disabled={busy} onClick={() => void adaDecide('submit_to_da')}>Submit to DA</Button>}
            {r.approval_route === 'ag' && <Button disabled={busy} onClick={() => void adaDecide('submit_to_ag')}>Submit to AG</Button>}
            <Button disabled={busy} onClick={() => void adaDecide('return')}>Return to CID</Button>
            <Button disabled={busy} onClick={() => void adaDecide('note')}>Add internal note</Button>
          </>
        )}
        {daActing && (
          <>
            {r.approval_route === 'da' && (
              <>
                <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'approve')}>Approve</Button>
                <Button disabled={busy} onClick={() => void daAgDecide('da', 'deny')}>Deny</Button>
              </>
            )}
            {r.approval_route === 'ag' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'forward_to_ag')}>Forward to AG</Button>}
            {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'forward_to_judge')}>Forward to Judge</Button>}
            <Button disabled={busy} onClick={() => void daAgDecide('da', 'return')}>Return to CID</Button>
          </>
        )}
        {agActing && (
          <>
            {r.approval_route === 'ag' && (
              <>
                <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('ag', 'approve')}>Approve</Button>
                <Button disabled={busy} onClick={() => void daAgDecide('ag', 'deny')}>Deny</Button>
              </>
            )}
            {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('ag', 'forward_to_judge')}>Forward to Judge</Button>}
            <Button disabled={busy} onClick={() => void daAgDecide('ag', 'return')}>Return to CID</Button>
          </>
        )}
        {canAssignJudge && judges.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Assign Judge:
            <Select value="" onChange={(e) => { if (e.target.value) void assignJudgeTo(e.target.value) }}>
              <option value="">Choose…</option>
              {judges.map((j) => <option key={j.user_id} value={j.user_id}>{j.display_name}</option>)}
            </Select>
          </label>
        )}
        {canAssignJudge && judges.length === 0 && (
          <span className="text-xs text-amber-300">No active Judges are available for assignment.</span>
        )}
        {judgeActing && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void judgeDecide('approve')}>Approve warrant/subpoena</Button>
            <Button disabled={busy} onClick={() => void judgeDecide('deny')}>Deny</Button>
            <Button disabled={busy} onClick={() => void judgeDecide('return')}>Return for revision</Button>
          </>
        )}
        {canWithdraw && <Button disabled={busy} onClick={() => void withdraw()}>Withdraw</Button>}
        {!editable && !canCidReview && !canManage && !adaActing && !daActing && !agActing && !canAssignJudge && !judgeActing && !canWithdraw && (
          <span className="text-xs text-slate-500">No actions available for your role at this stage.</span>
        )}
      </div>
    </div>
  )
}

/* ---- Packet (exhibit) section — deliberate selection only (§22) ---------- */

function PacketSection({ r, exhibits, editable, busy, onChanged, manifest }: {
  r: LegalRequest
  exhibits: LegalExhibit[]
  editable: boolean
  busy: boolean
  onChanged: () => void
  manifest: { title?: string; type?: string }[] | null
}) {
  const [adding, setAdding] = useState(false)

  const removeExhibit = async (e: LegalExhibit) => {
    const ok = await uiConfirm(`Remove “${e.display_title}” from the packet?`, { title: 'Remove exhibit', confirmText: 'Remove' })
    if (!ok) return
    const res = await rpc('remove_legal_exhibit', { p_exhibit: e.id })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Exhibit removed.', 'info'); onChanged() }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Selected packet — reviewers see ONLY these items
          </h3>
          {editable && <Button disabled={busy} onClick={() => setAdding((x) => !x)}>{adding ? 'Done' : '+ Add exhibit'}</Button>}
        </div>
        <ul className="space-y-1.5">
          {exhibits.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{e.exhibit_type.replaceAll('_', ' ')}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{e.display_title}</span>
              {typeof e.snapshot_metadata === 'object' && e.snapshot_metadata && 'url' in (e.snapshot_metadata as object) && (
                <a className="text-xs text-blue-300 underline" href={String((e.snapshot_metadata as Record<string, unknown>).url)} target="_blank" rel="noreferrer">open</a>
              )}
              {editable && (
                <button onClick={() => void removeExhibit(e)} className="text-xs font-semibold text-rose-300 hover:text-rose-200" aria-label={`Remove ${e.display_title}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {exhibits.length === 0 && <li className="text-sm text-slate-500">No supporting items selected yet.</li>}
        </ul>
      </div>
      {adding && editable && <ExhibitPickers r={r} onAdded={onChanged} />}
      {!editable && manifest && manifest.length > 0 && (
        <p className="text-xs text-slate-500">
          Frozen manifest of the submitted version: {manifest.map((m) => m.title).filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** Case-scoped selectors over the SAME canonical records used elsewhere in
 *  the portal (evidence, attachments, finalized reports, media, persons). */
function ExhibitPickers({ r, onAdded }: { r: LegalRequest; onAdded: () => void }) {
  const [evidence, setEvidence] = useState<Tables<'evidence'>[]>([])
  const [files, setFiles] = useState<Tables<'case_files'>[]>([])
  const [reports, setReports] = useState<Tables<'reports'>[]>([])
  const [media, setMedia] = useState<Tables<'media'>[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [ev, rp, md] = await Promise.all([
          list('evidence', { eq: { case_id: r.case_id } }),
          list('reports', { eq: { case_id: r.case_id, finalized: true } }),
          list('media', { eq: { case_id: r.case_id } }),
        ])
        const fl = r.case_number_snapshot
          ? await list('case_files', { eq: { case_number: r.case_number_snapshot } })
          : []
        if (cancelled) return
        setEvidence(ev); setReports(rp); setMedia(md); setFiles(fl)
      } catch { /* case records simply unavailable */ }
    })()
    return () => { cancelled = true }
  }, [r.case_id, r.case_number_snapshot])

  const add = async (type: string, sourceId: string | null, title?: string, meta?: Record<string, string>) => {
    const res = await rpc('add_legal_exhibit', {
      p_request: r.id, p_type: type, p_source_id: sourceId ?? undefined,
      p_title: title, p_meta: meta ?? {},
    })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Exhibit added.', 'success'); onAdded() }
  }

  const addLink = async () => {
    const url = await uiPrompt('External link URL (approved sources only).', { title: 'Add external link', placeholder: 'https://…' })
    if (!url?.trim()) return
    await add('external_link', null, undefined, { url: url.trim() })
  }

  const picker = (label: string, options: { id: string; text: string }[], type: string) => (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      {label}
      <Select value="" onChange={(e) => { if (e.target.value) void add(type, e.target.value) }}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
      </Select>
    </label>
  )

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-ink-900/60 p-4">
      {picker('Evidence', evidence.map((e) => ({ id: e.id, text: `${e.item_code ?? ''} ${e.description ?? e.type ?? 'Evidence'}`.trim() })), 'evidence')}
      {picker('Attachments', files.map((f) => ({ id: f.id, text: f.name })), 'attachment')}
      {picker('Finalized reports', reports.map((x) => ({ id: x.id, text: `${x.template} report` })), 'finalized_report')}
      {picker('Case media', media.map((m) => ({ id: m.id, text: m.title })), 'case_media')}
      <Button onClick={() => void addLink()}>+ External link</Button>
    </div>
  )
}

/* ---- Fulfilment: issue / execute / return / service / compliance --------- */

function FulfilmentSection({ r, cidActive, canManage, judgeSelf, busy, act, name }: {
  r: LegalRequest
  cidActive: boolean
  canManage: boolean
  judgeSelf: boolean
  busy: boolean
  act: (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => Promise<void>
  name: (id: string | null | undefined) => string
}) {
  const approvedUnissued = r.review_status === 'approved' && r.fulfilment_status === 'unissued'
  const warrant = r.request_type === 'warrant'

  const issue = async () => {
    const exp = warrant ? await uiPrompt('Expiration date/time (optional if the Judge set one).', { title: 'Issue', placeholder: '2026-07-21 18:00' }) : ''
    if (exp === null) return
    const dl = !warrant ? await uiPrompt('Response deadline (optional).', { title: 'Issue', placeholder: '2026-07-21 18:00' }) : ''
    if (dl === null) return
    const parse = (s: string | null) => (s?.trim() ? new Date(s.trim()).toISOString() : undefined)
    await act(() => rpc('issue_legal_request', { p_request: r.id, p_expires_at: parse(exp), p_response_deadline: parse(dl) }), 'Issued.')
  }
  const execute = async () => {
    const outcome = await uiPrompt('Execution outcome (e.g. suspect in custody).', { title: 'Record execution' })
    if (!outcome?.trim()) return
    const notes = await uiPrompt('Execution notes (optional).', { title: 'Record execution' })
    if (notes === null) return
    await act(() => rpc('record_warrant_execution', { p_request: r.id, p_outcome: outcome, p_notes: notes || undefined }), 'Execution recorded.')
  }
  const fileReturn = async () => {
    const narrative = await uiPrompt('Return narrative (required).', { title: 'File return' })
    if (!narrative?.trim()) return
    await act(() => rpc('record_warrant_return', { p_request: r.id, p_narrative: narrative }), 'Return filed.')
  }
  const service = async (statusValue: string) => {
    const method = await uiPrompt('Service method (optional).', { title: 'Record service' })
    if (method === null) return
    const notes = await uiPrompt('Service notes (optional).', { title: 'Record service' })
    if (notes === null) return
    await act(() => rpc('record_subpoena_service', { p_request: r.id, p_status: statusValue, p_method: method || undefined, p_notes: notes || undefined }), 'Service recorded.')
  }
  const compliance = async (statusValue: string) => {
    let reason: string | null = null
    if (statusValue === 'non_compliant') {
      reason = await uiPrompt('Non-compliance reason (required).', { title: 'Record compliance' })
      if (!reason?.trim()) return
    }
    const notes = await uiPrompt('Notes (optional). Received materials must be logged as case evidence/attachments — this record links back to the case.', { title: 'Record compliance' })
    if (notes === null) return
    await act(() => rpc('record_subpoena_compliance', { p_request: r.id, p_status: statusValue, p_notes: notes || undefined, p_non_compliance_reason: reason ?? undefined }), 'Compliance recorded.')
  }
  const close = async (outcome: 'closed' | 'expired' | 'revoked') => {
    const needNote = outcome === 'revoked'
    const note = await uiPrompt(needNote ? 'Revocation reason (required).' : 'Close note (optional).', { title: outcome === 'revoked' ? 'Revoke' : 'Close request' })
    if (note === null || (needNote && !note.trim())) return
    await act(() => rpc('close_legal_request', { p_request: r.id, p_outcome: outcome, p_note: note || undefined }), 'Recorded.')
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
        <Row label="Fulfilment status">{fulfilmentLabel(r.fulfilment_status)}</Row>
        {warrant ? (
          <>
            <Row label="Executed">{r.executed_at ? `${new Date(r.executed_at).toLocaleString()} by ${name(r.executed_by)}` : '—'}</Row>
            {r.execution_outcome && <Row label="Outcome">{r.execution_outcome}</Row>}
            {r.execution_notes && <Row label="Execution notes">{r.execution_notes}</Row>}
            {r.return_narrative && <Row label="Return narrative">{r.return_narrative}</Row>}
            {r.revoke_reason && <Row label="Revocation">{r.revoke_reason}</Row>}
          </>
        ) : (
          <>
            <Row label="Service">{r.service_status.replaceAll('_', ' ')}{r.served_at ? ` · ${new Date(r.served_at).toLocaleString()} by ${name(r.served_by)}` : ''}</Row>
            {r.service_method && <Row label="Method">{r.service_method}</Row>}
            {r.service_notes && <Row label="Service notes">{r.service_notes}</Row>}
            <Row label="Compliance">{r.compliance_status.replaceAll('_', ' ')}{r.compliance_date ? ` · ${new Date(r.compliance_date).toLocaleString()}` : ''}</Row>
            {r.non_compliance_reason && <Row label="Non-compliance">{r.non_compliance_reason}</Row>}
            {r.compliance_notes && <Row label="Compliance notes">{r.compliance_notes}</Row>}
          </>
        )}
        {r.closed_at && <Row label="Closed">{`${new Date(r.closed_at).toLocaleString()} by ${name(r.closed_by)}`}</Row>}
      </div>
      <div className="flex flex-wrap gap-2">
        {cidActive && approvedUnissued && <Button variant="primary" disabled={busy} onClick={() => void issue()}>Record issue</Button>}
        {cidActive && warrant && r.fulfilment_status === 'issued' && <Button variant="primary" disabled={busy} onClick={() => void execute()}>Record execution</Button>}
        {cidActive && warrant && ['executed', 'expired', 'revoked'].includes(r.fulfilment_status) && <Button disabled={busy} onClick={() => void fileReturn()}>File return</Button>}
        {cidActive && !warrant && ['issued', 'served'].includes(r.fulfilment_status) && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void service('served')}>Record service</Button>
            <Button disabled={busy} onClick={() => void service('service_attempted')}>Service attempted</Button>
            <Button disabled={busy} onClick={() => void service('service_failed')}>Service failed</Button>
          </>
        )}
        {cidActive && !warrant && ['compliance_pending', 'records_received', 'testimony_completed', 'non_compliance'].includes(r.fulfilment_status) && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void compliance('complete')}>Compliance complete</Button>
            <Button disabled={busy} onClick={() => void compliance('partial')}>Partial</Button>
            <Button disabled={busy} onClick={() => void compliance('non_compliant')}>Non-compliance</Button>
            <Button disabled={busy} onClick={() => void compliance('return_recorded')}>Record return</Button>
          </>
        )}
        {(cidActive || canManage) && r.fulfilment_status !== 'closed' && ['approved', 'denied', 'withdrawn'].includes(r.review_status) && (
          <Button disabled={busy} onClick={() => void close('closed')}>Close request</Button>
        )}
        {(cidActive || canManage) && r.expires_at && new Date(r.expires_at) < new Date() && !['expired', 'closed'].includes(r.fulfilment_status) && (
          <Button disabled={busy} onClick={() => void close('expired')}>Mark expired</Button>
        )}
        {(canManage || judgeSelf) && ['issued', 'executed'].includes(r.fulfilment_status) && (
          <Button disabled={busy} onClick={() => void close('revoked')}>Revoke</Button>
        )}
      </div>
    </div>
  )
}
