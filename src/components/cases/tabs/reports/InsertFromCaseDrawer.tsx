'use client'

/** Insert-from-case drawer (P5-04, RB6). A right slide-over that lists what
 *  the case already knows — people, vehicles, gangs, locations, evidence,
 *  media, officers, charges, legal requests, related cases, timeline events
 *  — as checkable rows. Insert hands the caller two things at once: the
 *  rendered text lines (for the narrative or a textarea) and the
 *  `report_entities` items `{kind, ref_id, role, label, snapshot, edited:false}`
 *  that back them. Every group loads under RLS with its own best-effort read
 *  (a failed group says so; it never blocks the others), nothing here writes
 *  to a source record, and media rows never carry a URL into a snapshot.
 *
 *  Persistence: when `reportId` is given (and `persist` is not false) the
 *  items are merged into the report's set through report_entities_set
 *  (ReportEntities.syncReportEntities, read-merge-send); for a report that
 *  does not exist yet the caller keeps the items and syncs after
 *  report_create. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { actionVerb, entityKindLabel } from '@/components/cases/sections/sectionShared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { loadCaseCharges, caseChargeStatusLabel } from '@/lib/caseCharges'
import type { Database, Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import type { FormSchema, FormValues } from '@/lib/forms'
import { isMentionKind, mentionKey, mentionToken, type EntityItem } from '@/lib/mentions'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { syncReportEntities } from './ReportEntities'

export interface InsertFromCaseDrawerProps {
  caseId: string
  /** The report being edited — null/undefined before the first save. */
  reportId?: string | null
  /** The editor's current field values (marks records already named). */
  values: FormValues
  /** The pinned schema (marks person fields already filled). */
  schema?: FormSchema | null
  /** The report's current entity set (marks records already inserted). */
  entities: readonly EntityItem[]
  /** Rendered text lines + the entity items that back them. */
  onInsert: (items: EntityItem[], text: string) => void
  onClose: () => void
  /** Prefix person / vehicle / gang / place / case lines with their
   *  `[kind:id]` mention token (for the narrative RichEditor). Default off
   *  — a plain textarea would show the token literally. */
  mentionTokens?: boolean
  /** Default true when reportId is set. */
  persist?: boolean
}

type GroupId = 'person' | 'vehicle' | 'gang' | 'place' | 'evidence' | 'media' | 'officer' | 'charge' | 'legal_request' | 'case' | 'timeline_event'
interface Candidate { key: string; item: EntityItem; line: string; sub?: string; restricted?: boolean }
interface Group { id: GroupId; label: string; items: Candidate[]; error?: boolean }

const GROUP_LABEL: Record<GroupId, string> = {
  person: 'People', vehicle: 'Vehicles', gang: 'Gangs', place: 'Locations', evidence: 'Evidence', media: 'Media',
  officer: 'Officers', charge: 'Charges', legal_request: 'Legal requests', case: 'Related cases', timeline_event: 'Timeline events',
}
const GROUP_ORDER: GroupId[] = ['person', 'vehicle', 'gang', 'place', 'evidence', 'media', 'officer', 'charge', 'legal_request', 'case', 'timeline_event']
const PERSON_ROLES = ['subject', 'suspect', 'witness', 'victim', 'associate'] as const
const humanize = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '')
const TIMELINE_LIMIT = 50

type FeedRow = Database['public']['Functions']['case_audit_feed']['Returns'][number]

const item = (kind: string, ref_id: string | null, role: string, label: string, snapshot: Record<string, unknown>): EntityItem =>
  ({ kind, ref_id, role, label, snapshot, edited: false })

/** Person ids the form already names — `_${key}_person_id` companions and
 *  grid `person_id` cells (the editor's picker writes both). */
function personIdsInValues(schema: FormSchema | null | undefined, values: FormValues): Set<string> {
  const out = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()) }
  for (const [k, v] of Object.entries(values)) if (/^_.*_person_id$/.test(k)) add(v)
  for (const s of schema?.sections ?? []) {
    if (s.type !== 'grid') continue
    const rows = Array.isArray(values[s.id]) ? (values[s.id] as unknown[]) : []
    for (const row of rows) if (row && typeof row === 'object') add((row as Record<string, unknown>).person_id)
  }
  return out
}

async function linkedIds(caseId: string, kind: 'person' | 'vehicle' | 'gang' | 'place'): Promise<string[]> {
  const rows = (await list('case_intel_links', { select: 'ref_id', eq: { case_id: caseId, kind } })) as unknown as { ref_id: string }[]
  return [...new Set(rows.map((r) => r.ref_id))]
}

/* ── Group loaders (each best-effort, RLS-filtered) ───────────────────────── */
const loaders: Record<GroupId, (caseId: string, c: Tables<'cases'> | null) => Promise<Candidate[]>> = {
  async person(caseId) {
    const ids = await linkedIds(caseId, 'person')
    if (!ids.length) return []
    const rows = (await list('persons', { select: 'id,name,alias,dob,status', in: { id: ids } })) as unknown as Pick<Tables<'persons'>, 'id' | 'name' | 'alias' | 'dob' | 'status'>[]
    return rows.map((p) => ({
      key: mentionKey('person', p.id),
      item: item('person', p.id, 'subject', p.name, { name: p.name, alias: p.alias, dob: p.dob, status: p.status }),
      line: `${p.name}${p.alias ? ` (“${p.alias}”)` : ''}${p.dob ? ` · DOB ${p.dob}` : ''}`,
      sub: [p.alias, p.dob].filter(Boolean).join(' · ') || undefined,
    }))
  },
  async vehicle(caseId) {
    const ids = await linkedIds(caseId, 'vehicle')
    if (!ids.length) return []
    const rows = (await list('vehicles', { select: 'id,plate,model,color', in: { id: ids } })) as unknown as Pick<Tables<'vehicles'>, 'id' | 'plate' | 'model' | 'color'>[]
    return rows.map((v) => {
      const desc = [v.color, v.model].filter(Boolean).join(' ')
      return {
        key: mentionKey('vehicle', v.id),
        item: item('vehicle', v.id, 'vehicle', v.plate, { plate: v.plate, model: v.model, color: v.color }),
        line: `${v.plate}${desc ? ` — ${desc}` : ''}`, sub: desc || undefined,
      }
    })
  },
  async gang(caseId) {
    const ids = await linkedIds(caseId, 'gang')
    if (!ids.length) return []
    const rows = (await list('gangs', { select: 'id,name,classification,status', in: { id: ids } })) as unknown as Pick<Tables<'gangs'>, 'id' | 'name' | 'classification' | 'status'>[]
    return rows.map((g) => ({
      key: mentionKey('gang', g.id),
      item: item('gang', g.id, 'gang', g.name, { name: g.name, classification: g.classification, status: g.status }),
      line: `${g.name}${g.classification ? ` · ${humanize(g.classification)}` : ''}`, sub: humanize(g.classification) || undefined,
    }))
  },
  async place(caseId) {
    const ids = await linkedIds(caseId, 'place')
    if (!ids.length) return []
    const rows = (await list('places', { select: 'id,name,area,type', in: { id: ids } })) as unknown as Pick<Tables<'places'>, 'id' | 'name' | 'area' | 'type'>[]
    return rows.map((p) => ({
      key: mentionKey('place', p.id),
      item: item('place', p.id, 'location', p.name, { name: p.name, area: p.area, type: p.type }),
      line: `${p.name}${p.area ? ` — ${p.area}` : ''}${p.type ? ` (${humanize(p.type)})` : ''}`, sub: [humanize(p.type), p.area].filter(Boolean).join(' · ') || undefined,
    }))
  },
  async evidence(caseId) {
    const rows = await list('evidence', { eq: { case_id: caseId }, order: 'created_at' })
    return rows.map((ev) => {
      const label = [ev.item_code, ev.description].filter(Boolean).join(' — ') || 'Untitled item'
      return {
        key: `evidence:${ev.id}`,
        item: item('evidence', ev.id, 'exhibit', label, { item_code: ev.item_code, description: ev.description, type: ev.type, collected_by: ev.collected_by, tamper: ev.tamper }),
        line: `${label}${ev.collected_by ? ` · collected by ${ev.collected_by}` : ''}${ev.tamper && ev.tamper !== 'intact' ? ` · seal ${ev.tamper}` : ''}`,
        sub: [ev.type, ev.collected_by ? `collected by ${ev.collected_by}` : ''].filter(Boolean).join(' · ') || undefined,
      }
    })
  },
  async media(caseId) {
    const rows = (await list('media', { select: 'id,title,type,category,restricted,created_at', eq: { case_id: caseId }, is: { archived_at: null }, order: 'created_at' })) as unknown as Pick<Tables<'media'>, 'id' | 'title' | 'type' | 'category' | 'restricted' | 'created_at'>[]
    return rows.map((m) => ({
      key: `media:${m.id}`,
      // Title only — never a URL or storage path in the snapshot.
      item: item('media', m.id, 'exhibit', m.title || 'Attachment', { title: m.title, type: m.type, category: m.category, restricted: m.restricted }),
      line: `${m.title || 'Attachment'} (${m.type})${m.restricted ? ' · restricted' : ''}`,
      sub: [m.type, m.category ? humanize(m.category) : ''].filter(Boolean).join(' · ') || undefined,
      restricted: m.restricted,
    }))
  },
  async officer(caseId, c) {
    const rows = (await list('case_assignments', { select: 'officer_id,role,joint_role', eq: { case_id: caseId }, is: { removed_at: null } })) as unknown as Pick<Tables<'case_assignments'>, 'officer_id' | 'role' | 'joint_role'>[]
    const seen = new Set<string>()
    const out: Candidate[] = []
    const push = (id: string, role: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const name = officerName(id) || 'Officer'
      out.push({
        key: `officer:${id}`,
        item: item('officer', id, 'officer', `${name} — ${role}`, { name, role }),
        line: `${name} — ${role}`, sub: role,
      })
    }
    if (c?.lead_detective_id) push(c.lead_detective_id, 'Lead detective')
    for (const a of rows) push(a.officer_id, humanize(a.joint_role ?? a.role))
    return out
  },
  async charge(caseId) {
    const rows = await loadCaseCharges(caseId)
    return rows.map((ch) => {
      const label = `${ch.code ? `${ch.code} ` : ''}${ch.offense}${ch.counts > 1 ? ` × ${ch.counts}` : ''}`
      return {
        key: `charge:${ch.id}`,
        item: item('charge', ch.id, 'charge', label, { code: ch.code, offense: ch.offense, counts: ch.counts, charge_class: ch.charge_class, status: ch.status }),
        line: `${label} — ${caseChargeStatusLabel(ch.status)}`, sub: `${ch.charge_class} · ${caseChargeStatusLabel(ch.status)}`,
      }
    })
  },
  async legal_request(caseId) {
    const rows = (await list('legal_requests', { select: 'id,request_number,title,request_type,subtype,review_status', eq: { case_id: caseId }, order: 'created_at', ascending: false })) as unknown as Pick<Tables<'legal_requests'>, 'id' | 'request_number' | 'title' | 'request_type' | 'subtype' | 'review_status'>[]
    return rows.map((r) => {
      const label = `${r.request_number} — ${r.title}`
      return {
        key: `legal_request:${r.id}`,
        item: item('legal_request', r.id, 'legal_request', label, { request_number: r.request_number, title: r.title, request_type: r.request_type, subtype: r.subtype, review_status: r.review_status }),
        line: `${label} (${humanize(r.subtype)} · ${humanize(r.review_status)})`, sub: `${humanize(r.subtype)} · ${humanize(r.review_status)}`,
      }
    })
  },
  async case(caseId) {
    const [out, inc] = await Promise.all([
      list('case_links', { select: 'related_case_id,kind', eq: { case_id: caseId } }) as unknown as Promise<{ related_case_id: string; kind: string }[]>,
      list('case_links', { select: 'case_id,kind', eq: { related_case_id: caseId } }) as unknown as Promise<{ case_id: string; kind: string }[]>,
    ])
    const kinds = new Map<string, string>()
    for (const l of out) kinds.set(l.related_case_id, l.kind)
    for (const l of inc) if (!kinds.has(l.case_id)) kinds.set(l.case_id, l.kind)
    const ids = [...kinds.keys()]
    if (!ids.length) return []
    const rows = (await list('cases', { select: 'id,case_number,title,status', in: { id: ids } })) as unknown as Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'status'>[]
    return rows.map((c) => {
      const label = `${c.case_number}${c.title ? ` — ${c.title}` : ''}`
      return {
        key: mentionKey('case', c.id),
        item: item('case', c.id, 'related_case', label, { case_number: c.case_number, title: c.title, status: c.status, link_kind: kinds.get(c.id) }),
        line: `${label} (${humanize(kinds.get(c.id))})`, sub: humanize(kinds.get(c.id)),
      }
    })
  },
  async timeline_event(caseId) {
    const res = await rpc('case_audit_feed', { p_case: caseId, p_limit: TIMELINE_LIMIT })
    if (res.error) throw new Error(res.error.message)
    return ((res.data ?? []) as FeedRow[]).map((r) => {
      const actor = officerName(r.actor_id) || (r.actor_id ? 'Officer' : 'System')
      const label = `${fmtDateTime(r.at)} — ${actor} ${actionVerb(r.action)} ${entityKindLabel(r.kind)}${r.label ? `: ${r.label}` : ''}`
      return {
        key: `timeline_event:${r.id}`,
        item: item('timeline_event', null, 'event', label, { at: r.at, action: r.action, entity: r.entity, entity_id: r.entity_id, kind: r.kind, actor_id: r.actor_id, label: r.label }),
        line: label, sub: fmtDateTime(r.at),
      }
    })
  },
}

/** The insert text: one bold heading per group, one bullet per row. Mention
 *  tokens (opt-in) go in front of the label so the narrative renders a chip
 *  followed by the descriptive text. */
export function renderInsertText(picked: readonly { group: GroupId; c: Candidate }[], mentionTokens: boolean): string {
  const blocks: string[] = []
  for (const g of GROUP_ORDER) {
    const rows = picked.filter((p) => p.group === g)
    if (!rows.length) continue
    blocks.push(`**${GROUP_LABEL[g]}**`)
    for (const { c } of rows) {
      const tok = mentionTokens && c.item.ref_id && isMentionKind(c.item.kind) ? `${mentionToken(c.item.kind, c.item.ref_id)} ` : ''
      blocks.push(`- ${tok}${c.line}`)
    }
    blocks.push('')
  }
  return blocks.join('\n').trimEnd()
}

export function InsertFromCaseDrawer({ caseId, reportId, values, schema, entities, onInsert, onClose, mentionTokens = false, persist }: InsertFromCaseDrawerProps) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [personRole, setPersonRole] = useState<(typeof PERSON_ROLES)[number]>('subject')
  const [busy, setBusy] = useState(false)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchRoster = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchRoster() }, [rosterLoaded, fetchRoster])

  const load = useCallback(async () => {
    setGroups(null)
    const c = (await list('cases', { eq: { id: caseId }, limit: 1 }).catch(() => []))[0] ?? null
    const out = await Promise.all(GROUP_ORDER.map(async (id): Promise<Group> => {
      try { return { id, label: GROUP_LABEL[id], items: await loaders[id](caseId, c) } }
      catch { return { id, label: GROUP_LABEL[id], items: [], error: true } }
    }))
    setGroups(out)
  }, [caseId])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  // Already in the report: the entity set (any role) and the person fields.
  const present = useMemo(() => {
    const s = new Set<string>()
    for (const e of entities) if (e.ref_id) s.add(`${e.kind}:${e.ref_id.toLowerCase()}`)
    for (const id of personIdsInValues(schema, values)) s.add(`person:${id}`)
    return s
  }, [entities, schema, values])

  const needle = q.trim().toLowerCase()
  const visible = useMemo(() => (groups ?? []).map((g) => ({
    ...g,
    items: needle ? g.items.filter((c) => c.line.toLowerCase().includes(needle)) : g.items,
  })), [groups, needle])

  const toggle = (key: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const toggleGroup = (g: Group) => setPicked((prev) => {
    const n = new Set(prev)
    const all = g.items.every((c) => n.has(c.key))
    for (const c of g.items) { if (all) n.delete(c.key); else n.add(c.key) }
    return n
  })

  const insert = async () => {
    if (!groups || !picked.size || busy) return
    const chosen: { group: GroupId; c: Candidate }[] = []
    for (const g of groups) for (const c of g.items) if (picked.has(c.key)) chosen.push({ group: g.id, c })
    const items = chosen.map(({ group, c }) => (group === 'person' ? { ...c.item, role: personRole } : c.item))
    const text = renderInsertText(chosen, mentionTokens)
    const shouldPersist = persist ?? !!reportId
    if (shouldPersist && reportId) {
      setBusy(true)
      const res = await syncReportEntities(reportId, items, 'merge')
      setBusy(false)
      if (!res.ok) toast(`Inserted into the text, but the records could not be saved to the report: ${res.message ?? 'refused'}`, 'warn')
    }
    onInsert(items, text)
    onClose()
  }

  return (
    <Modal open slide onClose={onClose} dirty={() => picked.size > 0}>
      <div className="flex min-h-full flex-col p-5">
        <ModalHeader title="Insert from case" onClose={onClose} />
        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <Field label="Filter">
            {(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Narrow the lists…" />}
          </Field>
          <Field label="Role for people" hint="Applied to every selected person.">
            {(id) => (
              <Select id={id} value={personRole} onChange={(e) => setPersonRole(e.target.value as (typeof PERSON_ROLES)[number])}>
                {PERSON_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {!groups ? (
            <p role="status" className="text-sm text-slate-400">Loading case records…</p>
          ) : visible.map((g) => (
            <section key={g.id} aria-label={g.label} className="rounded-lg border border-white/10 bg-ink-950/50">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <h4 className="flex items-center gap-2 text-[13px] font-semibold text-white">{g.label} <Badge>{g.items.length}</Badge></h4>
                {g.items.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => toggleGroup(g)}>
                    {g.items.every((c) => picked.has(c.key)) ? 'Clear' : 'Select all'}
                  </Button>
                )}
              </div>
              {g.error ? (
                <p className="px-3 pb-3 text-xs text-rose-200">Could not load {g.label.toLowerCase()} — try again later.</p>
              ) : !g.items.length ? (
                <p className="px-3 pb-3 text-xs text-slate-400">{needle ? 'No match.' : `Nothing on this case yet.`}</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {g.items.map((c) => {
                    const on = picked.has(c.key)
                    const inReport = present.has(c.key)
                    return (
                      <li key={c.key}>
                        <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-white/5 ${on ? 'bg-badge-500/10' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(c.key)} aria-label={`Insert ${c.item.label}`} className="h-4 w-4 accent-amber-500" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-slate-100">{c.item.label}</span>
                            {c.sub && <span className="block truncate text-xs text-slate-400">{c.sub}</span>}
                          </span>
                          {c.restricted && <Badge tone="danger" title="Restricted media — exported by title only, or omitted for readers without access">Restricted</Badge>}
                          {inReport && <Badge tone="accent" title="Already referenced by this report">In report</Badge>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-slate-400" aria-live="polite">{picked.size} selected{mentionTokens ? ' · mention chips on' : ''}</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!picked.size} loading={busy} onClick={() => void insert()}>Insert {picked.size ? `(${picked.size})` : ''}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
