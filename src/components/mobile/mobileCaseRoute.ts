/** The phone-first case route (plan §5.5 / §8.2, P8-01): `/m/cases/<id>?s=<section>`.
 *  Pure address + flag helpers shared by the view, the workspace's narrow
 *  redirect (WorkspaceView) and the `/cases?case=` landing (CasesView).
 *
 *  Loop guard: the workspace bounces a narrow viewport here; this screen
 *  NEVER bounces back on its own. "Open on desktop" sets the session flag
 *  first, so the workspace it lands on stays put. The flag is per browser
 *  tab (sessionStorage) — a fresh tab on a phone is phone-first again. */
import { CASE_TABS, CASE_TAB_CONDITIONAL, type CaseTabId } from '@/components/cases/caseTabs'

export const DESKTOP_ON_MOBILE_KEY = 'cid:desktop-on-mobile'

/** Sections that make sense on a phone. Graph / map-style sections and the
 *  dense editors (charges, RICO, legal, sign-off, chat, timeline,
 *  surveillance, extractions, intel) stay desktop-only: a `?s=` for one of
 *  those renders a "desktop only" card with the workspace link. The
 *  conditional `ci` tab is not a phone section at all — `isCaseTab` rejects
 *  it, so `?s=ci` falls back to the overview like any unknown value (no
 *  "desktop only" card that would name the tab). */
export const MOBILE_CASE_SECTIONS = [
  'overview', 'tasks', 'notes', 'people', 'vehicles', 'gangs', 'locations', 'media', 'reports', 'activity',
] as const satisfies readonly CaseTabId[]
export type MobileCaseSection = (typeof MOBILE_CASE_SECTIONS)[number]

export const isCaseTab = (s: string | null | undefined): s is CaseTabId =>
  !!s && (CASE_TABS as readonly string[]).includes(s) && !CASE_TAB_CONDITIONAL.has(s as CaseTabId)
export const isMobileCaseSection = (s: string | null | undefined): s is MobileCaseSection =>
  !!s && (MOBILE_CASE_SECTIONS as readonly string[]).includes(s)

export const MOBILE_CASE_PATH_PREFIX = '/m/'

export function mobileCaseHref(caseId: string, section?: string | null): string {
  const base = `/m/cases/${encodeURIComponent(caseId)}`
  return section ? `${base}?s=${encodeURIComponent(section)}` : base
}

/** True while this browser tab asked for the desktop workspace on a phone. */
export function desktopOnMobile(): boolean {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DESKTOP_ON_MOBILE_KEY) === '1' } catch { return false }
}

export function rememberDesktopOnMobile(): void {
  try { sessionStorage.setItem(DESKTOP_ON_MOBILE_KEY, '1') } catch { /* private mode / blocked storage — the redirect simply wins next time */ }
}
