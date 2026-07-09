'use client'

/** M.O. Detector & Profiler — port of vanilla modus.js. Extracts tactical
 *  indicators from a pasted narrative against MO_DICT, scores stored case
 *  M.O. profiles by shared indicators, and — for cases the viewer CANNOT
 *  see — surfaces existence-only locked cards via the `mo_crossref`
 *  SECURITY DEFINER RPC (the deliberate cross-bureau leak valve: case number
 *  + shared tags only) with a request-access flow. */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Json, Tables } from '@/lib/database.types'
import { insert, list, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { activeProfiles } from '@/lib/profiles'
import { COMMAND_ROLES } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { uiPrompt } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'

type MoProfileRow = Tables<'mo_profiles'>
type CaseRow = Tables<'cases'>

const MO_DICT: Record<string, string[]> = {
  names: ['tre', 'marcus', 'dion', 'lena', 'omar', 'reyes', 'ghost', 'switch'],
  entry: ['lockpick', 'lockpicked', 'thermite', 'breach', 'breached', 'crowbar', 'kicked', 'drilled', 'cut the lock'],
  vehicles: ['black cid suv', 'unmarked burrito', 'burrito', 'black suv', 'sandking', 'motorcycle', 'getaway sedan', 'unmarked'],
  weapons: ['class 2 ap pistol', 'ap pistol', 'class 3', 'rifle', 'smg', 'switch', 'auto-sear', 'shotgun', '9mm', '5.56'],
}
const SAMPLE_MO = "Two suspects in an unmarked black Burrito breached the rear door via lockpick. One matched the alias 'Tre'. A Class 2 AP Pistol casing was recovered, and thermite residue was found on the safe. They fled before our black CID SUV arrived."
const CATS = ['names', 'entry', 'vehicles', 'weapons'] as const
const CAT_META: Record<string, { l: string; t: string }> = {
  names: { l: 'Aliases / Names', t: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  entry: { l: 'Entry Methods', t: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  vehicles: { l: 'Vehicles', t: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
  weapons: { l: 'Weapons', t: 'bg-violet-500/10 text-violet-300 border-violet-500/20' },
}

type Indicators = Record<string, string[]>

function scanMO(text: string): Indicators {
  const lc = text.toLowerCase()
  const found: Indicators = { names: [], entry: [], vehicles: [], weapons: [] }
  for (const cat of CATS) for (const term of MO_DICT[cat]) if (lc.includes(term) && !found[cat].includes(term)) found[cat].push(term)
  return found
}
const flatten = (ind: Indicators | Json | null): string[] => {
  if (!ind || typeof ind !== 'object' || Array.isArray(ind)) return []
  const o = ind as Record<string, unknown>
  return CATS.flatMap((k) => (Array.isArray(o[k]) ? (o[k] as string[]) : []))
}

interface LocalMatch { caseObj: CaseRow | undefined; label: string; status: string; shared: string[]; pct: number }
interface CrossRow { case_id: string; case_number: string; shared: string[] }

export function ModusView() {
  const { state, profile, canEdit } = useAuth()
  const router = useRouter()
  const [text, setText] = useState('')
  const [scan, setScan] = useState<{ narrative: string; indicators: Indicators } | null>(null)
  const [profiles, setProfiles] = useState<MoProfileRow[]>([])
  const [cases, setCases] = useState<CaseRow[]>([])
  const [matches, setMatches] = useState<LocalMatch[]>([])
  const [crossRows, setCrossRows] = useState<CrossRow[]>([])
  const [saveOpen, setSaveOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try {
      const [ps, cs] = await Promise.all([
        list('mo_profiles', { order: 'created_at', ascending: false }),
        list('cases', {}),
      ])
      setProfiles(ps)
      setCases(cs)
    } catch { toast('Could not load M.O. profiles — check your connection.', 'danger') }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const run = () => {
    const t = text.trim()
    if (!t) { toast('Paste an incident narrative first.', 'warn'); return }
    const indicators = scanMO(t)
    const all = flatten(indicators)
    setScan({ narrative: t, indicators })
    // Score stored profiles by shared indicators. Cases in other bureaus are
    // RLS-hidden here — those matches arrive via the mo_crossref RPC below.
    const scored: LocalMatch[] = profiles.map((p) => {
      const tags = flatten(p.indicators)
      const shared = tags.filter((tag) => all.includes(tag))
      const pct = tags.length ? Math.round((shared.length / tags.length) * 100) : 0
      const c = cases.find((x) => x.id === p.case_id)
      return { caseObj: c, label: c?.case_number ?? '—', status: c ? (c.status === 'cold' ? 'Cold' : 'Open') : '—', shared, pct }
    }).filter((m) => m.shared.length).sort((a, b) => b.pct - a.pct)
    setMatches(scored)
    if (scored.length) toast(`${scored[0].pct}% M.O. match found with ${scored[0].label}`, scored[0].pct >= 70 ? 'danger' : 'info')
    setCrossRows([])
    if (all.length) {
      void rpc('mo_crossref', { terms: all }).then((r) => {
        const rows = ((r.data ?? []) as CrossRow[]).filter((row) => (row.shared ?? []).length)
        // Only show locked cards for cases NOT visible to this viewer.
        setCrossRows(rows.filter((row) => !cases.some((c) => c.id === row.case_id)))
      })
    }
  }

  const requestAccess = async (caseId: string, caseNumber: string) => {
    if (!profile) return
    const reason = (await uiPrompt('Reason for requesting access (optional):', { title: 'Request case access' })) || ''
    const res = await insert('case_access_requests', { case_id: caseId, requester_name: profile.display_name, reason: reason || null })
    if (res.error) { toast(`Request failed: ${res.error.message}`, 'danger'); return }
    // Notify deciders (command roles) — the case lead is RLS-hidden from us here.
    const deciders = activeProfiles().filter((p) => (COMMAND_ROLES as readonly string[]).includes(p.role) && p.id !== profile.id)
    for (const d of deciders) await notify(d.id, 'access_requested', { case_id: caseId, case_number: caseNumber, detective: profile.display_name, reason: reason ? `Access requested: ${reason}` : 'Requested access to this case.' })
    toast('Access request sent to the case owner.', 'success')
  }

  const all = scan ? flatten(scan.indicators) : []

  if (state !== 'in') return <Notice text="Sign in to use the M.O. detector." />

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <PageHeader
          title="🔍 Modus Operandi (M.O.) Detector & Criminal Profiler"
          subtitle="Paste narrative incident updates, scene notes or witness statements — the engine extracts tactical indicators and cross-references open / cold files."
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <label className="mb-2 block text-sm font-semibold text-white" htmlFor="mo-input">Incident Narrative / Scene Notes</label>
          <textarea
            id="mo-input"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Two suspects in an unmarked black Burrito breached the rear door via lockpick…"
            className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm leading-relaxed text-white outline-none transition focus:border-badge-500"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={run} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Run M.O. Analysis</button>
            <button onClick={() => setText(SAMPLE_MO)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Load Sample</button>
            {scan && all.length > 0 && canEdit && (
              <button onClick={() => setSaveOpen(true)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Save as Case Profile</button>
            )}
          </div>
          {scan && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Extracted Tactical Indicators ({all.length})</p>
              {all.length ? CATS.filter((c) => scan.indicators[c].length > 0).map((c) => (
                <div key={c} className="mb-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{CAT_META[c].l}</p>
                  <div className="flex flex-wrap gap-2">
                    {scan.indicators[c].map((t) => <span key={t} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${CAT_META[c].t}`}>{t}</span>)}
                  </div>
                </div>
              )) : <p className="text-sm text-slate-400">No known indicators detected.</p>}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <h2 className="mb-1 text-sm font-semibold text-white">🎯 M.O. Cross-Reference</h2>
          <p className="mb-4 text-xs text-slate-400">Matching open / cold files sharing tactical operational profiles.</p>
          <div className="space-y-3">
            {!scan && <p className="text-sm text-slate-400">Run an analysis to surface matching case files.</p>}
            {scan && !matches.length && !crossRows.length && (
              <p className="text-sm text-slate-400">No cross-reference matches found{profiles.length ? '' : ' — no case M.O. profiles saved yet'}.</p>
            )}
            {matches.map((m, i) => {
              const tint = m.pct >= 70 ? 'border-rose-500/40 bg-rose-500/5' : m.pct >= 40 ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900'
              const bar = m.pct >= 70 ? 'bg-rose-500' : m.pct >= 40 ? 'bg-amber-500' : 'bg-blue-500'
              return (
                <div key={i} className={`rounded-xl border ${tint} p-4`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <button onClick={() => { if (m.caseObj) router.push(`/cases?case=${m.caseObj.id}`) }} className="font-mono text-sm font-semibold text-white hover:text-blue-300">{m.label}</button>
                      <span className={`ml-2 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${m.status === 'Cold' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{m.status}</span>
                    </div>
                    <span className={`font-mono text-lg font-bold ${m.pct >= 70 ? 'text-rose-300' : m.pct >= 40 ? 'text-amber-300' : 'text-blue-300'}`}>{m.pct}%</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{m.pct}% M.O. match — shared: {m.shared.join(', ')}</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800"><div className={`h-full ${bar}`} style={{ width: `${m.pct}%` }} /></div>
                </div>
              )
            })}
            {crossRows.map((row) => (
              <div key={row.case_id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2"><span className="text-lg" aria-hidden>🔒</span><span className="text-sm font-semibold text-amber-200">Flagged in another bureau&rsquo;s investigation</span></div>
                <p className="mt-1 text-xs text-slate-300">
                  Indicators (<span className="text-amber-200">{row.shared.join(', ')}</span>) match case{' '}
                  <span className="font-mono text-amber-200">{row.case_number}</span> you don&rsquo;t have access to. Details are restricted.
                </p>
                <button onClick={() => void requestAccess(row.case_id, row.case_number)} className="mt-2 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">
                  Request access
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saveOpen && scan && (
        <SaveProfileModal
          indicators={scan.indicators}
          narrative={scan.narrative}
          cases={cases}
          onClose={() => setSaveOpen(false)}
          onSaved={() => { setSaveOpen(false); void refresh() }}
        />
      )}
    </div>
  )
}

function SaveProfileModal({ indicators, narrative, cases, onClose, onSaved }: {
  indicators: Indicators
  narrative: string
  cases: CaseRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const tags = flatten(indicators)

  const save = async () => {
    if (!caseId) { toast('Select a case.', 'warn'); return }
    setBusy(true)
    const res = await insert('mo_profiles', { case_id: caseId, indicators: indicators as Json, narrative })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('M.O. profile saved', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Save M.O. Profile" onClose={onClose} />
      <p className="mb-3 text-xs text-slate-400">Link these {tags.length} indicators to a case so future scans cross-reference against it.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {tags.map((t) => <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">{t}</span>)}
      </div>
      <label className="mb-1 block text-xs font-semibold text-slate-400" htmlFor="mo-case">Case *</label>
      <select id="mo-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
        {!cases.length && <option value="">— no cases —</option>}
        {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
      </select>
      <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
        Save Profile
      </button>
    </Modal>
  )
}
