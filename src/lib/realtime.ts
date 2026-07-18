'use client'

/** Realtime subscription registry — React adaptation of vanilla
 *  CIDApp.realtime.subscribeOnce (core.js:1074-1084) + CIDDB.subscribe.
 *
 *  One channel per table (`rt_<table>`), registered at most once per authed
 *  session so remounting views never double-subscribes (the vanilla
 *  rt_cases double-subscribe bug). Instead of callbacks, every change bumps a
 *  per-table version counter in a zustand store; components subscribe with
 *  useTableVersion(table) and refetch when it moves. Teardown happens on
 *  sign-out via supabase.removeAllChannels() (auth.tsx) + resetRealtime(). */
import { useEffect } from 'react'
import { create } from 'zustand'
import { isConfigured, supabase } from './supabase'

interface RtState {
  versions: Record<string, number>
  bump: (table: string) => void
}

export const useRealtimeStore = create<RtState>((set) => ({
  versions: {},
  bump: (table) => set((s) => ({ versions: { ...s.versions, [table]: (s.versions[table] ?? 0) + 1 } })),
}))

const registered = new Set<string>()

/** Per-table leading+trailing debounce for the version bumps. Contract: the
 *  FIRST event of a burst bumps immediately (a lone change stays prompt); any
 *  further events within `waitMs` collapse into ONE trailing bump after the
 *  burst goes quiet — so a bulk insert of N rows costs every subscribed view
 *  O(1) refetch cycles, not N. Exported for the unit test. */
export function createDebouncedBump(bump: (table: string) => void, waitMs = 300): (table: string) => void {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; again: boolean }>()
  return (table) => {
    const prev = pending.get(table)
    if (prev) clearTimeout(prev.timer) // mid-burst: fold into the trailing bump
    else bump(table) // leading edge — the first event of a burst is prompt
    const entry = {
      again: !!prev,
      timer: setTimeout(() => {
        pending.delete(table)
        if (entry.again) bump(table)
      }, waitMs),
    }
    pending.set(table, entry)
  }
}

const debouncedBump = createDebouncedBump((table) => useRealtimeStore.getState().bump(table))

/** Subscribe (once per session) to postgres_changes for a table. Safe to call
 *  from every mount — repeat calls are no-ops. */
export function subscribeTable(table: string): void {
  if (!isConfigured || typeof window === 'undefined' || registered.has(table)) return
  registered.add(table)
  try {
    supabase()
      .channel(`rt_${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        debouncedBump(table)
      })
      .subscribe()
  } catch {
    registered.delete(table) // allow a later retry if channel setup failed
  }
}

/** Forget local registrations after sign-out — the channels themselves are
 *  torn down by removeAllChannels() in the auth layer. */
export function resetRealtime(): void {
  registered.clear()
}

/** Version counter for a table — changes whenever any row changes. Also
 *  registers the subscription on first mount (idempotent). */
export function useTableVersion(table: string): number {
  useEffect(() => { subscribeTable(table) }, [table])
  return useRealtimeStore((s) => s.versions[table] ?? 0)
}
