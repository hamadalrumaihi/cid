/** Central Command vocabulary + pure helpers — ported from vanilla command.js
 *  (filters, KPI derivations) and core.js (BUREAUS/DEPT_ROUTING/BRACKETS).
 *  Everything computes over the RLS-scoped caches the view fetched; a viewer
 *  never sees numbers for rows RLS didn't return. */
import type { Tables } from '@/lib/database.types'

export type CaseRow = Tables<'cases'>
export type TicketRow = Tables<'tickets'>
export type TrackerRow = Tables<'trackers'>

/* ---- Command filters (#17) — command staff scope the dashboard ------------ */
export interface CmdFilters {
  bureau: string
  detective: string
  /** '' · open/active/cold/closed · 'awaiting' · 'ready_doj' · 'open_active' (KPI drill) */
  status: string
  from: string
  to: string
}
export const EMPTY_CMD_FILTERS: CmdFilters = { bureau: '', detective: '', status: '', from: '', to: '' }

export const cmdFilterActive = (f: CmdFilters): boolean =>
  !!(f.bureau || f.detective || f.status || f.from || f.to)

/** Case-vs-filter predicate (command.js:15-26). 'open_active' is the drill
 *  target for the "Open Cases" KPI card, which counts open+active together. */
export function cmdMatch(c: CaseRow, f: CmdFilters): boolean {
  if (f.bureau && c.bureau !== f.bureau) return false
  if (f.detective && c.lead_detective_id !== f.detective) return false
  if (f.status === 'awaiting') { if (!/^awaiting_/.test(c.signoff_status || '')) return false }
  else if (f.status === 'ready_doj') { if (!(c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete')) return false }
  else if (f.status === 'open_active') { if (!(c.status === 'open' || c.status === 'active')) return false }
  else if (f.status && c.status !== f.status) return false
  if (f.from && new Date(c.created_at) < new Date(f.from)) return false
  if (f.to && new Date(c.created_at) > new Date(f.to + 'T23:59:59')) return false
  return true
}

/* ---- KPI derivations ------------------------------------------------------ */
export const reEvWeapon = /gun|weapon|firearm|pistol|rifle|shotgun|ammo|ammunition|magazine/i
export const reEvNarc = /narc|drug|cocaine|coke|meth|heroin|cannabis|weed|marijuana|fentanyl|opi|pill/i

export function avgResolutionDays(cases: CaseRow[]): number | null {
  const closed = cases.filter((c) => c.closed_at && c.created_at)
  if (!closed.length) return null
  const totalMs = closed.reduce((a, c) => a + (new Date(c.closed_at as string).getTime() - new Date(c.created_at).getTime()), 0)
  return totalMs / closed.length / 86400000
}

/** Per-bureau performance scorecard numbers (command.js bureauScore). */
export function bureauScore(cases: CaseRow[]) {
  const open = cases.filter((c) => c.status === 'open' || c.status === 'active').length
  const closed = cases.filter((c) => c.status === 'closed').length
  const total = cases.length
  return { open, closed, total, clearance: total ? Math.round((closed / total) * 100) : null, avg: avgResolutionDays(cases) }
}

/** '<1d' / '3.2d' / '—' formatting shared by KPI + scorecards. */
export const fmtAvgDays = (avg: number | null): string =>
  avg == null ? '—' : avg < 1 ? '<1d' : `${avg.toFixed(1)}d`

/* ---- Ticket routing (core.js:9-22) ---------------------------------------- */
/** Case-number-issuing bureaus (JTF never issues via ticket intake). */
export const TICKET_BUREAUS: Record<string, { name: string; prefix: string; dept: string }> = {
  LSB: { name: 'Los Santos Bureau', prefix: 'LSB', dept: 'LSPD' },
  BCB: { name: 'Blaine County Bureau', prefix: 'BCB', dept: 'BCSO' },
  SAB: { name: 'State Bureau', prefix: 'SAB', dept: 'SAHP' },
}
export const DEPT_ROUTING: Record<string, { bureau: string; rename: string }> = {
  LSPD: { bureau: 'LSB', rename: 'losangeles' },
  BCSO: { bureau: 'BCB', rename: 'blaine' },
  SAHP: { bureau: 'SAB', rename: 'state' },
}
/** Expected leading digit of the numeric case number per bureau. */
export const CASE_NUM_LEAD: Record<string, string> = { LSB: '1', BCB: '2', SAB: '9', JTF: '9' }

/* ---- Raid compensation (core.js:25-32) ------------------------------------ */
export const BRACKETS = [
  { min: 1000000, max: 2499999, pct: 60, label: '$1.00M – $2.49M' },
  { min: 2500000, max: 7499999, pct: 50, label: '$2.50M – $7.49M' },
  { min: 7500000, max: 14999999, pct: 40, label: '$7.50M – $14.99M' },
  { min: 15000000, max: 24999999, pct: 30, label: '$15.0M – $24.99M' },
  { min: 25000000, max: Infinity, pct: 20, label: '$25.0M +' },
] as const
export const COMP_SPLIT: Record<string, number> = {
  'Primary Detective': 0.5,
  'Supporting Units': 0.3,
  'Confidential Informants': 0.2,
}
export const findBracket = (v: number) => BRACKETS.find((b) => v >= b.min && v <= b.max) ?? null

/* ---- Tracker countdown (command.js:457-461) -------------------------------- */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'EXPIRED'
  const h = Math.floor(ms / 3.6e6)
  const m = Math.floor((ms % 3.6e6) / 6e4)
  const s = Math.floor((ms % 6e4) / 1000)
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

/** Resolve a case id → case number against the fetched cases cache. */
export const caseNumById = (cases: CaseRow[], id: string | null | undefined): string | null =>
  (id && cases.find((c) => c.id === id)?.case_number) || null
