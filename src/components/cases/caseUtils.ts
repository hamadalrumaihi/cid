'use client'

/** Client-side case helpers — staleness, pins/recents, filters and saved
 *  views. All persistence uses the SAME Store keys as vanilla casefiles.js
 *  (casesScope/casesView/caseFilters/caseViews/recentCases/pinnedCases) so
 *  personal presets carry over between the legacy site and this app. */
import type { Tables } from '@/lib/database.types'
import { countRows, list } from '@/lib/db'
import { assessCase } from '@/lib/caseWorkflow'
import { todayISO } from '@/lib/format'
import { Store } from '@/lib/store'
import { uiConfirm } from '@/components/ui/dialog'

export type CaseRow = Tables<'cases'>

export const CASE_GRID_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

/** Days since a case last moved (casefiles.js:312). */
export const caseStaleDays = (c: CaseRow): number =>
  Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000)

/** Open/active case gone quiet ≥14d (closed/cold never count). */
export const isStaleCase = (c: CaseRow): boolean =>
  c.status !== 'closed' && c.status !== 'cold' && caseStaleDays(c) >= 14

/* ---- Pre-close advisory ---------------------------------------------------
 * The shared "Still open on this case" checklist confirm behind EVERY close
 * path (detail quick-status + board drag/select). Fetches the case's workflow
 * rows, runs the shared evaluator, and confirms. Advisory only — command can
 * still close over open work (the reason lives in history). */
export async function confirmCaseClose(c: CaseRow, meId: string | null = null): Promise<boolean> {
  let blockerLines = ''
  try {
    const [tasks, reports, legal, liveMedia, persisted] = await Promise.all([
      list('case_tasks', { eq: { case_id: c.id } }),
      list('reports', { eq: { case_id: c.id } }),
      list('legal_requests', { eq: { case_id: c.id } }).catch(() => []),
      countRows('media', { eq: { case_id: c.id }, is: { archived_at: null } }),
      list('case_blockers', { eq: { case_id: c.id, status: 'open' } }).catch(() => [] as Tables<'case_blockers'>[]),
    ])
    const { blockers } = assessCase({ c, tasks, reports, legal, mediaCount: liveMedia, persistedBlockers: persisted, meId, todayISO: todayISO() })
    if (blockers.length) blockerLines = '\n\nStill open on this case:\n' + blockers.map((b) => `• ${b.label}`).join('\n') + '\n\nClose anyway?'
  } catch { /* checklist is best-effort; fall back to the plain confirm */ }
  return uiConfirm(
    `Close ${c.case_number}? It will leave the active case board. You can reopen it later.${blockerLines}`,
    { title: 'Close case', confirmText: blockerLines ? 'Close anyway' : 'Close case', danger: !!blockerLines },
  )
}

/* ---- Pins + recents (Jump-back data; the strip renders on Command) ------- */
export const recentCaseIds = (): string[] => Store.get<string[]>('recentCases', [])
export const pinnedCaseIds = (): string[] => Store.get<string[]>('pinnedCases', [])

export function pushRecentCase(id: string): void {
  if (!id) return
  const r = recentCaseIds().filter((x) => x !== id)
  Store.set('recentCases', [id, ...r].slice(0, 8))
}
export const isPinnedCase = (id: string): boolean => pinnedCaseIds().includes(id)
export function togglePinCase(id: string): void {
  const p = pinnedCaseIds()
  Store.set('pinnedCases', (p.includes(id) ? p.filter((x) => x !== id) : [id, ...p]).slice(0, 12))
}

/* ---- RICO tab session reveal ---------------------------------------------
 * The RICO tab is conditional (lib/caseWorkflow.ricoTabVisible): hidden until
 * the case has tracker data, unless the viewer explicitly enabled tracking.
 * That explicit reveal is a per-browser-tab SESSION flag (sessionStorage, not
 * the localStorage Store blob) — it should not outlive the sitting, and once
 * a record exists the data itself keeps the tab visible. */
const RICO_SESSION_KEY = 'cid:ricoTabEnabled'

export function ricoSessionEnabled(caseId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (JSON.parse(window.sessionStorage.getItem(RICO_SESSION_KEY) ?? '[]') as string[]).includes(caseId)
  } catch { return false }
}

export function enableRicoSession(caseId: string): void {
  if (typeof window === 'undefined') return
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(RICO_SESSION_KEY) ?? '[]')
    const ids = Array.isArray(raw) ? (raw as string[]) : []
    if (!ids.includes(caseId)) window.sessionStorage.setItem(RICO_SESSION_KEY, JSON.stringify([...ids, caseId]))
  } catch { /* storage blocked — the reveal just doesn't survive navigation */ }
}

/* ---- Advanced filters + saved views (casefiles.js:53-124) ---------------- */
export interface CaseFilters {
  bureau: string
  status: string
  /** '' anyone · 'me' · 'unassigned' · a profile id */
  assignee: string
  /** '' any · 'stale' ≥14d · 'fresh' <14d */
  stale: string
}

export const EMPTY_FILTERS: CaseFilters = { bureau: '', status: '', assignee: '', stale: '' }

export function loadCaseFilters(): CaseFilters {
  const f = Store.get<Partial<CaseFilters>>('caseFilters', {})
  return {
    bureau: typeof f.bureau === 'string' ? f.bureau : '',
    status: typeof f.status === 'string' ? f.status : '',
    assignee: typeof f.assignee === 'string' ? f.assignee : '',
    stale: typeof f.stale === 'string' ? f.stale : '',
  }
}
export const persistCaseFilters = (f: CaseFilters): void => Store.set('caseFilters', f)
export const activeCaseFilterCount = (f: CaseFilters): number =>
  (['bureau', 'status', 'assignee', 'stale'] as const).filter((k) => f[k]).length

export function applyCaseFilters(items: CaseRow[], f: CaseFilters, meId: string | null): CaseRow[] {
  return items.filter((c) => {
    if (f.bureau && c.bureau !== f.bureau) return false
    if (f.status && c.status !== f.status) return false
    if (f.assignee === 'me') { if (c.lead_detective_id !== meId) return false }
    else if (f.assignee === 'unassigned') { if (c.lead_detective_id) return false }
    else if (f.assignee && c.lead_detective_id !== f.assignee) return false
    if (f.stale === 'stale') { if (c.status === 'closed' || c.status === 'cold' || caseStaleDays(c) < 14) return false }
    else if (f.stale === 'fresh') { if (caseStaleDays(c) >= 14) return false }
    return true
  })
}

export interface SavedCaseView {
  name: string
  filters: Partial<CaseFilters>
  scope?: string
  q?: string
}

export const caseViews = (): SavedCaseView[] => Store.get<SavedCaseView[]>('caseViews', [])
export const setCaseViews = (v: SavedCaseView[]): void => Store.set('caseViews', v)
