/** Pure logic behind the LinkedPersonPanel completion flow: which quick
 *  profile fields are present vs missing on a persons row (isBlank — the
 *  autofill vocabulary, so "0 felonies" style falsiness can never read as
 *  missing), and the clearly-labelled provenance lines the "Case only" choice
 *  appends to the link's note. No React, no I/O — unit-tested colocated. */
import { isBlank } from '@/lib/autofill'

/** The sensible editable set for link-time completion — optional identity
 *  fields an investigator plausibly learns while working a case. All map 1:1
 *  to persons columns, so a "fill the profile" diff needs no translation. */
export type CompletionKey = 'dob' | 'phone' | 'alias' | 'classification' | 'status'

export interface CompletionFieldDef {
  key: CompletionKey
  label: string
  /** Prefix for the case-note provenance line. */
  noteLabel: string
}

export const PERSON_COMPLETION_FIELDS: readonly CompletionFieldDef[] = [
  { key: 'dob', label: 'Date of birth', noteLabel: 'DOB' },
  { key: 'phone', label: 'Phone', noteLabel: 'Phone' },
  { key: 'alias', label: 'Alias', noteLabel: 'Alias' },
  { key: 'classification', label: 'Classification', noteLabel: 'Classification' },
  { key: 'status', label: 'Status', noteLabel: 'Status' },
]

/** The completion slice of a persons row — structural, so any projection that
 *  carries these columns (RegistryPerson, the picker hydration) satisfies it. */
export type PersonCompletionRow = Partial<Record<CompletionKey, string | null>>

export interface CompletionSplit {
  /** Fields with a master value — rendered read-only ("on the profile"). */
  present: Array<{ def: CompletionFieldDef; value: string }>
  /** Fields blank on the master — rendered as small optional inputs. */
  missing: CompletionFieldDef[]
}

/** dob can arrive as a full ISO timestamp — clip to the date for display and
 *  for the date-input value shape. */
const clip = (key: CompletionKey, v: string): string => (key === 'dob' ? v.slice(0, 10) : v)

export function splitCompletionFields(row: PersonCompletionRow): CompletionSplit {
  const present: CompletionSplit['present'] = []
  const missing: CompletionFieldDef[] = []
  for (const def of PERSON_COMPLETION_FIELDS) {
    const v = row[def.key]
    if (isBlank(v)) missing.push(def)
    else present.push({ def, value: clip(def.key, String(v).trim()) })
  }
  return { present, missing }
}

/** "Case only" provenance lines, e.g. `DOB (case record): 1990-01-01` — the
 *  source marker lives in the note text itself, because case_intel_links.note
 *  is the only case-scoped field (no schema is invented for this). Ordering
 *  follows the field vocabulary, blanks are skipped, values are trimmed. */
export function caseOnlyNoteLines(proposed: Partial<Record<CompletionKey, string>>): string[] {
  const lines: string[] = []
  for (const def of PERSON_COMPLETION_FIELDS) {
    const v = proposed[def.key]
    if (isBlank(v)) continue
    lines.push(`${def.noteLabel} (case record): ${String(v).trim()}`)
  }
  return lines
}

/** Append provenance lines to the link-note buffer. '; '-joined — the note is
 *  a single-line <Input>, which strips newlines on assignment. */
export function appendNoteLines(existing: string, lines: string[]): string {
  if (!lines.length) return existing
  const head = existing.trim()
  const joined = lines.join('; ')
  return head ? `${head}; ${joined}` : joined
}
