'use client'

/** Mention label resolution (P5-05). One bounded `list()` per kind with an
 *  `in: { id }` filter — RLS decides what comes back: a hidden, sealed,
 *  merged or deleted record is simply absent, and its key resolves to `null`
 *  ("Restricted record"). Nothing here widens access or prints an id. */
import { useEffect, useRef, useState } from 'react'
import { list } from './db'
import { mentionKey, type MentionKind, type MentionLabels, type MentionRef } from './mentions'

type Source = {
  table: 'persons' | 'vehicles' | 'gangs' | 'places' | 'cases' | 'narcotics' | 'media' | 'penal_charges' | 'reports' | 'legal_requests' | 'external_sources'
  select: string
  label: (row: Record<string, unknown>) => string
}
const str = (v: unknown): string => (v == null ? '' : String(v))
/** Every kind reads ONE projected table under RLS. The platform-upgrade
 *  kinds: evidence = the media row (title + evidence number — a restricted
 *  or SIU-blocked row is absent, so it resolves "Restricted record");
 *  charge = the penal catalog row (code + offense); report = the case
 *  report (template name — reportTitle's base, without the catalog);
 *  legal = the request number (sealed requests are absent under RLS);
 *  source = the external source number + title. Never a URL. */
const SOURCES: Record<MentionKind, Source> = {
  person: { table: 'persons', select: 'id,name', label: (r) => str(r.name) },
  vehicle: { table: 'vehicles', select: 'id,plate', label: (r) => str(r.plate) },
  gang: { table: 'gangs', select: 'id,name', label: (r) => str(r.name) },
  place: { table: 'places', select: 'id,name', label: (r) => str(r.name) },
  case: { table: 'cases', select: 'id,case_number', label: (r) => str(r.case_number) },
  narcotic: { table: 'narcotics', select: 'id,name', label: (r) => str(r.name) },
  evidence: { table: 'media', select: 'id,title,evidence_number', label: (r) => [str(r.title) || 'Evidence', str(r.evidence_number)].filter(Boolean).join(' · ') },
  charge: { table: 'penal_charges', select: 'id,code,offense', label: (r) => [str(r.code), str(r.offense)].filter(Boolean).join(' · ') },
  report: { table: 'reports', select: 'id,template,kind,seq', label: (r) => reportLabel(r) },
  legal: { table: 'legal_requests', select: 'id,request_number,request_type', label: (r) => [str(r.request_number), str(r.request_type)].filter(Boolean).join(' · ') },
  source: { table: 'external_sources', select: 'id,source_number,title', label: (r) => [str(r.source_number), str(r.title)].filter(Boolean).join(' · ') },
}

/** A report's label from its row alone (no template catalog fetch): the
 *  template key humanised, plus the supplemental / follow-up sequence. */
export function reportLabel(r: Record<string, unknown>): string {
  const base = str(r.template).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Report'
  const kind = str(r.kind)
  const seq = r.seq == null ? '' : ` #${str(r.seq)}`
  if (kind === 'supplemental') return `${base} — Supplemental${seq}`
  if (kind === 'followup') return `${base} — Follow-up${seq}`
  return base
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
