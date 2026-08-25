'use client'

/** Recently opened records — a device-local, ids-only trail (Store blob, same
 *  mechanism as the existing `recentCases` key it generalizes). Never store
 *  titles, counts or data: consumers re-resolve labels through the viewer's
 *  RLS-scoped client at render time, so a record the viewer lost access to
 *  silently disappears instead of leaking its former title. Push ONLY on a
 *  deliberate open (a click that lands on the record) — never from passive
 *  background loading. */
import { Store } from './store'
import type { PinType } from './pins'

export type RecentType = PinType
export interface RecentEntry { type: RecentType; id: string; at: number }

const KEY = 'recentRecords'
const CAP = 20

export function recentRecords(): RecentEntry[] {
  const rows = Store.get<RecentEntry[]>(KEY, [])
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.type === 'string') : []
}

/** Record a deliberate open. Dedupes on (type,id), most recent first. */
export function pushRecent(type: RecentType, id: string): void {
  if (!id) return
  const rest = recentRecords().filter((r) => !(r.type === type && r.id === id))
  Store.set(KEY, [{ type, id, at: Date.now() }, ...rest].slice(0, CAP))
}

/** Drop one entry (e.g. its RLS title lookup came back empty). */
export function dropRecent(type: RecentType, id: string): void {
  Store.set(KEY, recentRecords().filter((r) => !(r.type === type && r.id === id)))
}

/** "Clear my history" — the user-facing wipe. */
export function clearRecents(): void {
  Store.set(KEY, [])
}
