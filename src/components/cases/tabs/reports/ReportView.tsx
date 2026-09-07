'use client'

import { useState } from 'react'
import type { FormSchema, FormValues } from '@/lib/forms'
import { renderMarkdown } from '@/lib/markdown'
import { parseMediaRefEntries } from '@/lib/mediaRefs'
import { parseMentions, withMentionLabels, type EntityItem } from '@/lib/mentions'
import { useMentionLabels } from '@/lib/mentionResolve'
import { timeAgo } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'
import type { EvidenceRow, MediaRow } from '../shared'

/** Read-only rendering of a saved report — walks the PINNED template
 *  version's schema (the same shape the editor uses) and presents each section
 *  styled like the rest of the site. Shared by the Reports tab (detail +
 *  version history) and the template admin's live preview. With
 *  evidence/media/persons pools it makes referenced items clickable; without
 *  them it renders exactly as before. `requiredKeys` / `advisoryKeys` add a
 *  small marker on the fields a version requires (the admin preview). */
export function ReportView({ schema, values, evidence = [], media = [], persons = [], entities = [], onOpenPerson, requiredKeys, advisoryKeys }: {
  schema: FormSchema
  values: FormValues
  evidence?: EvidenceRow[]
  media?: MediaRow[]
  persons?: { id: string; name: string | null }[]
  /** report_entities items — their snapshots label the narrative's mention
   *  tokens without a lookup; anything else resolves under RLS. */
  entities?: readonly Pick<EntityItem, 'kind' | 'ref_id' | 'label'>[]
  onOpenPerson?: (id: string) => void
  requiredKeys?: readonly string[]
  advisoryKeys?: readonly string[]
}) {
  const V = values || {}
  // Narrative mentions (P5-05): `[kind:id]` tokens across every narrative
  // section resolve to EntityLinks the viewer can open, or "Restricted
  // record" — never the id. One hook call for the whole report.
  const narrativeMd = schema.sections.filter((s) => s.type === 'textarea' && !s.mediaPick).map((s) => (s.type === 'textarea' ? String(V[s.key] ?? '') : '')).join('\n')
  const mentionLabels = useMentionLabels(parseMentions(narrativeMd), withMentionLabels({}, entities))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim()
  const req = new Set(requiredKeys ?? [])
  const adv = new Set(advisoryKeys ?? [])
  const marker = (key: string) => req.has(key)
    ? <span className="ml-1.5 rounded bg-rose-500/15 px-1 text-[10px] font-semibold uppercase text-rose-300">required</span>
    : adv.has(key) ? <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-semibold uppercase text-amber-300">advisory</span> : null
  // Canonical person ids only (captured by the editor's picker) — the old
  // fuzzy name-match fallback is gone with the whole-registry load. Name-only
  // legacy values render as the plain text they are, with a subtle hint. The
  // persons pool holds just this report's referenced ids: when it resolved and
  // an id is missing, the registry row is gone (or RLS-hidden), so the stored
  // snapshot renders instead of a dead link; an empty pool (lookup pending or
  // failed) keeps the link, matching the old always-clickable behavior.
  const personHint = (v: string, hint: string) => <>{v} <span className="text-xs text-slate-500">({hint})</span></>
  const personText = (v: string, pid?: string) => {
    if (!pid || !onOpenPerson) return pid ? v : personHint(v, 'not linked')
    if (persons.length && !persons.some((p) => p.id === pid)) return personHint(v, 'profile unavailable')
    return <button onClick={() => onOpenPerson(pid)} className="font-semibold text-badge-200 hover:underline">{v}</button>
  }
  const findEvidence = (entry: string) => evidence.find((ev) => (!!ev.item_code && !!ev.description && entry === `${ev.item_code} — ${ev.description}`) || (!!ev.item_code && entry.startsWith(ev.item_code)))
  const detailPanel = (line: string) => <span className="mt-1 block rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-left text-xs text-slate-300">{line}</span>
  // ev_items/ev_files render '; '-separated entries; entries that match a
  // logged evidence item or attachment become expandable/linked.
  const lookupEntries = (key: 'ev_items' | 'ev_files', raw: string) => (
    <div className="flex flex-col items-end gap-0.5">{raw.split(';').map((t) => t.trim()).filter(Boolean).map((entry, i) => {
      const k = `${key}:${i}`
      if (key === 'ev_items') {
        const ev = findEvidence(entry)
        if (!ev) return <span key={k}>{entry}</span>
        return <span key={k} className="flex flex-col items-end">
          <button onClick={() => toggle(k)} aria-expanded={expanded.has(k)} className="text-badge-200 hover:underline">{entry}</button>
          {expanded.has(k) && detailPanel([ev.description, ev.type, ev.collected_by ? `collected by ${ev.collected_by}` : '', `seal ${ev.tamper}`, timeAgo(ev.created_at)].filter(Boolean).join(' · '))}
        </span>
      }
      const m = media.find((x) => !!x.title && x.title === entry)
      if (!m) return <span key={k}>{entry}</span>
      const url = m.external_url ? safeUrl(m.external_url) : ''
      if (url) return <a key={k} href={url} target="_blank" rel="noreferrer" className="text-badge-200 hover:underline">{entry} ↗</a>
      return <span key={k} className="flex flex-col items-end">
        <button onClick={() => toggle(k)} aria-expanded={expanded.has(k)} className="text-badge-200 hover:underline">{entry}</button>
        {expanded.has(k) && detailPanel([m.type, timeAgo(m.created_at)].filter(Boolean).join(' · '))}
      </span>
    })}</div>
  )
  return (
    <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
      <p className="text-xs font-medium text-slate-500">{schema.subtitle}</p>
      {schema.sections.map((s) => {
        if (s.type === 'note') return <p key={s.id} className="rounded-lg bg-white/5 p-3 text-sm text-slate-300">{s.text}</p>
        return (
          <section key={s.id} className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
            <h4 className="mb-2 text-[13px] font-semibold text-white">{s.label}{s.type === 'textarea' ? marker(s.key) : s.type === 'grid' ? marker(s.id) : null}</h4>
            {s.type === 'textarea' && (s.mediaPick
              ? <MediaRefsView raw={text(V[s.key])} media={media} />
              : text(V[s.key]) ? <div className="text-sm leading-relaxed text-slate-200">{renderMarkdown(text(V[s.key]), { mentions: mentionLabels })}</div> : <p className="text-sm text-slate-500">—</p>)}
            {s.type === 'kv' && <dl className="divide-y divide-white/5">{s.fields.map((f) => {
              const v = text(V[f.key])
              const lookupKey = s.evidenceLookup && (f.key === 'ev_items' || f.key === 'ev_files') ? f.key : null
              const hasPool = lookupKey === 'ev_items' ? evidence.length > 0 : lookupKey === 'ev_files' ? media.length > 0 : false
              return <div key={f.key} className="flex items-start justify-between gap-4 py-1.5"><dt className="text-sm text-slate-400">{f.label}{marker(f.key)}</dt><dd className={`text-right text-sm ${v ? 'text-white' : 'text-slate-500'}`}>{!v ? '—' : lookupKey && hasPool ? lookupEntries(lookupKey, v) : f.person ? personText(v, String(V[`_${f.key}_person_id`] ?? '') || undefined) : v}</dd></div>
            })}</dl>}
            {s.type === 'grid' && (() => {
              const rows = (Array.isArray(V[s.id]) ? V[s.id] : []) as Record<string, string>[]
              const filled = rows.filter((r) => s.cols.some((c) => text(r[c.key])))
              return filled.length
                ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{s.cols.map((c) => <th key={c.key} className="pb-1.5 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{filled.map((r, i) => <tr key={i}>{s.cols.map((c) => { const cv = text(r[c.key]); return <td key={c.key} className="py-1.5 pr-4 text-slate-200">{cv ? (c.person ? personText(cv, r.person_id || undefined) : cv) : '—'}</td> })}</tr>)}</tbody></table></div>
                : <p className="text-sm text-slate-500">—</p>
            })()}
          </section>
        )
      })}
    </div>
  )
}

/** media_refs display: `[media:<id>]` token lines resolve to the row's CURRENT
 *  title + URL (rename-proof); legacy plain-text lines render exactly as the
 *  text they are. A token whose row is deleted/RLS-hidden falls back to its
 *  label snapshot. */
export function MediaRefsView({ raw, media }: { raw: string; media: MediaRow[] }) {
  const entries = parseMediaRefEntries(raw)
  if (!entries.length) return <p className="text-sm text-slate-500">—</p>
  return (
    <ul className="space-y-1 text-sm">
      {entries.map((e, i) => {
        if (!e.id) return <li key={`${e.label}-${i}`} className="whitespace-pre-wrap text-slate-200">{e.label}</li>
        const m = media.find((x) => x.id === e.id)
        if (!m) return <li key={`${e.id}-${i}`} className="text-slate-400">{e.label} <span className="text-xs">(no longer available)</span></li>
        const url = m.external_url ? safeUrl(m.external_url) : ''
        return (
          <li key={`${e.id}-${i}`}>
            {url
              ? <a href={url} target="_blank" rel="noreferrer" className="text-badge-200 hover:underline">{m.title} ↗</a>
              : <span className="text-slate-200">{m.title}</span>}
          </li>
        )
      })}
    </ul>
  )
}
