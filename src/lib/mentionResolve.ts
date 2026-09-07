'use client'

/** Mention label resolution (P5-05). One bounded `list()` per kind with an
 *  `in: { id }` filter — RLS decides what comes back: a hidden, sealed,
 *  merged or deleted record is simply absent, and its key resolves to `null`
 *  ("Restricted record"). Nothing here widens access or prints an id. */
import { useEffect, useRef, useState } from 'react'
import { list } from './db'
import { mentionKey, type MentionKind, type MentionLabels, type MentionRef } from './mentions'

type Source = { table: 'persons' | 'vehicles' | 'gangs' | 'places' | 'cases' | 'narcotics'; select: string; label: (row: Record<string, unknown>) => string }
const SOURCES: Record<MentionKind, Source> = {
  person: { table: 'persons', select: 'id,name', label: (r) => String(r.name ?? '') },
  vehicle: { table: 'vehicles', select: 'id,plate', label: (r) => String(r.plate ?? '') },
  gang: { table: 'gangs', select: 'id,name', label: (r) => String(r.name ?? '') },
  place: { table: 'places', select: 'id,name', label: (r) => String(r.name ?? '') },
  case: { table: 'cases', select: 'id,case_number', label: (r) => String(r.case_number ?? '') },
  narcotic: { table: 'narcotics', select: 'id,name', label: (r) => String(r.name ?? '') },
}

/** Resolve display labels for a set of refs. Every requested key is present
 *  in the answer: a string when readable, `null` when not. A transient
 *  failure on one kind leaves that kind's keys ABSENT (unknown, not
 *  restricted) so a flaky read never paints a record as restricted. */
export async function resolveMentionLabels(refs: readonly MentionRef[]): Promise<MentionLabels> {
  const byKind = new Map<MentionKind, Set<string>>()
  for (const r of refs) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, new Set())
    byKind.get(r.kind)!.add(r.id.toLowerCase())
  }
  const out: Record<string, string | null> = {}
  await Promise.all([...byKind].map(async ([kind, ids]) => {
    const src = SOURCES[kind]
    try {
      const rows = (await list(src.table, { select: src.select, in: { id: [...ids] } })) as unknown as Record<string, unknown>[]
      const found = new Map(rows.map((r) => [String(r.id).toLowerCase(), src.label(r)]))
      for (const id of ids) out[mentionKey(kind, id)] = found.get(id) || null
    } catch { /* leave unknown */ }
  }))
  return out
}

/** Hook form: resolves the refs it has not seen yet and accumulates. The
 *  `known` map (labels the caller already holds — e.g. from report_entities
 *  snapshots) short-circuits lookups and is merged into the result. */
export function useMentionLabels(refs: readonly MentionRef[], known?: MentionLabels): MentionLabels {
  const [labels, setLabels] = useState<MentionLabels>(known ?? {})
  const asked = useRef<Set<string>>(new Set())
  // Effects key on the CONTENT of refs / known (both are commonly built
  // inline by callers), never on their identity.
  const latest = useRef({ refs, known })
  useEffect(() => { latest.current = { refs, known } })
  const refKeys = refs.map((r) => mentionKey(r.kind, r.id)).join('|')
  const knownKeys = known ? JSON.stringify(known) : ''
  useEffect(() => {
    const { refs: cur, known: k } = latest.current
    const pending = cur.filter((r) => {
      const key = mentionKey(r.kind, r.id)
      return !asked.current.has(key) && !(k && typeof k[key] === 'string')
    })
    if (!pending.length) return
    for (const r of pending) asked.current.add(mentionKey(r.kind, r.id))
    let alive = true
    void resolveMentionLabels(pending).then((res) => { if (alive) setLabels((prev) => ({ ...prev, ...res })) })
    return () => { alive = false }
  }, [refKeys, knownKeys])
  useEffect(() => {
    const k = latest.current.known
    if (k) setLabels((prev) => ({ ...k, ...prev }))
  }, [knownKeys])
  return labels
}
