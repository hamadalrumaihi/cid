/** Entity-layer RPC mocks (Portal Improvements plan, Phase 2 — P2-02…P2-06).
 *
 *  The CONTRACT of the server functions in migrations 20261015120000 …
 *  20261019120000, answered from the mock DB — never a second
 *  implementation of the server's matching or its authority model:
 *   · entity_suggest / entity_duplicates / entity_crossref read the seeded
 *     rows; `exact` is a normalized equality (the same normPhone /
 *     normPlate / handle rules entitySearch.ts mirrors); merged tombstones
 *     and soft-deleted rows are skipped; duplicates are STRONG only (the
 *     trigram `soft` tier is server-side and never answered here);
 *   · entity_merge / entity_merge_preview / entity_unmerge mutate the mock
 *     DB the way the protocol does for its simplest dependant
 *     (case_intel_links): repoint, drop a colliding link, tombstone, ledger;
 *   · entity_suggest_update / decide / withdraw / promote_observation follow
 *     EA6: SrDet+ applies now, a Detective queues;
 *   · siu_reconcile_resolve is SIB-only — in the mock, the Owner.
 *  Refusals are RETURNED as { ok:false, code } exactly like the server
 *  (never raised). Anything richer is pinned with scenarios.rpcResult(). */
import type { Database, Json, Tables } from '@/lib/database.types'
import { EDITABLE_FIELDS, isMergeKind, MERGE_TABLE, type MergeKind } from '@/lib/entity/kinds'
import { getDenial, getRows, getSession, mockId, seedRows, setRows, type MockRow, type MockTableName } from '../store'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Refusal = { ok: false; code: string; message: string; current?: string | null }

/* ── Normalizers (mirrors of private.norm_* — entitySearch.test pins parity) ── */

const str = (v: unknown): string => (v == null ? '' : String(v))
const low = (v: unknown): string => str(v).toLowerCase()
const normalizeQuery = (q: unknown): string => low(q).replace(/\s+/g, ' ').trim()
function normPhone(v: unknown): string | null {
  const digits = str(v).replace(/\D/g, '')
  if (!digits) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}
function normPlate(v: unknown): string | null {
  const out = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return out || null
}
function normHandle(v: unknown): string | null {
  const out = str(v).trim().replace(/^@+/, '').toLowerCase().trim()
  return out || null
}
const clamp = (n: unknown, dflt: number, max: number) => Math.min(Math.max(Number(n) || dflt, 1), max)
const dots = (...parts: unknown[]): string | null => parts.map(str).filter(Boolean).join(' · ') || null
const blank = (v: unknown): string | null => str(v).trim() || null

/* ── Session ────────────────────────────────────────────────────────────── */

const COMMAND = new Set(['bureau_lead', 'deputy_director', 'director'])
const SENIOR = new Set(['senior_detective', ...COMMAND])
function profile(): Tables<'profiles'> | null {
  const s = getSession()
  if (!s) return null
  return (getRows('profiles') as unknown as Tables<'profiles'>[]).find((p) => p.id === s.userId) ?? null
}
const isActive = (p = profile()) => !!p && p.active && p.removed_at == null
const isOwner = (p = profile()) => isActive(p) && !!p!.is_owner
const isCommand = (p = profile()) => isActive(p) && (!!p!.is_owner || COMMAND.has(p!.role ?? ''))
const isSenior = (p = profile()) => isActive(p) && (!!p!.is_owner || SENIOR.has(p!.role ?? ''))
const uid = () => getSession()?.userId ?? null

/* ── Rows ───────────────────────────────────────────────────────────────── */

/** Live (not trashed, not policy-denied) rows of a table. */
const live = (table: MockTableName): MockRow[] =>
  getDenial(table) ? [] : getRows(table).filter((r) => r.deleted_at == null)

function isMergedRow(kind: MergeKind, row: MockRow): boolean {
  if (row.merged_into != null) return true
  if (kind === 'person' || kind === 'account') return row.lifecycle === 'merged'
  if (kind === 'narcotic') return row.status === 'merged'
  return false
}
const registry = (kind: MergeKind): MockRow[] => live(MERGE_TABLE[kind]).filter((r) => !isMergedRow(kind, r))
const findRow = (table: MockTableName, id: unknown): MockRow | undefined =>
  getDenial(table) ? undefined : getRows(table).find((r) => r.id === str(id))
const caseNumber = (caseId: unknown): string | null => str(findRow('cases', caseId)?.case_number) || null

function label(kind: MergeKind, row: MockRow | undefined): string {
  if (!row) return ''
  switch (kind) {
    case 'person': return dots(row.name, row.alias) ?? ''
    case 'vehicle': return dots(row.plate, row.model, row.color) ?? ''
    case 'gang': return str(row.name)
    case 'place': return dots(row.name, row.area) ?? ''
    case 'account': return dots(`@${str(row.handle)}`, row.platform) ?? ''
    case 'narcotic': return str(row.name)
  }
}

/* ── entity_suggest ─────────────────────────────────────────────────────── */

type SuggestHit = Omit<Fns['entity_suggest']['Returns'][number], 'sublabel'> & { sublabel: string | null }

export function entitySuggest(args: Args): SuggestHit[] {
  const q = str(args.p_q)
  const lq = normalizeQuery(q)
  if (lq.length < 2 || !isActive()) return []
  const lim = clamp(args.p_limit, 20, 50)
  const np = normPhone(q), npl = normPlate(q), nh = normHandle(q), uq = q.trim().toUpperCase()
  const has = (...fields: unknown[]) => fields.some((f) => low(f).includes(lq))
  const hit = (id: unknown, kind: string, lbl: unknown, sub: string | null, exact: boolean, score = exact ? 1 : 0.5): SuggestHit =>
    ({ id: str(id), kind, label: str(lbl), sublabel: sub, score, exact })
  const out: SuggestHit[] = []

  switch (low(args.p_kind).trim()) {
    case 'person':
      for (const p of registry('person')) {
        const phoneHit = np != null && normPhone(p.phone) === np
        if (has(p.name, p.alias) || phoneHit) {
          out.push(hit(p.id, 'person', p.name, dots(p.alias, p.status), low(p.name) === lq || low(p.alias) === lq || phoneHit))
        }
      }
      break
    case 'vehicle':
      for (const v of registry('vehicle')) {
        const plateHit = npl != null && normPlate(v.plate) === npl
        if (plateHit || has(v.plate, v.model, v.color)) out.push(hit(v.id, 'vehicle', v.plate, dots(v.model, v.color), plateHit))
      }
      break
    case 'phone':
      if (np == null) return []
      for (const p of registry('person')) {
        const pn = normPhone(p.phone)
        if (pn?.startsWith(np)) out.push(hit(p.id, 'person', p.name, dots(p.phone, p.alias), pn === np, pn === np ? 1 : 0.6))
      }
      for (const i of live('indicators')) {
        const vn = normPhone(i.value)
        if (i.kind === 'phone' && vn?.startsWith(np)) {
          out.push(hit(i.id, 'indicator', i.value, dots('Indicator', caseNumber(i.case_id)), vn === np, vn === np ? 1 : 0.6))
        }
      }
      break
    case 'gang':
      for (const g of registry('gang')) {
        if (has(g.name, g.aliases)) out.push(hit(g.id, 'gang', g.name, dots(g.aliases ? `aka ${str(g.aliases)}` : null, g.status), low(g.name) === lq))
      }
      break
    case 'place':
      for (const pl of registry('place')) {
        if (has(pl.name, pl.area)) out.push(hit(pl.id, 'place', pl.name, dots(pl.type, pl.area), low(pl.name) === lq))
      }
      break
    case 'narcotic':
      for (const n of registry('narcotic')) {
        if (has(n.name)) out.push(hit(n.id, 'narcotic', n.name, dots(n.category, n.status), low(n.name) === lq))
      }
      break
    case 'case':
      for (const c of live('cases')) {
        if (has(c.case_number, c.title)) out.push(hit(c.id, 'case', c.case_number, blank(c.title), str(c.case_number).toUpperCase() === uq))
      }
      break
    case 'indicator':
      for (const i of live('indicators')) {
        const vn = i.kind === 'phone' ? normPhone(i.value) : low(i.value).trim()
        const exact = vn === lq || (np != null && i.kind === 'phone' && vn === np)
        if (exact || has(i.value)) out.push(hit(i.id, 'indicator', i.value, dots(i.kind, caseNumber(i.case_id)), exact))
      }
      break
    case 'account':
      for (const a of registry('account')) {
        const handleHit = nh != null && normHandle(a.handle) === nh
        if (handleHit || has(a.handle, a.display_name)) out.push(hit(a.id, 'account', `@${str(a.handle)}`, dots(a.platform, a.display_name), handleHit))
      }
      break
    default:
      return []
  }
  return out
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, lim)
}

/* ── entity_duplicates (strong signals only) ────────────────────────────── */

type DupRow = Omit<Fns['entity_duplicates']['Returns'][number], 'sublabel'> & { sublabel: string | null }

export function entityDuplicates(args: Args): DupRow[] {
  if (!isActive()) return []
  const j = (args.p_payload ?? {}) as Record<string, unknown>
  const name = normalizeQuery(j.name), alias = normalizeQuery(j.alias), area = normalizeQuery(j.area)
  const platform = normalizeQuery(j.platform), value = normalizeQuery(j.value), ikind = normalizeQuery(j.kind)
  const dob = blank(j.dob), phone = normPhone(j.phone), plate = normPlate(j.plate), handle = normHandle(j.handle)
  const caseNo = str(j.case_number).trim().toUpperCase(), exclude = blank(j.exclude_id)
  const out: DupRow[] = []
  const push = (id: unknown, lbl: unknown, sub: string | null, signal: string, score = 1) => {
    if (str(id) === exclude || out.some((d) => d.id === str(id))) return
    out.push({ id: str(id), label: str(lbl), sublabel: sub, signal, strength: 'strong', score })
  }

  switch (low(args.p_kind).trim()) {
    case 'person':
      for (const p of registry('person')) {
        const sub = dots(p.alias, p.dob, p.phone)
        if (phone != null && normPhone(p.phone) === phone) push(p.id, p.name, sub, 'phone')
        else if (name && low(p.name) === name && (dob == null || p.dob == null || p.dob === dob)) push(p.id, p.name, sub, dob != null && p.dob === dob ? 'name+dob' : 'name')
        else if (alias && (low(p.alias) === alias || low(p.name) === alias)) push(p.id, p.name, sub, 'alias', 0.9)
      }
      break
    case 'vehicle':
      for (const v of registry('vehicle')) if (plate != null && normPlate(v.plate) === plate) push(v.id, v.plate, dots(v.model, v.color), 'plate')
      break
    case 'gang':
      for (const g of registry('gang')) if (name && low(g.name) === name) push(g.id, g.name, blank(g.aliases), 'name')
      break
    case 'place':
      for (const pl of registry('place')) {
        if (name && low(pl.name) === name && (!area || pl.area == null || low(pl.area) === area)) {
          push(pl.id, pl.name, dots(pl.type, pl.area), area && low(pl.area) === area ? 'name+area' : 'name')
        }
      }
      break
    case 'account':
      for (const a of registry('account')) {
        if (handle != null && normHandle(a.handle) === handle && (!platform || low(a.platform) === platform)) push(a.id, `@${str(a.handle)}`, dots(a.platform, a.display_name), 'handle')
      }
      break
    case 'narcotic':
      for (const n of registry('narcotic')) if (name && low(n.name) === name) push(n.id, n.name, dots(n.category, n.status), 'name')
      break
    case 'indicator':
      for (const i of live('indicators')) {
        if (!value || (ikind && i.kind !== ikind)) continue
        const want = i.kind === 'phone' ? (normPhone(j.value) ?? value) : value
        const have = i.kind === 'phone' ? normPhone(i.value) : low(i.value).trim()
        if (have === want) push(i.id, i.value, dots(i.kind, caseNumber(i.case_id)), 'value')
      }
      break
    case 'case':
      // The soft `title~` tier is a server-side trigram match — never answered here.
      for (const c of live('cases')) if (caseNo && str(c.case_number).toUpperCase() === caseNo) push(c.id, c.case_number, blank(c.title), 'case_number')
      break
    default:
      return []
  }
  return out.slice(0, 20)
}

/* ── entity_crossref ────────────────────────────────────────────────────── */

type CrossrefRow = Omit<Fns['entity_crossref']['Returns'][number], 'title' | 'detail' | 'observed_at'>
  & { title: string | null; detail: string | null; observed_at: string | null }

export function entityCrossref(args: Args): CrossrefRow[] {
  if (!isActive()) return []
  const k = low(args.p_kind).trim()
  const id = str(args.p_id)
  const lim = clamp(args.p_limit, 50, 200)
  const cases = live('cases')
  const out: CrossrefRow[] = []
  const push = (caseId: unknown, via: string, detail: unknown, at: unknown) => {
    const c = cases.find((r) => r.id === str(caseId))
    if (!c) return
    out.push({ case_id: str(c.id), case_number: str(c.case_number), title: blank(c.title), bureau: str(c.bureau), via, detail: blank(detail), observed_at: blank(at) })
  }
  const links = (kind: string, ref: string) => {
    for (const l of live('case_intel_links')) if (l.kind === kind && l.ref_id === ref) push(l.case_id, 'link', l.role ?? 'linked', l.created_at)
  }
  if (isMergeKind(k)) {
    if (!findRow(MERGE_TABLE[k], id)) return []
    links(k, id)
  } else if (k === 'indicator') {
    const me = findRow('indicators', id)
    if (!me) return []
    const mine = me.kind === 'phone' ? normPhone(me.value) : low(me.value).trim()
    for (const i of live('indicators')) {
      const v = i.kind === 'phone' ? normPhone(i.value) : low(i.value).trim()
      if (i.id !== id && i.kind === me.kind && v === mine) push(i.case_id, 'indicator', `${str(i.kind)} · ${str(i.value)}`, i.created_at)
    }
  } else if (k === 'phone') {
    const np = normPhone(args.p_q)
    if (np == null || np.length < 6) return []
    for (const i of live('indicators')) if (i.kind === 'phone' && normPhone(i.value) === np) push(i.case_id, 'indicator', i.value, i.created_at)
    for (const p of registry('person')) {
      if (normPhone(p.phone) !== np) continue
      for (const l of live('case_intel_links')) if (l.kind === 'person' && l.ref_id === p.id) push(l.case_id, 'person', p.name, l.created_at)
    }
  } else {
    return []
  }
  return out.sort((a, b) => str(b.observed_at).localeCompare(str(a.observed_at))).slice(0, lim)
}

/* ── merge protocol ─────────────────────────────────────────────────────── */

type Dropped = { table: string; why: string; row: Record<string, Json> }
type VictimManifest = {
  id: string; label: string; repointed: Record<string, number>; repointed_ids: Record<string, string[]>
  dropped: Dropped[]; scalar_fill: Record<string, { from: Json; to: Json }>; notes_from: string | null; tombstone: string
}
type Manifest = { survivor: { id: string; label: string }; victims: VictimManifest[]; added_aliases: Json[] }

const refuse = (code: string, message: string, extra: Partial<Refusal> = {}): Refusal => ({ ok: false, code, message, ...extra })

function mergeCheck(kind: string, survivor: unknown, victims: unknown, reason: unknown, needReason: boolean): Refusal | null {
  if (!isMergeKind(kind)) return refuse('bad_request', 'unknown record kind')
  // Bureau Lead or higher (Owner included) for every kind — the narcotic
  // arm's can_manage_narcotics() is the same rank test.
  if (!isCommand()) {
    return refuse('denied', kind === 'narcotic' ? 'narcotic merge is restricted to Bureau Lead or higher' : `${kind} merge is restricted to command (Bureau Lead or higher)`)
  }
  if (needReason && !blank(reason)) return refuse('reason_required', `a reason is required to merge ${kind} records`)
  const ids = Array.isArray(victims) ? victims.map(str).filter(Boolean) : []
  const s = str(survivor)
  if (!s || ids.length === 0) return refuse('bad_request', 'both the survivor and at least one merge victim are required')
  if (ids.includes(s)) return refuse('bad_request', 'the survivor cannot also be a merge victim')
  if (new Set(ids).size !== ids.length) return refuse('bad_request', 'a merge victim is listed twice')
  const table = MERGE_TABLE[kind]
  const check = (id: string, who: string): Refusal | null => {
    const row = findRow(table, id)
    if (!row) return refuse('not_found', `${who} ${kind} not found`)
    if (isMergedRow(kind, row)) return refuse('already_merged', `${kind} ${id} is already merged`)
    if (row.deleted_at != null) return refuse('deleted', `${kind} ${id} is in the Trash — restore it before merging`)
    return null
  }
  return check(s, 'survivor') ?? ids.map((v) => check(v, 'merge victim')).find((r) => r !== null) ?? null
}

/** Apply (or, dry, only compute) a merge over the one dependant the mock
 *  models: case_intel_links (unique (case_id, kind, ref_id) → a colliding
 *  link is dropped, the rest repointed). */
function mergeApply(kind: MergeKind, survivor: string, victims: string[], reason: string, dry: boolean, mergeId: string): Manifest {
  const table = MERGE_TABLE[kind]
  const out: VictimManifest[] = []
  for (const victim of victims) {
    const links = getRows('case_intel_links')
    const repointedIds: string[] = []
    const dropped: Dropped[] = []
    for (const l of links) {
      if (l.kind !== kind || l.ref_id !== victim || l.deleted_at != null) continue
      const collides = links.some((o) => o !== l && o.kind === kind && o.ref_id === survivor && o.case_id === l.case_id)
      if (collides) {
        dropped.push({ table: 'case_intel_links', why: 'unique:case_intel_links_case_id_kind_ref_id_key', row: { ...l } as Record<string, Json> })
      } else {
        repointedIds.push(str(l.id))
      }
    }
    if (!dry) {
      const dropIds = new Set(dropped.map((d) => str(d.row.id)))
      for (const l of links) if (repointedIds.includes(str(l.id))) l.ref_id = survivor
      setRows('case_intel_links', links.filter((l) => !dropIds.has(str(l.id))))
      const row = findRow(table, victim)!
      if (kind === 'person' || kind === 'account') Object.assign(row, { lifecycle: 'merged', merged_into: survivor })
      else if (kind === 'narcotic') Object.assign(row, { status: 'merged', merged_into: survivor })
      else {
        Object.assign(row, {
          merged_into: survivor, deleted_at: new Date().toISOString(), deleted_by: uid(),
          delete_reason: `merged into ${label(kind, findRow(table, survivor))}`, delete_batch: mergeId,
        })
      }
    }
    out.push({
      id: victim, label: label(kind, findRow(table, victim)),
      repointed: repointedIds.length ? { 'case_intel_links.ref_id': repointedIds.length } : {},
      repointed_ids: repointedIds.length ? { 'case_intel_links.ref_id': repointedIds } : {},
      dropped, scalar_fill: {}, notes_from: null,
      tombstone: kind === 'person' || kind === 'account' ? 'lifecycle' : kind === 'narcotic' ? 'status' : 'soft_delete',
    })
  }
  void reason
  return { survivor: { id: survivor, label: label(kind, findRow(table, survivor)) }, victims: out, added_aliases: [] }
}

export function entityMergePreview(args: Args): Json {
  const kind = low(args.p_kind).trim()
  const refusal = mergeCheck(kind, args.p_survivor, args.p_victims, null, false)
  if (refusal) return refusal
  const manifest = mergeApply(kind as MergeKind, str(args.p_survivor), (args.p_victims as unknown[]).map(str), '', true, '')
  return { ok: true, kind, manifest }
}

export function entityMerge(args: Args): Json {
  const kind = low(args.p_kind).trim()
  const refusal = mergeCheck(kind, args.p_survivor, args.p_victims, args.p_reason, true)
  if (refusal) return refusal
  const k = kind as MergeKind
  const survivor = str(args.p_survivor)
  const victims = (args.p_victims as unknown[]).map(str)
  const id = mockId()
  const snapshots = victims.map((v) => ({ ...findRow(MERGE_TABLE[k], v)! }) as Record<string, Json>)
  const manifest = mergeApply(k, survivor, victims, str(args.p_reason).trim(), false, id)
  seedRows('entity_merges', [{
    id, kind, survivor_id: survivor, victim_ids: victims, manifest, victim_snapshots: snapshots,
    actor_id: uid(), reason: str(args.p_reason).trim().slice(0, 500), created_at: new Date().toISOString(),
    reversed_at: null, reversed_by: null, reverse_reason: null,
  }])
  return { ok: true, merge_id: id, kind, survivor_id: survivor, victim_ids: victims, manifest }
}

export function entityUnmerge(args: Args): Json {
  const m = findRow('entity_merges', args.p_merge_id) as unknown as Tables<'entity_merges'> | undefined
  if (!m) return refuse('not_found', 'merge not found')
  const kind = m.kind as MergeKind
  const table = MERGE_TABLE[kind]
  if (!isCommand() || !findRow(table, m.survivor_id)) return refuse('denied', 'unmerge is restricted to command (Bureau Lead or higher)')
  const reason = blank(args.p_reason)
  if (!reason) return refuse('reason_required', 'a reason is required to unmerge')
  if (m.reversed_at) return refuse('already_reversed', 'this merge was already reversed')
  if (Date.parse(m.created_at) < Date.now() - 30 * 24 * 60 * 60 * 1000) return refuse('window_closed', 'a merge can only be reversed within 30 days')
  if (isMergedRow(kind, findRow(table, m.survivor_id)!)) return refuse('survivor_merged', 'the survivor has since been merged itself — reverse that merge first')

  let restored = 0
  const manifest = m.manifest as unknown as Manifest
  const snapshots = m.victim_snapshots as unknown as Record<string, Json>[]
  for (const v of manifest.victims) {
    const row = findRow(table, v.id)
    const snap = snapshots.find((s) => s.id === v.id)
    if (!row || !snap) continue
    if (kind === 'person' || kind === 'account') Object.assign(row, { lifecycle: snap.lifecycle ?? 'active', merged_into: null })
    else if (kind === 'narcotic') Object.assign(row, { status: snap.status ?? 'reported', merged_into: null })
    else if (row.delete_batch === m.id) Object.assign(row, { merged_into: null, deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null })
    const links = getRows('case_intel_links')
    for (const id of v.repointed_ids['case_intel_links.ref_id'] ?? []) {
      const l = links.find((r) => r.id === id)
      if (l && l.ref_id === m.survivor_id) l.ref_id = v.id
    }
    for (const d of v.dropped) if (!links.some((r) => r.id === d.row.id)) links.push({ ...d.row })
    restored += 1
  }
  Object.assign(m, { reversed_at: new Date().toISOString(), reversed_by: uid(), reverse_reason: reason })
  return { ok: true, merge_id: m.id, kind, survivor_id: m.survivor_id, restored }
}

/* ── update suggestions / observations ──────────────────────────────────── */

function applyField(kind: MergeKind, id: string, field: string, value: string | null): { ok: true; from: string | null; to: string | null; changed: boolean } | Refusal {
  const row = findRow(MERGE_TABLE[kind], id)
  if (!row) return refuse('not_found', 'record not found')
  if (row.deleted_at != null || isMergedRow(kind, row)) return refuse('not_editable', 'a merged or trashed record is not edited')
  const from = row[field] == null ? null : str(row[field])
  if (from === value) return { ok: true, from, to: value, changed: false }
  row[field] = value
  return { ok: true, from, to: value, changed: true }
}

function suggestUpdate(kind: string, id: string, field: string, rawValue: unknown, rawReason: unknown, expected: unknown, observationId: string | null): Json {
  if (!isMergeKind(kind) || !EDITABLE_FIELDS[kind].includes(field)) return refuse('bad_request', 'that field cannot be updated this way')
  if (!isActive() || getDenial(MERGE_TABLE[kind])) return refuse('denied', 'you cannot edit this record')
  const reason = blank(rawReason)
  if (!reason) return refuse('reason_required', 'say why the record should change')
  const row = findRow(MERGE_TABLE[kind], id)
  if (!row) return refuse('not_found', 'record not found')
  const value = blank(rawValue)
  const current = row[field] == null ? null : str(row[field])
  if (expected != null && current !== blank(expected)) return refuse('stale', 'the record changed since you looked — review the current value', { current })
  if (current === value) return refuse('no_change', 'the record already carries that value', { current })
  const now = new Date().toISOString()
  const suggestionId = mockId()
  const base: Tables<'entity_update_suggestions'> = {
    id: suggestionId, kind, ref_id: id, field, proposed_value: value, current_value: current, reason: reason.slice(0, 500),
    proposed_by: uid(), created_at: now, status: 'pending', decided_by: null, decided_at: null, decision_note: null,
    source_observation_id: observationId,
  }
  if (isSenior()) {
    const res = applyField(kind, id, field, value)
    if (!res.ok) return res
    seedRows('entity_update_suggestions', [{ ...base, status: 'accepted', decided_by: uid(), decided_at: now }])
    return { ok: true, applied: true, suggestion_id: suggestionId, from: current, to: value }
  }
  seedRows('entity_update_suggestions', [base])
  return { ok: true, applied: false, suggestion_id: suggestionId, from: current, to: value }
}

export function entitySuggestUpdate(args: Args): Json {
  return suggestUpdate(low(args.p_kind).trim(), str(args.p_id), low(args.p_field).trim(), args.p_value, args.p_reason,
    args.p_expected_current ?? null, blank(args.p_observation_id))
}

export function entitySuggestionDecide(args: Args): Json {
  const s = findRow('entity_update_suggestions', args.p_id) as unknown as Tables<'entity_update_suggestions'> | undefined
  if (!s) return refuse('not_found', 'suggestion not found')
  const kind = s.kind as MergeKind
  if (!isSenior() || getDenial(MERGE_TABLE[kind])) return refuse('denied', 'a Senior Detective or higher with edit authority decides suggestions')
  if (s.status !== 'pending') return refuse('already_decided', `this suggestion was already ${s.status}`)
  const accept = !!args.p_accept
  let changed = false
  if (accept) {
    const res = applyField(kind, s.ref_id, s.field, s.proposed_value)
    if (!res.ok) return res
    changed = res.changed
    const o = s.source_observation_id ? findRow('entity_field_observations', s.source_observation_id) : undefined
    if (o && o.promoted_at == null) Object.assign(o, { promoted_at: new Date().toISOString(), promoted_by: uid() })
  }
  Object.assign(s, { status: accept ? 'accepted' : 'declined', decided_by: uid(), decided_at: new Date().toISOString(), decision_note: blank(args.p_note)?.slice(0, 500) ?? null })
  return { ok: true, id: s.id, accepted: accept, changed }
}

export function entitySuggestionWithdraw(args: Args): Json {
  const s = findRow('entity_update_suggestions', args.p_id)
  if (!s) return refuse('not_found', 'suggestion not found')
  if (!uid() || s.proposed_by !== uid()) return refuse('denied', 'only the proposer withdraws a suggestion')
  if (s.status !== 'pending') return refuse('already_decided', `this suggestion was already ${str(s.status)}`)
  Object.assign(s, { status: 'withdrawn', decided_by: uid(), decided_at: new Date().toISOString() })
  return { ok: true, id: str(s.id) }
}

export function promoteObservation(args: Args): Json {
  const o = findRow('entity_field_observations', args.p_id)
  if (!o) return refuse('not_found', 'observation not found')
  if (!isActive() || !findRow('cases', o.case_id)) return refuse('denied', 'you cannot promote this observation')
  if (o.promoted_at != null) return refuse('already_promoted', 'this observation was already promoted')
  const reason = blank(args.p_reason)
  if (!reason) return refuse('reason_required', 'say why the master record should carry this value')
  const res = suggestUpdate(str(o.kind), str(o.ref_id), str(o.field), o.value, reason, null, str(o.id))
  if (!res || typeof res !== 'object' || Array.isArray(res) || !res.ok) return res
  if (res.applied) Object.assign(o, { promoted_at: new Date().toISOString(), promoted_by: uid() })
  return { ...res, observation_id: str(o.id) }
}

/* ── siu_reconcile_resolve ──────────────────────────────────────────────── */

export function siuReconcileResolve(args: Args): Json {
  if (!isOwner()) return refuse('denied', 'only SIB agents resolve the reconcile queue')
  const res = low(args.p_resolution).trim()
  if (!['link', 'merge', 'dismiss'].includes(res)) return refuse('bad_request', 'resolution must be link, merge or dismiss')
  const q = findRow('siu_reconcile_queue', args.p_id)
  if (!q) return refuse('not_found', 'queue item not found')
  if (q.resolved_at != null) return refuse('already_resolved', 'this item is already resolved')
  const note = blank(args.p_note)?.slice(0, 500) ?? null
  let mergeId: string | null = null
  if (res === 'merge') {
    if (!note) return refuse('reason_required', 'a reason is required to merge')
    const m = entityMerge({ p_kind: q.kind, p_survivor: q.hidden_record_id, p_victims: [q.cid_record_id], p_reason: note })
    if (!m || typeof m !== 'object' || Array.isArray(m) || !m.ok) return m
    mergeId = str(m.merge_id)
  }
  Object.assign(q, { resolved_at: new Date().toISOString(), resolved_by: uid(), resolution: res, note })
  return { ok: true, id: str(q.id), resolution: res, merge_id: mergeId }
}

/** fn → handler, consumed by the rpc.ts switch's default arm. */
export const ENTITY_RPCS: Record<string, (args: Args) => unknown> = {
  entity_suggest: entitySuggest,
  entity_duplicates: entityDuplicates,
  entity_crossref: entityCrossref,
  entity_merge_preview: entityMergePreview,
  entity_merge: entityMerge,
  entity_unmerge: entityUnmerge,
  entity_suggest_update: entitySuggestUpdate,
  entity_suggestion_decide: entitySuggestionDecide,
  entity_suggestion_withdraw: entitySuggestionWithdraw,
  promote_observation: promoteObservation,
  siu_reconcile_resolve: siuReconcileResolve,
}
