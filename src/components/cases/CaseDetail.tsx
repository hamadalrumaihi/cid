'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { uiConfirm } from '@/components/ui/dialog'
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

  // ── Tab bar mechanics: overflow fades tracked to real scroll position,
  //    roving-tabindex keyboard focus, and active-tab-into-view on change. ──
  const stripRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const rafRef = useRef<number | undefined>(undefined)
  const [fade, setFade] = useState({ left: false, right: false })

  const readFades = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }))
  }, [])

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = undefined; readFades() })
  }, [readFades])

  // Window resize can change what overflows — re-measure (rAF-throttled).
  useEffect(() => {
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('resize', onScroll)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [onScroll])

  // Bring the active tab into view on first paint and on every tab change,
  // then re-measure the fades. Respect reduced-motion for the scroll.
  useEffect(() => {
    const el = tabRefs.current[tab]
    if (el) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    }
    readFades()
    // c?.id: the strip only mounts once the case has loaded.
  }, [tab, c?.id, readFades])

  // Roving focus only — arrows/Home/End MOVE focus between tabs; activation
  // (Enter/Space/click) is left to each button's native onClick → setTab, so
  // the ?tab= URL is not churned as focus roams the strip.
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const active = document.activeElement
    let idx = TABS.findIndex((t) => tabRefs.current[t] === active)
    if (idx < 0) idx = TABS.indexOf(tab)
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : e.key === 'ArrowLeft' ? (idx - 1 + TABS.length) % TABS.length
      : (idx + 1) % TABS.length
    tabRefs.current[TABS[next]]?.focus()
  }

  if (loading) return <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Loading case...</p>
  if (!c) return <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Case not found.</p>

  const op = operations.find((x) => x.id === c.operation_id)
  const hint = caseCourtHint(c, profile?.id ?? null, officerName(c.signoff_assignee_id))
  const pinned = isPinnedCase(c.id)
  // "Awaiting a decision" reuses the established sign-off vocabulary: every
  // awaiting state is prefixed awaiting_ (lib/signoff), same set caseCourtHint
  // keys off. No new states invented.
  const awaitingSignoff = (c.signoff_status ?? '').startsWith('awaiting_')

  const quickStatus = async (status: CaseRow['status']) => {
    // Closing stamps closed_at and takes the case off the active board — worth
    // a beat of confirmation. It stays reversible (set it back to reopen).
    if (status === 'closed' && c.status !== 'closed') {
      const ok = await uiConfirm(`Close ${c.case_number}? It moves to the Closed column and drops off active dashboards. You can reopen it by changing the status back.`, { title: 'Close case', confirmText: 'Close case', danger: false })
      if (!ok) { void fetchCase(); return }
    }
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
      <Breadcrumbs items={[{ label: 'Cases', onClick: onBack }, { label: c.case_number }]} />
      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {/* Identity group — what the case is. */}
              <button onClick={() => copyText(c.case_number, 'Case number copied.')} title="Copy case number" className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-[11px] font-bold text-badge-200 hover:bg-white/10">{c.case_number}</button>
              <Badge>{c.bureau}</Badge>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-white/10" />
              {/* Workflow group — where the case stands. */}
              <Badge tint={caseStatusTint(c.status)} className="uppercase">{c.status}</Badge>
              <Badge tint={signoffTint(c.signoff_status)}>{signoffLabel(c.signoff_status)}</Badge>
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

      {/* Sticky tab strip — tucks directly under the shell header (sticky
          top-0). Header ≈ 4.5rem mobile / 4.75rem sm+; z-10 stays below the
          header's z-20 so the header owns the seam (no gap, no overlap). */}
      <div className="sticky top-[4.5rem] z-10 -mx-4 border-b border-white/10 bg-ink-950/90 px-4 backdrop-blur sm:top-[4.75rem] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="relative">
          {fade.left && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-ink-950 to-transparent" />}
          {fade.right && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-ink-950 to-transparent" />}
          <div
            ref={stripRef}
            role="tablist"
            aria-label="Case sections"
            onScroll={onScroll}
            onKeyDown={onTabKeyDown}
            className="flex gap-2 overflow-x-auto py-2"
          >
            {TABS.map((t) => {
              const on = tab === t
              const marker = t === 'signoff' && awaitingSignoff
              return (
                <Fragment key={t}>
                  {/* One subtle divider before the workflow cluster (reports ·
                      tasks · signoff · chat); tab order is untouched. */}
                  {t === 'reports' && <span aria-hidden className="mx-1 h-6 w-px flex-shrink-0 self-center bg-white/10" />}
                  <button
                    ref={(el) => { tabRefs.current[t] = el }}
                    role="tab"
                    id={`casetab-${t}`}
                    aria-selected={on}
                    aria-controls={`casepanel-${t}`}
                    tabIndex={on ? 0 : -1}
                    title={marker ? 'Sign-off requires attention' : undefined}
                    onClick={() => setTab(t)}
                    className={`flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold capitalize sm:min-h-0 ${on ? 'bg-badge-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                  >
                    {t}
                    {marker && (
                      <>
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        <span className="sr-only">Sign-off requires attention</span>
                      </>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>
      </div>
      <section role="tabpanel" id={`casepanel-${tab}`} aria-labelledby={`casetab-${tab}`} tabIndex={0} className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
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
