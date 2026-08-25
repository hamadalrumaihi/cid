'use client'

/** Pinned records — per-user quick-access bookmarks, DB-backed (`user_pins`,
 *  owner-only RLS) so pins follow the member across devices. Pinning never
 *  widens access: a pinned target the viewer can no longer see simply fails
 *  its title lookup at render time and is dropped from the strip (ids only
 *  are stored — never titles, counts or data). Distinct from the Follow
 *  watchlist (`watchlist.ts`): follow = "tell me about updates on My Desk",
 *  pin = "keep this one click away". */
import { create } from 'zustand'
import { insert, list, removeWhere } from './db'
import type { Tables } from './database.types'
import { toast } from './toast'

export type PinRow = Tables<'user_pins'>
export type PinType =
  | 'case' | 'person' | 'vehicle' | 'gang' | 'place' | 'account'
  | 'narcotic' | 'legal_request' | 'document' | 'operation' | 'field_submission'

/** Soft cap — keeps the strip a strip. The oldest pin is dropped when a new
 *  one would exceed it (the server does not enforce a cap). */
export const MAX_PINS = 24

interface PinsState {
  rows: PinRow[]
  loaded: boolean
  fetch: () => Promise<void>
  isPinned: (type: PinType, id: string) => boolean
  toggle: (type: PinType, id: string, label?: string) => Promise<void>
}

export const usePinsStore = create<PinsState>((set, get) => ({
  rows: [],
  loaded: false,
  async fetch() {
    try {
      const rows = await list('user_pins', { order: 'created_at', ascending: false })
      set({ rows, loaded: true })
    } catch { set({ rows: [], loaded: true }) }
  },
  isPinned(type, id) {
    return get().rows.some((p) => p.target_type === type && p.target_id === id)
  },
  async toggle(type, id, label) {
    const existing = get().rows.find((p) => p.target_type === type && p.target_id === id)
    if (existing) {
      const res = await removeWhere('user_pins', { eq: { target_type: type, target_id: id } })
      if (res.error) { toast(`Unpin failed: ${res.error.message}`, 'danger'); return }
      set((s) => ({ rows: s.rows.filter((p) => !(p.target_type === type && p.target_id === id)) }))
      toast(`Unpinned${label ? ' ' + label : ''}`, 'info')
      return
    }
    const res = await insert('user_pins', { target_type: type, target_id: id })
    if (res.error) {
      // Double-click race on the composite PK — treat as already pinned.
      if (/duplicate|unique|23505/i.test(res.error.message)) { await get().fetch(); return }
      toast(`Pin failed: ${res.error.message}`, 'danger')
      return
    }
    if (res.data?.[0]) set((s) => ({ rows: [res.data![0], ...s.rows] }))
    else await get().fetch()
    const over = get().rows.slice(MAX_PINS)
    for (const p of over) {
      void removeWhere('user_pins', { eq: { target_type: p.target_type, target_id: p.target_id } })
    }
    if (over.length) set((s) => ({ rows: s.rows.slice(0, MAX_PINS) }))
    toast(`Pinned${label ? ' ' + label : ''}`, 'success')
  },
}))
