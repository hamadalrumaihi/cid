/** The Penal Code as a workspace rather than a list.
 *
 *  Pure model — vocabulary, filtering, grouping and comparison. No React, no
 *  I/O, so every rule here is unit-testable (the docModel / fieldReview
 *  pattern).
 *
 *  ── What this deliberately does NOT do ────────────────────────────────────
 *  The brief asks a charge card to show required legal ELEMENTS, the evidence
 *  that commonly supports each one, applicable enhancements, and lesser or
 *  mutually exclusive offenses. None of that exists as data: `penal_charges`
 *  carries penalties, class, RICO flags, arrest requirement, substance schedule
 *  and the statutory definition, and nothing else. Those fields would have to
 *  be AUTHORED by somebody with the authority to say what the elements of an
 *  offense are.
 *
 *  Generating them would mean inventing legal requirements and presenting them
 *  next to real statutory text, where nothing on screen would distinguish the
 *  two. So the card shows what the code actually says, and the gap is stated
 *  rather than filled.
 */

import type { PenalCharge } from './penal'

// ---------------------------------------------------------------------------
// The penalty, said honestly
// ---------------------------------------------------------------------------

/** "A judge decides" is not zero, and an empty cell is not "no fine".
 *
 *  The database keeps the penalty NULL and raises judge_set_fine /
 *  judge_set_jail exactly so a total can never quietly count a judge-set
 *  penalty as nothing. The card has to be as careful as the column. */
export function fineLabel(c: PenalCharge): string {
  if (c.judgeFine) return 'Set by the judge'
  if (c.fine == null) return 'Not stated'
  return `$${c.fine.toLocaleString('en-US')}`
}

export function jailLabel(c: PenalCharge): string {
  if (c.judgeJail) return 'Set by the judge'
  if (c.jail == null) return 'Not stated'
  if (c.jail === 0) return 'No custodial term'
  const y = Math.floor(c.jail / 12)
  const m = c.jail % 12
  return [y ? `${y}y` : '', m ? `${m}mo` : ''].filter(Boolean).join(' ') || '0mo'
}

/** How a charge is brought. Null in the data means the published code does not
 *  address it -- which is different from "a citation will do". */
export function arrestLabel(c: PenalCharge): string {
  return c.arrest === true ? 'Arrest required' : 'The code does not say'
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface ChargeFilters {
  q: string
  level: string | null
  /** Only offenses the code says require an arrest. */
  arrestOnly: boolean
  /** Anything RICO-related: a modifier or a designated predicate act. */
  ricoOnly: boolean
  /** Offenses that stack with others. */
  stackableOnly: boolean
  /** Controlled-substance schedule 1-3. */
  schedule: number | null
  /** Hide offenses PD cannot charge. */
  hidePdExempt: boolean
}

export const NO_FILTERS: ChargeFilters = {
  q: '', level: null, arrestOnly: false, ricoOnly: false,
  stackableOnly: false, schedule: null, hidePdExempt: false,
}

/** Which filters can actually match something in the code that is in force.
 *
 *  The 2026 code records an arrest requirement for NONE of its 195 offenses --
 *  arrest_required is null throughout, meaning the version is silent rather
 *  than permissive. An "Arrest required" checkbox would therefore be a control
 *  that always returns nothing, which is the same defect as a predicate picker
 *  offered against a code that designates no predicates.
 *
 *  Derived from the loaded catalog rather than hardcoded, so a future version
 *  that does record arrests lights the filter up on its own. */
export interface FilterAvailability {
  arrest: boolean
  rico: boolean
  stackable: boolean
  pdExempt: boolean
  schedules: number[]
}

export function filterAvailability(charges: PenalCharge[]): FilterAvailability {
  return {
    arrest: charges.some((c) => c.arrest === true),
    rico: charges.some((c) => c.rico),
    stackable: charges.some((c) => c.stack),
    pdExempt: charges.some((c) => c.pdExempt),
    schedules: [...new Set(charges
      .map((c) => c.schedule)
      .filter((n): n is number => n != null))].sort((a, b) => a - b),
  }
}

export function activeFilterCount(f: ChargeFilters): number {
  return [
    f.level, f.arrestOnly || null, f.ricoOnly || null, f.stackableOnly || null,
    f.schedule, f.hidePdExempt || null,
  ].filter(Boolean).length
}

export function matchesCharge(c: PenalCharge, f: ChargeFilters): boolean {
  const q = f.q.trim().toLowerCase()
  if (q) {
    const hay = `${c.code} ${c.title} ${c.level} ${c.penalTitle ?? ''} ${c.desc ?? ''} ${c.notes ?? ''}`
    if (!hay.toLowerCase().includes(q)) return false
  }
  if (f.level && c.level !== f.level) return false
  // `arrest` is only ever true or absent: the column is nullable because a
  // version that says nothing about arrest is different from one that says a
  // citation is enough, and filtering must not turn silence into a claim.
  if (f.arrestOnly && c.arrest !== true) return false
  if (f.ricoOnly && !c.rico) return false
  if (f.stackableOnly && !c.stack) return false
  if (f.schedule != null && c.schedule !== f.schedule) return false
  if (f.hidePdExempt && c.pdExempt) return false
  return true
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface TitleGroup { title: string; charges: PenalCharge[] }

/** Group by the title of the code, which is how the statute book is actually
 *  organised and the reason the flat list was hard to browse. Offenses with no
 *  recorded title collect at the end rather than vanishing. */
export function byPenalTitle(charges: PenalCharge[]): TitleGroup[] {
  const groups = new Map<string, PenalCharge[]>()
  for (const c of charges) {
    const key = c.penalTitle?.trim() || 'Uncategorised'
    const list = groups.get(key)
    if (list) list.push(c)
    else groups.set(key, [c])
  }
  return [...groups.entries()]
    .map(([title, cs]) => ({ title, charges: cs }))
    .sort((a, b) =>
      a.title === 'Uncategorised' ? 1
        : b.title === 'Uncategorised' ? -1
        : a.title.localeCompare(b.title, 'en'))
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  label: string
  values: string[]
  /** True when the charges genuinely differ on this row -- the only reason to
   *  put two offenses side by side is to see where they part company. */
  differs: boolean
}

export const MAX_COMPARE = 3

export function compareCharges(charges: PenalCharge[]): ComparisonRow[] {
  if (charges.length < 2) return []
  const rows: [string, (c: PenalCharge) => string][] = [
    ['Code', (c) => c.code || 'None recorded'],
    ['Title of code', (c) => c.penalTitle ?? 'Not recorded'],
    ['Class', (c) => c.level],
    ['Custodial term', jailLabel],
    ['Fine', fineLabel],
    ['How it is brought', arrestLabel],
    ['Stacks with others', (c) => (c.stack ? 'Yes' : 'No')],
    ['Modifier', (c) => (c.modifier ? 'Yes' : 'No')],
    ['RICO', (c) => (c.predicate ? 'Designated predicate act' : c.rico ? 'RICO modifier' : 'No')],
    ['Substance schedule', (c) => (c.schedule != null ? `Schedule ${c.schedule}` : 'Not applicable')],
    ['Chargeable by PD', (c) => (c.pdExempt ? 'No' : 'Yes')],
  ]
  return rows.map(([label, read]) => {
    const values = charges.map(read)
    return { label, values, differs: new Set(values).size > 1 }
  })
}
