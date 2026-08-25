'use client'

/** Followed-target resolution for My Dashboard's "Watched items" panel.
 *  Extracted from the old InboxView's module-private resolveWatchItems, but
 *  re-based on BOUNDED projected fetches: one page of the viewer's own
 *  watchlist (owner-only RLS) plus one `in:{id}` projected read per target
 *  type — never the former full-table persons/vehicles/cases caches. Targets
 *  hidden by RLS (or deleted) resolve to nothing and are skipped silently,
 *  exactly like vanilla, so the panel never confirms a record exists. */
import { caseLink } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { bureauShort } from '@/lib/roles'

export type WatchRow = Tables<'watchlist'>

/** A followed target resolved through the viewer's RLS. Freshness is NOT
 *  baked in — the view derives it from the Store `watchSeen` markers so
 *  "Mark all seen" recomputes without a refetch. */
export interface WatchTarget {
  w: WatchRow
  icon: string
  title: string
  sub: string
  ts: string | null
  href: string
}

/** More followed rows than this and the oldest stop resolving — a personal
 *  follow list past 100 entries is a filing problem, not a fetch problem. */
const WATCH_LIMIT = 100

type CaseLite = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'updated_at'>
type PersonLite = Pick<Tables<'persons'>, 'id' | 'name' | 'alias' | 'status' | 'updated_at'>
type VehicleLite = Pick<Tables<'vehicles'>, 'id' | 'plate' | 'model' | 'color' | 'updated_at'>

const CASE_COLS = 'id,case_number,title,status,bureau,updated_at'
const PERSON_COLS = 'id,name,alias,status,updated_at'
const VEHICLE_COLS = 'id,plate,model,color,updated_at'

export async function fetchWatchTargets(userId: string): Promise<WatchTarget[]> {
  const watchlist = await list('watchlist', {
    eq: { user_id: userId }, order: 'created_at', ascending: false, limit: WATCH_LIMIT,
  })
  const idsOf = (t: string) => watchlist.filter((w) => w.target_type === t).map((w) => w.target_id)
  const caseIds = idsOf('case')
  const personIds = idsOf('person')
  const vehicleIds = idsOf('vehicle')

  // A failed per-type resolve hides those targets for this pass — it must
  // never sink the dashboard (the follow rows themselves are still safe).
  const [cases, persons, vehicles] = await Promise.all([
    caseIds.length
      ? list('cases', { select: CASE_COLS, in: { id: caseIds } })
          .then((r) => r as unknown as CaseLite[]).catch(() => [] as CaseLite[])
      : Promise.resolve([] as CaseLite[]),
    personIds.length
      ? list('persons', { select: PERSON_COLS, in: { id: personIds } })
          .then((r) => r as unknown as PersonLite[]).catch(() => [] as PersonLite[])
      : Promise.resolve([] as PersonLite[]),
    vehicleIds.length
      ? list('vehicles', { select: VEHICLE_COLS, in: { id: vehicleIds } })
          .then((r) => r as unknown as VehicleLite[]).catch(() => [] as VehicleLite[])
      : Promise.resolve([] as VehicleLite[]),
  ])
  const caseById = new Map(cases.map((c) => [c.id, c]))
  const personById = new Map(persons.map((p) => [p.id, p]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))

  const items: WatchTarget[] = []
  for (const w of watchlist) {
    if (w.target_type === 'case') {
      const c = caseById.get(w.target_id)
      if (c) {
        items.push({
          w, icon: '🗂️',
          title: `${c.case_number} · ${c.title || 'Untitled'}`,
          sub: `Followed case · ${bureauShort(c.bureau)} · ${c.status}`,
          ts: c.updated_at, href: caseLink(c.id),
        })
      }
    } else if (w.target_type === 'person') {
      const p = personById.get(w.target_id)
      if (p) {
        items.push({
          w, icon: '👤',
          title: p.name || 'Person',
          sub: ['Followed person', p.alias ? `“${p.alias}”` : '', p.status || ''].filter(Boolean).join(' · '),
          ts: p.updated_at, href: `/persons?q=${encodeURIComponent(p.name ?? '')}`,
        })
      }
    } else if (w.target_type === 'vehicle') {
      const v = vehicleById.get(w.target_id)
      if (v) {
        items.push({
          w, icon: '🚗',
          title: v.plate,
          sub: ['Followed plate', v.model, v.color].filter(Boolean).join(' · '),
          ts: v.updated_at, href: `/vehicles?q=${encodeURIComponent(v.plate)}`,
        })
      }
    }
  }
  return items
}
