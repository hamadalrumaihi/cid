'use client'

/** Per-user saved views — named snapshots of client-side filter state,
 *  persisted in `user_prefs` (owner-only RLS; key ≤100 chars, value ≤32KiB
 *  jsonb) so views follow the member across devices. One row per section:
 *  key `views:<section>`, value `{ views: [{ name, config, isDefault? }] }`.
 *  `config` is OPAQUE, caller-shaped JSON — this module never interprets it.
 *
 *  SECURITY: a saved view only re-applies CLIENT filter state. It never
 *  widens access — RLS still decides which rows any re-applied filter can
 *  match, exactly as if the user had clicked the filters by hand.
 *
 *  Server is the source of truth. One-time migration: the cases area used to
 *  keep saved views in the localStorage Store blob (key 'caseViews', shape
 *  [{name, filters, scope?, q?}]). On the FIRST load of section 'cases' with
 *  no server row, those entries are lifted into user_prefs; the local copy is
 *  left in place as an offline fallback (and for the legacy site). */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { Json } from './database.types'
import { list, upsert } from './db'
import { Store } from './store'
import { toast } from './toast'
import { uiPrompt } from '@/components/ui/dialog'

export interface SavedView<C = unknown> {
  name: string
  config: C
  isDefault?: boolean
}

export const viewsPrefKey = (section: string): string => `views:${section}`

/** Select usability + jsonb-size guardrails (server caps value at 32KiB). */
export const MAX_VIEWS_PER_SECTION = 30
export const MAX_VIEW_NAME_LEN = 60
const MAX_VALUE_BYTES = 30_000 // headroom under the 32KiB user_prefs cap

/* ---- Pure shaping (unit-tested, offline-safe) ---------------------------- */

/** Parse a user_prefs value into a clean view list: entries need a non-empty
 *  string name and a defined config; duplicate names keep the first; at most
 *  ONE view keeps isDefault (the first marked). Garbage in → []. */
export function parseViewsValue(value: unknown): SavedView[] {
  const raw = (value as { views?: unknown } | null | undefined)?.views
  if (!Array.isArray(raw)) return []
  const out: SavedView[] = []
  const seen = new Set<string>()
  let hasDefault = false
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const { name, config, isDefault } = v as Partial<SavedView>
    if (typeof name !== 'string') continue
    const clean = name.trim().slice(0, MAX_VIEW_NAME_LEN)
    if (!clean || seen.has(clean) || config === undefined) continue
    seen.add(clean)
    const entry: SavedView = { name: clean, config }
    if (isDefault === true && !hasDefault) { entry.isDefault = true; hasDefault = true }
    out.push(entry)
  }
  return out.slice(0, MAX_VIEWS_PER_SECTION)
}

/** Add or replace (by name). A replaced default stays the default. */
export function upsertViewIn<C>(views: SavedView<C>[], name: string, config: C): SavedView<C>[] {
  const existing = views.find((v) => v.name === name)
  const next: SavedView<C> = { name, config }
  if (existing?.isDefault) next.isDefault = true
  return existing
    ? views.map((v) => (v.name === name ? next : v))
    : [...views, next]
}

/** Rename `from` → `to`. A pre-existing view named `to` is overwritten
 *  (same replace-by-name semantics as saving under that name). */
export function renameViewIn<C>(views: SavedView<C>[], from: string, to: string): SavedView<C>[] {
  if (from === to || !views.some((v) => v.name === from)) return views
  return views
    .filter((v) => v.name !== to)
    .map((v) => (v.name === from ? { ...v, name: to } : v))
}

export function removeViewIn<C>(views: SavedView<C>[], name: string): SavedView<C>[] {
  return views.filter((v) => v.name !== name)
}

/** Mark exactly one view (or none) as the section default. */
export function withDefault<C>(views: SavedView<C>[], name: string | null): SavedView<C>[] {
  return views.map((v) => {
    if (name !== null && v.name === name) return { ...v, isDefault: true }
    if (!v.isDefault) return v
    const rest = { ...v }
    delete rest.isDefault
    return rest
  })
}

export const defaultViewOf = <C,>(views: SavedView<C>[]): SavedView<C> | null =>
  views.find((v) => v.isDefault) ?? null

export const serializeViews = (views: SavedView[]): Json =>
  ({ views } as unknown as Json)

/** Would this list fit the user_prefs value cap (with headroom)? */
export function viewsFitLimit(views: SavedView[]): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(serializeViews(views))).length <= MAX_VALUE_BYTES
  } catch { return false }
}

/** One-time lift of the legacy localStorage cases views (Store 'caseViews',
 *  [{name, filters, scope?, q?}]) into the generic SavedView shape. */
export function legacyCaseViewsToSaved(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return []
  const shaped = raw
    .filter((v): v is { name: string; filters?: unknown; scope?: unknown; q?: unknown } =>
      !!v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string')
    .map((v) => ({
      name: v.name,
      config: {
        filters: (v.filters && typeof v.filters === 'object') ? v.filters : {},
        ...(typeof v.scope === 'string' ? { scope: v.scope } : {}),
        ...(typeof v.q === 'string' ? { q: v.q } : {}),
      },
    }))
  return parseViewsValue({ views: shaped })
}

/* ---- Store (fetch / cache / optimistic writes) --------------------------- */

interface SectionState { views: SavedView[]; loaded: boolean }
interface SavedViewsState {
  sections: Record<string, SectionState>
  inflight: Record<string, boolean>
}

const useSavedViewsStore = create<SavedViewsState>(() => ({ sections: {}, inflight: {} }))

const setSection = (section: string, views: SavedView[]) =>
  useSavedViewsStore.setState((s) => ({ sections: { ...s.sections, [section]: { views, loaded: true } } }))

/** Fetch a section's views (cached — refetches only on a fresh session).
 *  Offline / signed out degrades to the local fallback, never throws. */
export async function loadViews(section: string): Promise<SavedView[]> {
  const st = useSavedViewsStore.getState()
  if (st.sections[section]?.loaded) return st.sections[section].views
  if (st.inflight[section]) return st.sections[section]?.views ?? []
  useSavedViewsStore.setState((s) => ({ inflight: { ...s.inflight, [section]: true } }))
  try {
    const rows = await list('user_prefs', { eq: { key: viewsPrefKey(section) } })
    let views = rows.length ? parseViewsValue(rows[0].value) : []
    if (!rows.length && section === 'cases') {
      // Migrate-on-first-load: no server row yet, but the legacy local blob
      // may hold views from the vanilla site — lift them up once. The local
      // copy is intentionally NOT cleared (offline/legacy fallback).
      const legacy = legacyCaseViewsToSaved(Store.get<unknown>('caseViews', null))
      if (legacy.length) {
        views = legacy
        void upsert('user_prefs', { key: viewsPrefKey(section), value: serializeViews(views) }, 'user_id,key')
      }
    }
    setSection(section, views)
    return views
  } catch {
    // No session / network blip: cases falls back to the legacy local views.
    const fallback = section === 'cases'
      ? legacyCaseViewsToSaved(Store.get<unknown>('caseViews', null))
      : []
    setSection(section, fallback)
    return fallback
  } finally {
    useSavedViewsStore.setState((s) => ({ inflight: { ...s.inflight, [section]: false } }))
  }
}

/** Optimistic write-through: apply locally, upsert, revert + toast on error. */
async function persistViews(section: string, next: SavedView[]): Promise<boolean> {
  if (next.length > MAX_VIEWS_PER_SECTION) {
    toast(`Saved-view limit reached (${MAX_VIEWS_PER_SECTION} per area). Delete one first.`, 'warn')
    return false
  }
  if (!viewsFitLimit(next)) {
    toast('Saved views are too large to store — delete an old view first.', 'warn')
    return false
  }
  const prev = useSavedViewsStore.getState().sections[section]?.views ?? []
  setSection(section, next)
  const res = await upsert('user_prefs', { key: viewsPrefKey(section), value: serializeViews(next) }, 'user_id,key')
  if (res.error) {
    setSection(section, prev)
    toast(`Could not save view: ${res.error.message}`, 'danger')
    return false
  }
  return true
}

export async function saveView(section: string, name: string, config: unknown): Promise<boolean> {
  const clean = name.trim().slice(0, MAX_VIEW_NAME_LEN)
  if (!clean) return false
  await loadViews(section)
  const views = useSavedViewsStore.getState().sections[section]?.views ?? []
  return persistViews(section, upsertViewIn(views, clean, config))
}

export async function renameView(section: string, from: string, to: string): Promise<boolean> {
  const clean = to.trim().slice(0, MAX_VIEW_NAME_LEN)
  if (!clean || clean === from) return false
  const views = useSavedViewsStore.getState().sections[section]?.views ?? []
  return persistViews(section, renameViewIn(views, from, clean))
}

export async function deleteView(section: string, name: string): Promise<boolean> {
  const views = useSavedViewsStore.getState().sections[section]?.views ?? []
  return persistViews(section, removeViewIn(views, name))
}

/** Mark `name` as the section default (applied on first visit when no other
 *  filters are active) — or clear the default with null. One default max. */
export async function setDefaultView(section: string, name: string | null): Promise<boolean> {
  const views = useSavedViewsStore.getState().sections[section]?.views ?? []
  return persistViews(section, withDefault(views, name))
}

/* ---- Hook ----------------------------------------------------------------- */

export interface SavedViewsApi<C> {
  views: SavedView<C>[]
  loaded: boolean
  defaultView: SavedView<C> | null
  save: (name: string, config: C) => Promise<boolean>
  rename: (from: string, to: string) => Promise<boolean>
  remove: (name: string) => Promise<boolean>
  setDefault: (name: string | null) => Promise<boolean>
  /** uiPrompt for a name, then save — resolves the saved name (or null). */
  saveViaPrompt: (config: C, promptText?: string) => Promise<string | null>
  /** uiPrompt for a new name, then rename — resolves the new name (or null). */
  renameViaPrompt: (name: string) => Promise<string | null>
}

export function useSavedViews<C = unknown>(section: string): SavedViewsApi<C> {
  const state = useSavedViewsStore((s) => s.sections[section])
  useEffect(() => { queueMicrotask(() => { void loadViews(section) }) }, [section])
  const views = useMemo(() => (state?.views ?? []) as SavedView<C>[], [state])
  return {
    views,
    loaded: state?.loaded ?? false,
    defaultView: defaultViewOf(views),
    save: (name, config) => saveView(section, name, config),
    rename: (from, to) => renameView(section, from, to),
    remove: (name) => deleteView(section, name),
    setDefault: (name) => setDefaultView(section, name),
    saveViaPrompt: async (config, promptText = 'Name this view.') => {
      const name = await uiPrompt(promptText, { title: 'Save view', placeholder: 'e.g. My follow-ups', confirmText: 'Save' })
      const clean = name?.trim().slice(0, MAX_VIEW_NAME_LEN) ?? ''
      if (!clean) return null
      const ok = await saveView(section, clean, config)
      if (ok) toast('View saved.', 'success')
      return ok ? clean : null
    },
    renameViaPrompt: async (name) => {
      const next = await uiPrompt(`Rename view "${name}".`, { title: 'Rename view', value: name, confirmText: 'Rename' })
      const clean = next?.trim().slice(0, MAX_VIEW_NAME_LEN) ?? ''
      if (!clean || clean === name) return null
      const ok = await renameView(section, name, clean)
      if (ok) toast('View renamed.', 'success')
      return ok ? clean : null
    },
  }
}
