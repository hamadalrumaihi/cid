'use client'

/** Follow / Watchlist — port of vanilla watchlist.js. A per-member, opt-in
 *  follow list; following never widens access (targets stay bureau-isolated
 *  by their own RLS). Backed by the `watchlist` table (owner-only RLS). */
import { create } from 'zustand'
import { insert, list, remove } from './db'
import type { Tables } from './database.types'
import { Store } from './store'
import { toast } from './toast'

export type WatchRow = Tables<'watchlist'>
export type WatchType = 'case' | 'person' | 'vehicle'

/** "Last seen" per followed target — a personal read-marker in the shared
 *  Store blob (same `watchSeen` key as vanilla). */
export function markWatchSeen(type: WatchType, id: string, ts?: string): void {
  const m = Store.get<Record<string, string>>('watchSeen', {})
  Store.set('watchSeen', { ...m, [`${type}:${id}`]: ts || new Date().toISOString() })
}

interface WatchlistState {
  rows: WatchRow[]
  loaded: boolean
  fetch: () => Promise<void>
  isWatched: (type: WatchType, id: string) => boolean
  toggle: (type: WatchType, id: string, label?: string) => Promise<void>
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  rows: [],
  loaded: false,
  async fetch() {
    try {
      const rows = await list('watchlist', { order: 'created_at', ascending: false })
      set({ rows, loaded: true })
    } catch { set({ rows: [], loaded: true }) }
  },
  isWatched(type, id) {
    return get().rows.some((w) => w.target_type === type && w.target_id === id)
  },
  async toggle(type, id, label) {
    const existing = get().rows.find((w) => w.target_type === type && w.target_id === id)
    if (existing) {
      const res = await remove('watchlist', existing.id)
      if (res.error) { toast(`Unfollow failed: ${res.error.message}`, 'danger'); return }
      set((s) => ({ rows: s.rows.filter((w) => w.id !== existing.id) }))
      toast(`Unfollowed${label ? ' ' + label : ''}`, 'info')
      return
    }
    const res = await insert('watchlist', { target_type: type, target_id: id })
    if (res.error) {
      // A double-click race can hit the unique index — treat as already-following.
      if (/duplicate|unique|23505/i.test(res.error.message)) { await get().fetch(); return }
      toast(`Follow failed: ${res.error.message}`, 'danger')
      return
    }
    if (res.data?.[0]) set((s) => ({ rows: [res.data![0], ...s.rows] }))
    else await get().fetch()
    markWatchSeen(type, id) // following it now = you've seen its current state
    toast(`Following${label ? ' ' + label : ''} — updates show on My Desk`, 'success')
  },
}))
