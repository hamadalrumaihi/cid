/** Autofill / save-choice engine — pure functions behind the "use this
 *  record's details" flows. Two invariants, enforced here rather than in each
 *  form:
 *
 *    1. buildAutofill NEVER replaces a user-entered value — the master record
 *       only fills fields the user left empty.
 *    2. diffForMasterUpdate NEVER overwrites a non-empty master value and
 *       NEVER writes blanks — it is strictly "fill the master's gaps".
 *
 *  The resulting persons UPDATE goes through the normal RLS-audited update()
 *  path (lib/db) and MUST be preceded by an explicit uiConfirm — this module
 *  computes payloads only and performs no I/O. */
import { parsePersonIdentity, type PersonIdentity } from './jsonShapes'

export type FieldProvenance = 'master' | 'user' | 'empty'

/** "Empty" for autofill purposes: null / undefined / '' (after trim) / empty
 *  array. 0 and false are real values and are never treated as empty. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export interface AutofillResult<T> {
  /** The merged field values — user values verbatim, master values only where
   *  the user's field was empty. Fields empty in both are omitted. */
  values: Partial<T>
  provenance: Record<string, FieldProvenance>
  /** Fields empty in BOTH master and current — what the form still needs. */
  missing: string[]
}

export function buildAutofill<T extends Record<string, unknown>>(
  master: Partial<T>, current: Partial<T>,
): AutofillResult<T> {
  const keys = [...new Set([...Object.keys(master), ...Object.keys(current)])]
  const values: Partial<T> = {}
  const provenance: Record<string, FieldProvenance> = {}
  const missing: string[] = []
  for (const k of keys) {
    const kk = k as keyof T & string
    if (!isBlank(current[kk])) { values[kk] = current[kk]; provenance[k] = 'user' }
    else if (!isBlank(master[kk])) { values[kk] = master[kk]; provenance[k] = 'master' }
    else { provenance[k] = 'empty'; missing.push(k) }
  }
  return { values, provenance, missing }
}

/** The payload for the explicit "Update person profile" choice: ONLY fields
 *  that are empty on the master and non-empty in the proposal. A non-empty
 *  master value is never touched, and a blank can never be written. */
export function diffForMasterUpdate<T extends Record<string, unknown>>(
  master: Partial<T>, proposed: Partial<T>,
): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(proposed)) {
    const kk = k as keyof T & string
    if (!isBlank(proposed[kk]) && isBlank(master[kk])) out[kk] = proposed[kk]
  }
  return out
}

/** Append-only merge for the persons `identity` jsonb: array fields become the
 *  case-insensitive union (existing order preserved, additions appended in
 *  their given order, first spelling wins), and the free-text fields are
 *  filled only when the master's are empty. Both sides pass through the
 *  jsonShapes parser, so a malformed master row degrades to empty instead of
 *  crashing — nothing already stored can ever be removed by this. */
export function mergeIdentityArrays(
  masterIdentity: unknown, additions: Partial<PersonIdentity>,
): PersonIdentity {
  const base = parsePersonIdentity(masterIdentity)
  const add = parsePersonIdentity(additions)
  const union = (a: string[], b: string[]): string[] => {
    const seen = new Set(a.map((s) => s.toLowerCase()))
    const out = [...a]
    for (const s of b) {
      const key = s.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s)
    }
    return out
  }
  return {
    aliases: union(base.aliases, add.aliases),
    street_names: union(base.street_names, add.street_names),
    distinguishing: union(base.distinguishing, add.distinguishing),
    license_ids: union(base.license_ids, add.license_ids),
    occupation: base.occupation || add.occupation,
    notes: base.notes || add.notes,
  }
}
