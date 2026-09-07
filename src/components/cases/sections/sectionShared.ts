/** Small helpers shared by the Phase 3 case sections (P3-03/04/06). Pure —
 *  nothing here touches the network. */
import type { Tables } from '@/lib/database.types'
import type { MutationResult } from '@/lib/db'
import { cellText } from '@/components/entity/labels'

/** The registry link kinds that have their own case section. */
export type EntitySectionKind = 'person' | 'vehicle' | 'gang' | 'place'

export const ENTITY_SECTION: Record<EntitySectionKind, {
  table: 'persons' | 'vehicles' | 'gangs' | 'places'
  /** The column that names the record in chips and pickers. */
  labelColumn: 'name' | 'plate'
  one: string
  many: string
  /** EntityCreateSheet prefill key for the typed query. */
  createKey: 'name' | 'plate'
}> = {
  person: { table: 'persons', labelColumn: 'name', one: 'person', many: 'People', createKey: 'name' },
  vehicle: { table: 'vehicles', labelColumn: 'plate', one: 'vehicle', many: 'Vehicles', createKey: 'plate' },
  gang: { table: 'gangs', labelColumn: 'name', one: 'gang', many: 'Gangs', createKey: 'name' },
  place: { table: 'places', labelColumn: 'name', one: 'location', many: 'Locations', createKey: 'name' },
}

/** Id deep-link to a linked record's dossier — the canonical query-param
 *  shapes each registry reads (`?person=`/`?gang=`/`?place=`/`?drug=`).
 *  Account-kind rows land on the Accounts registry; an unknown kind renders
 *  as plain text. */
export function recordHref(kind: string, id: string): string | null {
  switch (kind) {
    case 'person': return `/persons?person=${encodeURIComponent(id)}`
    case 'vehicle': return `/vehicles?vehicle=${encodeURIComponent(id)}`
    case 'gang': return `/gangs?gang=${encodeURIComponent(id)}`
    case 'place': return `/places?place=${encodeURIComponent(id)}`
    case 'narcotic': return `/narcotics?drug=${encodeURIComponent(id)}`
    case 'account': return '/accounts'
    default: return null
  }
}

/** Why a write did not land, or null when it did. An archived case (and any
 *  other RLS refusal) answers either 42501 or ZERO ROWS rather than an
 *  error — both must read as a refusal, never as success. */
export function writeRefusal(res: MutationResult<unknown[] | null>): string | null {
  if (res.error) {
    if (res.error.code === '42501') return 'You are not permitted to make this change.'
    return res.error.message
  }
  if (Array.isArray(res.data) && res.data.length === 0) return 'The server refused this change — the case may be archived or read-only.'
  return null
}

/** "INSERT" → "added", "CASE_ARCHIVED" → "case archived". */
export function actionVerb(action: string): string {
  switch (action) {
    case 'INSERT': return 'added'
    case 'UPDATE': return 'updated'
    case 'DELETE': return 'removed'
    case 'SOFT_DELETE': return 'moved to the Trash'
    case 'RESTORE': return 'restored'
  }
  return action.toLowerCase().replace(/_/g, ' ')
}

/** "case_intel_link" → "intel link", "rico_case" → "RICO tracker". */
export function entityKindLabel(kind: string): string {
  switch (kind) {
    case 'case': return 'case'
    case 'case_intel_link': return 'intel link'
    case 'case_note': return 'note'
    case 'case_link': return 'related case'
    case 'case_task': return 'task'
    case 'case_blocker': return 'blocker'
    case 'case_assignment': return 'assignment'
    case 'case_access_grant': return 'access grant'
    case 'rico_case': return 'RICO tracker'
    case 'raid_compensation': return 'raid compensation'
  }
  return kind.replace(/_/g, ' ')
}

export type MasterRow = Record<string, unknown> & { id: string }

/** The latest observation per field on this case whose value is not what
 *  the master record currently says — the "differs from record" markers.
 *  Rows arrive newest-first. A master the viewer cannot read yields nothing
 *  (there is nothing to compare against). */
export function differingObservations<T extends Pick<Tables<'entity_field_observations'>, 'id' | 'field' | 'value'>>(
  master: MasterRow | undefined,
  rows: readonly T[],
): T[] {
  if (!master) return []
  const seen = new Set<string>()
  const out: T[] = []
  for (const o of rows) {
    if (seen.has(o.field)) continue
    seen.add(o.field)
    if (o.value.trim() !== cellText(master[o.field]).trim()) out.push(o)
  }
  return out
}

/** Pinned first, then newest — the case_notes index's own order. Pure. */
export function orderNotes<T extends { pinned: boolean; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
}
