'use client'

/** Legal request DOSSIER — one component for every seat at the table (CID +
 *  all Justice roles), rebuilt on the modern dossier spine: Breadcrumbs →
 *  command header Card (stage tracker + disposition) → click-through
 *  MetricStrip → deep-linkable SectionTabs (`?section=`, coexisting with the
 *  parent's `?request=`) → the role decision panel → court-packet print.
 *
 *  The decision panel renders only what the current identity may do (creator
 *  edit/submit, CID supervisor review, DA/AG/Owner assignment + oversight,
 *  ADA review, judicial decision, CID fulfilment), and every action is a
 *  definer RPC — a hidden button is cosmetic, the server revalidates
 *  everything. Reviewers always see the exact immutable version
 *  (current_version_id), its frozen packet manifest, prior returns, and the
 *  signature trail. All stage/status interpretation comes from the
 *  deterministic legalWorkflow model. */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { Drafts } from '@/lib/drafts'
import { fmtDateTime } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import {
  LEGAL_ACTION_COLS, SUBPOENA_FIELDS, WARRANT_FIELDS,
  fulfilmentLabel, isEditableDraft, reviewStatusLabel,
  type LegalExhibit, type LegalRequest, type LegalSignature, type LegalVersion,
  type SubpoenaType, type WarrantType,
} from '@/lib/justice'
import { dispositionFor, formatTarget, humanize, routingExplanation } from '@/lib/legalWorkflow'
import { parsePacketManifest } from '@/lib/schemas'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Card } from '@/components/ui/Card'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import {
  ClassificationBadge, DeadlineChip, StatusChip, buildLegalViewer, reviewTone,
  useJusticeDirectory, useLegalPeople, useMyProsecutorBureaus,
} from './legalShared'
import { LegalStageTracker } from './LegalStageTracker'
import { CourtPacketPrint } from './dossier/CourtPacketPrint'
import { DecisionPanel } from './dossier/DecisionPanel'
import {
  DOSSIER_SECTIONS, sectionFromParam, useCaseRecords,
  type ActionRow, type DossierSectionId, type DraftShape,
} from './dossier/dossierShared'
import { ActivitySection, DecisionSection, ReviewSection, ServiceSection, SummarySection } from './dossier/InfoSections'
import { RequestSection } from './dossier/RequestSection'
import { SubmitPreview } from './dossier/SubmitPreview'
import { SupportingSection, type ReferencedBy } from './dossier/SupportingSection'

export function LegalRequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  // useSearchParams needs a Suspense boundary in every host (LegalView has
  // one; the Justice shell does not) — carry our own so the dossier stays a
  // single drop-in component.
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading legal request…</p>}>
      <LegalRequestDossier requestId={requestId} onBack={onBack} />
    </Suspense>
  )
}

function LegalRequestDossier({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const auth = useAuth()
  const { profile, justiceRole } = auth
  const me = profile?.id ?? null
  const isOwnerFlag = !!profile?.is_owner
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const now = useNow()
  const [r, setR] = useState<LegalRequest | null>(null)
  const [versions, setVersions] = useState<LegalVersion[]>([])
  const [exhibits, setExhibits] = useState<LegalExhibit[]>([])
  const [participants, setParticipants] = useState<Tables<'legal_request_participants'>[]>([])
  const [actions, setActions] = useState<ActionRow[]>([])
  const [signatures, setSignatures] = useState<LegalSignature[]>([])
  const [referencedBy, setReferencedBy] = useState<ReferencedBy[]>([])
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const [printPreparedAt, setPrintPreparedAt] = useState<string | null>(null)
  const people = useLegalPeople(requestId)
  const prosecutorBureaus = useMyProsecutorBureaus()
  const { entries: directory } = useJusticeDirectory()
  const v = useTableVersion('legal_requests')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  // Deep-linkable section (`?section=`) — namespaced beside the parent's
  // `?request=` param: we only ever touch our own key.
  const section = sectionFromParam(sp.get('section'))
  const setSection = useCallback((next: DossierSectionId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('section', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [sp, pathname, router])
  const back = useCallback(() => {
    // Drop our section key so it can't leak into the next opened request.
    const params = new URLSearchParams(sp.toString())
    params.delete('section')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    onBack()
  }, [sp, pathname, router, onBack])
  // Cross-reference navigation (prior-request exhibits / "referenced by"):
  // swap the host's ?request= in place — both hosts read it reactively, and
  // the section key is dropped so it can't leak into the next request.
  const openRequest = useCallback((id: string) => {
    const params = new URLSearchParams(sp.toString())
    params.set('request', id)
    params.delete('section')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [sp, pathname, router])

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
        // Reverse cross-references: OTHER requests citing this one as a
        // 'prior_legal_request' exhibit. RLS trims both legs (the exhibit row
        // is visible only when ITS parent passes can_view_legal_request, and
        // the parent fetch is scoped the same way) — a sealed or out-of-scope
        // referencing request never appears. Optional garnish: a failure here
        // degrades to an empty list, never a "request unavailable".
        try {
          const refEx = (await list('legal_request_exhibits', {
            select: 'legal_request_id',
            eq: { exhibit_type: 'prior_legal_request', source_id: requestId },
          })) as unknown as { legal_request_id: string }[]
          const refIds = [...new Set(refEx.map((x) => x.legal_request_id))].filter((x) => x !== requestId)
          const refRows = refIds.length
            ? ((await list('legal_requests', { select: 'id,request_number,title', in: { id: refIds } })) as unknown as ReferencedBy[])
            : []
          if (!cancelled) setReferencedBy(refRows)
        } catch { if (!cancelled) setReferencedBy([]) }
      } catch { if (!cancelled) setMissing(true) }
    })()
    return () => { cancelled = true }
  }, [requestId, v, tick])

  const name = useCallback((id: string | null | undefined) => (id && people[id]) || (id ? 'Member' : '—'), [people])

  // Draft form state (creator editing) — re-seeded from the row via the
  // adjust-state-during-render pattern so realtime refetches never clobber
  // in-progress typing mid-status.
  const [draft, setDraft] = useState<DraftShape>({ title: '', priority: '', narrative: '', classification: '', form: {} })
  const [seededKey, setSeededKey] = useState<string | null>(null)
  const [seedJson, setSeedJson] = useState('')
  // Never-lose-work recovery (v1.14): a stash from a previous session on this
  // device. Offered ONLY via an explicit banner, and only when it is newer
  // than the server row — it never auto-fills the form.
  const [pendingDraft, setPendingDraft] = useState(() => Drafts.load<DraftShape>(`legal:edit:${requestId}`))
  const draftKey = r ? `${r.id}:${r.review_status}` : null
  if (r && draftKey !== seededKey) {
    setSeededKey(draftKey)
    const seeded: DraftShape = {
      title: r.title, priority: r.priority ?? '', narrative: r.narrative ?? '',
      classification: r.classification,
      form: (r.form_data && typeof r.form_data === 'object' && !Array.isArray(r.form_data))
        ? Object.fromEntries(Object.entries(r.form_data as Record<string, unknown>).filter(([k]) => !k.startsWith('_')).map(([k, val]) => [k, String(val ?? '')]))
        : {},
    }
    setDraft(seeded)
    setSeedJson(JSON.stringify(seeded))
  }

  const editingEnabled = !!me && !!r && r.created_by === me && isEditableDraft(r)
  const caseRecords = useCaseRecords(r, editingEnabled)
  const [preview, setPreview] = useState(false)

  // Stash keystrokes while editing — cleared on a successful save or submit.
  useEffect(() => {
    if (!editingEnabled || !r || !seedJson) return
    if (JSON.stringify(draft) === seedJson) return
    Drafts.save(`legal:edit:${r.id}`, draft)
  }, [draft, editingEnabled, r, seedJson])

  const act = useCallback(async (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast(okMsg, 'success'); reload() }
  }, [reload])

  if (missing) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: 'Legal requests', onClick: back }, { label: 'Not found' }]} />
        <EmptyState
          icon="⚖️"
          title="Legal request unavailable"
          hint="This legal request does not exist or is outside your access."
          action={{ label: 'Back to legal requests', onClick: back }}
        />
      </div>
    )
  }
  if (!r) return <Notice text="Loading legal request…" />

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
  // Parallel judiciary lane: a judge may take a waiting judge-routed request
  // without a prosecutor hand-off. Client mirror only — the RPC re-checks role,
  // route, sealed, conflicts, and no-judge-yet server-side.
  const canJudgeClaim = justiceRole === 'judge' && !isCreator && !r.assigned_judge_id
    && (r.approval_route ?? 'judge') === 'judge' && r.classification !== 'sealed'
    && ['submitted_to_doj', 'submitted_to_judge'].includes(status)
  const canWithdraw = isCreator && !['approved', 'denied', 'withdrawn'].includes(status)
  const judgeSelf = !!me && r.assigned_judge_id === me
  // Bureau-prosecutor awareness (presentation only, mirrors the queue note in
  // the Justice portal): an ADA sees a DOJ-parked request their RLS already
  // scoped to them, but no action is assigned. Never action styling.
  const awarenessOnly = justiceRole === 'assistant_district_attorney'
    && status === 'submitted_to_doj' && (!me || r.assigned_ada_id !== me)
  const prosecutors = directory.filter((d) => d.active && (d.justice_role === 'assistant_district_attorney' || d.justice_role === 'district_attorney'))
  const judges = directory.filter((d) => d.active && d.justice_role === 'judge')
  const currentVersion = versions.find((x) => x.id === r.current_version_id) ?? versions[0] ?? null

  const viewer = buildLegalViewer(auth, prosecutorBureaus)
  const disposition = dispositionFor(r, viewer, now)

  const promptSig = () => uiPrompt('Type your name to sign this action.', { title: 'Signature', placeholder: profile?.display_name ?? '' })

  const saveDraft = () => act(async () => {
    const res = await rpc('update_legal_draft', {
      p_request: r.id,
      p_title: draft.title.trim() || undefined,
      p_priority: draft.priority || undefined,
      p_narrative: draft.narrative,
      p_classification: draft.classification || undefined,
      p_form: draft.form,
    })
    if (!res.error) { Drafts.clear(`legal:edit:${r.id}`); setPendingDraft(null) }
    return res
  }, 'Draft saved.')

  /** Requirements checklist for the pre-submission preview — the server
   *  revalidates everything; this is honest UX, not authority. */
  const submitChecklist = (): { label: string; ok: boolean; blocking: boolean }[] => {
    const items: { label: string; ok: boolean; blocking: boolean }[] = [
      { label: 'Title', ok: !!draft.title.trim(), blocking: true },
      { label: 'Description / justification', ok: !!draft.narrative.trim(), blocking: true },
    ]
    if (r.request_type === 'warrant') {
      items.push({ label: 'Priority', ok: !!draft.priority, blocking: true })
      // Search warrants require search targets + items sought (arrest warrants
      // carry no required form fields — suspect NOT blocked here).
      const specNow = WARRANT_FIELDS[r.subtype as WarrantType] ?? []
      for (const f of specNow.filter((x) => x.req)) {
        items.push({ label: f.label, ok: !!String(draft.form[f.key] ?? '').trim(), blocking: true })
      }
    }
    if (r.request_type === 'subpoena') {
      const specNow = SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? []
      for (const f of specNow.filter((x) => x.req)) {
        items.push({ label: f.label, ok: !!String(draft.form[f.key] ?? '').trim(), blocking: true })
      }
    }
    // Not blocking: the CID supervisor can record a packet override.
    items.push({ label: 'At least one supporting item selected', ok: exhibits.length > 0, blocking: false })
    return items
  }

  // Submission is a two-step flow (§ packet preview, v1.14): review exactly
  // what DOJ will receive, then confirm — the existing RPCs do the work.
  const submitToCid = () => {
    const specNow = r.request_type === 'subpoena'
      ? (SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? [])
      : r.request_type === 'warrant' ? (WARRANT_FIELDS[r.subtype as WarrantType] ?? []) : []
    const missingReq = specNow.filter((f) => f.req && !String(draft.form[f.key] ?? '').trim())
    if (missingReq.length) { toast(`Required: ${missingReq.map((f) => f.label).join(', ')}`, 'warn'); return }
    setPreview(true)
  }

  const confirmSubmit = async () => {
    const save = await rpc('update_legal_draft', {
      p_request: r.id, p_title: draft.title.trim() || undefined, p_priority: draft.priority || undefined,
      p_narrative: draft.narrative, p_classification: draft.classification || undefined, p_form: draft.form,
    })
    if (save.error) { toast(save.error.message, 'danger'); return }
    setPreview(false)
    await act(async () => {
      const res = await rpc('submit_legal_request_to_cid', { p_request: r.id })
      if (!res.error) { Drafts.clear(`legal:edit:${r.id}`); setPendingDraft(null) }
      return res
    }, 'Submitted for CID supervisor review.')
  }

  const withdraw = async () => {
    const ok = await uiConfirm('Withdraw this legal request? The record is preserved but review stops.', { title: 'Withdraw request', confirmText: 'Withdraw' })
    if (!ok) return
    await act(async () => {
      const res = await rpc('withdraw_legal_request', { p_request: r.id })
      // A withdrawn request is abandoned — don't leave its narrative in
      // localStorage on shared terminals.
      if (!res.error) { Drafts.clear(`legal:edit:${r.id}`); setPendingDraft(null) }
      return res
    }, 'Request withdrawn.')
  }

  const spec = r.request_type === 'subpoena'
    ? (SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? [])
    : r.request_type === 'warrant' ? (WARRANT_FIELDS[r.subtype as WarrantType] ?? []) : []

  const returnsCount = actions.filter((a) => a.to_status?.startsWith('returned')).length
  const metrics: Metric[] = [
    { label: 'Versions', value: versions.length, onClick: () => setSection('request') },
    { label: 'Exhibits', value: exhibits.length, onClick: () => setSection('supporting') },
    { label: 'Signatures', value: signatures.length, onClick: () => setSection('supporting') },
    { label: 'Returns', value: returnsCount, onClick: () => setSection('review') },
  ]

  const tabs: SectionTab<DossierSectionId>[] = DOSSIER_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    ...(s.id === 'supporting' ? { count: exhibits.length } : {}),
    ...(s.id === 'review' && returnsCount > 0 ? { marker: true, markerLabel: 'Has returns for revision' } : {}),
  }))

  // Rare / secondary actions live in the overflow menu, not beside primaries.
  const menuItems: ActionItem[] = [
    {
      label: 'Print court packet',
      icon: '🖨',
      disabled: !currentVersion,
      onClick: () => setPrintPreparedAt(fmtDateTime(new Date())),
    },
    ...(canWithdraw ? [{
      label: 'Withdraw request…', icon: '⤺', danger: true, separatorBefore: true,
      onClick: () => void withdraw(),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Legal requests', onClick: back }, { label: r.request_number }]} />

      {/* ── Command header ─────────────────────────────────────────────────── */}
      <Card pad="lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-blue-300">{r.request_number}</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {humanize(r.request_type)} · {humanize(r.subtype)}
              </span>
              <ClassificationBadge value={r.classification} />
            </div>
            <h1 className="mt-1 text-xl font-black text-white">{r.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip label={reviewStatusLabel(status)} tone={reviewTone(status)} />
              <StatusChip label={fulfilmentLabel(r.fulfilment_status)} tone="slate" />
              <DeadlineChip request={r} />
            </div>
            <p className="mt-2 text-sm text-slate-400">
              <span className="text-slate-300">{r.request_type === 'warrant' ? 'Suspect' : 'Recipient'}:</span> {formatTarget(r)}
              {r.case_number_snapshot && (
                <>
                  <span aria-hidden className="text-slate-500"> · </span>
                  <span className="text-slate-300">Case:</span> <span className="font-mono">{r.case_number_snapshot}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <ActionMenu items={menuItems} label="Request actions" />
          </div>
        </div>

        <LegalStageTracker request={r} className="mt-4 border-t border-white/5 pt-4" />

        <p className="mt-3 text-sm text-slate-300">
          <span className="font-semibold text-white">{disposition.stageLabel}</span>
          {disposition.responsibleRoleLabel !== '—' && (
            <span className="text-slate-400"> — awaiting {disposition.responsibleRoleLabel}</span>
          )}
        </p>
        <details className="mt-1">
          <summary className="cursor-pointer rounded text-xs font-semibold text-badge-200 hover:text-white">
            Why is it here?
          </summary>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{routingExplanation(r, viewer)}</p>
        </details>
      </Card>

      <MetricStrip metrics={metrics} />

      {/* ── Deep-linkable sections ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 -mx-1 bg-ink-950/80 px-1 py-1 backdrop-blur">
        <SectionTabs<DossierSectionId> tabs={tabs} active={section} onChange={setSection} idBase="legal" ariaLabel="Legal request sections" />
      </div>

      <div id={panelDomId('legal', section)} role="tabpanel" aria-labelledby={tabDomId('legal', section)} tabIndex={-1}>
        {section === 'summary' && (
          <SummarySection r={r} name={name} viewer={viewer} disposition={disposition} caseLinkable={cidActive} />
        )}
        {section === 'request' && (
          <RequestSection
            r={r} editable={editable} busy={busy} spec={spec}
            draft={draft} setDraft={setDraft}
            pendingDraft={pendingDraft} setPendingDraft={setPendingDraft}
            currentVersion={currentVersion} versions={versions} name={name}
            onSaveDraft={() => void saveDraft()} onSubmit={() => void submitToCid()}
          />
        )}
        {section === 'supporting' && (
          <SupportingSection
            r={r} exhibits={exhibits} signatures={signatures} versions={versions}
            editable={editable} busy={busy} onChanged={reload}
            records={caseRecords} manifest={parsePacketManifest(currentVersion?.packet_manifest)}
            referencedBy={referencedBy} onOpenRequest={openRequest}
          />
        )}
        {section === 'review' && <ReviewSection actions={actions} name={name} />}
        {section === 'decision' && <DecisionSection r={r} name={name} />}
        {section === 'service' && <ServiceSection r={r} name={name} />}
        {section === 'activity' && <ActivitySection actions={actions} participants={participants} name={name} />}
      </div>

      {/* ── Role decision panel (sticky-bottom on mobile) ──────────────────── */}
      <DecisionPanel
        r={r} status={status} busy={busy} act={act} promptSig={promptSig}
        exhibits={exhibits} prosecutors={prosecutors} judges={judges}
        editable={editable} canCidReview={canCidReview} canManage={canManage}
        adaActing={adaActing} daActing={daActing} agActing={agActing}
        canAssignJudge={canAssignJudge} judgeActing={judgeActing} canJudgeClaim={canJudgeClaim}
        cidActive={cidActive} judgeSelf={judgeSelf} awarenessOnly={awarenessOnly}
        disposition={disposition} now={now} onSubmitToCid={submitToCid}
      />

      {preview && editable && (
        <SubmitPreview
          r={r} draft={draft} exhibits={exhibits} records={caseRecords}
          checklist={submitChecklist()} busy={busy}
          onCancel={() => setPreview(false)} onConfirm={() => void confirmSubmit()}
        />
      )}

      {printPreparedAt && currentVersion && (
        <CourtPacketPrint
          r={r} version={currentVersion} signatures={signatures} versions={versions}
          name={name} preparedAt={printPreparedAt} onDone={() => setPrintPreparedAt(null)}
        />
      )}
    </div>
  )
}
