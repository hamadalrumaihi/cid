'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteWithUndo, list, updateWhere, withRetry } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useOperationsStore } from '@/lib/operations'
import { notify } from '@/lib/notify'
import { activeProfiles, officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { caseStatusTint, signoffLabel, signoffTint } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { CaseBoard } from './CaseBoard'
import { CaseDetail } from './CaseDetail'
import { CaseFilterBar } from './CaseFilterBar'
import { CaseModal } from './CaseModal'
import { CASE_GRID_CLASS, applyCaseFilters, isStaleCase, loadCaseFilters, persistCaseFilters, type CaseFilters, type CaseRow } from './caseUtils'
import { StaleBadge } from './StaleBadge'
import { WatchButton } from './WatchButton'

let staleEscalationStarted = false

export function CasesView() {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile, canEdit, canDelete } = useAuth()
  const [cases, setCases] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState(() => Store.get('casesScope', 'mine'))
  const [view, setView] = useState(() => Store.get('casesView', 'grid'))
  const [filters, setFilters] = useState<CaseFilters>(() => loadCaseFilters())
  const [activeViewName, setActiveViewName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<CaseRow | null>(null)
  const casesV = useTableVersion('cases')
  const templatesV = useTableVersion('case_templates')
  const caseId = sp.get('case')
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const fetchOps = useOperationsStore((s) => s.fetch)

  const fetchCases = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await withRetry(() => list('cases', { order: 'updated_at', ascending: false }))
      setCases(rows)
      maybeEscalateStale(rows, profile?.id ?? null)
    } catch (e) {
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { queueMicrotask(() => { void fetchProfiles(); void fetchOps() }) }, [fetchProfiles, fetchOps])
  useEffect(() => { queueMicrotask(() => { void fetchCases() }) }, [fetchCases, casesV, templatesV])
  useEffect(() => { Store.set('casesScope', scope) }, [scope])
  useEffect(() => { Store.set('casesView', view) }, [view])
  useEffect(() => { persistCaseFilters(filters) }, [filters])

  const filtered = useMemo(() => {
    let rows = cases
    if (scope === 'mine' && profile?.id) rows = rows.filter((c) => c.lead_detective_id === profile.id || c.created_by === profile.id)
    rows = applyCaseFilters(rows, filters, profile?.id ?? null)
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter((c) => JSON.stringify(c).toLowerCase().includes(q))
    return rows
  }, [cases, scope, filters, profile, query])

  const openCase = (id: string) => router.push(`/cases?case=${id}`)
  const closeDetail = () => router.push('/cases')
  const setAllSelected = () => setSelected(selected.length === filtered.length ? [] : filtered.map((c) => c.id))

  const deleteSelected = async () => {
    const rows = cases.filter((c) => selected.includes(c.id))
    const ok = await deleteWithUndo('cases', rows, { label: `${rows.length} cases`, noConfirm: false })
    if (ok) { setSelected([]); void fetchCases() }
  }

  if (caseId) return <CaseDetail id={caseId} onBack={closeDetail} onChanged={fetchCases} />

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">LIVE CASES</p>
          <h2 className="text-2xl font-black text-white">Case Files</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDelete && <button onClick={setAllSelected} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">{selected.length === filtered.length && filtered.length ? 'Deselect all' : `Select all (${filtered.length})`}</button>}
          <div className="flex rounded-lg border border-white/10 bg-ink-950 p-1">
            {['mine', 'all'].map((s) => <button key={s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1.5 text-sm font-bold capitalize ${scope === s ? 'bg-badge-600 text-white' : 'text-slate-400'}`}>{s}</button>)}
          </div>
          <div className="flex rounded-lg border border-white/10 bg-ink-950 p-1">
            {['grid', 'board'].map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-bold capitalize ${view === v ? 'bg-badge-600 text-white' : 'text-slate-400'}`}>{v}</button>)}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases" className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />
          <button onClick={() => void fetchCases()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200">Refresh</button>
          {canEdit && <button onClick={() => { setEditRecord(null); setModalOpen(true) }} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-sm font-bold text-white">New Case</button>}
        </div>
      </header>

      <CaseFilterBar filters={filters} scope={scope} query={query} activeViewName={activeViewName} onFilters={setFilters} onScope={setScope} onQuery={setQuery} onActiveViewName={setActiveViewName} />

      {loading ? <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Loading cases...</p>
        : view === 'board' ? <CaseBoard items={filtered} canEdit={canEdit} onOpen={openCase} onMoved={fetchCases} />
        : <div className={CASE_GRID_CLASS}>{filtered.map((c, i) => <CaseCard key={c.id} c={c} index={i} selected={selected.includes(c.id)} canDelete={canDelete} onSelect={(on) => setSelected((s) => on ? [...s, c.id] : s.filter((x) => x !== c.id))} onOpen={() => openCase(c.id)} />)}</div>}
      {!loading && !filtered.length && <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-8 text-center text-sm text-slate-400">No cases match this view.</p>}

      {selected.length > 0 && <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-white/10 bg-ink-850 p-3 shadow-glow">
        <p className="text-sm font-bold text-white">{selected.length} selected</p>
        <div className="flex gap-2"><button onClick={() => setSelected([])} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Clear</button><button onClick={() => void deleteSelected()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white">Delete selected</button></div>
      </div>}

      <CaseModal open={modalOpen} record={editRecord} onClose={() => setModalOpen(false)} onSaved={(id) => { setModalOpen(false); void fetchCases(); if (id) openCase(id) }} />
    </div>
  )
}

function CaseCard({ c, index, selected, canDelete, onSelect, onOpen }: { c: CaseRow; index: number; selected: boolean; canDelete: boolean; onSelect: (on: boolean) => void; onOpen: () => void }) {
  return (
    <article data-status={c.status} data-bureau={c.bureau} data-stale={isStaleCase(c) ? 'true' : 'false'} style={{ ['--i' as string]: index }} className="case-card rounded-2xl border border-white/10 bg-ink-900/60 p-4 transition hover:border-badge-400/50">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 text-left">
          <p className="font-mono text-sm font-bold text-badge-200">{c.case_number}</p>
          <h3 className="mt-1 line-clamp-2 text-lg font-black text-white">{c.title || 'Untitled case'}</h3>
        </button>
        {canDelete && <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1" />}
      </div>
      <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm text-slate-400">{c.summary || 'No summary recorded.'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${caseStatusTint(c.status)}`}>{c.status}</span>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-bold text-slate-300">{c.bureau}</span>
        <StaleBadge c={c} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{officerName(c.lead_detective_id) || 'Unassigned'}</span>
        <span>UPD {timeAgo(c.updated_at).toUpperCase()}</span>
      </div>
      <div className="mt-3 flex justify-end"><WatchButton type="case" id={c.id} label={c.case_number} /></div>
    </article>
  )
}

function maybeEscalateStale(rows: CaseRow[], meId: string | null) {
  if (staleEscalationStarted || !meId) return
  staleEscalationStarted = true
  window.setTimeout(() => {
    void (async () => {
      const now = new Date().toISOString()
      const leadRoles = new Set(['bureau_lead', 'deputy_director', 'director', 'command'])
      for (const c of rows.filter(isStaleCase).filter((x) => !x.last_stale_notified_at)) {
        const cas = await updateWhere('cases', { is: { last_stale_notified_at: null }, eq: { id: c.id } }, { last_stale_notified_at: now })
        if (cas.error || !cas.data?.length) continue
        const targets = activeProfiles()
          .filter((p) => (p.id === c.lead_detective_id) || (p.division === c.bureau && leadRoles.has(p.role)) || p.role === 'deputy_director')
          .map((p) => p.id)
        await Promise.all([...new Set(targets)].map((uid) => notify(uid, 'stale_case', { case_id: c.id, case_number: c.case_number })))
      }
    })()
  }, 6000)
}
