'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToolNav } from '@/components/tools/useToolNav'
import { GuideHelpLink } from '@/components/guides/GuideHelpLink'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { list, rpc, update } from '@/lib/db'
import { deleteRecord } from '@/lib/deleteRecord'
import { createReport } from '@/lib/services/reports'
import type { Json, Tables } from '@/lib/database.types'
import { copyText, fmtDateTime, timeAgo } from '@/lib/format'
import { caseLink } from '@/lib/caseLinks'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { WARRANT_TPLS, reportTitle, warrantStatusOf, type FormSchema, type FormValues } from '@/lib/forms'
import {
  REPORT_REVIEW_LABEL, fallbackVersionFor, isReportEditable, loadPublishedTemplates, parseSignatureInfo, reopenEntries,
  reportReviewTone, resolveReportVersion, reviewStatusOf, type PublishedTemplate, type TemplateCatalog, type TemplateVersion,
} from '@/lib/reportTemplates'
import { parseMediaRefEntries } from '@/lib/mediaRefs'
import { detectEditedEntities, entityKey, mentionEntityRows, mergeEntityItems, withMentionLabels, type EntityItem, type MentionLabels } from '@/lib/mentions'
import { parseSignatureLike } from '@/lib/reportExport'
import { parseFormValues } from '@/lib/jsonShapes'
import { canReopenReport, canReviewReport, canSubmitReport, type CidViewer } from '@/lib/permissions'
import { SignatureViewer, type SignatureItem } from '@/components/shared/SignatureViewer'
import { RecordHistory } from '@/components/shared/RecordHistory'
import { VersionViewer } from '@/components/shared/VersionViewer'
import { clearDraft, loadDraft, saveDraft, useDraftState } from '@/lib/userDrafts'
import { useTabDirty } from '@/components/workspace/WorkspaceProvider'
import { SaveState } from '@/components/ui/SaveState'
import { humanizeError, toast } from '@/lib/toast'
import { WarrantPrintButton } from './WarrantPrint'
import type { CaseRow, EvidenceRow, MediaRow, ReportRow } from './shared'
import { DocumentIcon, ScaleIcon, VideoIcon } from '@/components/shell/icons'
import { TemplateIcon } from './reports/TemplateIcon'
import { ReportView } from './reports/ReportView'
import { FormEditor } from './reports/FormEditor'
import { RequiredChecklist } from './reports/RequiredChecklist'
import { ReopenReportModal, ReviewReportModal, SubmitReportModal, type FlowTarget } from './reports/ReportFlowModals'
import { InsertFromCaseDrawer } from './reports/InsertFromCaseDrawer'
import { ReportEntityList } from './reports/ReportEntityBadge'
import { loadReportEntities, syncReportEntities, toEntityItem } from './reports/ReportEntities'
import { ReportExportMenu } from './reports/ReportExportMenu'

/** Lite persons projection the read view resolves report-referenced ids to. */
type PersonRef = { id: string; name: string | null }

/** Person ids a report's fields reference — the `_${key}_person_id` companions
 *  the kv person fields write and the `person_id` cells of grid rows with a
 *  person column. Pure (exported for the unit tests); tolerant of legacy
 *  shapes: missing keys, non-array grids and name-only rows yield nothing. */
export function collectReportPersonIds(schema: FormSchema | undefined, values: FormValues): string[] {
  if (!schema) return []
  const out = new Set<string>()
  const add = (v: unknown) => { const id = typeof v === 'string' ? v.trim() : ''; if (id) out.add(id) }
  for (const s of schema.sections) {
    if (s.type === 'kv') { for (const f of s.fields) if (f.person) add(values[`_${f.key}_person_id`]) }
    else if (s.type === 'grid' && s.cols.some((col) => col.person)) {
      const rows = Array.isArray(values[s.id]) ? (values[s.id] as unknown[]) : []
      for (const row of rows) if (row && typeof row === 'object') add((row as Record<string, unknown>).person_id)
    }
  }
  return [...out]
}

/** Both seal signatures (author + reviewer) plus every superseded pair a
 *  reopen preserved in fields._reopen_log — purely presentational. Pure
 *  (exported for the unit tests). */
export function sealSignatureItems(r: Pick<ReportRow, 'signature' | 'reviewer_signature' | 'fields'>): SignatureItem[] {
  const sig = parseSignatureInfo(r.signature)
  const rev = parseSignatureInfo(r.reviewer_signature)
  const log = reopenEntries(parseFormValues(r.fields))
  return [
    ...(sig ? [{ id: 'current', name: sig.officer, badge: sig.badge ?? null, action: 'report seal', at: sig.signed_at ?? null }] : []),
    ...(rev ? [{ id: 'reviewer', name: rev.officer, badge: rev.badge ?? null, role: rev.role ?? null, action: 'review approval', at: rev.signed_at ?? null }] : []),
    ...log.flatMap((e, i) => [
      ...(e.prev_signature ? [{ id: `prev-${i}`, name: e.prev_signature.officer, badge: e.prev_signature.badge ?? null, action: 'previous seal', at: e.at ?? null, superseded: true }] : []),
      ...(e.prev_reviewer_signature ? [{ id: `prev-rev-${i}`, name: e.prev_reviewer_signature.officer, badge: e.prev_reviewer_signature.badge ?? null, role: e.prev_reviewer_signature.role ?? null, action: 'previous review approval', at: e.at ?? null, superseded: true }] : []),
    ]),
  ]
}

export function ReportsTab({ c, canEdit, canDelete, holdActive = false }: { c: CaseRow; canEdit: boolean; canDelete: boolean; holdActive?: boolean }) {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile } = useAuth()
  const viewer: CidViewer = useMemo(() => ({ id: profile?.id, role: profile?.role, division: profile?.division, active: profile?.active, is_owner: profile?.is_owner }), [profile])
  // Case writability mirror (private.case_writable): an archived case refuses
  // every write, so the flow controls close with it.
  const writable = canEdit && !c.archived_at
  const [reports, setReports] = useState<ReportRow[]>([])
  // Published template catalog (DB, with the FORM_SCHEMAS fallback) — drives
  // the picker; every OPEN report renders from its own pinned version.
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  useEffect(() => {
    let alive = true
    void loadPublishedTemplates().then((cat) => { if (alive) setCatalog(cat) })
    return () => { alive = false }
  }, [])
  const byKey = useMemo(() => new Map((catalog?.templates ?? []).map((t) => [t.key, t])), [catalog])
  const titleOf = useCallback((r: ReportRow) => reportTitle(r, byKey.get(r.template)?.name), [byKey])
  // `entities` = the report's record set (report_entities: drawer inserts +
  // narrative mentions); `labels` = every mention label known (snapshots +
  // what the RichEditor learns) so the mention rows can be derived on save.
  const [editing, setEditing] = useState<{ template: string; version: TemplateVersion; values: FormValues; report?: ReportRow; entities: EntityItem[]; labels: MentionLabels } | null>(null)
  /** Drop an inserted record from the editor; a saved report persists the
   *  remaining set at once (REPLACE — the source record is never touched). */
  const removeEntity = async (key: string) => {
    if (!editing) return
    const remaining = editing.entities.filter((it) => entityKey(it) !== key)
    setEditing({ ...editing, entities: remaining })
    if (editing.report) {
      const res = await syncReportEntities(editing.report.id, remaining, 'replace')
      if (!res.ok) toast(humanizeError(res.message ?? 'Could not update the inserted records.'), 'danger')
    }
  }
  // Insert-from-case drawer: the narrative key its lines append to.
  const [drawerFor, setDrawerFor] = useState<string | null>(null)
  // The open report lives in the URL (?report=), so exact records are
  // shareable/bookmarkable. `case` and `tab` are always preserved — same
  // router.replace idiom the shell's tab strip uses.
  const openId = sp.get('report')
  const setOpenId = useCallback((id: string | null) => {
    const params = new URLSearchParams(sp.toString())
    params.set('case', c.id)
    if (id) params.set('report', id)
    else params.delete('report')
    router.replace(`/cases?${params.toString()}`)
  }, [sp, router, c.id])
  // Submit / review / reopen each go through an explicit dialog.
  const [flow, setFlow] = useState<FlowTarget | null>(null)
  const openFlow = async (kind: FlowTarget['kind'], r: ReportRow, decision?: 'approve' | 'return') => {
    const version = await resolveReportVersion(r, catalog?.templates)
    setFlow({ kind, r, version, decision })
  }
  const v = useTableVersion('reports')
  const refresh = useCallback(async () => { try { setReports(await list('reports', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  // The in-page detail derives from the id, so a realtime refresh shows the
  // REFRESHED row (a review decision flips the chip live) and a deleted
  // report falls back to the list.
  const open = openId ? reports.find((r) => r.id === openId) ?? null : null
  const seed = (): FormValues => ({ case_number: c.case_number, report_type: 'Initial', filed_at: fmtDateTime(new Date()), det_name: profile?.display_name || '', detective: profile?.display_name || '', narrative: c.summary || '', summary: c.summary || '' })
  // Never-lose-work: field values are stashed per case+template (or per
  // report when editing) while typing — DB-backed via userDrafts so a draft
  // follows the detective across devices — restored when the editor reopens,
  // and cleared on a successful save. Closing/cancelling keeps the draft.
  const draftKey = (template: string, report?: ReportRow) => (report ? `report:edit:${report.id}` : `report:${c.id}:${template}`)
  const editorDraft = useDraftState(editing ? draftKey(editing.template, editing.report) : '')
  useTabDirty(editing ? draftKey(editing.template, editing.report) : '') // workspace tab dot while the flush is pending
  const openEditor = async (template: string, report?: ReportRow) => {
    // New reports use the published version; an existing report its PINNED
    // one (fallback by key when it was filed before the catalog existed).
    const version = report ? await resolveReportVersion(report, catalog?.templates) : (byKey.get(template)?.version ?? fallbackVersionFor(template))
    if (!version) { toast('This report template is not available.', 'warn'); return }
    const d = await loadDraft<FormValues>(draftKey(template, report))
    const base = report ? parseFormValues(report.fields) : seed()
    const useDraft = !!d?.data && (!report || d.at > new Date(report.updated_at ?? report.created_at).getTime())
    if (useDraft) toast('Unsaved draft restored.', 'info')
    const entities = report ? (await loadReportEntities(report.id).catch(() => [])).map(toEntityItem) : []
    setEditing({ template, version, values: useDraft ? d!.data : base, report, entities, labels: withMentionLabels({}, entities) })
  }
  // Explicit throw-away (the legal wizard's discard pattern): clears the
  // stash everywhere and resets the form to the saved row / fresh seed.
  const discardEditorDraft = async () => {
    if (!editing) return
    await clearDraft(draftKey(editing.template, editing.report))
    setEditing((cur) => (cur ? { ...cur, values: cur.report ? parseFormValues(cur.report.fields) : seed() } : cur))
    toast('Draft discarded.', 'info')
  }
  const save = async () => {
    if (!editing) return
    const hasMediaRefs = editing.version.schema.sections.some((s) => s.type === 'textarea' && s.mediaPick)
    const prevRefs = editing.report ? String(parseFormValues(editing.report.fields).media_refs ?? '') : ''
    let reportId = editing.report?.id ?? null
    if (editing.report) {
      // Editing changes only what was typed — kind/seq/author stay as filed.
      // A submitted / sealed report is trigger-locked; the message says so.
      const res = await update('reports', editing.report.id, { fields: editing.values as Json })
      if (res.error) { toast(res.error.message, 'danger'); return }
    } else {
      // Creation goes through the shared report_create RPC: seq is computed
      // server-side (max+1 per case/template/kind under a lock — the old
      // client count raced concurrent authors), author_id is pinned to the
      // caller and template_version_id to the published version.
      const rt = String(editing.values.report_type ?? '').toLowerCase()
      const kind = rt.startsWith('supplemental') ? ('supplemental' as const) : rt.startsWith('follow') ? ('followup' as const) : ('initial' as const)
      const res = await createReport({ caseId: c.id, template: editing.template, kind, fields: editing.values as Json })
      if (res.error) { toast(res.error.message, 'danger'); return }
      reportId = res.data?.id ?? null
    }
    if (hasMediaRefs && reportId) await syncReportMediaLinks(reportId, prevRefs, String(editing.values.media_refs ?? ''))
    if (reportId) await syncEntitiesAfterSave(reportId, editing)
    void clearDraft(draftKey(editing.template, editing.report)); setEditing(null); toast('Report saved.', 'success'); void refresh()
  }
  /** report_entities follow every save (P5-04/05): the narrative's `[kind:id]`
   *  tokens become role-'mention' rows (the narrative is their source of
   *  truth — removed tokens drop their rows), the drawer's inserts are kept
   *  and re-flagged "differs from record" when their text was edited. One
   *  read-merge-send; a refusal is a warning, the report itself is saved. */
  const syncEntitiesAfterSave = async (reportId: string, e: NonNullable<typeof editing>) => {
    const narrative = e.version.schema.sections.filter((s) => s.type === 'textarea' && !s.mediaPick).map((s) => (s.type === 'textarea' ? String(e.values[s.key] ?? '') : '')).join('\n')
    const inserted = detectEditedEntities(e.entities.filter((it) => it.role !== 'mention'), JSON.stringify(e.values))
    const mentions = mentionEntityRows(narrative, e.labels)
    const hadMentions = e.entities.some((it) => it.role === 'mention')
    if (!inserted.length && !mentions.length && !hadMentions) return
    const res = await syncReportEntities(reportId, [...inserted, ...mentions], 'mentions')
    if (!res.ok) toast(`Report saved, but its record links were not updated: ${res.message}`, 'warn')
  }
  // List-row action label: the published version's review rule for the key
  // (the dialog re-resolves the PINNED version before acting).
  const selfSealByKey = (key: string) => { const ver = byKey.get(key)?.version ?? fallbackVersionFor(key); return !!ver && !ver.reviewRequired }
  const statusChip = (r: ReportRow) => { const s = reviewStatusOf(r); return <Badge tone={reportReviewTone(s)}>{REPORT_REVIEW_LABEL[s]}</Badge> }
  return (
    <div className="space-y-4">
      {open ? (
        <ReportDetail r={open} c={c} viewer={viewer} writable={writable} canEdit={canEdit} canDelete={canDelete} holdActive={holdActive} catalog={catalog} title={titleOf(open)}
          onBack={() => setOpenId(null)}
          onEdit={() => void openEditor(open.template, open)}
          onSubmit={() => void openFlow('submit', open)}
          onReview={(decision) => void openFlow('review', open, decision)}
          onReopen={() => void openFlow('reopen', open)}
          onChanged={() => void refresh()}
          onDelete={() => { void deleteRecord('reports', open, { label: titleOf(open), after: refresh }); setOpenId(null) }} />
      ) : (<>
        {writable && (
          catalog
            ? <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">{catalog.templates.map((tpl: PublishedTemplate) => <Button key={tpl.id} onClick={() => void openEditor(tpl.key)} title={tpl.description || (tpl.version.reviewRequired ? 'Review required before sealing' : 'Seals on submission')}><TemplateIcon id={tpl.key} /> {tpl.name}</Button>)}</div>
                {catalog.source === 'fallback' && <p className="text-xs text-slate-400">Template catalog unavailable — offering the built-in forms.</p>}
              </div>
            : <ListSkeleton count={1} />
        )}
        <div className="space-y-2">
          {reports.map((r) => {
            const editable = isReportEditable(r)
            const mySubmit = canSubmitReport(r, viewer, writable)
            return <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink-950/50 p-3">
              <button onClick={() => setOpenId(r.id)} className="min-w-0 flex-1 text-left">
                <p className="font-semibold text-white">{titleOf(r)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">{statusChip(r)}<span>{timeAgo(r.created_at)}</span></p>
              </button>
              {editable && mySubmit && <Button size="sm" variant={selfSealByKey(r.template) ? 'success' : 'warn'} onClick={() => void openFlow('submit', r)}>{selfSealByKey(r.template) ? 'Finalize' : 'Submit for review'}</Button>}
              {reviewStatusOf(r) === 'submitted' && canReviewReport(r, viewer, c.bureau) && <Button size="sm" variant="primary" onClick={() => void openFlow('review', r)}>Review</Button>}
              {editable && writable && <button onClick={() => void openEditor(r.template, r)} className="min-h-9 text-sm font-bold text-badge-200">Edit</button>}
              {canDelete && (holdActive ? <span title="A legal hold preserves this case's reports" className="text-sm font-bold text-rose-300/50">Held</span> : <button onClick={() => { void deleteRecord('reports', r, { label: titleOf(r), after: refresh }) }} className="min-h-9 text-sm font-bold text-rose-300">Delete</button>)}
            </div>
          })}
          {!reports.length && <p className="rounded-lg border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-400">No reports yet.</p>}
        </div>
      </>)}
      <Modal open={!!editing} onClose={() => setEditing(null)} wide>
        <div className="p-5">
          <ModalHeader
            title={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {editing ? editing.version.schema.title || 'Report' : 'Report'}
                {editing && editing.version.versionNumber > 0 && <span className="font-mono text-xs font-normal text-slate-400">v{editing.version.versionNumber}</span>}
                <SaveState status={editorDraft.status} lastSavedAt={editorDraft.lastSavedAt} />
              </span>
            }
            onClose={() => setEditing(null)}
          />
          {editing && <div className="space-y-4">
            {editing.report && reviewStatusOf(editing.report) === 'returned' && editing.report.review_note && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100"><span className="font-semibold">Returned for revision:</span> {editing.report.review_note}</p>
            )}
            <RequiredChecklist version={editing.version} values={editing.values} compact />
            <FormEditor template={editing.template} schema={editing.version.schema} caseId={c.id} reportId={editing.report?.id} values={editing.values} requiredKeys={editing.version.required} advisoryKeys={editing.version.advisory}
              mentions={{ labels: editing.labels, onLabels: (labels) => setEditing((cur) => (cur ? { ...cur, labels: { ...cur.labels, ...labels } } : cur)) }}
              onInsertFromCase={(key) => setDrawerFor(key)}
              onChange={(values) => { setEditing({ ...editing, values }); void saveDraft(draftKey(editing.template, editing.report), values) }} />
            {editing.entities.some((it) => it.role !== 'mention') && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-400">Records inserted from the case</p>
                <ReportEntityList items={editing.entities.filter((it) => it.role !== 'mention')} onRemove={(key) => void removeEntity(key)} />
              </div>
            )}
          </div>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" className="text-rose-300 hover:text-rose-200" onAction={discardEditorDraft}>Discard draft</Button>
            <div className="flex gap-2"><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onAction={save}>Save</Button></div>
          </div>
        </div>
      </Modal>
      {editing && drawerFor && (
        <InsertFromCaseDrawer
          caseId={c.id}
          reportId={editing.report?.id ?? null}
          values={editing.values}
          schema={editing.version.schema}
          entities={editing.entities}
          mentionTokens
          onClose={() => setDrawerFor(null)}
          onInsert={(items, text) => {
            // Append the rendered lines to the target narrative and keep the
            // items locally; an existing report is persisted by the drawer
            // itself, a new one syncs right after report_create (save()).
            const cur = String(editing.values[drawerFor] ?? '').trimEnd()
            const values = { ...editing.values, [drawerFor]: cur ? `${cur}\n${text}` : text }
            setEditing({ ...editing, values, entities: mergeEntityItems(editing.entities, items, 'merge'), labels: withMentionLabels(editing.labels, items) })
            void saveDraft(draftKey(editing.template, editing.report), values)
            setDrawerFor(null)
          }}
        />
      )}
      <SubmitReportModal target={flow} onClose={() => setFlow(null)} onDone={() => void refresh()} />
      <ReviewReportModal target={flow} onClose={() => setFlow(null)} onDone={() => void refresh()} />
      <ReopenReportModal target={flow} onClose={() => setFlow(null)} onDone={() => void refresh()} />
    </div>
  )
}

/** In-page read view of one report — replaces the template row + list while
 *  open. Renders from the report's PINNED template version. Loads case
 *  evidence/attachments plus ONLY the persons this report's fields reference
 *  (bounded in:{id} lookup — never the whole registry) so ReportView can make
 *  referenced items clickable; every load is best-effort. */
function ReportDetail({ r, c, viewer, writable, canEdit, canDelete, holdActive, catalog, title, onBack, onEdit, onSubmit, onReview, onReopen, onChanged, onDelete }: {
  r: ReportRow; c: CaseRow; viewer: CidViewer; writable: boolean; canEdit: boolean; canDelete: boolean; holdActive: boolean; catalog: TemplateCatalog | null; title: string
  onBack: () => void; onEdit: () => void; onSubmit: () => void; onReview: (decision?: 'approve' | 'return') => void; onReopen: () => void; onChanged: () => void; onDelete: () => void
}) {
  const router = useRouter()
  const nav = useToolNav()
  const status = warrantStatusOf(r)
  const review = reviewStatusOf(r)
  // Pinned version — resolved once per report id; the schema it carries is
  // what this report was filed under, whatever the template says today.
  const [version, setVersion] = useState<TemplateVersion | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void resolveReportVersion({ template: r.template, template_version_id: r.template_version_id }, catalog?.templates).then((ver) => { if (alive) setVersion(ver) })
    return () => { alive = false }
  }, [r.template, r.template_version_id, catalog])
  const schema = version?.schema
  const selfSeal = !!version && !version.reviewRequired
  // Warrant lifecycle goes through a validating RPC — the status whitelist
  // and the actor stamped into fields._warrant_log are server-side, and it's
  // the only path that can touch a sealed warrant.
  const setWarrant = async (next: string) => {
    if (next === status) return
    const res = await rpc('warrant_set_status', { p_report: r.id, p_status: next })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(`Warrant marked ${next}.`, 'success'); onChanged() }
  }
  // Submit for Legal Review (arrest warrants only): spins up a DOJ legal
  // request linked to this case + finalized report, carrying the canonical
  // suspect person_id, title, priority and justification. The report itself
  // stays investigator-owned — the legal request freezes its own versions.
  const [legalBusy, setLegalBusy] = useState(false)
  const submitForLegalReview = async () => {
    const vals = parseFormValues(r.fields)
    const suspects = Array.isArray(vals.suspects) ? (vals.suspects as Record<string, string>[]) : []
    const suspectPid = suspects.find((s) => s.person_id)?.person_id || ''
    const suspectName = suspects.map((s) => s.full_name).filter(Boolean).join(', ')
    if (!suspectPid) {
      toast('No suspect is linked to a registry profile — edit the report and use the Full Name picker in Suspect Information to link one.', 'warn')
      return
    }
    const title = String(vals.warrant_title ?? '').trim() || `Arrest Warrant — ${suspectName || c.case_number}`
    const priority = ['Medium', 'High', 'Critical'].includes(String(vals.priority)) ? String(vals.priority) : 'Medium'
    const narrative = [String(vals.probable_cause ?? '').trim(), String(vals.summary ?? '').trim()]
      .filter(Boolean).join('\n\n') || 'See the attached finalized warrant report.'
    setLegalBusy(true)
    const res = await rpc('create_legal_request', {
      p_case: c.id, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: title, p_priority: priority, p_narrative: narrative,
      p_person: suspectPid, p_source_report: r.id,
    })
    if (res.error || !res.data) { setLegalBusy(false); toast(res.error?.message || 'Could not create the legal request.', 'danger'); return }
    // The source report is always the packet's first exhibit.
    const ex = await rpc('add_legal_exhibit', { p_request: res.data.id, p_type: 'finalized_report', p_source_id: r.id })
    setLegalBusy(false)
    if (ex.error) toast(`Request created, but the report could not be attached (${ex.error.message}) — open the request and attach it manually.`, 'warn')
    else toast('Legal request created — build the packet, then submit for CID review.', 'success')
    router.push(`/legal?request=${encodeURIComponent(res.data.id)}`)
  }
  const [pools, setPools] = useState<{ evidence: EvidenceRow[]; media: MediaRow[]; linked: MediaRow[] }>({ evidence: [], media: [], linked: [] })
  useEffect(() => {
    let alive = true
    void (async () => {
      const [ev, m, lk] = await Promise.all([
        list('evidence', { eq: { case_id: c.id }, order: 'created_at' }).catch(() => [] as EvidenceRow[]),
        list('media', { eq: { case_id: c.id } }).catch(() => [] as MediaRow[]),
        // Typed-FK linked media (media.report_id) — thumbnails below.
        list('media', { eq: { report_id: r.id } }).catch(() => [] as MediaRow[]),
      ])
      if (alive) setPools({ evidence: ev, media: m, linked: lk })
    })()
    return () => { alive = false }
  }, [c.id, r.id])
  // Persons pool: resolve ONLY the ids captured by the editor's person pickers
  // (this report's fields now; each seal snapshot's fields when history opens)
  // with bounded in:{id} lookups. Name-only legacy values stay plain text.
  const personIds = useMemo(() => collectReportPersonIds(schema, parseFormValues(r.fields)), [schema, r.fields])
  const [personRefs, setPersonRefs] = useState<PersonRef[]>([])
  const fetchPersonRefs = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    try {
      const rows: PersonRef[] = await list('persons', { select: 'id,name', in: { id: ids } })
      setPersonRefs((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        const fresh = rows.filter((p) => !seen.has(p.id))
        return fresh.length ? [...prev, ...fresh] : prev
      })
    } catch { /* the stored name snapshots still render */ }
  }, [])
  useEffect(() => { queueMicrotask(() => { void fetchPersonRefs(personIds) }) }, [personIds, fetchPersonRefs])
  // Reference resolution pool: case media + report-linked rows (a linked row
  // can outlive its case_id), deduped by id.
  const mediaPool = useMemo(() => {
    const seen = new Set(pools.media.map((m) => m.id))
    return [...pools.media, ...pools.linked.filter((m) => !seen.has(m.id))]
  }, [pools.media, pools.linked])
  const sealSignatures = sealSignatureItems(r)
  // Records referenced (report_entities, RLS-filtered) and — for a sealed
  // report — the latest frozen snapshot the export menu prints from.
  const [entities, setEntities] = useState<EntityItem[]>([])
  const [latestVersion, setLatestVersion] = useState<Tables<'report_versions'> | null>(null)
  useEffect(() => {
    let alive = true
    void loadReportEntities(r.id).then((rows) => { if (alive) setEntities(rows.map(toEntityItem)) }).catch(() => { /* hidden or unavailable */ })
    if (r.finalized) {
      void list('report_versions', { eq: { report_id: r.id }, order: 'version_number', ascending: false, limit: 1 })
        .then((rows) => { if (alive) setLatestVersion(rows[0] ?? null) }).catch(() => { /* export falls back to live fields */ })
    }
    return () => { alive = false }
  }, [r.id, r.finalized, r.updated_at])
  // A reopened report exports its live fields again (the stale snapshot
  // state is simply not read while it is unsealed).
  const exportVersion = r.finalized ? latestVersion : null
  // Frozen seal snapshots (report_versions) load lazily on toggle so readers
  // who never open history keep the detail view a single round-trip.
  const [versions, setVersions] = useState<Tables<'report_versions'>[] | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const toggleVersions = () => {
    const next = !showVersions
    setShowVersions(next)
    if (next) void (async () => {
      try {
        const vers = await list('report_versions', { eq: { report_id: r.id }, order: 'version_number', ascending: false })
        setVersions(vers)
        // Old snapshots can reference persons the live report no longer does.
        const ids = new Set(vers.flatMap((ver) => collectReportPersonIds(schema, parseFormValues(ver.fields))))
        void fetchPersonRefs([...ids])
      }
      catch { setVersions([]) }
    })()
  }
  const editable = isReportEditable(r)
  const mySubmit = canSubmitReport(r, viewer, writable)
  const myReview = canReviewReport(r, viewer, c.bureau)
  const myReopen = canReopenReport(r, viewer, c.bureau)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button onClick={onBack} className="rounded-lg py-2 pr-2 text-sm font-semibold text-badge-200 hover:text-white">← Back to reports</button>
          <h3 className="min-w-0 truncate font-semibold text-white">{title}</h3>
          <Badge tone={reportReviewTone(review)}>{REPORT_REVIEW_LABEL[review]}</Badge>
          {version && version.versionNumber > 0 && <span className="font-mono text-xs text-slate-400" title="Template version this report is pinned to">template v{version.versionNumber}</span>}
          {/* Registry chip: 'returned' renders as "Return filed" — the return
              was filed with the court, NOT sent back for revision. */}
          {WARRANT_TPLS[r.template] && <StatusBadge domain="warrant" value={status} className="uppercase" />}
          {WARRANT_TPLS[r.template] && canEdit && <select aria-label="Set warrant status" value={status} onChange={(e) => void setWarrant(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs font-bold text-white">{['draft', 'signed', 'executed', 'returned'].map((o) => <option key={o} value={o}>{o}</option>)}</select>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GuideHelpLink
            slug="reports-evidence"
            anchor="drafting"
            title="Open the Reports and Evidence Guide at Drafting a report"
          />
          {r.template === 'arrest_warrant' && r.finalized && canEdit && (
            <Button size="sm" variant="warn" onClick={() => void submitForLegalReview()} disabled={legalBusy}>
              <ScaleIcon size={14} /> Submit for Legal Review
            </Button>
          )}
          {editable && mySubmit && <Button size="sm" variant={selfSeal ? 'success' : 'warn'} onClick={onSubmit} disabled={version === undefined}>{selfSeal ? 'Finalize' : 'Submit for review'}</Button>}
          {myReopen && <Button size="sm" variant="warn" onClick={onReopen}>Reopen</Button>}
          {editable && writable && <Button size="sm" onClick={onEdit}>Edit</Button>}
          {canDelete && (holdActive
            ? <span title="A legal hold preserves this case's reports" className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-rose-300/50">Delete — blocked by legal hold</span>
            : <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>)}
          {/* Shareable deep link straight to this report (?case&tab&report). */}
          <Button onClick={() => copyText(`${window.location.origin}${caseLink(c.id, 'reports', { report: r.id })}`, 'Report link')}>Copy link</Button>
          <Button onClick={toggleVersions} aria-expanded={showVersions}>{showVersions ? 'Hide versions' : 'Versions'}</Button>
          {/* Court-ready paper copy for warrants — browser print flow only. */}
          {WARRANT_TPLS[r.template] && <WarrantPrintButton r={r} c={c} />}
          {/* PDF / DOCX / MD (P5-07): every download is recorded by
              report_record_export first; a sealed report prints its frozen
              snapshot, a draft its live fields. */}
          {schema && version && (
            <ReportExportMenu input={{
              report: r, version: exportVersion, schema, templateName: title, templateVersion: version.versionNumber || null,
              caseNumber: c.case_number, caseTitle: c.title, entities,
              // A media entity whose row RLS withheld from this viewer (restricted) never prints.
              restrictedMediaIds: new Set(entities.filter((e) => e.kind === 'media' && e.ref_id && !mediaPool.some((m) => m.id === e.ref_id)).map((e) => e.ref_id as string)),
              authorSignature: parseSignatureLike(r.signature), reviewerSignature: parseSignatureLike(r.reviewer_signature),
              reviewStatusLabel: (st) => REPORT_REVIEW_LABEL[reviewStatusOf({ review_status: st, finalized: r.finalized })],
              authorName: parseSignatureInfo(r.signature)?.officer ?? null,
            }} />
          )}
        </div>
      </div>
      {/* Flow state panels — what happens next, for the author and the reviewer. */}
      {review === 'submitted' && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-slate-200">
          <p><span className="font-semibold text-white">Awaiting review</span>{r.submitted_at ? ` — submitted ${timeAgo(r.submitted_at)}.` : '.'} Contents are locked until a reviewer approves or returns it.</p>
          {myReview && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-slate-300">Your decision:</span>
              <Button size="sm" variant="success" onClick={() => onReview('approve')}>Approve</Button>
              <Button size="sm" variant="warn" onClick={() => onReview('return')}>Return for revision</Button>
            </div>
          )}
        </div>
      )}
      {review === 'returned' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
          <p className="font-semibold">Returned for revision{r.reviewed_at ? ` · ${timeAgo(r.reviewed_at)}` : ''}</p>
          <p className="mt-1 whitespace-pre-wrap">{r.review_note || 'No note was left.'}</p>
          {mySubmit && <p className="mt-1 text-xs text-amber-200/80">Edit the report and submit it again when it is ready.</p>}
        </div>
      )}
      {review === 'approved' && r.review_note && (
        <p className="rounded-lg border border-white/10 bg-ink-950/50 p-3 text-sm text-slate-300"><span className="font-semibold text-white">Reviewer note:</span> {r.review_note}</p>
      )}
      {version && version.required.length > 0 && editable && (
        <RequiredChecklist version={version} values={parseFormValues(r.fields)} compact />
      )}
      {(r.finalized || sealSignatures.length > 0) && (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <h4 className="mb-2 text-[13px] font-semibold text-white">Signatures</h4>
          <SignatureViewer signatures={sealSignatures} />
        </div>
      )}
      {showVersions && (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <h4 className="mb-2 text-[13px] font-semibold text-white">Versions</h4>
          {/* A draft / returned report: field-level edit history
              (record_versions, P8-04) with restore where the case is
              writable — the server refuses a sealed report anyway. Sealed
              reports keep the read-only snapshot viewer below. */}
          {editable && (
            <div className={versions?.length ? 'mb-4 border-b border-white/10 pb-4' : ''}>
              <p className="mb-2 text-xs text-slate-400">Draft edits — every save, field by field.</p>
              <RecordHistory kind="report" id={r.id} canRestore={writable ? undefined : false} onRestored={onChanged} fieldLabels={{ fields: 'Report fields' }} />
            </div>
          )}
          {editable && versions?.length ? <p className="mb-2 text-xs text-slate-400">Sealed snapshots</p> : null}
          {!versions ? (editable ? null : <ListSkeleton count={3} />) : editable && !versions.length ? null : (
            <VersionViewer
              versions={versions.map((ver) => ({ id: ver.id, number: ver.version_number, label: 'Sealed', at: ver.created_at, byName: parseSignatureInfo(ver.signature)?.officer ?? null }))}
              renderContent={(item) => {
                const ver = versions.find((x) => x.id === item.id)
                if (!ver) return null
                const vsig = parseSignatureInfo(ver.signature)
                const vrev = parseSignatureInfo(ver.reviewer_signature)
                const sigs: SignatureItem[] = [
                  ...(vsig ? [{ id: `${ver.id}-a`, name: vsig.officer, badge: vsig.badge ?? null, action: 'report seal', at: vsig.signed_at ?? null, versionLabel: `v${ver.version_number}` }] : []),
                  ...(vrev ? [{ id: `${ver.id}-r`, name: vrev.officer, badge: vrev.badge ?? null, role: vrev.role ?? null, action: 'review approval', at: vrev.signed_at ?? null, versionLabel: `v${ver.version_number}` }] : []),
                ]
                return (
                  <div className="space-y-3">
                    {sigs.length > 0 && <SignatureViewer signatures={sigs} />}
                    {schema
                      ? <ReportView schema={schema} values={parseFormValues(ver.fields)} evidence={pools.evidence} media={mediaPool} persons={personRefs} entities={entities} onOpenPerson={(id) => nav.openRecord('persons', id)} />
                      : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-950 p-4 text-sm text-slate-200">{JSON.stringify(ver.fields, null, 2)}</pre>}
                  </div>
                )
              }}
            />
          )}
        </div>
      )}
      {entities.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <h4 className="mb-2 text-[13px] font-semibold text-white">Records referenced ({entities.length})</h4>
          <ReportEntityList items={entities} />
        </div>
      )}
      {pools.linked.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <h4 className="mb-2 text-[13px] font-semibold text-white">Linked media ({pools.linked.length})</h4>
          <ul className="flex flex-wrap gap-2">
            {pools.linked.map((m) => {
              const url = m.external_url ? safeUrl(m.external_url) : ''
              const tile = m.type === 'image' && url
                // eslint-disable-next-line @next/next/no-img-element -- external media URL
                ? <img src={url} alt={m.title} loading="lazy" className="h-16 w-16 rounded-lg border border-white/10 object-cover" />
                : <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 bg-ink-800 text-slate-400">{m.type === 'video' ? <VideoIcon size={24} /> : <DocumentIcon size={24} />}</span>
              return (
                <li key={m.id}>
                  {url
                    ? <a href={url} target="_blank" rel="noreferrer" title={m.title} aria-label={`Open ${m.title}`}>{tile}</a>
                    : <span title={m.title}>{tile}</span>}
                </li>
              )
            })}
          </ul>
          <Link href={caseLink(c.id, 'media')} className="mt-2 inline-block text-xs font-semibold text-badge-200 hover:text-white">Manage in Photos &amp; Media →</Link>
        </div>
      )}
      {version === undefined
        ? <ListSkeleton count={4} />
        : schema
          ? <ReportView schema={schema} values={parseFormValues(r.fields)} evidence={pools.evidence} media={mediaPool} persons={personRefs} entities={entities} onOpenPerson={(id) => nav.openRecord('persons', id)} />
          : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-950 p-4 text-sm text-slate-200">{JSON.stringify(r.fields, null, 2)}</pre>}
    </div>
  )
}

/** Typed-FK side of the media picker (media.report_id, §26/§32): picks added
 *  to media_refs SET report_id on rows that have none; picks removed clear it
 *  only when it points at THIS report. One report per media row — a row
 *  already linked elsewhere keeps its link and rides along as a text ref.
 *  Best-effort under RLS: a failed write leaves the id-bearing text reference,
 *  which still resolves at render/export. */
async function syncReportMediaLinks(reportId: string, prevText: string, nextText: string): Promise<void> {
  const idsOf = (t: string) => new Set(parseMediaRefEntries(t).map((e) => e.id).filter((x): x is string => !!x))
  const prev = idsOf(prevText)
  const next = idsOf(nextText)
  const added = [...next].filter((id) => !prev.has(id))
  const removed = [...prev].filter((id) => !next.has(id))
  try {
    if (added.length) {
      const rows = (await list('media', { select: 'id,report_id', in: { id: added } })) as unknown as { id: string; report_id: string | null }[]
      for (const m of rows) if (!m.report_id) await update('media', m.id, { report_id: reportId })
    }
    if (removed.length) {
      const rows = (await list('media', { select: 'id,report_id', in: { id: removed } })) as unknown as { id: string; report_id: string | null }[]
      for (const m of rows) if (m.report_id === reportId) await update('media', m.id, { report_id: null })
    }
  } catch { /* text refs remain the durable record */ }
}
