/** Runtime shape-checks for the JSON columns we read back from Supabase.
 *  These columns are written by the app but stored as loose `jsonb` — a
 *  migration script, a manual SQL edit, or an old vanilla-era row can hand
 *  back any shape. Every read boundary goes through one of these parsers:
 *  malformed entries are dropped and wholesale-wrong values degrade to the
 *  empty fallback, so a bad row renders as "empty" instead of crashing the
 *  screen. (Hand-rolled on purpose — the shapes are tiny and this keeps the
 *  dependency surface at zero.) */

import type { CaseCharge } from '@/lib/penal'
import type { FormValues } from '@/lib/forms'

/** `cases.charges` — an array of `{ code, count? }`. Entries without a
 *  string `code` are dropped; a non-numeric `count` becomes 1. */
export function parseCharges(v: unknown): CaseCharge[] {
  if (!Array.isArray(v)) return []
  const out: CaseCharge[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const code = (x as { code?: unknown }).code
    if (typeof code !== 'string' || !code) continue
    const count = (x as { count?: unknown }).count
    out.push({ code, count: typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 1 })
  }
  return out
}

/** `reports.fields` — a string-keyed value map. Arrays/scalars degrade to `{}`. */
export function parseFormValues(v: unknown): FormValues {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as FormValues
}

/** String-array columns (`feedback_meta.tags`, `case_messages.mentions`):
 *  keeps only the string elements. */
export function parseStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** `gangs.intelligence_summary` — a string-keyed map of section → text. Any
 *  non-string value is dropped so a malformed row renders as an empty summary
 *  (falling back to the legacy `notes`) rather than crashing the dossier.
 *  `persons.intelligence_summary` (20260729010000) stores the exact same
 *  section → text record shape, so the Persons workspace reuses this parser
 *  as-is — no persons-specific duplicate. */
export function parseIntelSummary(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[k] = val
  }
  return out
}

/** `persons.identity` — the documented (not SQL-enforced) shape from the
 *  person-intelligence migration 20260729010000: alias/street-name/ID string
 *  arrays plus free-text occupation and notes. */
export interface PersonIdentity {
  aliases: string[]
  street_names: string[]
  occupation: string
  distinguishing: string[]
  license_ids: string[]
  notes: string
}

/** `persons.identity` parser. Arrays keep only trimmed non-empty strings and
 *  non-arrays degrade to `[]`; the free-text fields degrade to `''`. A
 *  wholesale-wrong value (scalar, array, null) parses as an empty identity —
 *  never throws. */
export function parsePersonIdentity(v: unknown): PersonIdentity {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const strings = (x: unknown): string[] =>
    Array.isArray(x)
      ? x.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
      : []
  const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
  return {
    aliases: strings(o.aliases),
    street_names: strings(o.street_names),
    occupation: text(o.occupation),
    distinguishing: strings(o.distinguishing),
    license_ids: strings(o.license_ids),
    notes: text(o.notes),
  }
}
