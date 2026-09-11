/** Narrative mention tokens and report-entity helpers (plan P5-04 / P5-05,
 *  decisions RB5 / RB6). Pure — no React, no db, no clock.
 *
 *  Token grammar: `[kind:id]` where kind is one of the EntityLink kinds
 *  (person | vehicle | gang | place | case | narcotic) or, since the platform
 *  upgrade, a case artefact (evidence | charge | report | legal | source),
 *  and id is a UUID. The
 *  narrative is stored as plain markdown with the tokens inline; the editor
 *  (ui/RichEditorInner) renders them as chips and serialises them back, the
 *  read-only renderer (lib/markdown) resolves them under RLS, and every
 *  narrative save derives one `report_entities` row per token with role
 *  'mention' (contract §5). The raw id is never shown to a reader — a token
 *  the viewer cannot resolve renders as the literal "Restricted record". */
import type { EntityKind } from '@/components/ui/EntityLink'

/** The registry kinds — exactly the EntityLink kinds (the read-only renderer
 *  deep-links these). */
export const MENTION_LINK_KINDS = ['person', 'vehicle', 'gang', 'place', 'case', 'narcotic'] as const
export type MentionLinkKind = (typeof MENTION_LINK_KINDS)[number]
// The link kinds ARE the EntityLink kinds — a compile-time pin so the
// grammar can never name a link kind EntityLink cannot deep-link.
const _pin: readonly EntityKind[] = MENTION_LINK_KINDS
void _pin

/** Platform upgrade (report editor): case artefacts the slash menu inserts
 *  as `cidEntity` blocks — evidence (a media row with an evidence number),
 *  a penal charge (the catalog row's uuid), a case report, a legal request
 *  and an external source. Same `[kind:id]` grammar; the read-only renderer
 *  shows their resolved label as a chip (no EntityLink deep link yet). */
export const MENTION_BLOCK_KINDS = ['evidence', 'charge', 'report', 'legal', 'source'] as const

export const MENTION_KINDS = [...MENTION_LINK_KINDS, ...MENTION_BLOCK_KINDS] as const
export type MentionKind = (typeof MENTION_KINDS)[number]

export function isMentionLinkKind(v: unknown): v is MentionLinkKind {
  return typeof v === 'string' && (MENTION_LINK_KINDS as readonly string[]).includes(v)
}

/** Upper-case tag the entity block renders — `[PERSON]`, `[EVIDENCE]` … */
export const MENTION_KIND_TAG: Record<MentionKind, string> = {
  person: 'PERSON', vehicle: 'VEHICLE', gang: 'GANG', place: 'PLACE', case: 'CASE', narcotic: 'NARCOTIC',
  evidence: 'EVIDENCE', charge: 'CHARGE', report: 'REPORT', legal: 'LEGAL', source: 'SOURCE',
}

/** The `report_entities.kind` a mention row is written under (the table's
 *  CHECK vocabulary: person | vehicle | gang | place | evidence | media |
 *  officer | charge | legal_request | case | timeline_event). Evidence
 *  mentions point at MEDIA rows (evidence numbers live on media), legal at
 *  `legal_request`; narcotic, report and source have no arm and are simply
 *  not derived — `report_entities_set` refuses an unknown kind for the
 *  WHOLE set, so a kind without an arm must never reach it. */
export const MENTION_ENTITY_KIND: Partial<Record<MentionKind, string>> = {
  person: 'person', vehicle: 'vehicle', gang: 'gang', place: 'place', case: 'case',
  evidence: 'media', charge: 'charge', legal: 'legal_request',
}

/** The inverse map for folding `report_entities` rows back into labels. */
const ENTITY_MENTION_KIND: Record<string, MentionKind> = Object.fromEntries(
  Object.entries(MENTION_ENTITY_KIND).map(([m, e]) => [e, m as MentionKind]),
)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** Global, case-insensitive; group 1 = kind, group 2 = id. Callers that
 *  iterate must reset `lastIndex` (or use `matchAll`) — parseMentions and
 *  splitMentions below do. */
export const MENTION_RE = new RegExp(`\\[(${MENTION_KINDS.join('|')}):(${UUID})\\]`, 'gi')

export interface MentionRef { kind: MentionKind; id: string }

export function isMentionKind(v: unknown): v is MentionKind {
  return typeof v === 'string' && (MENTION_KINDS as readonly string[]).includes(v)
}

/** `kind:id` — the key of the label maps and entity sets below. */
export const mentionKey = (kind: string, id: string): string => `${kind}:${id.toLowerCase()}`
/** The serialised token. */
export const mentionToken = (kind: MentionKind, id: string): string => `[${kind}:${id.toLowerCase()}]`

/** Every distinct token in document order. */
export function parseMentions(md: string | null | undefined): MentionRef[] {
  const out: MentionRef[] = []
  const seen = new Set<string>()
  for (const m of String(md ?? '').matchAll(MENTION_RE)) {
    const kind = m[1].toLowerCase()
    const id = m[2].toLowerCase()
    if (!isMentionKind(kind)) continue
    const key = mentionKey(kind, id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id })
  }
  return out
}

/** Split a text run into literal segments and mention refs, preserving
 *  order — the renderer and the exporters both walk this. */
export function splitMentions(text: string): Array<string | MentionRef> {
  const out: Array<string | MentionRef> = []
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const kind = m[1].toLowerCase()
    if (isMentionKind(kind)) out.push({ kind, id: m[2].toLowerCase() })
    else out.push(m[0])
    last = idx + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Display labels keyed by mentionKey. A key that is PRESENT with `null`
 *  means "looked up, not readable" (→ "Restricted record"); an ABSENT key
 *  means "not resolved yet". */
export type MentionLabels = Readonly<Record<string, string | null>>

export const RESTRICTED_LABEL = 'Restricted record'

/** Flatten tokens to plain text for exports and previews: a resolved token
 *  becomes its label, anything else the restricted literal — never the id. */
export function mentionsToText(md: string | null | undefined, labels: MentionLabels): string {
  return splitMentions(String(md ?? ''))
    .map((seg) => (typeof seg === 'string' ? seg : labels[mentionKey(seg.kind, seg.id)] ?? RESTRICTED_LABEL))
    .join('')
}

/* ── report_entities items ──────────────────────────────────────────────── */

/** One `report_entities_set` item — the client-side shape of a row
 *  (contract §2: `{kind, ref_id|null, role|null, label, snapshot, edited}`). */
export interface EntityItem {
  kind: string
  ref_id: string | null
  role: string | null
  label: string
  snapshot: Record<string, unknown>
  edited: boolean
}

/** The identity of an item inside a report's set: kind + ref (or the label
 *  for ref-less timeline events) + role — a narrative mention of a person and
 *  the same person inserted as a subject are two distinct items. */
export const entityKey = (e: Pick<EntityItem, 'kind' | 'ref_id' | 'role' | 'label'>): string =>
  `${e.kind}:${e.ref_id ? e.ref_id.toLowerCase() : `label=${e.label}`}:${e.role ?? ''}`

/** Fold entity items / report_entities rows into a label map (existing keys
 *  win — an explicitly resolved label is never overwritten by a snapshot).
 *  Only the mention-capable kinds contribute; other kinds have no token. */
export function withMentionLabels(
  labels: MentionLabels,
  items: ReadonlyArray<Pick<EntityItem, 'kind' | 'ref_id' | 'label'>>,
): MentionLabels {
  const out: Record<string, string | null> = { ...labels }
  for (const it of items) {
    // Rows are keyed by the report_entities kind (`media` → evidence,
    // `legal_request` → legal); kinds with no mention arm contribute nothing.
    const kind = ENTITY_MENTION_KIND[it.kind]
    if (!it.ref_id || !kind || !it.label) continue
    const key = mentionKey(kind, it.ref_id)
    if (!(key in out) || out[key] === null) out[key] = it.label
  }
  return out
}

/** The role-'mention' rows for a narrative: one per resolved token. Tokens
 *  without a label are SKIPPED — a label proves the author resolved the
 *  record, and `report_entities_set` refuses any ref the caller cannot read
 *  (which would reject the whole set, not just the one row). */
export function mentionEntityRows(md: string | null | undefined, labels: MentionLabels): EntityItem[] {
  return parseMentions(md).flatMap((ref) => {
    const label = labels[mentionKey(ref.kind, ref.id)]
    const kind = MENTION_ENTITY_KIND[ref.kind]
    if (!label || !kind) return []
    return [{ kind, ref_id: ref.id, role: 'mention', label, snapshot: { label }, edited: false }]
  })
}

/** Mark one item "differs from record" (RB6). Returns a new array; unknown
 *  keys are a no-op. */
export function markEdited(items: readonly EntityItem[], key: string, edited = true): EntityItem[] {
  return items.map((it) => (entityKey(it) === key && it.edited !== edited ? { ...it, edited } : it))
}

/** Flag every inserted (non-mention) item whose rendered label no longer
 *  appears verbatim in the report text — the "edited after insert" signal.
 *  Mention rows are atomic tokens and are never flagged here. */
export function detectEditedEntities(items: readonly EntityItem[], text: string): EntityItem[] {
  return items.map((it) => {
    if (it.role === 'mention' || !it.label) return it
    const edited = !text.includes(it.label)
    return it.edited === edited ? it : { ...it, edited }
  })
}

/** Merge for the REPLACE-semantics RPC. `merge`: incoming items upsert by
 *  key over the current set ('replace' sends the incoming set as-is — a removal). `mentions`: the current role-'mention' rows are
 *  dropped and the incoming ones (the narrative's tokens) take their place,
 *  everything else is kept — the narrative is the source of truth for
 *  mentions, the drawer for the rest. */
export function mergeEntityItems(
  current: readonly EntityItem[],
  incoming: readonly EntityItem[],
  mode: 'merge' | 'mentions' | 'replace' = 'merge',
): EntityItem[] {
  if (mode === 'replace') return incoming.slice()
  const base = mode === 'mentions' ? current.filter((it) => it.role !== 'mention') : current.slice()
  const byKey = new Map(base.map((it) => [entityKey(it), it]))
  for (const it of incoming) byKey.set(entityKey(it), it)
  return [...byKey.values()]
}
