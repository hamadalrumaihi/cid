/** The penal code, read from the shared database rather than compiled in.
 *
 *  This file used to BE the penal code: a 162-entry array converted from the
 *  vanilla penal.js. That array is gone. The statutes now live in
 *  `public.penal_charges`, versioned, and this module is a cache over
 *  `public.penal_current_charges()` — the published version, whatever it is.
 *
 *  ── Why the array had to go ────────────────────────────────────────────────
 *  A constant in a JS bundle has no version, no audit and no RLS. Amending a
 *  fine meant a deploy; every unit ran whatever build it was served; and there
 *  was no way for a case to record which code it was charged under. The
 *  database answers all three, but only if it is the single source — keeping a
 *  fallback copy here would just be a second penal code that silently
 *  disagrees with the first.
 *
 *  ── There is deliberately no `PENAL_CODE` export any more ──────────────────
 *  A module-level array that fills in later is a trap: anything that reads it
 *  at import time (`new Map(PENAL_CODE.map(...))`) captures it while empty and
 *  stays empty forever. narcoticsDossier.ts did exactly that. Every read now
 *  goes through `penalCatalog()` or `penalByCode()`, which consult the live
 *  cache at call time, so that mistake is not available.
 *
 *  ── Loading ────────────────────────────────────────────────────────────────
 *  `ensurePenalCode()` is idempotent and single-flight: N components mounting
 *  at once produce one request. React callers should use `usePenalCode()`,
 *  which reports readiness so a view can show a loading state instead of
 *  rendering an empty statute book. Non-React callers that cannot tolerate a
 *  miss — the case packet, which would otherwise export charges with no title
 *  or penalty — must await it explicitly.
 *
 *  Until the catalog loads, `penalCatalog()` is empty and `penalByCode()`
 *  returns null. That is the honest answer: nothing is known yet. It is NOT
 *  the same as "no such charge", which is why `penalLoaded()` exists.
 */

import { rpc } from './db'

/** A statute, in the shape the views have always used. `level` is the charge
 *  class, `jail` is months with null meaning a judge decides, and `rico`
 *  covers BOTH senses the old array conflated — see `penalRicoFlag`. */
export interface PenalCharge {
  /** The charge row's uuid. Stable across renumbering; use it for React keys
   *  and for `case_charges.charge_id`. */
  id: string
  code: string
  title: string
  level: string
  jail: number | null
  fine: number | null
  desc?: string
  modifier?: true
  stack?: true
  arrest?: true
  rico?: true
}

/** Row shape returned by public.penal_current_charges(). */
interface PenalRow {
  id: string
  code: string | null
  offense: string
  charge_class: string
  jail_months: number | null
  fine: number | null
  definition: string | null
  is_modifier: boolean
  stackable: boolean
  arrest_required: boolean | null
  is_rico: boolean
  is_rico_predicate: boolean | null
  version_name: string
}

/** The old array's single `rico` flag covered 24 charges: the 6 RICO modifiers
 *  AND the 18 offenses that can serve as a predicate act. The database keeps
 *  those apart, correctly — they are opposite ends of the statute. This
 *  restores the union, because that union is what the RICO predicate picker,
 *  the catalog badge and the per-case predicate count have always meant. */
function penalRicoFlag(r: PenalRow): true | undefined {
  return r.is_rico || r.is_rico_predicate ? true : undefined
}

function toCharge(r: PenalRow): PenalCharge {
  return {
    id: r.id,
    // A charge can in principle be active with no code (the constraint only
    // forces a code on non-draft rows that claim to need one). Such a row is
    // still shown, but nothing can look it up by code.
    code: r.code ?? '',
    title: r.offense,
    level: r.charge_class,
    jail: r.jail_months,
    fine: r.fine,
    desc: r.definition ?? undefined,
    modifier: r.is_modifier || undefined,
    stack: r.stackable || undefined,
    arrest: r.arrest_required || undefined,
    rico: penalRicoFlag(r),
  }
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

let CATALOG: PenalCharge[] = []
let BY_CODE = new Map<string, PenalCharge>()
let VERSION: string | null = null
let inFlight: Promise<void> | null = null

/** Replace the cached catalog. Used by the loader, and by tests that need a
 *  known catalog without a database. */
export function setPenalCatalog(charges: PenalCharge[], versionName: string | null = null): void {
  CATALOG = charges
  BY_CODE = new Map(charges.filter((c) => c.code).map((c) => [c.code, c]))
  VERSION = versionName
}

/** Every statute in the published code. Empty until loaded — check
 *  `penalLoaded()` before treating that as "the code is empty". */
export function penalCatalog(): PenalCharge[] {
  return CATALOG
}

/** True once the catalog has been fetched at least once. */
export function penalLoaded(): boolean {
  return VERSION !== null
}

/** The name of the published version currently cached, for a footer or an
 *  export header. Null until loaded. */
export function penalVersionName(): string | null {
  return VERSION
}

/** Fetch the published code once. Concurrent callers share one request; later
 *  callers return immediately. Pass `force` to re-fetch after a publish. */
export async function ensurePenalCode(force = false): Promise<void> {
  if (VERSION !== null && !force) return
  if (inFlight && !force) return inFlight
  inFlight = (async () => {
    const res = await rpc('penal_current_charges', {})
    const rows = (res.data ?? []) as PenalRow[]
    // A failed load leaves the cache untouched rather than blanking it: a
    // stale statute book beats an empty one, and penalLoaded() still reports
    // false on a first-load failure so callers can say so.
    if (!res.error && rows.length) {
      setPenalCatalog(rows.map(toCharge), rows[0]?.version_name ?? null)
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

// ---------------------------------------------------------------------------
// Lookups and formatting — unchanged signatures, live data
// ---------------------------------------------------------------------------

/** O(1) code → statute. Null when the code is unknown OR the catalog has not
 *  loaded; `penalLoaded()` distinguishes the two. */
export const penalByCode = (code: string): PenalCharge | null => BY_CODE.get(code) ?? null

export const PENAL_LEVEL_TINT: Record<string, string> = {
  Felony: "text-rose-300 bg-rose-500/10 border-rose-500/20",
  Misdemeanor: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  Infraction: "text-slate-300 bg-white/5 border-white/10",
  Capital: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20",
}

// Sentence formatting — months → "Xy Ym", or JUDGE for capital/null.
export function penalSentence(months: number | null | undefined): string {
  if (months == null) return "JUDGE"
  const y = Math.floor(months / 12), m = months % 12
  return (y ? y + "y " : "") + (m || !y ? m + "mo" : "").trim() || "0mo"
}

// The legacy `cases.charges` jsonb totals used to live here (CaseCharge,
// PenalTotals, penalTotals). They are gone with the column's last reader.
//
// Keeping them would have been worse than dead code: penalTotals() resolved
// stored codes against the PUBLISHED catalog, so the moment a new version is
// published every case charged under the old one would silently total to
// 0mo / $0 -- no error, just a wrong number on screen. Charge totals now come
// from public.case_charge_totals(), which sums each record's own snapshot.

export const penalSearch = (q: string | null | undefined): PenalCharge[] => {
  const query = String(q || "").trim().toLowerCase()
  if (!query) return CATALOG
  return CATALOG.filter((c) => (c.code + " " + c.title + " " + c.level + " " + (c.desc || "")).toLowerCase().includes(query))
}

const RECOMMEND_STOP_WORDS = new Set(["the", "and", "for", "with", "was", "were", "that", "this", "from", "have", "has", "are", "his", "her", "him", "them", "they", "you", "your", "any", "all", "out", "not", "but", "who", "how", "one", "two", "about", "into", "than", "then", "when", "what", "will", "would", "could", "their", "there", "been", "being", "also", "such", "each", "some"])

// Recommend charges by keyword overlap between case text and each charge's
// title+description. Returns the top scored matches (codes only).
export function penalRecommend(text: string | null | undefined, limit?: number): string[] {
  const hay = String(text || "").toLowerCase()
  if (hay.trim().length < 3) return []
  const scored = CATALOG.map((c) => {
    const terms = (c.title + " " + (c.desc || "")).toLowerCase().match(/[a-z]{3,}/g) || []
    let score = 0
    const seen = new Set<string>()
    terms.forEach((t) => {
      if (RECOMMEND_STOP_WORDS.has(t) || seen.has(t)) return
      seen.add(t)
      if (hay.includes(t)) score += t.length > 5 ? 2 : 1
    })
    return { code: c.code, score }
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit || 6).map((x) => x.code)
}
