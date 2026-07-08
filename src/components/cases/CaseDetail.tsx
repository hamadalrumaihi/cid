'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { uiPrompt } from '@/components/ui/dialog'
import { deleteWithUndo, insert, list, remove, rpc, update, withRetry } from '@/lib/db'
import type { Json, Tables } from '@/lib/database.types'
import { fmtUSD, timeAgo, todayISO, copyText, downloadTextFile } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { renderMarkdown } from '@/lib/markdown'
import { useOperationsStore } from '@/lib/operations'
import { caseCourtHint, caseStatusTint, CASE_STATUSES, signoffLabel, signoffTint, SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { officerName, activeProfiles } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { gatherCasePacket, packetDocx, packetMarkdown } from '@/lib/packet'
import { safeUrl } from '@/lib/safeUrl'
import { FORM_SCHEMAS, REPORT_TEMPLATES, formToText, reportTitle, type FormValues } from '@/lib/forms'
import { PENAL_CODE, penalByCode, penalRecommend, penalSentence, penalSearch, penalTotals, type CaseCharge } from '@/lib/penal'
import { notify } from '@/lib/notify'
import { toast } from '@/lib/toast'
import { isPinnedCase, pushRecentCase, togglePinCase } from './caseUtils'

/** One-click row mutations (delete chips, detach) previously discarded the
 *  returned {error}, so an RLS-denied or failed write looked like a silent
 *  no-op. Toast the reason on failure; refresh on success. */
function mutateThen(p: Promise<{ error: { message: string } | null }>, refresh: () => void): void {
  void p.then((r) => { if (r.error) toast(r.error.message, 'danger'); else refresh() })
}
import { StaleBadge } from './StaleBadge'
import { WatchButton } from './WatchButton'
import { CaseModal } from './CaseModal'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>
type MessageRow = Tables<'case_messages'>
type HistoryRow = Tables<'case_signoff_history'>
type EvidenceRow = Tables<'evidence'>
type ReportRow = Tables<'reports'>
type AssignmentRow = Tables<'case_assignments'>
type CustodyRow = Tables<'custody_chain'>
type MediaRow = Tables<'media'>
type RicoRow = Tables<'rico_cases'>
type PredicateRow = Tables<'predicate_acts'>
type GangRow = Tables<'gangs'>
type IntelRow = Tables<'case_intel_links'>
type PersonRow = Tables<'persons'>
type PlaceRow = Tables<'places'>

const TABS = ['overview', 'evidence', 'notes', 'charges', 'rico', 'intel', 'reports', 'tasks', 'signoff', 'chat', 'timeline'] as const
type TabId = (typeof TABS)[number]

export function CaseDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile, canEdit, canDelete } = useAuth()
  const operations = useOperationsStore((s) => s.operations)
  const [c, setCase] = useState<CaseRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)
  const casesV = useTableVersion('cases')
  const tab = (sp.get('tab') && TABS.includes(sp.get('tab') as TabId) ? sp.get('tab') : 'overview') as TabId

  const fetchCase = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await withRetry(() => list('cases', { eq: { id } }))
      setCase(rows[0] ?? null)
      if (rows[0]) pushRecentCase(rows[0].id)
    } catch (e) {
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { queueMicrotask(() => { void fetchCase() }) }, [fetchCase, casesV])

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('case', id)
    params.set('tab', next)
    router.replace(`/cases?${params.toString()}`)
  }

  if (loading) return <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Loading case...</p>
  if (!c) return <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Case not found.</p>

  const op = operations.find((x) => x.id === c.operation_id)
  const hint = caseCourtHint(c, profile?.id ?? null, officerName(c.signoff_assignee_id))
  const pinned = isPinnedCase(c.id)

  const quickStatus = async (status: CaseRow['status']) => {
    const res = await update('cases', c.id, { status, closed_at: status === 'closed' && !c.closed_at ? new Date().toISOString() : c.closed_at })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Status updated.', 'success'); onChanged(); void fetchCase() }
  }

  const deleteCase = async () => {
    const ok = await deleteWithUndo('cases', c, {
      label: c.case_number,
      children: [
        { table: 'case_assignments', column: 'case_id' },
        { table: 'case_tasks', column: 'case_id' },
        { table: 'case_messages', column: 'case_id' },
        { table: 'case_signoff_history', column: 'case_id' },
        { table: 'reports', column: 'case_id' },
      ],
      setNullRefs: [{ table: 'evidence', column: 'case_id' }, { table: 'media', column: 'case_id' }],
    })
    if (ok) { onBack(); onChanged() }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-semibold text-badge-200 hover:text-white">Back to cases</button>
      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button onClick={() => copyText(c.case_number, 'Case number copied.')} className="font-mono text-sm font-bold text-badge-200">{c.case_number}</button>
              <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${caseStatusTint(c.status)}`}>{c.status}</span>
              <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-bold text-slate-300">{c.bureau}</span>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>
              <StaleBadge c={c} />
            </div>
            <h2 className="text-2xl font-black text-white">{c.title || 'Untitled case'}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">{c.summary || 'No summary recorded.'}</p>
            {hint && <p className={`mt-3 inline-flex rounded-lg px-3 py-2 text-sm font-semibold ${hint.c}`}>{hint.t}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canEdit ? (
              <select value={c.status} onChange={(e) => void quickStatus(e.target.value as CaseRow['status'])} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
                {CASE_STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            ) : <span className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">Read-only</span>}
            {op && <Link href={`/operations?op=${op.id}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Operation: {op.name}</Link>}
            <button onClick={() => { togglePinCase(c.id); setCase({ ...c }) }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">{pinned ? 'Pinned' : 'Pin'}</button>
            <WatchButton type="case" id={c.id} label={c.case_number} />
            {canEdit && <FollowUpButton c={c} onChanged={fetchCase} />}
            <button onClick={() => copyText(`${window.location.origin}/cases?case=${c.id}`, 'Case link copied.')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Link</button>
            <PacketButton c={c} />
            {canEdit && <button onClick={() => setEdit(true)} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15">Edit</button>}
            {canDelete && <button onClick={() => void deleteCase()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500">Delete</button>}
          </div>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto border-b border-white/10 pb-2">
        {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-2 text-sm font-bold capitalize ${tab === t ? 'bg-badge-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{t}</button>)}
      </div>
      <section className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
        {tab === 'overview' && <OverviewTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'evidence' && <EvidenceTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'notes' && <NotesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'charges' && <ChargesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'rico' && <RicoTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'intel' && <IntelTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'reports' && <ReportsTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'tasks' && <TasksTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'signoff' && <SignoffTab c={c} />}
        {tab === 'chat' && <ChatTab c={c} />}
        {tab === 'timeline' && <TimelineTab c={c} />}
      </section>
      <CaseModal open={edit} record={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); void fetchCase() }} />
    </div>
  )
}

function PacketButton({ c }: { c: CaseRow }) {
  const [open, setOpen] = useState(false)
  const exportMd = async () => {
    try {
      const data = await gatherCasePacket(c)
      packetMarkdown(c, data)
      setOpen(false)
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
  }
  const exportDocx = async () => {
    try {
      const data = await gatherCasePacket(c)
      packetDocx(c, data)
      setOpen(false)
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Packet</button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-5">
          <ModalHeader title="Case packet" onClose={() => setOpen(false)} />
          <div className="grid gap-2">
            <button onClick={exportDocx} className="rounded-lg bg-badge-600 px-4 py-3 text-sm font-bold text-white">Download DOCX</button>
            <button onClick={exportMd} className="rounded-lg bg-badge-600 px-4 py-3 text-sm font-bold text-white">Download Markdown</button>
            <button disabled className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-500">PDF/XLSX exports continue in the Exports slice</button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function FollowUpButton({ c, onChanged }: { c: CaseRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(c.follow_up_at?.slice(0, 10) ?? '')
  useEffect(() => { if (open) queueMicrotask(() => setDate(c.follow_up_at?.slice(0, 10) ?? '')) }, [open, c.follow_up_at])
  const due = c.follow_up_at && c.follow_up_at.slice(0, 10) <= todayISO()
  const save = async (clear = false) => {
    const res = await update('cases', c.id, { follow_up_at: clear ? null : date || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(clear ? 'Follow-up cleared.' : 'Follow-up saved.', 'success'); setOpen(false); onChanged() }
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${due ? 'border-amber-400/40 bg-amber-500/15 text-amber-200' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'}`}>
        Follow-up{c.follow_up_at ? ` ${c.follow_up_at.slice(0, 10)}` : ''}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-5">
          <ModalHeader title="Follow-up" onClose={() => setOpen(false)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => void save(true)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Clear</button>
            <button onClick={() => void save()} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function OverviewTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [evidence, setEvidence] = useState(0)
  const [reports, setReports] = useState(0)
  const vA = useTableVersion('case_assignments')
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const refresh = useCallback(async () => {
    try {
      const [a, e, r] = await Promise.all([
        list('case_assignments', { eq: { case_id: c.id } }),
        list('evidence', { eq: { case_id: c.id } }),
        list('reports', { eq: { case_id: c.id } }),
      ])
      setAssignments(a); setEvidence(e.length); setReports(r.length)
    } catch { /* tab can render stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vA, vE, vR])

  const [assignBusy, setAssignBusy] = useState(false)
  const addAssignment = async () => {
    if (assignBusy) return
    const officer = activeProfiles()[0]?.id
    if (!officer) { toast('No active officers found.', 'warn'); return }
    setAssignBusy(true)
    const res = await insert('case_assignments', { case_id: c.id, officer_id: officer, role: 'support' })
    setAssignBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Officer assigned.', 'success'); void refresh() }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Evidence" value={evidence} />
        <Stat label="Reports" value={reports} />
        <Stat label="Lead" value={officerName(c.lead_detective_id) || 'Unassigned'} />
        <Stat label="Updated" value={timeAgo(c.updated_at).toUpperCase()} />
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-white">Assigned Officers</h3>
          {canEdit && <button onClick={() => void addAssignment()} disabled={assignBusy} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Add support</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {assignments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
              {officerName(a.officer_id) || 'Officer'} <span className="text-xs uppercase text-slate-500">{a.role}</span>
              {canDelete && <button onClick={() => mutateThen(remove('case_assignments', a.id), refresh)} className="text-rose-300">x</button>}
            </span>
          ))}
          {!assignments.length && <p className="text-sm text-slate-500">No support assignments recorded.</p>}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-lg font-bold text-white">{value}</p></div>
}

function NotesTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.notes ?? '')
  useEffect(() => { queueMicrotask(() => setText(c.notes ?? '')) }, [c.notes])
  const save = async () => {
    const res = await update('cases', c.id, { notes: text || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Notes saved.', 'success'); setEditing(false); onChanged() }
  }
  if (editing) return (
    <div className="space-y-3">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="w-full rounded-xl border border-white/10 bg-ink-950 p-3 text-sm text-white" />
      <div className="flex justify-end gap-2"><button onClick={() => setEditing(false)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button><button onClick={save} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button></div>
    </div>
  )
  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <button onClick={() => copyText(c.notes ?? '', 'Notes copied.')} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Copy</button>
        <button onClick={() => downloadTextFile(`${c.case_number}-notes.md`, c.notes ?? '')} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">.md</button>
        {canEdit && <button onClick={() => setEditing(true)} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white">Edit</button>}
      </div>
      <div className="prose prose-invert max-w-none rounded-xl border border-white/10 bg-ink-950/50 p-4 text-sm text-slate-200">{c.notes ? renderMarkdown(c.notes) : <p className="text-slate-500">No case notes yet.</p>}</div>
    </div>
  )
}

function EvidenceTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<EvidenceRow[]>([])
  const [custody, setCustody] = useState<CustodyRow[]>([])
  const [media, setMedia] = useState<MediaRow[]>([])
  const [modal, setModal] = useState<'evidence' | 'media' | null>(null)
  const [item, setItem] = useState({ item_code: '', type: '', description: '', location: '' })
  const [link, setLink] = useState({ title: '', type: 'document', external_url: '' })
  const vE = useTableVersion('evidence')
  const vC = useTableVersion('custody_chain')
  const vM = useTableVersion('media')
  const refresh = useCallback(async () => {
    try {
      const [e, cc, m] = await Promise.all([
        list('evidence', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
        list('custody_chain', { order: 'at', ascending: false }),
        list('media', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
      ])
      setRows(e)
      setCustody(cc.filter((x) => e.some((ev) => ev.id === x.evidence_id)))
      setMedia(m)
    } catch { /* stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vC, vM])

  const nextCode = () => `EV-${String(rows.length + 1).padStart(3, '0')}`
  const addEvidence = async () => {
    if (!item.description.trim()) { toast('Description is required.', 'warn'); return }
    const res = await insert('evidence', {
      case_id: c.id,
      item_code: item.item_code.trim() || nextCode(),
      type: item.type.trim() || null,
      description: item.description.trim(),
      location: item.location.trim() || null,
      collected_by: profile?.id ?? null,
      tamper: 'intact',
    })
    if (res.error) toast(res.error.message, 'danger')
    else { setItem({ item_code: '', type: '', description: '', location: '' }); setModal(null); toast('Evidence logged.', 'success'); void refresh() }
  }
  const addMedia = async () => {
    const url = safeUrl(link.external_url)
    if (!link.title.trim() || !url) { toast('Title and safe URL are required.', 'warn'); return }
    const res = await insert('media', { case_id: c.id, title: link.title.trim(), type: link.type as MediaRow['type'], external_url: url })
    if (res.error) toast(res.error.message, 'danger')
    else { setLink({ title: '', type: 'document', external_url: '' }); setModal(null); toast('Media linked.', 'success'); void refresh() }
  }
  const transfer = async (ev: EvidenceRow) => {
    const to = await uiPrompt('Transfer custody to officer / locker / lab:', { title: ev.item_code || 'Custody transfer', placeholder: 'Forensics locker', confirmText: 'Record' })
    if (!to) return
    const last = custody.find((x) => x.evidence_id === ev.id)
    const res = await insert('custody_chain', { evidence_id: ev.id, from_officer: last?.to_officer ?? officerName(ev.collected_by) ?? null, to_officer: to, transferred_by: profile?.id ?? null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Custody transfer recorded.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && <button onClick={() => { setItem((x) => ({ ...x, item_code: x.item_code || nextCode() })); setModal('evidence') }} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Add Evidence</button>}
        {canEdit && <button onClick={() => setModal('media')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200">Add Link</button>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((ev) => {
          const chain = custody.filter((x) => x.evidence_id === ev.id)
          return (
            <article key={ev.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-mono text-sm font-bold text-badge-200">{ev.item_code || 'Evidence'}</p><h3 className="font-bold text-white">{ev.description || ev.type || 'Untitled item'}</h3></div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${ev.tamper === 'intact' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{ev.tamper}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{[ev.type, ev.location].filter(Boolean).join(' - ') || 'No location/type recorded.'}</p>
              <p className="mt-2 text-xs text-slate-500">Custody entries: {chain.length}</p>
              <div className="mt-3 flex gap-2">
                {canEdit && <button onClick={() => void transfer(ev)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">Transfer</button>}
                {canDelete && <button onClick={() => { void deleteWithUndo('evidence', ev, { label: ev.item_code || 'evidence', children: [{ table: 'custody_chain', column: 'evidence_id' }], after: refresh }) }} className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-bold text-rose-300">Delete</button>}
              </div>
            </article>
          )
        })}
        {!rows.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500 lg:col-span-2">No evidence logged.</p>}
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <h3 className="font-bold text-white">Linked Media</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {media.map((m) => {
            const url = safeUrl(m.external_url || m.storage_path)
            return <div key={m.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"><p className="font-bold text-white">{m.title}</p><p className="text-xs uppercase text-slate-500">{m.type}</p>{url && <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-badge-200 hover:text-white">Open</a>}{canEdit && <button onClick={() => mutateThen(update('media', m.id, { case_id: null }), refresh)} className="ml-3 text-xs font-bold text-rose-300">Detach</button>}</div>
          })}
          {!media.length && <p className="text-sm text-slate-500">No linked media.</p>}
        </div>
      </div>
      <Modal open={modal === 'evidence'} onClose={() => setModal(null)}>
        <div className="p-5"><ModalHeader title="Add evidence" onClose={() => setModal(null)} /><div className="space-y-3">
          <input value={item.item_code} onChange={(e) => setItem({ ...item, item_code: e.target.value })} placeholder="Item code" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <input value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })} placeholder="Type" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <input value={item.location} onChange={(e) => setItem({ ...item, location: e.target.value })} placeholder="Location" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <textarea value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} placeholder="Description" rows={4} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <button onClick={addEvidence} className="w-full rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save evidence</button>
        </div></div>
      </Modal>
      <Modal open={modal === 'media'} onClose={() => setModal(null)}>
        <div className="p-5"><ModalHeader title="Add media link" onClose={() => setModal(null)} /><div className="space-y-3">
          <input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <select value={link.type} onChange={(e) => setLink({ ...link, type: e.target.value })} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white"><option value="document">Document</option><option value="image">Image</option><option value="video">Video</option><option value="fivemanage">FiveManage</option></select>
          <input value={link.external_url} onChange={(e) => setLink({ ...link, external_url: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <button onClick={addMedia} className="w-full rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save link</button>
        </div></div>
      </Modal>
    </div>
  )
}

function ChargesTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const charges = (Array.isArray(c.charges) ? c.charges : []) as unknown as CaseCharge[]
  const [q, setQ] = useState('')
  const totals = penalTotals(charges)
  const save = async (next: CaseCharge[]) => {
    const res = await update('cases', c.id, { charges: next as unknown as Json })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Charges updated.', 'success'); onChanged() }
  }
  const addCode = (code: string) => {
    const found = charges.find((x) => x.code === code)
    void save(found ? charges.map((x) => x.code === code ? { ...x, count: (x.count || 1) + 1 } : x) : [...charges, { code, count: 1 }])
  }
  const recommended = penalRecommend(`${c.title || ''} ${c.summary || ''}`, 8).filter((code) => !charges.some((x) => x.code === code))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Charges" value={charges.reduce((n, x) => n + Math.max(1, x.count || 1), 0)} />
        <Stat label="Sentence" value={totals.judge ? `${penalSentence(totals.months)} + JUDGE` : penalSentence(totals.months)} />
        <Stat label="Fine" value={fmtUSD(totals.fine)} />
        <Stat label="RICO predicates" value={charges.filter((x) => penalByCode(x.code)?.rico).length} />
      </div>
      <div className="space-y-2">
        {charges.map((ch) => {
          const pc = penalByCode(ch.code)
          return <div key={ch.code} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><div className="min-w-0 flex-1"><p className="font-bold text-white">{ch.code} - {pc?.title || 'Unknown charge'}</p><p className="text-xs text-slate-500">{pc?.level} - {pc?.jail == null ? 'JUDGE' : penalSentence(pc.jail)} - {fmtUSD(pc?.fine)}</p></div><span className="font-mono text-white">x{ch.count || 1}</span>{canEdit && <><button onClick={() => void addCode(ch.code)} className="rounded bg-white/10 px-2 py-1 text-sm text-white">+</button><button onClick={() => void save(charges.map((x) => x.code === ch.code ? { ...x, count: Math.max(1, (x.count || 1) - 1) } : x))} className="rounded bg-white/10 px-2 py-1 text-sm text-white">-</button><button onClick={() => void save(charges.filter((x) => x.code !== ch.code))} className="text-sm font-bold text-rose-300">Remove</button></>}</div>
        })}
        {!charges.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No charges attached.</p>}
      </div>
      {canEdit && <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search penal code" className="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        {!!recommended.length && <div className="mb-3 flex flex-wrap gap-2">{recommended.map((code) => <button key={code} onClick={() => addCode(code)} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-200">Recommend {code}</button>)}</div>}
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {penalSearch(q).slice(0, 40).map((pc) => <button key={pc.code} onClick={() => addCode(pc.code)} className="block w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10"><span className="font-mono text-badge-200">{pc.code}</span> <span className="font-bold text-white">{pc.title}</span><span className="ml-2 text-xs text-slate-500">{pc.level}{pc.rico ? ' - RICO' : ''}</span></button>)}
        </div>
      </div>}
    </div>
  )
}

export function RicoTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [rico, setRico] = useState<RicoRow | null>(null)
  const [preds, setPreds] = useState<PredicateRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [form, setForm] = useState({ predicate_type: '', evidence_id: '', evidence_ref: '', act_date: todayISO(), note: '' })
  const vR = useTableVersion('rico_cases')
  const vP = useTableVersion('predicate_acts')
  const refresh = useCallback(async () => {
    try {
      const [rc, g, ev] = await Promise.all([list('rico_cases', { eq: { case_id: c.id } }), list('gangs', { order: 'name' }), list('evidence', { eq: { case_id: c.id } })])
      const row = rc[0] ?? null
      setRico(row); setGangs(g); setEvidence(ev)
      setPreds(row ? await list('predicate_acts', { eq: { rico_case_id: row.id }, order: 'act_date', ascending: false }) : [])
    } catch { /* stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vR, vP])
  const ensure = async () => {
    if (rico) return rico
    const res = await insert('rico_cases', { case_id: c.id })
    if (res.error || !res.data?.[0]) { toast(res.error?.message || 'Could not create RICO tracker.', 'danger'); return null }
    setRico(res.data[0]); return res.data[0]
  }
  const saveEnterprise = async (gangId: string) => {
    const row = await ensure(); if (!row) return
    const res = await update('rico_cases', row.id, { enterprise_gang_id: gangId || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Enterprise updated.', 'success'); void refresh() }
  }
  const addPredicate = async () => {
    const row = await ensure(); if (!row) return
    if (!form.predicate_type) { toast('Choose a predicate type.', 'warn'); return }
    const res = await insert('predicate_acts', { rico_case_id: row.id, predicate_type: form.predicate_type, evidence_id: form.evidence_id || null, evidence_ref: form.evidence_ref || null, act_date: form.act_date || null, note: form.note || null })
    if (res.error) toast(res.error.message, 'danger')
    else { setForm({ predicate_type: '', evidence_id: '', evidence_ref: '', act_date: todayISO(), note: '' }); toast('Predicate added.', 'success'); void refresh() }
  }
  const score = Math.min(100, (rico?.enterprise_gang_id ? 30 : 0) + Math.min(60, preds.length * 20) + (preds.some((p) => p.evidence_id || p.evidence_ref) ? 10 : 0))
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-bold text-white">RICO Readiness</h3><span className="font-mono text-sm text-badge-200">{score}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-white/5"><span className="block h-full bg-emerald-400" style={{ width: `${score}%` }} /></div>
        <label className="mt-4 block text-sm text-slate-300">Enterprise gang
          <select disabled={!canEdit} value={rico?.enterprise_gang_id ?? ''} onChange={(e) => void saveEnterprise(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white disabled:opacity-70">
            <option value="">None linked</option>{gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4 md:grid-cols-2">
        <select value={form.predicate_type} onChange={(e) => setForm({ ...form, predicate_type: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="">Predicate type</option>{PENAL_CODE.filter((p) => p.rico).map((p) => <option key={p.code} value={`${p.code} ${p.title}`}>{p.code} {p.title}</option>)}</select>
        <select value={form.evidence_id} onChange={(e) => setForm({ ...form, evidence_id: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="">Evidence link</option>{evidence.map((ev) => <option key={ev.id} value={ev.id}>{ev.item_code || ev.description}</option>)}</select>
        <input type="date" value={form.act_date} onChange={(e) => setForm({ ...form, act_date: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <input value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder="Text ref" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Predicate note" rows={2} className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <button onClick={addPredicate} className="md:col-span-2 rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Add predicate act</button>
      </div>}
      <div className="space-y-2">
        {preds.map((p) => <div key={p.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3"><p className="font-bold text-white">{p.predicate_type}</p><p className="text-sm text-slate-500">{p.act_date || 'No date'}{p.evidence_ref ? ` - ${p.evidence_ref}` : ''}</p>{p.note && <p className="mt-1 text-sm text-slate-300">{p.note}</p>}{canDelete && <button onClick={() => mutateThen(remove('predicate_acts', p.id), refresh)} className="mt-2 text-xs font-bold text-rose-300">Delete</button>}</div>)}
        {!preds.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No predicate acts recorded.</p>}
      </div>
    </div>
  )
}

function IntelTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [links, setLinks] = useState<IntelRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [kind, setKind] = useState('person')
  const [ref, setRef] = useState('')
  const [role, setRole] = useState('Subject')
  const v = useTableVersion('case_intel_links')
  const refresh = useCallback(async () => {
    try {
      const [l, p, g, pl] = await Promise.all([list('case_intel_links', { eq: { case_id: c.id } }), list('persons', { order: 'name' }), list('gangs', { order: 'name' }), list('places', { order: 'name' })])
      setLinks(l); setPeople(p); setGangs(g); setPlaces(pl)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === '42P01' || code === 'PGRST205') toast('Intel links table is not available in this environment.', 'warn')
    }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const pool = kind === 'person' ? people : kind === 'gang' ? gangs : places
  const label = (l: IntelRow) => {
    const src = l.kind === 'person' ? people : l.kind === 'gang' ? gangs : places
    return src.find((x) => x.id === l.ref_id)?.name || l.ref_id
  }
  const add = async () => {
    if (!ref) return
    const res = await insert('case_intel_links', { case_id: c.id, kind, ref_id: ref, role })
    if (res.error) toast(res.error.message, 'danger')
    else { setRef(''); toast('Intel linked.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4 md:grid-cols-[10rem_1fr_10rem_auto]">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setRef('') }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="person">Person</option><option value="gang">Gang</option><option value="place">Place</option></select>
        <select value={ref} onChange={(e) => setRef(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="">Choose...</option>{pool.filter((x) => !links.some((l) => l.kind === kind && l.ref_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <button onClick={add} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Link</button>
      </div>}
      {(['person', 'gang', 'place'] as const).map((section) => <div key={section} className="rounded-xl border border-white/10 bg-ink-950/50 p-4"><h3 className="mb-2 font-bold capitalize text-white">{section}s</h3><div className="flex flex-wrap gap-2">{links.filter((l) => l.kind === section).map((l) => <span key={l.id} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">{label(l)} <span className="text-xs text-slate-500">{l.role}</span>{canDelete && <button onClick={() => mutateThen(remove('case_intel_links', l.id), refresh)} className="text-rose-300">x</button>}</span>)}{!links.some((l) => l.kind === section) && <p className="text-sm text-slate-500">None linked.</p>}</div></div>)}
    </div>
  )
}

function ReportsTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [editing, setEditing] = useState<{ template: string; values: FormValues; report?: ReportRow } | null>(null)
  const [view, setView] = useState<ReportRow | null>(null)
  const v = useTableVersion('reports')
  const refresh = useCallback(async () => { try { setReports(await list('reports', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const seed = (): FormValues => ({ case_number: c.case_number, report_type: 'Initial', filed_at: new Date().toLocaleString('en-US'), det_name: profile?.display_name || '', narrative: c.summary || '', summary: c.summary || '' })
  const save = async () => {
    if (!editing) return
    const seq = reports.filter((r) => r.template === editing.template).length + 1
    const patch = { case_id: c.id, template: editing.template, kind: 'initial' as const, seq, fields: editing.values as Json, author_id: profile?.id ?? null }
    const res = editing.report ? await update('reports', editing.report.id, patch) : await insert('reports', patch)
    if (res.error) toast(res.error.message, 'danger')
    else { setEditing(null); toast('Report saved.', 'success'); void refresh() }
  }
  const finalize = async (r: ReportRow) => {
    const res = await rpc('report_finalize', { p_report: r.id, p_badge: profile?.badge_number || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Report finalized.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      {canEdit && <div className="flex flex-wrap gap-2">{REPORT_TEMPLATES.map((tpl) => <button key={tpl.id} onClick={() => setEditing({ template: tpl.id, values: seed() })} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">{tpl.icon} {tpl.name}</button>)}</div>}
      <div className="space-y-2">
        {reports.map((r) => <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><button onClick={() => setView(r)} className="min-w-0 flex-1 text-left"><p className="font-bold text-white">{reportTitle(r)}</p><p className="text-xs text-slate-500">{r.finalized ? 'Finalized' : 'Draft'} - {timeAgo(r.created_at)}</p></button>{!r.finalized && canEdit && <button onClick={() => void finalize(r)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Finalize</button>}{canEdit && <button onClick={() => setEditing({ template: r.template, values: (r.fields || {}) as FormValues, report: r })} className="text-sm font-bold text-badge-200">Edit</button>}{canDelete && <button onClick={() => { void deleteWithUndo('reports', r, { label: reportTitle(r), after: refresh }) }} className="text-sm font-bold text-rose-300">Delete</button>}</div>)}
        {!reports.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No reports yet.</p>}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} wide>
        <div className="p-5">
          <ModalHeader title={editing ? FORM_SCHEMAS[editing.template]?.title || 'Report' : 'Report'} onClose={() => setEditing(null)} />
          {editing && <FormEditor template={editing.template} values={editing.values} onChange={(values) => setEditing({ ...editing, values })} />}
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button><button onClick={save} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button></div>
        </div>
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} wide>
        <div className="p-5">
          <ModalHeader title={view ? reportTitle(view) : 'Report'} onClose={() => setView(null)} />
          {view && <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950 p-4 text-sm text-slate-200">{formToText(FORM_SCHEMAS[view.template], (view.fields || {}) as FormValues)}</pre>}
          {view && <div className="mt-4 flex justify-end"><button onClick={() => downloadTextFile(`${c.case_number}-${view.template}.md`, formToText(FORM_SCHEMAS[view.template], (view.fields || {}) as FormValues), 'text/markdown')} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Download .md</button></div>}
        </div>
      </Modal>
    </div>
  )
}

function FormEditor({ template, values, onChange }: { template: string; values: FormValues; onChange: (v: FormValues) => void }) {
  const schema = FORM_SCHEMAS[template]
  if (!schema) return <p className="text-sm text-slate-400">Unknown report template.</p>
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value })
  return <div className="space-y-4">{schema.sections.map((s) => {
    if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
    if (s.type === 'textarea') return <label key={s.id} className="block text-sm font-bold text-white">{s.label}<textarea value={String(values[s.key] ?? '')} onChange={(e) => set(s.key, e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 font-normal text-white" /></label>
    if (s.type === 'grid') {
      const rows = (Array.isArray(values[s.id]) ? values[s.id] : [{}]) as Record<string, string>[]
      return <div key={s.id} className="rounded-xl border border-white/10 p-3"><h4 className="mb-2 font-bold text-white">{s.label}</h4>{rows.map((row, i) => <div key={i} className="mb-2 grid gap-2 md:grid-cols-2">{s.cols.map((col) => <input key={col.key} value={row[col.key] || ''} onChange={(e) => set(s.id, rows.map((r, idx) => idx === i ? { ...r, [col.key]: e.target.value } : r))} placeholder={col.label} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />)}</div>)}<button onClick={() => set(s.id, [...rows, {}])} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">Add row</button></div>
    }
    return <div key={s.id} className="rounded-xl border border-white/10 p-3"><h4 className="mb-2 font-bold text-white">{s.label}</h4><div className="grid gap-2 md:grid-cols-2">{s.fields.map((f) => f.type === 'select' ? <select key={f.key} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"><option value="">{f.label}</option>{(f.opts || []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input key={f.key} value={Array.isArray(values[f.key]) ? (values[f.key] as string[]).join(', ') : String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} placeholder={f.label} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />)}</div></div>
  })}</div>
}

function TasksTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const v = useTableVersion('case_tasks')
  const refresh = useCallback(async () => { try { setTasks(await list('case_tasks', { eq: { case_id: c.id }, order: 'due', nullsFirst: false })) } catch { /* stale ok */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const [adding, setAdding] = useState(false)
  const add = async () => {
    if (!title.trim() || adding) return
    setAdding(true)
    const res = await insert('case_tasks', { case_id: c.id, title: title.trim(), assignee: assignee || null, due: due || null })
    setAdding(false)
    if (res.error) toast(res.error.message, 'danger')
    else { setTitle(''); setAssignee(''); setDue(''); toast('Task added.', 'success'); void refresh() }
  }
  const toggle = async (t: TaskRow) => {
    const res = await update('case_tasks', t.id, { done: !t.done })
    if (res.error) toast(res.error.message, 'danger')
    else void refresh()
  }
  return (
    <div className="space-y-3">
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-3 md:grid-cols-[1fr_12rem_10rem_auto]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="New task" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Unassigned</option>{activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}</select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
        <button onClick={() => void add()} disabled={adding} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Add</button>
      </div>}
      {tasks.map((t) => <div key={t.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
        <input type="checkbox" checked={t.done} disabled={!canEdit} onChange={() => void toggle(t)} />
        <div className="min-w-0 flex-1"><p className={`font-semibold ${t.done ? 'text-slate-500 line-through' : 'text-white'}`}>{t.title}</p><p className="text-xs text-slate-500">{officerName(t.assignee) || 'Unassigned'}{t.due ? ` - due ${t.due}` : ''}</p></div>
        {canDelete && <button onClick={() => mutateThen(remove('case_tasks', t.id), refresh)} className="text-sm font-bold text-rose-300">Delete</button>}
      </div>)}
      {!tasks.length && <p className="py-8 text-center text-sm text-slate-500">No tasks yet.</p>}
    </div>
  )
}

function SignoffTab({ c }: { c: CaseRow }) {
  const { profile } = useAuth()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [note, setNote] = useState('')
  const v = useTableVersion('case_signoff_history')
  const refresh = useCallback(async () => { try { setHistory(await list('case_signoff_history', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const owner = profile?.id && (profile.id === c.lead_detective_id || profile.id === c.signoff_submitted_by)
  const reviewer = profile?.id && profile.id === c.signoff_assignee_id
  const callRpc = async (kind: 'submit' | 'approve' | 'deny' | 'changes' | 'complete' | 'escalate') => {
    const res = kind === 'submit' ? await rpc('signoff_submit', { p_case: c.id })
      : kind === 'complete' || kind === 'escalate' ? await rpc('signoff_owner_action', { p_case: c.id, p_action: kind })
      : await rpc('signoff_decide', { p_case: c.id, p_decision: kind === 'changes' ? 'changes_requested' : kind, p_note: note || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { setNote(''); toast('Sign-off updated.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <p className="text-sm text-slate-400">Current state</p>
        <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</p>
        <p className="mt-2 text-sm text-slate-400">Assignee: {officerName(c.signoff_assignee_id) || 'None'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {owner && <button onClick={() => void callRpc('submit')} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Submit / Resubmit</button>}
          {owner && c.signoff_status === 'approved_deputy' && <><button onClick={() => void callRpc('complete')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Complete at Deputy</button><button onClick={() => void callRpc('escalate')} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white">Escalate</button></>}
          {reviewer && <><button onClick={() => void callRpc('approve')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Approve</button><button onClick={() => void callRpc('changes')} className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white">Changes</button><button onClick={() => void callRpc('deny')} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white">Deny</button></>}
        </div>
        {(reviewer || owner) && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Decision note" className="mt-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />}
      </div>
      <div className="space-y-2">
        {history.map((h) => <div key={h.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3 text-sm text-slate-300"><b className="text-white">{h.actor_name || officerName(h.actor_id) || 'System'}</b> {SIGNOFF_ACTION_VERB[h.action] || h.action} <span className="text-slate-500">{timeAgo(h.created_at)}</span>{h.note && <p className="mt-1 text-slate-400">{h.note}</p>}</div>)}
        {!history.length && <p className="py-8 text-center text-sm text-slate-500">No sign-off history yet.</p>}
      </div>
    </div>
  )
}

/** Highlight @Name tokens inside an (auto-escaped) message body — the React
 *  version of vanilla collab.js:111's regex-to-span pass. */
function chatBody(text: string): React.ReactNode {
  return text.split(/(@[\w.\-]+(?:\s[\w.\-]+)?)/g).map((part, i) =>
    part.startsWith('@') ? <span key={i} className="text-blue-300">{part}</span> : part)
}

function ChatTab({ c }: { c: CaseRow }) {
  const { profile, isCommand } = useAuth()
  const [msgs, setMsgs] = useState<MessageRow[]>([])
  const [body, setBody] = useState('')
  // ＠ Mention flow — port of vanilla collab.js:216-225: picking an officer
  // queues them, appends @Name to the text, and on send stores the id list
  // on the row + fires a chat_mention notification per mentioned officer.
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([])
  const v = useTableVersion('case_messages')
  const refresh = useCallback(async () => { try { setMsgs(await list('case_messages', { eq: { case_id: c.id }, order: 'created_at' })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const [sending, setSending] = useState(false)
  const addMention = (val: string) => {
    if (!val) return
    const p = activeProfiles().find((x) => x.id === val)
    if (!p || mentions.some((m) => m.id === p.id)) return
    setMentions((prev) => [...prev, { id: p.id, name: p.display_name || 'Officer' }])
    setBody((prev) => (prev + ' @' + (p.display_name || 'Officer') + ' ').trimStart())
  }
  const send = async () => {
    if (!body.trim() || sending) return
    setSending(true)
    const res = await insert('case_messages', { case_id: c.id, body: body.trim(), author_id: profile?.id ?? null, author_name: profile?.display_name ?? null, mentions: mentions.map((m) => m.id) })
    setSending(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    for (const m of mentions) {
      if (m.id !== profile?.id) void notify(m.id, 'chat_mention', { case_id: c.id, case_number: c.case_number, detective: profile?.display_name ?? 'Officer', reason: `${profile?.display_name ?? 'An officer'} mentioned you in the ${c.case_number} channel.` })
    }
    setBody(''); setMentions([]); void refresh()
  }
  const rowMentions = (m: MessageRow): string[] => (Array.isArray(m.mentions) ? m.mentions.filter((x): x is string => typeof x === 'string') : [])
  return (
    <div className="space-y-3">
      <div className="max-h-[48vh] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/50 p-3">
        {msgs.map((m) => <div key={m.id} className={`rounded-xl p-3 ${m.author_id === profile?.id ? 'ml-auto max-w-[85%] bg-badge-600/20' : 'max-w-[85%] bg-white/5'}`}><p className="text-xs font-bold text-slate-400">{m.author_name || officerName(m.author_id) || 'Officer'} - {timeAgo(m.created_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{chatBody(m.body)}</p>{rowMentions(m).length > 0 && <span className="mt-1 flex flex-wrap gap-1">{rowMentions(m).map((id) => <span key={id} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@{officerName(id) || 'Officer'}</span>)}</span>}{(m.author_id === profile?.id || isCommand) && <button onClick={() => mutateThen(remove('case_messages', m.id), refresh)} className="mt-2 text-xs font-bold text-rose-300">Delete</button>}</div>)}
        {!msgs.length && <p className="py-8 text-center text-sm text-slate-500">No messages yet.</p>}
      </div>
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">
              @{m.name}
              <button onClick={() => setMentions((prev) => prev.filter((x) => x.id !== m.id))} title="Remove mention" className="text-blue-300/60 hover:text-rose-300">✕</button>
            </span>
          ))}
        </div>
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={3} className="w-full rounded-xl border border-white/10 bg-ink-950 p-3 text-sm text-white" placeholder="Message the case room..." />
      <div className="flex items-center justify-between gap-2">
        <select value="" onChange={(e) => addMention(e.target.value)} aria-label="Mention an officer" className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500">
          <option value="">＠ Mention…</option>
          {activeProfiles().map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <button onClick={() => void send()} disabled={sending} className="rounded-lg bg-badge-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Send</button>
      </div>
    </div>
  )
}

function TimelineTab({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<{ at: string; label: string; sub?: string }[]>([])
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vS = useTableVersion('case_signoff_history')
  const refresh = useCallback(async () => {
    try {
      const [e, r, t, s] = await Promise.all([
        list('evidence', { eq: { case_id: c.id } }) as Promise<EvidenceRow[]>,
        list('reports', { eq: { case_id: c.id } }) as Promise<ReportRow[]>,
        list('case_tasks', { eq: { case_id: c.id } }) as Promise<TaskRow[]>,
        list('case_signoff_history', { eq: { case_id: c.id } }) as Promise<HistoryRow[]>,
      ])
      setRows([
        { at: c.created_at, label: 'Case opened', sub: c.case_number },
        ...(c.follow_up_at ? [{ at: c.follow_up_at, label: 'Follow-up due' }] : []),
        ...e.map((x) => ({ at: x.collected_at || x.created_at, label: `Evidence ${x.item_code || ''}`, sub: x.description || undefined })),
        ...r.map((x) => ({ at: x.created_at, label: `${x.template} report`, sub: x.finalized ? 'Finalized' : 'Draft' })),
        ...t.map((x) => ({ at: x.created_at, label: `Task: ${x.title}`, sub: x.done ? 'Done' : 'Open' })),
        ...s.map((x) => ({ at: x.created_at, label: SIGNOFF_ACTION_VERB[x.action] || x.action, sub: x.actor_name || officerName(x.actor_id) || undefined })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
    } catch { /* stale */ }
  }, [c])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vR, vT, vS])
  return <div className="space-y-2">{rows.map((r, i) => <div key={`${r.at}-${i}`} className="rounded-xl border border-white/10 bg-ink-950/50 p-3"><p className="font-semibold text-white">{r.label}</p><p className="text-sm text-slate-500">{timeAgo(r.at)}{r.sub ? ` - ${r.sub}` : ''}</p></div>)}</div>
}
