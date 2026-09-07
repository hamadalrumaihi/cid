'use client'

/** Legal request DOSSIER — one component for every seat at the table (CID +
 *  the two live justice roles), on the modern dossier spine: Breadcrumbs →
 *  command header Card (stage tracker + disposition + SLA chips) →
 *  click-through MetricStrip → deep-linkable SectionTabs (`?section=`,
 *  coexisting with the parent's `?request=`) → the role decision panel →
 *  court-packet print.
 *
 *  Phase 4: the panel renders only what the current identity may do
 *  (creator edit/submit, bureau gate, AG assignment, judicial decision with
 *  per-target scope, CID fulfilment); the overflow menu carries the
 *  administrative actions (withdraw, cancel, amend, supersede, observer
 *  access, verified PDF/DOCX exports). Every action is a definer RPC — a
 *  hidden button is cosmetic, the server revalidates everything. Reviewers
 *  always see the exact immutable version (current_version_id), its frozen
 *  packet manifest, the structured charges, prior returns with their
 *  revision checklists, the comments thread and the signature trail. All
 *  stage/status interpretation comes from the deterministic legalWorkflow
 *  model; client authority checks are mirrors of the server's. */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { useMyJusticeRole } from '@/lib/permissions'
import { useSiu } from '@/lib/permissions'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { adoptLegacyDraft, clearDraft, saveDraft as saveUserDraft, type LoadedDraft } from '@/lib/userDrafts'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import {
  LEGAL_ACTION_COLS, SUBPOENA_FIELDS, WARRANT_FIELDS,
  fulfilmentLabel, isDecidedApproved, isEditableDraft, reviewStatusLabel,
  type LegalExhibit, type LegalRequest, type LegalSignature, type LegalVersion,
  type SubpoenaType, type WarrantType,
} from '@/lib/justice'
import { legalInstrumentSpec, legalPacketSpec, type LegalChargeRow, type TargetDecisionRow } from '@/lib/legalExport'
import { dispositionFor, formatTarget, humanize, routingExplanation, slaChips } from '@/lib/legalWorkflow'
import type { PdfDocSpec } from '@/lib/pdf'
import { bureauShort } from '@/lib/roles'
import { parsePacketManifest } from '@/lib/schemas'
import { humanizeError, toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { DocumentIcon, ScaleIcon, UndoIcon } from '@/components/shell/icons'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Card } from '@/components/ui/Card'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import {
  ClassificationBadge, LegalDeadlineChip, StatusChip, reviewTone, useLegalPeople,
} from './legalShared'
import { LegalStageTracker } from './LegalStageTracker'
import { CaseBriefPanel } from './dossier/CaseBriefPanel'
import { CommentsThread } from './dossier/CommentsThread'
import { CourtPacketPrint } from './dossier/CourtPacketPrint'
import { DecisionPanel } from './dossier/DecisionPanel'
import {
  DOSSIER_SECTIONS, sectionFromParam, useCaseRecords, useRestrictedExhibitIds,
  type ActionRow, type DossierSectionId, type DraftShape,
} from './dossier/dossierShared'
import { exportLegalDocument } from './dossier/exportRequest'
import { ActivitySection, DecisionSection, ReviewSection, ServiceSection, SummarySection } from './dossier/InfoSections'
import { buildLegalViewer, legalSubmitChecklist } from './dossier/legalP4Shim'
import { ObserverPickerModal } from './dossier/ObserverPickerModal'
import { RequestSection } from './dossier/RequestSection'
import { RevisionChecklist, type RevisionItem } from './dossier/RevisionChecklist'
import { readJsonRpc } from './dossier/rpcJson'
import { SubmitPreview } from './dossier/SubmitPreview'
import { SupersedeModal } from './dossier/SupersedeModal'
import { SupportingSection, type ReferencedBy } from './dossier/SupportingSection'

export interface LegalRequestDetailProps {
  requestId: string
  onBack: () => void
  /** Open a request in the guided editor (wizard edit mode). Offered for
   *  editable drafts (charges live only there) and after an amendment; when
   *  absent the dossier simply navigates to the new request. */
  onRevise?: (id: string) => void
}

export function LegalRequestDetail(props: LegalRequestDetailProps) {
  // useSearchParams needs a Suspense boundary in every host (LegalView has
  // one; the Justice shell does not) — carry our own so the dossier stays a
  // single drop-in component.
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading legal request…</p>}>
      <LegalRequestDossier {...props} />
    </Suspense>
  )
}

/** Closed terminals: no withdraw / cancel past these (mirror of the server's
 *  terminal set in withdraw_legal_request / legal_admin_cancel). */
const TERMINAL = new Set(['approved', 'partially_approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded'])
/** legal_amend sources (contract §5). */
const AMENDABLE = new Set(['approved', 'partially_approved', 'denied', 'superseded', 'withdrawn', 'cancelled'])
/** legal_mark_superseded sources (contract §1). */
const SUPERSEDABLE = new Set(['approved', 'partially_approved', 'denied', 'declined'])

function LegalRequestDossier({ requestId, onBack, onRevise }: LegalRequestDetailProps) {
  const auth = useAuth()
  const { profile, isCommand } = auth
  const siu = useSiu()
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
  const [charges, setCharges] = useState<LegalChargeRow[]>([])
  const [revisionItems, setRevisionItems] = useState<RevisionItem[]>([])
  const [targetDecisions, setTargetDecisions] = useState<TargetDecisionRow[]>([])
  const [referencedBy, setReferencedBy] = useState<ReferencedBy[]>([])
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const [printSpec, setPrintSpec] = useState<{ spec: PdfDocSpec; preparedAt: string } | null>(null)
  const [observerOpen, setObserverOpen] = useState(false)
  const [supersedeOpen, setSupersedeOpen] = useState(false)
  const people = useLegalPeople(requestId)
  const dojRole = useMyJusticeRole()
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
  // Cross-reference navigation (prior-request exhibits / "referenced by" /
  // amend + supersede links): swap the host's ?request= in place — both
  // hosts read it reactively, and the section key is dropped so it can't
  // leak into the next request.
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
        const [vs, ex, pa, ac, sg, ch, ri, td] = await Promise.all([
          list('legal_request_versions', { eq: { legal_request_id: requestId }, order: 'version_number', ascending: false }),
          list('legal_request_exhibits', { eq: { legal_request_id: requestId }, order: 'created_at' }),
          list('legal_request_participants', { eq: { legal_request_id: requestId }, order: 'added_at' }),
          list('legal_request_actions', { eq: { legal_request_id: requestId }, order: 'created_at', select: LEGAL_ACTION_COLS }) as unknown as Promise<ActionRow[]>,
          list('legal_request_signatures', { eq: { legal_request_id: requestId }, order: 'signed_at' }),
          // The Phase 4 side tables (RLS SELECT via can_view_legal_request;
          // no client writes). Each degrades to an empty list on its own —
          // a missing publication must never turn into "request unavailable".
          list('legal_request_charges', { eq: { legal_request_id: requestId }, order: 'created_at' }).catch(() => []),
          list('legal_request_revision_items', { eq: { legal_request_id: requestId }, order: 'created_at' }).catch(() => []),
          list('legal_request_target_decisions', { eq: { legal_request_id: requestId }, order: 'decided_at' }).catch(() => []),
        ])
        if (cancelled) return
        setVersions(vs); setExhibits(ex); setParticipants(pa); setActions(ac); setSignatures(sg)
        setCharges(ch); setRevisionItems(ri); setTargetDecisions(td)
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
  // Never-lose-work recovery (v1.14): a stash from a previous session (this
  // device, or any device via the per-user drafts layer). Offered ONLY via an explicit banner, and only when it is newer
  // than the server row — it never auto-fills the form.
  const [pendingDraft, setPendingDraft] = useState<LoadedDraft<DraftShape> | null>(null)
  const loadedDraftFor = useRef<string | null>(null)
  useEffect(() => {
    if (loadedDraftFor.current === requestId) return
    loadedDraftFor.current = requestId
    void adoptLegacyDraft<DraftShape>(`legal:edit:${requestId}`).then((d) => {
      if (loadedDraftFor.current === requestId) setPendingDraft(d)
    })
  }, [requestId])
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
  const restrictedIds = useRestrictedExhibitIds(exhibits)
  const [preview, setPreview] = useState(false)

  // Stash keystrokes while editing — cleared on a successful save or submit.
  useEffect(() => {
    if (!editingEnabled || !r || !seedJson) return
    if (JSON.stringify(draft) === seedJson) return
    void saveUserDraft(`legal:edit:${r.id}`, draft)
  }, [draft, editingEnabled, r, seedJson])

  const act = useCallback(async (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (res.error) toast(humanizeError(res.error.message), 'danger')
    else { toast(okMsg, 'success'); reload() }
  }, [reload])

  if (missing) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: 'Legal requests', onClick: back }, { label: 'Not found' }]} />
        <EmptyState
          icon={<ScaleIcon className="h-5 w-5" />}
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
  const isAG = dojRole === 'attorney_general'
  // Bureau Lead+ decision mirror: an active command member (Bureau Lead /
  // Deputy Director / Director; Owner passes server-side) who is NOT the
  // creator may approve/deny/return a request in supervisor review. Mirror
  // only — review_legal_request_as_cid re-checks everything server-side.
  const canCidReview = (isCommand || isOwnerFlag) && !isCreator && status === 'cid_supervisor_review'
  // The SIU lane's first approval. Gated on SIU COMMAND standing, never on a
  // CID rank: private.can_approve_legal() routes an SIU case through
  // siu_case_command(), so showing this to a Bureau Lead would paint a button
  // the database refuses — a silent no-op, which this codebase treats as worse
  // than a missing control.
  const canSiuCommandReview = (siu.isCommand || isOwnerFlag) && !isCreator
    && status === 'siu_command_review'
  /* ── P4-09 administrative actions — contract authority mirrors ─────────── */
  const commandLike = isCommand || isOwnerFlag || isAG || siu.isCommand
  const canWithdraw = isCreator && !TERMINAL.has(status)
  const canCancel = commandLike && !TERMINAL.has(status)
  const canAmend = cidActive && AMENDABLE.has(status)
  const canSupersede = commandLike && SUPERSEDABLE.has(status) && !r.superseded_by_id
  const canObserve = commandLike || isCreator
  const currentVersion = versions.find((x) => x.id === r.current_version_id) ?? versions[0] ?? null
  const canExportInstrument = !!currentVersion && isDecidedApproved(status)
  const canExportPacket = !!currentVersion
  const activeParticipant = participants.some((p) => p.user_id === me && !p.removed_at)
  const observerIds = participants.filter((p) => p.participant_role === 'observer' && !p.removed_at).map((p) => p.user_id)
  // Who may comment (contract §5 legal_comment): creator, active
  // participant, the approver pool, AG (when visible), Owner.
  const mirrorMayComment = isCreator || activeParticipant || (!!me && r.assigned_judge_id === me) || commandLike

  const viewer = buildLegalViewer(auth, dojRole, siu.isCommand)
  const disposition = dispositionFor(r, viewer, now)
  // "Current owner" — the named judge when one holds it, else the
  // responsible role (the queue, the bench, the investigator, …).
  const currentOwner = ['judicial_review', 'submitted_to_judge'].includes(status) && r.assigned_judge_id
    ? name(r.assigned_judge_id)
    : disposition.responsibleRoleLabel

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
    if (!res.error) { void clearDraft(`legal:edit:${r.id}`); setPendingDraft(null) }
    return res
  }, 'Draft saved.')

  /** Requirements checklist for the pre-submission preview — the server
   *  revalidates everything; this is honest UX, not authority. */
  const submitChecklist = () => legalSubmitChecklist({
    requestType: r.request_type, subtype: r.subtype,
    title: draft.title, narrative: draft.narrative, priority: draft.priority, form: draft.form,
    exhibitCount: exhibits.length,
  })

  // Submission is a two-step flow (§ packet preview, v1.14): review exactly
  // what the reviewers will receive, then confirm — the existing RPCs do the work.
  const submitToCid = () => {
    const missingReq = submitChecklist().filter((c) => c.blocking && !c.ok)
    if (missingReq.length) { toast(`Required: ${missingReq.map((f) => f.label).join(', ')}`, 'warn'); return }
    setPreview(true)
  }

  // Resubmission (P4-06): from ANY returned_* state the server requires a
  // change summary; a judge return fast-tracks back to the judicial queue
  // unless the investigator declares a material change in the preview.
  const returnedBy: 'judge' | 'bureau' | null =
    status === 'returned_by_judge' ? 'judge' : status.startsWith('returned_by') ? 'bureau' : null
  const unresolved = revisionItems.filter((i) => !i.resolved_at)

  const confirmSubmit = async (val: { materialChange: boolean; changeSummary: string }) => {
    const save = await rpc('update_legal_draft', {
      p_request: r.id, p_title: draft.title.trim() || undefined, p_priority: draft.priority || undefined,
      p_narrative: draft.narrative, p_classification: draft.classification || undefined, p_form: draft.form,
    })
    if (save.error) { toast(save.error.message, 'danger'); return }
    setPreview(false)
    const fastTrack = returnedBy === 'judge' && !val.materialChange
    await act(async () => {
      const res = await rpc('submit_legal_request_to_cid', {
        p_request: r.id,
        ...(returnedBy ? {
          p_change_summary: val.changeSummary,
          ...(returnedBy === 'judge' ? { p_material_change: val.materialChange } : {}),
        } : {}),
      })
      if (!res.error) { void clearDraft(`legal:edit:${r.id}`); setPendingDraft(null) }
      return res
    }, fastTrack
      ? 'Resubmitted — the corrected request returned directly to the judicial queue.'
      : 'Submitted for bureau review.')
  }

  const withdraw = async () => {
    const ok = await uiConfirm('Withdraw this legal request? The record is preserved but review stops.', { title: 'Withdraw request', confirmText: 'Withdraw' })
    if (!ok) return
    await act(async () => {
      const res = await rpc('withdraw_legal_request', { p_request: r.id })
      // A withdrawn request is abandoned — don't leave its narrative in
      // localStorage on shared terminals.
      if (!res.error) { void clearDraft(`legal:edit:${r.id}`); setPendingDraft(null) }
      return res
    }, 'Request withdrawn.')
  }
  const cancel = async () => {
    const reason = await uiPrompt('Reason for cancelling this request (required — recorded on the timeline).', { title: 'Cancel request', confirmText: 'Cancel request' })
    if (!reason?.trim()) return
    await act(() => rpc('legal_admin_cancel', { p_request: r.id, p_reason: reason.trim() }), 'Request cancelled.')
  }
  // Amend (L13): never edit a decided instrument in place — legal_amend
  // clones it into a NEW linked draft, which opens in the guided editor.
  const amend = async () => {
    const reason = await uiPrompt('Why is an amended request needed? (required — recorded on both requests)', { title: 'Amend request', confirmText: 'Create amended draft' })
    if (!reason?.trim()) return
    setBusy(true)
    const res = readJsonRpc<{ id?: string; request_number?: string }>(await rpc('legal_amend', { p_request: r.id, p_reason: reason.trim() }))
    setBusy(false)
    if (!res.ok || typeof res.data?.id !== 'string') { toast(res.message ?? 'Could not create the amended draft.', 'danger'); return }
    toast(`Amended draft ${res.data.request_number ?? ''} created — revise and submit it.`.replace('  ', ' '), 'success')
    if (onRevise) onRevise(res.data.id)
    else openRequest(res.data.id)
  }
  const supersede = async (val: { replacementId: string; reason: string }) => {
    await act(() => rpc('legal_mark_superseded', { p_old: r.id, p_new: val.replacementId, p_reason: val.reason }), 'Marked superseded.')
    setSupersedeOpen(false)
  }
  const setObserver = async (val: { userId: string; active: boolean; reason: string }) => {
    setBusy(true)
    const res = readJsonRpc(await rpc('legal_set_observer', {
      p_request: r.id, p_user: val.userId, p_active: val.active, ...(val.reason ? { p_reason: val.reason } : {}),
    }))
    setBusy(false)
    if (!res.ok) { toast(res.message ?? 'Refused.', 'danger'); return }
    toast(val.active ? 'Observer access granted.' : 'Observer access removed.', 'success')
    setObserverOpen(false)
    reload()
  }

  /* ── Exports (P4-11): record → build from the rows we hold → download ─── */
  const exportInputs = {
    r, version: currentVersion, versions, exhibits, timeline: actions, charges, targetDecisions, signatures, name,
    restrictedSourceIds: restrictedIds,
  }
  const runExport = async (kind: 'instrument' | 'packet', format: 'pdf' | 'docx') => {
    setBusy(true)
    const ok = await exportLegalDocument(kind, format, exportInputs)
    setBusy(false)
    if (ok) reload() // the timeline gains an `exported` row
  }
  const print = (kind: 'instrument' | 'packet') => {
    const opts = { name, restrictedSourceIds: restrictedIds, versions, statusLabel: reviewStatusLabel, fulfilmentLabel }
    const spec = kind === 'instrument'
      ? legalInstrumentSpec(r, currentVersion, charges, targetDecisions, signatures, null, { ...opts, exhibits })
      : legalPacketSpec(r, currentVersion, exhibits, actions, charges, signatures, null, { ...opts, targetDecisions })
    setPrintSpec({ spec, preparedAt: fmtDateTime(new Date()) })
  }

  const spec = r.request_type === 'subpoena'
    ? (SUBPOENA_FIELDS[r.subtype as SubpoenaType] ?? [])
    : r.request_type === 'warrant' ? (WARRANT_FIELDS[r.subtype as WarrantType] ?? []) : []

  const returnsCount = actions.filter((a) => a.to_status?.startsWith('returned')).length
  const metrics: Metric[] = [
    { label: 'Versions', value: versions.length, onClick: () => setSection('request') },
    { label: 'Charges', value: charges.length, onClick: () => setSection('request') },
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
    ...(canExportInstrument ? [
      { label: 'Export instrument (PDF)', icon: <DocumentIcon size={15} />, disabled: busy, onClick: () => void runExport('instrument', 'pdf') },
      { label: 'Export instrument (DOCX)', icon: <DocumentIcon size={15} />, disabled: busy, onClick: () => void runExport('instrument', 'docx') },
      { label: 'Print instrument', icon: <DocumentIcon size={15} />, onClick: () => print('instrument') },
    ] : []),
    ...(canExportPacket ? [
      { label: 'Export court packet (PDF)', icon: <DocumentIcon size={15} />, disabled: busy, separatorBefore: canExportInstrument, onClick: () => void runExport('packet', 'pdf') },
      { label: 'Export court packet (DOCX)', icon: <DocumentIcon size={15} />, disabled: busy, onClick: () => void runExport('packet', 'docx') },
    ] : []),
    { label: 'Print court packet', icon: <DocumentIcon size={15} />, disabled: !currentVersion, onClick: () => print('packet') },
    ...(editable && onRevise ? [{ label: 'Revise in guided editor', separatorBefore: true, onClick: () => onRevise(r.id) }] : []),
    ...(canAmend ? [{ label: 'Amend — new linked request…', separatorBefore: !(editable && onRevise), disabled: busy, onClick: () => void amend() }] : []),
    ...(canSupersede ? [{ label: 'Supersede…', disabled: busy, onClick: () => setSupersedeOpen(true) }] : []),
    ...(canObserve ? [{ label: 'Observer access…', disabled: busy, onClick: () => setObserverOpen(true) }] : []),
    ...(canWithdraw ? [{
      label: 'Withdraw request…', icon: <UndoIcon size={15} />, danger: true, separatorBefore: true,
      onClick: () => void withdraw(),
    }] : []),
    ...(canCancel ? [{
      label: 'Cancel request…', danger: true, separatorBefore: !canWithdraw, disabled: busy,
      onClick: () => void cancel(),
    }] : []),
  ]

  // Newest return note — surfaced prominently for the investigator so the
  // required corrections are never buried in the Review tab (actions load
  // ascending; the last matching row is the newest).
  const latestReturn = returnedBy
    ? [...actions].reverse().find((a) => a.to_status === status) ?? null
    : null
  const returnedByLabel = status === 'returned_by_judge' ? 'the Judge'
    : status === 'returned_by_siu_command' ? 'SIB command'
    : status === 'returned_by_cid' ? 'the Bureau Lead'
    : reviewStatusLabel(status)
  const chips = slaChips(r, now)

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Legal requests', onClick: back }, { label: r.request_number }]} />

      {/* ── Return callout (investigator) ──────────────────────────────────── */}
      {isCreator && returnedBy && (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-bold text-amber-200">
            Returned for revision by {returnedByLabel}
            {latestReturn && (
              <span className="ml-2 font-normal text-amber-200/80">
                {latestReturn.actor_id ? name(latestReturn.actor_id) : 'System'} · {timeAgo(latestReturn.created_at)}
              </span>
            )}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-100">
            {latestReturn?.public_note
              ? <>Reason: {latestReturn.public_note}</>
              : 'No return note was recorded — see the Review section for the full history.'}
          </p>
          <p className="mt-1.5 text-xs text-amber-200/80">
            {returnedBy === 'judge'
              ? 'Work through the checklist, then resubmit with a change summary — a corrected request returns directly to the judicial queue unless you declare a material change.'
              : 'Work through the checklist, then resubmit with a change summary for renewed bureau review.'}
          </p>
        </div>
      )}
      {revisionItems.length > 0 && (isCreator || unresolved.length > 0) && (
        <RevisionChecklist
          items={revisionItems} canResolve={editable} busy={busy} name={name} onChanged={reload}
        />
      )}

      {/* ── Command header ─────────────────────────────────────────────────── */}
      <Card pad="lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-blue-300">{r.request_number}</span>
              <span className="text-xs font-medium text-slate-400">
                {humanize(r.request_type)} · {humanize(r.subtype)}
              </span>
              <ClassificationBadge value={r.classification} />
            </div>
            <h1 className="mt-1 text-xl font-semibold text-white">{r.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* partially_approved is a judicial approval (P4-07) — emerald
                  like approved until the status registry learns the value. */}
              <StatusChip label={reviewStatusLabel(status)} tone={status === 'partially_approved' ? 'emerald' : reviewTone(status)} />
              <StatusChip label={fulfilmentLabel(r.fulfilment_status)} tone="slate" />
              <LegalDeadlineChip request={r} />
              {/* SLA chips (P4-10): the reminder sweep's marks + expiry pressure. */}
              {chips.map((c) => <StatusChip key={c.id} label={c.label} tone={c.tone === 'danger' ? 'rose' : 'amber'} />)}
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

        {/* Disposition strip: stage · current owner · next required action ·
            responsible bureau — the four facts every seat needs at a glance. */}
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-white/5 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-slate-400">Stage</dt>
            <dd className="text-sm font-semibold text-white">{disposition.stageLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400">Current owner</dt>
            <dd className="text-sm text-slate-200">{currentOwner}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400">Next required action</dt>
            <dd className="text-sm text-slate-200">{disposition.nextAction}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400">Responsible bureau</dt>
            <dd className="text-sm text-slate-200">{r.responsible_bureau ? bureauShort(r.responsible_bureau) : '—'}</dd>
          </div>
        </dl>
        {!disposition.viewerCanAct && disposition.whyNoAction && (
          <p className="mt-2 text-xs text-slate-400">{disposition.whyNoAction}</p>
        )}
        <details className="mt-1">
          <summary className="cursor-pointer rounded text-xs font-semibold text-badge-200 hover:text-white">
            Why is it here?
          </summary>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{routingExplanation(r, viewer)}</p>
        </details>
      </Card>

      {/* ── Case brief (justice seats only) — the referenced-material view
          from legal_request_case_brief; never a link into /cases. */}
      {dojRole && <CaseBriefPanel requestId={requestId} />}

      <MetricStrip metrics={metrics} />

      {/* ── Deep-linkable sections ─────────────────────────────────────────── */}
      <div className="sticky-below-header z-20 -mx-1 bg-ink-950/80 px-1 py-1 backdrop-blur">
        <SectionTabs<DossierSectionId> tabs={tabs} active={section} onChange={setSection} idBase="legal" ariaLabel="Legal request sections" />
      </div>

      <div id={panelDomId('legal', section)} role="tabpanel" aria-labelledby={tabDomId('legal', section)} tabIndex={-1}>
        {section === 'summary' && (
          <SummarySection r={r} name={name} viewer={viewer} disposition={disposition} caseLinkable={cidActive} charges={charges} />
        )}
        {section === 'request' && (
          <RequestSection
            r={r} editable={editable} busy={busy} spec={spec}
            draft={draft} setDraft={setDraft}
            pendingDraft={pendingDraft} setPendingDraft={setPendingDraft}
            currentVersion={currentVersion} versions={versions} name={name}
            onSaveDraft={() => void saveDraft()} onSubmit={() => void submitToCid()}
            charges={charges} onEditCharges={onRevise ? () => onRevise(r.id) : undefined}
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
        {section === 'review' && (
          <div className="space-y-4">
            {revisionItems.length > 0 && (
              <RevisionChecklist items={revisionItems} canResolve={editable} busy={busy} name={name} onChanged={reload} />
            )}
            <ReviewSection actions={actions} name={name} />
          </div>
        )}
        {section === 'comments' && (
          <CommentsThread
            requestId={requestId} me={me} name={name}
            mirrorMayComment={mirrorMayComment} mayDeleteAny={isAG || isOwnerFlag}
          />
        )}
        {section === 'decision' && (
          <DecisionSection r={r} name={name} onOpenRequest={openRequest} targetDecisions={targetDecisions} exhibits={exhibits} />
        )}
        {section === 'service' && <ServiceSection r={r} name={name} canFulfil={cidActive && r.request_type === 'warrant'} />}
        {section === 'activity' && <ActivitySection actions={actions} participants={participants} name={name} />}
      </div>

      {/* ── Role decision panel (sticky-bottom on mobile) ──────────────────── */}
      <DecisionPanel
        r={r} busy={busy} act={act} promptSig={promptSig}
        exhibits={exhibits}
        editable={editable} canCidReview={canCidReview}
        canSiuCommandReview={canSiuCommandReview}
        cidActive={cidActive} viewer={viewer}
        disposition={disposition} now={now} onSubmitToCid={submitToCid}
      />

      {preview && editable && (
        <SubmitPreview
          r={r} draft={draft} exhibits={exhibits} records={caseRecords}
          checklist={submitChecklist()} busy={busy} returnedBy={returnedBy} unresolved={unresolved}
          onCancel={() => setPreview(false)} onConfirm={(val) => void confirmSubmit(val)}
        />
      )}
      {observerOpen && (
        <ObserverPickerModal
          requestNumber={r.request_number} currentObserverIds={observerIds} busy={busy}
          onSubmit={(val) => void setObserver(val)} onClose={() => setObserverOpen(false)}
        />
      )}
      {supersedeOpen && (
        <SupersedeModal r={r} busy={busy} onSubmit={(val) => void supersede(val)} onClose={() => setSupersedeOpen(false)} />
      )}
      {printSpec && (
        <CourtPacketPrint spec={printSpec.spec} preparedAt={printSpec.preparedAt} onDone={() => setPrintSpec(null)} />
      )}
    </div>
  )
}
