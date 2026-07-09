'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { deleteWithUndo, list, update, withRetry } from '@/lib/db'
import { todayISO, copyText, slug } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useOperationsStore } from '@/lib/operations'
import { caseCourtHint, caseStatusTint, CASE_STATUSES, signoffLabel, signoffTint } from '@/lib/signoff'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { gatherCasePacket, packetDocx, packetMarkdown, packetPdfSpec } from '@/lib/packet'
import { toast } from '@/lib/toast'
import { isPinnedCase, pushRecentCase, togglePinCase } from './caseUtils'
import { StaleBadge } from './StaleBadge'
import { WatchButton } from './WatchButton'
import { CaseModal } from './CaseModal'
import { OverviewTab } from './tabs/OverviewTab'
import { NotesTab } from './tabs/NotesTab'
import { EvidenceTab } from './tabs/EvidenceTab'
import { ChargesTab } from './tabs/ChargesTab'
import { RicoTab } from './tabs/RicoTab'
import { IntelTab } from './tabs/IntelTab'
import { ReportsTab } from './tabs/ReportsTab'
import { TasksTab } from './tabs/TasksTab'
import { SignoffTab } from './tabs/SignoffTab'
import { ChatTab } from './tabs/ChatTab'
import { TimelineTab } from './tabs/TimelineTab'
import type { CaseRow } from './tabs/shared'

// RicoView renders the same tracker outside the case screen.
export { RicoTab } from './tabs/RicoTab'

// React Flow is heavy — load the graph only when its tab is opened.
const CaseGraphTab = dynamic(() => import('./CaseGraphTab').then((m) => m.CaseGraphTab), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-sm text-slate-500">Building the link chart…</p>,
})

const TABS = ['overview', 'graph', 'evidence', 'notes', 'charges', 'rico', 'intel', 'reports', 'tasks', 'signoff', 'chat', 'timeline'] as const
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
        {tab === 'graph' && <CaseGraphTab c={c} />}
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
  const [pdfBusy, setPdfBusy] = useState(false)
  const exportPdf = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const data = await gatherCasePacket(c)
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(packetPdfSpec(c, data), `${slug(c.case_number)}-packet.pdf`)
      setOpen(false)
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
    finally { setPdfBusy(false) }
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
            <button onClick={() => void exportPdf()} disabled={pdfBusy} className="rounded-lg bg-badge-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pdfBusy ? 'Rendering PDF…' : 'Download PDF'}</button>
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
