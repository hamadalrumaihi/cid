'use client'

/** Feature flags (platform upgrade §2.1). The `feature_flags` table is the
 *  one switchboard for the optional services (Stirling, Crawl4AI, Docling,
 *  Meilisearch, embeddings …) and the client-only capabilities that ship on.
 *  Every signed-in member reads every row (RLS: select to authenticated);
 *  only the Owner flips one, through the `feature_flag_set` RPC (audited
 *  FEATURE_FLAG_SET). Realtime publishes the table, so a flip lands on
 *  every open session within a debounce.
 *
 *  Precedence: `NEXT_PUBLIC_ENABLE_<KEY>=on|off` (a build-time env override)
 *  wins over the row; the row wins over the default (off). The override is
 *  the escape hatch for a preview deployment that must exercise a service the
 *  live row keeps dark — it never widens data access (RLS is the wall; a flag
 *  only decides which adapter the client calls).
 *
 *  Pure pieces (`resolveFlag`, `envOverride`) are exported for the unit test;
 *  React surfaces use `useFlag(key)` / `useFeatureFlags()`. */
import { useEffect } from 'react'
import { create } from 'zustand'
import { list, rpc, type DbError } from './db'
import { useTableVersion } from './realtime'

export const FEATURE_FLAG_KEYS = [
  'stirling_pdf', 'crawl4ai', 'document_processing', 'advanced_graph', 'meilisearch',
  'semantic_search', 'evidence_sealing', 'openfga', 'advanced_editor', 'ai_assistant',
] as const
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number]

export const isFeatureFlagKey = (v: unknown): v is FeatureFlagKey =>
  typeof v === 'string' && (FEATURE_FLAG_KEYS as readonly string[]).includes(v)

/** What each flag enables and which service it needs — the Owner panel's
 *  copy and the reason a flag stays dark on a bare Supabase deployment. */
export const FEATURE_FLAG_META: Record<FeatureFlagKey, { label: string; enables: string; needs: string | null }> = {
  stirling_pdf: { label: 'Stirling PDF', enables: 'The full Document Tools grid (OCR, compress, redact, sanitize, compare …) on the Documents tab.', needs: 'Stirling PDF service + worker' },
  crawl4ai: { label: 'Crawl4AI', enables: 'Browser-rendered fetches for external sources (JavaScript-heavy pages, cleaner markdown).', needs: 'Crawl4AI service + worker' },
  document_processing: { label: 'Document processing', enables: 'Docling extraction for evidence documents (structure, tables, better page text than the runner fallback).', needs: 'Docling service + worker' },
  advanced_graph: { label: 'Investigation graph', enables: 'The Cytoscape investigation graph (expand, paths, focus, export).', needs: null },
  meilisearch: { label: 'Meilisearch index', enables: 'Index candidates for document and source search; every hit is re-authorized in Postgres.', needs: 'Meilisearch + the search-query function' },
  semantic_search: { label: 'Semantic search', enables: 'The “Semantic” toggle in the search palette (embeddings over pgvector).', needs: 'An embeddings provider + the semantic-query function' },
  evidence_sealing: { label: 'Evidence sealing', enables: 'The Seal action on verified evidence (immutable, hash-chained custody).', needs: null },
  openfga: { label: 'OpenFGA', enables: 'Reserved — evaluated and rejected; nothing reads this flag.', needs: 'Not deployed' },
  advanced_editor: { label: 'Advanced report editor', enables: 'Slash commands, entity blocks, tables, underline and links in the narrative editor.', needs: null },
  ai_assistant: { label: 'AI assistant', enables: 'Reserved for a future authorization-first assistant pipeline; nothing reads this flag.', needs: 'Not deployed' },
}

/** `NEXT_PUBLIC_ENABLE_<KEY>` → true/false, or null when unset / not
 *  `on`|`off`. Next inlines `process.env.NEXT_PUBLIC_*` only for literal
 *  member accesses, so the ten keys are spelled out — a dynamic
 *  `process.env[name]` would always be undefined in the browser. */
const ENV_OVERRIDES: Record<FeatureFlagKey, string | undefined> = {
  stirling_pdf: process.env.NEXT_PUBLIC_ENABLE_STIRLING_PDF,
  crawl4ai: process.env.NEXT_PUBLIC_ENABLE_CRAWL4AI,
  document_processing: process.env.NEXT_PUBLIC_ENABLE_DOCUMENT_PROCESSING,
  advanced_graph: process.env.NEXT_PUBLIC_ENABLE_ADVANCED_GRAPH,
  meilisearch: process.env.NEXT_PUBLIC_ENABLE_MEILISEARCH,
  semantic_search: process.env.NEXT_PUBLIC_ENABLE_SEMANTIC_SEARCH,
  evidence_sealing: process.env.NEXT_PUBLIC_ENABLE_EVIDENCE_SEALING,
  openfga: process.env.NEXT_PUBLIC_ENABLE_OPENFGA,
  advanced_editor: process.env.NEXT_PUBLIC_ENABLE_ADVANCED_EDITOR,
  ai_assistant: process.env.NEXT_PUBLIC_ENABLE_AI_ASSISTANT,
}

/** Parse one override value: `on` → true, `off` → false, anything else →
 *  null (no override). Case-insensitive, whitespace-tolerant. */
export function parseOverride(raw: string | undefined | null): boolean | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'on' ? true : v === 'off' ? false : null
}

export function envOverride(key: FeatureFlagKey, env: Partial<Record<FeatureFlagKey, string | undefined>> = ENV_OVERRIDES): boolean | null {
  return parseOverride(env[key])
}

/** Pure precedence: env override → row → false. */
export function resolveFlag(
  key: FeatureFlagKey,
  rows: Readonly<Record<string, boolean>>,
  env: Partial<Record<FeatureFlagKey, string | undefined>> = ENV_OVERRIDES,
): boolean {
  const o = envOverride(key, env)
  if (o !== null) return o
  return rows[key] === true
}

interface FlagsState {
  rows: Record<string, boolean>
  notes: Record<string, string | null>
  updatedAt: Record<string, string>
  loaded: boolean
  error: string | null
  fetch: () => Promise<void>
}

let inflight: Promise<void> | null = null

export const useFeatureFlagsStore = create<FlagsState>((set) => ({
  rows: {},
  notes: {},
  updatedAt: {},
  loaded: false,
  error: null,
  async fetch() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const data = await list('feature_flags', { select: 'key,enabled,note,updated_at' })
        const rows: Record<string, boolean> = {}
        const notes: Record<string, string | null> = {}
        const updatedAt: Record<string, string> = {}
        for (const r of data) { rows[r.key] = !!r.enabled; notes[r.key] = r.note ?? null; updatedAt[r.key] = r.updated_at }
        set({ rows, notes, updatedAt, loaded: true, error: null })
      } catch (e) {
        // A failed read leaves the flags at their defaults (off) — a dark
        // service never becomes reachable because a read blipped.
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
      } finally {
        inflight = null
      }
    })()
    return inflight
  },
}))

/** Non-hook read for adapters (search service, error reporter): env override
 *  → the last loaded row → false. Before the first load every flag is off
 *  unless its env override says otherwise. */
export function flagOn(key: FeatureFlagKey): boolean {
  return resolveFlag(key, useFeatureFlagsStore.getState().rows)
}

/** Subscribes the caller to the table (realtime) and returns the store. */
export function useFeatureFlags(): FlagsState {
  const version = useTableVersion('feature_flags')
  const state = useFeatureFlagsStore()
  useEffect(() => { void useFeatureFlagsStore.getState().fetch() }, [version])
  return state
}

/** Reactive flag read — env override → live row → false. */
export function useFlag(key: FeatureFlagKey): boolean {
  const { rows } = useFeatureFlags()
  return resolveFlag(key, rows)
}

/** Owner: flip one flag through the audited RPC. The server answers jsonb
 *  `{ok:false, code, message}` on refusal (or raises P0403 → humanizeError
 *  at the call site); on success the realtime bump refreshes every session. */
export async function setFlag(key: FeatureFlagKey, enabled: boolean): Promise<{ error: DbError | null }> {
  const res = await rpc('feature_flag_set', { p_key: key, p_enabled: enabled })
  if (res.error) return { error: res.error }
  const d = (res.data ?? null) as { ok?: boolean; code?: string; message?: string } | null
  if (d && d.ok === false) return { error: { message: d.message || 'The server refused this change.', code: d.code } }
  // Optimistic local mirror so the toggle settles before the realtime bump.
  useFeatureFlagsStore.setState((s) => ({ rows: { ...s.rows, [key]: enabled } }))
  return { error: null }
}
