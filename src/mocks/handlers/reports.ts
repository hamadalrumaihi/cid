/** Report-builder mocks (Portal Improvements plan, Phase 5 — P5-01 … P5-07;
 *  migrations 20261028120000_report_templates → 20261029120000_report_review).
 *
 *  The CONTRACT of the server functions, answered from the mock DB — never
 *  a second implementation of the server's audit ledger or its authority
 *  model. Four surfaces:
 *
 *   · report_templates / report_template_versions are SEEDED lazily from
 *     src/lib/forms.ts (the 14 FORM_SCHEMAS as version 1, published;
 *     `review_required` false only for the four legal drafting forms;
 *     `required` from TEMPLATE_REQUIRED — the mirror of the migration's
 *     REQUIRED map). Reads: any active member or the Owner. report_entities
 *     and report_exports read through the parent report (the case must be
 *     readable). Every client write to the four tables is refused with
 *     42501 by `reportHandlers` (RPC-only).
 *   · The report flow RPCs (report_create / report_submit / report_review /
 *     report_finalize / report_reopen) and the task waivers RETURN the row
 *     and RAISE (ReportRpcError → PostgREST 400) exactly where the server
 *     raises: missing required fields, the case_closure open-task gate,
 *     review-required templates refusing report_finalize, a reopen without
 *     a reason.
 *   · The jsonb RPCs (report_template_save / publish / discard / update,
 *     report_entities_set, report_record_export) answer {ok:true, …} or
 *     {ok:false, code:'denied', message} for authority refusals and raise
 *     only on hard validation errors (a malformed schema, an unreadable
 *     ref), as the server does.
 *   · `private.block_direct_report_finalize` — the client-facing trigger —
 *     is mirrored by `reportUpdateGuard` for direct PATCHes of `reports`
 *     (workflow columns are RPC-only; `fields` lock once submitted /
 *     sealed) and by `pinReportTemplateVersion` for direct INSERTs (the
 *     BEFORE INSERT pin of `template_version_id`).
 *
 *  The mock's case-access reading is the entity layer's plus a bureau
 *  wall: active member of the case bureau (JTF: any), the lead / creator,
 *  Deputy Director+ anywhere, the Owner. Anything richer is pinned with
 *  scenarios.rpcResult(). */
import { http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { FORM_SCHEMAS, REPORT_TEMPLATES, type FormSchema } from '@/lib/forms'
import { supabaseBaseUrl } from '../env'
import { getDenial, getRows, mockId, mockTimestamp, seedRows, setRows, type MockRow, type MockTableName } from '../store'
import { findRow, isActive, isOwner, profile, uid } from './entity'
import { canViewLegalRequest } from './legal'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Report = Tables<'reports'>
type Template = Tables<'report_templates'>
type Version = Tables<'report_template_versions'>
type Denied = { ok: false; code: 'denied'; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): boolean => str(v).trim() === ''
const now = () => new Date().toISOString()

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape. */
export class ReportRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
const raise = (message: string): never => { throw new ReportRpcError(message) }
const denied = (message: string): Denied => ({ ok: false, code: 'denied', message })

/* ── Vocabulary (mirrors of the migration CHECKs) ───────────────────────── */

/** RPC-only tables: no client INSERT / UPDATE / DELETE, ever. */
export const REPORT_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'report_templates', 'report_template_versions', 'report_entities', 'report_exports',
]
const REPORT_TABLES = new Set<MockTableName>(REPORT_RPC_ONLY_TABLES)
const ENTITY_KINDS = new Set(['person', 'vehicle', 'gang', 'place', 'evidence', 'media', 'officer', 'charge', 'legal_request', 'case', 'timeline_event'])
const REVIEW_ROLES = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])
const WIDE_COMMAND = new Set(['deputy_director', 'director'])
const REPORT_KINDS = new Set(['initial', 'supplemental', 'followup'])
const EXPORT_FORMATS = new Set(['pdf', 'docx', 'md'])
/** reports columns only the definer RPCs may change (block_direct_report_finalize). */
const REPORT_RPC_COLUMNS = new Set([
  'finalized', 'signature', 'review_status', 'submitted_at', 'submitted_by', 'reviewed_by', 'reviewed_at',
  'review_note', 'reviewer_signature', 'template_version_id',
])
/** The legal drafting forms carry their own review (a legal request); every narrative report is reviewed. */
const SELF_SEAL_TEMPLATES = new Set(['arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena'])

/** Mirror of the migration's REQUIRED map: the case number, the date, the
 *  detective / affiant field and the primary narrative key of each
 *  template — only keys the schema actually carries (raid_seizure has no
 *  detective or narrative field). The client never hard-codes these; it
 *  reads the pinned version. */
export const TEMPLATE_REQUIRED: Record<string, string[]> = {
  cid_investigative_report: ['case_number', 'filed_at', 'det_name', 'narrative'],
  raid_seizure: ['case_number', 'seizure_date'],
  uc_operation: ['op_code', 'submitted', 'uc_officer', 'summary'],
  arrest_warrant: ['case_number', 'date', 'detective', 'probable_cause'],
  search_warrant: ['case_number', 'date', 'affiant', 'probable_cause'],
  wiretap_warrant: ['case_number', 'date', 'detective', 'probable_cause'],
  subpoena: ['case_number', 'date', 'detective', 'records_requested'],
  surveillance_report: ['case_number', 'date', 'detective', 'scope'],
  incident_followup: ['case_number', 'date', 'detective', 'narrative'],
  interview: ['case_number', 'date', 'detective', 'narrative'],
  arrest_report: ['case_number', 'date', 'detective', 'narrative'],
  search_report: ['case_number', 'date', 'detective', 'narrative'],
  case_closure: ['case_number', 'date', 'detective', 'summary'],
  warrant_return: ['case_number', 'executed_on', 'detective', 'return_narrative'],
}

/* ── Session / access ───────────────────────────────────────────────────── */

const role = (p = profile()) => p?.role ?? ''
const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]

/** The mock's private.can_read_case for an arbitrary profile. */
function canReadCaseAs(p: Tables<'profiles'> | null, kase: MockRow | undefined): boolean {
  if (!kase || !isActive(p) || kase.deleted_at != null) return false
  if (p!.is_owner || WIDE_COMMAND.has(p!.role ?? '')) return true
  if (kase.bureau === 'JTF' || kase.bureau === p!.division) return true
  return kase.lead_detective_id === p!.id || kase.created_by === p!.id
}
const caseOf = (id: unknown): MockRow | undefined => findRow('cases', id)
const canReadCase = (kase: MockRow | undefined) => canReadCaseAs(profile(), kase)
const canWriteCase = (kase: MockRow | undefined) => canReadCase(kase) && kase!.archived_at == null
/** Bureau Lead of the case bureau (JTF: any), DD / Director, Owner. */
function bureauCommand(kase: MockRow, p = profile()): boolean {
  if (!isActive(p)) return false
  if (p!.is_owner || WIDE_COMMAND.has(p!.role ?? '')) return true
  return p!.role === 'bureau_lead' && (kase.bureau === 'JTF' || kase.bureau === p!.division)
}

const reportOf = (id: unknown): Report | undefined => {
  const r = findRow('reports', id) as Report | undefined
  return r && r.deleted_at == null ? r : undefined
}
const canReadReport = (r: Report | undefined): boolean => !!r && canReadCase(caseOf(r.case_id))

/** The generic table handler runs the Phase 5 tables through this. */
export function visibleReportRows(table: MockTableName, list: MockRow[]): MockRow[] {
  if (!REPORT_TABLES.has(table)) return list
  if (table === 'report_templates' || table === 'report_template_versions') return isActive() || isOwner() ? list : []
  return list.filter((row) => canReadReport(reportOf(row.report_id)))
}

/* ── Template seed ──────────────────────────────────────────────────────── */

/** Seed the 14 FORM_SCHEMAS as published version 1 (the migration's seed).
 *  Idempotent per key. Returns the rows it created. */
export function seedReportTemplates(): { templates: Template[]; versions: Version[] } {
  const existing = new Set(rows('report_templates').map((t) => t.key))
  const templates: Template[] = []
  const versions: Version[] = []
  REPORT_TEMPLATES.forEach((tpl, i) => {
    if (existing.has(tpl.id)) return
    const [t] = seedRows('report_templates', [{
      active: true, created_at: mockTimestamp(), created_by: null, description: null, id: mockId(),
      is_default: tpl.isDefault, key: tpl.id, name: tpl.name, sort_order: i + 1, updated_at: mockTimestamp(),
    }])
    const [v] = seedRows('report_template_versions', [{
      advisory: [], change_summary: 'Seeded from FORM_SCHEMAS', created_at: mockTimestamp(), created_by: null, id: mockId(),
      published_at: mockTimestamp(), published_by: null, required: [...(TEMPLATE_REQUIRED[tpl.id] ?? ['case_number'])],
      review_required: !SELF_SEAL_TEMPLATES.has(tpl.id), schema: tpl.schema as unknown as Json, status: 'published',
      superseded_at: null, template_id: t.id, version_number: 1,
    }])
    templates.push(t); versions.push(v)
  })
  return { templates, versions }
}
/** Lazy seed: a store with no templates behaves like the migrated database. */
export function ensureReportTemplates(): void {
  if (!getRows('report_templates').length) seedReportTemplates()
}

const templateByKey = (key: unknown): Template | undefined => rows('report_templates').find((t) => t.key === str(key))
const templateById = (id: unknown): Template | undefined => rows('report_templates').find((t) => t.id === str(id))
const versionsOf = (templateId: string): Version[] => rows('report_template_versions').filter((v) => v.template_id === templateId)
const publishedVersion = (templateId: string): Version | undefined => versionsOf(templateId).find((v) => v.status === 'published')
const versionById = (id: unknown): Version | undefined => rows('report_template_versions').find((v) => v.id === str(id))

/* ── Schema validation (the server's shape check) ───────────────────────── */

type Section = FormSchema['sections'][number]
const FIELD_TYPES = new Set(['text', 'date', 'money', 'select', 'textarea', 'checks'])
const SECTION_TYPES = new Set(['kv', 'grid', 'textarea', 'note'])

/** Validates the FormSchema shape and returns every value key it carries
 *  (kv field keys, textarea keys, grid section ids). Raises on a problem. */
function validateSchema(schema: unknown): { keys: Set<string>; labels: Map<string, string> } {
  const s = schema as Partial<FormSchema> | null
  if (!s || typeof s !== 'object' || Array.isArray(s)) return raise('schema must be an object')
  if (blank(s.title) || typeof s.subtitle !== 'string') return raise('schema needs a title and a subtitle')
  if (!Array.isArray(s.sections) || !s.sections.length) return raise('schema needs at least one section')
  const keys = new Set<string>(), labels = new Map<string, string>(), ids = new Set<string>()
  const addKey = (k: unknown, label: string) => {
    const key = str(k)
    if (!key) return raise('every field needs a key')
    if (keys.has(key)) return raise(`duplicate field key "${key}"`)
    keys.add(key); labels.set(key, label)
  }
  for (const sec of s.sections as Partial<Section>[]) {
    if (!sec || blank(sec.id) || blank(sec.label) || !SECTION_TYPES.has(str(sec.type))) return raise('every section needs an id, a label and a type in kv|grid|textarea|note')
    if (ids.has(sec.id!)) return raise(`duplicate section id "${sec.id}"`)
    ids.add(sec.id!)
    if (sec.type === 'kv') {
      const fields = (sec as { fields?: unknown }).fields
      if (!Array.isArray(fields) || !fields.length) return raise(`kv section "${sec.id}" needs fields`)
      for (const f of fields as Args[]) {
        if (blank(f.label) || !FIELD_TYPES.has(str(f.type))) return raise(`field "${str(f.key)}" needs a label and a type in text|date|money|select|textarea|checks`)
        if ((f.type === 'select' || f.type === 'checks') && !Array.isArray(f.opts)) return raise(`field "${str(f.key)}" needs opts`)
        addKey(f.key, str(f.label))
      }
    } else if (sec.type === 'grid') {
      const cols = (sec as { cols?: unknown }).cols
      if (!Array.isArray(cols) || !cols.length || (cols as Args[]).some((c) => blank(c.key) || blank(c.label))) return raise(`grid section "${sec.id}" needs cols with key and label`)
      addKey(sec.id, str(sec.label))
    } else if (sec.type === 'textarea') {
      addKey((sec as { key?: unknown }).key, str(sec.label))
    } else if (blank((sec as { text?: unknown }).text)) {
      return raise(`note section "${sec.id}" needs text`)
    }
  }
  return { keys, labels }
}
function keyList(v: unknown, what: string): string[] {
  if (v == null) return []
  if (!Array.isArray(v) || v.some((k) => typeof k !== 'string')) return raise(`${what} must be an array of field keys`)
  return [...new Set(v as string[])]
}

/* ── Audit + notifications ──────────────────────────────────────────────── */

function audit(action: string, entity: string, entityId: string, detail: Json | null = null): void {
  seedRows('audit_log', [{
    action, actor_id: uid(), created_at: now(), detail, entity, entity_id: entityId,
    id: getRows('audit_log').length + 1, prev_hash: null, row_hash: null,
  }])
}
function notify(userIds: Iterable<string | null | undefined>, kind: string, payload: Json): number {
  const me = uid()
  const targets = [...new Set([...userIds].filter((id): id is string => !!id && id !== me))]
  seedRows('notifications', targets.map((user_id) => ({ created_at: now(), id: mockId(), payload, read: false, type: kind, user_id })))
  return targets.length
}
function payloadFor(r: Report, kase: MockRow, extra: Record<string, Json> = {}): Json {
  const me = profile()
  return {
    report_id: r.id, case_id: r.case_id, case_number: str(kase.case_number), template: r.template,
    title: templateByKey(r.template)?.name ?? r.template, actor_id: me?.id ?? null, actor_name: me?.display_name ?? null, ...extra,
  }
}
/** private.report_reviewers(case): active, case access, not the author, a review rank. */
function reviewersOf(r: Report, kase: MockRow): string[] {
  return rows('profiles')
    .filter((p) => p.id !== r.author_id && REVIEW_ROLES.has(p.role ?? '') && canReadCaseAs(p, kase)
      && (WIDE_COMMAND.has(p.role ?? '') || kase.bureau === 'JTF' || p.division === kase.bureau))
    .map((p) => p.id)
}

/* ── Template administration (jsonb) ───────────────────────────────────── */

const isTemplateAdmin = () => isActive() && (isOwner() || WIDE_COMMAND.has(role()))
const isTemplateProposer = () => isActive() && (isOwner() || role() === 'bureau_lead' || WIDE_COMMAND.has(role()))

/** report_template_save(p_key, p_name, p_schema, p_required, p_advisory, p_review_required, p_change_summary, p_description). */
export function reportTemplateSave(args: Args): Fns['report_template_save']['Returns'] {
  ensureReportTemplates()
  const key = str(args.p_key).trim()
  if (!key || blank(args.p_name)) return raise('a template needs a key and a name')
  let tpl = templateByKey(key)
  if (!tpl && !isTemplateAdmin()) return denied('only a Director, Deputy Director or the Owner may create a template')
  if (tpl && !isTemplateProposer()) return denied('only a Bureau Lead or above may propose a template version')
  const { keys, labels } = validateSchema(args.p_schema)
  void labels
  const required = keyList(args.p_required, 'required'), advisory = keyList(args.p_advisory, 'advisory')
  for (const k of [...required, ...advisory]) if (!keys.has(k)) return raise(`required / advisory key "${k}" is not in the schema`)
  if (!tpl) {
    ;[tpl] = seedRows('report_templates', [{
      active: true, created_at: now(), created_by: uid(), description: blank(args.p_description) ? null : str(args.p_description),
      id: mockId(), is_default: false, key, name: str(args.p_name).trim(), sort_order: rows('report_templates').length + 1, updated_at: now(),
    }])
  }
  // One draft per template: a new save REPLACES it.
  const existing = versionsOf(tpl.id)
  const draft = existing.find((v) => v.status === 'draft')
  if (draft) setRows('report_template_versions', getRows('report_template_versions').filter((v) => v.id !== draft.id))
  const number = draft ? draft.version_number : Math.max(0, ...existing.map((v) => v.version_number)) + 1
  const [v] = seedRows('report_template_versions', [{
    advisory, change_summary: blank(args.p_change_summary) ? null : str(args.p_change_summary), created_at: now(), created_by: uid(),
    id: mockId(), published_at: null, published_by: null, required, review_required: args.p_review_required !== false,
    schema: args.p_schema as Json, status: 'draft', superseded_at: null, template_id: tpl.id, version_number: number,
  }])
  return { ok: true, template_id: tpl.id, version_id: v.id, version_number: number }
}

/** report_template_publish(p_version, p_note) — Director / DD / Owner. */
export function reportTemplatePublish(args: Args): Fns['report_template_publish']['Returns'] {
  if (!isTemplateAdmin()) return denied('only a Director, Deputy Director or the Owner may publish a template')
  const v = versionById(args.p_version)
  if (!v || v.status !== 'draft') return raise('only a draft version can be published')
  const prev = publishedVersion(v.template_id)
  if (prev) Object.assign(prev, { status: 'superseded', superseded_at: now() })
  Object.assign(v, { status: 'published', published_at: now(), published_by: uid() })
  const tpl = templateById(v.template_id)
  if (tpl) tpl.updated_at = now()
  audit('REPORT_TEMPLATE_PUBLISHED', 'report_templates', v.template_id, { version_id: v.id, version_number: v.version_number, superseded_version_id: prev?.id ?? null, note: blank(args.p_note) ? null : str(args.p_note) })
  return { ok: true, version_id: v.id, superseded_version_id: prev?.id ?? null }
}

/** report_template_discard(p_version) — the draft's author, or Director / DD / Owner. */
export function reportTemplateDiscard(args: Args): Fns['report_template_discard']['Returns'] {
  const v = versionById(args.p_version)
  if (!v || !isActive()) return denied('draft not found')
  if (v.created_by !== uid() && !isTemplateAdmin()) return denied("only the draft's author or a Director may discard it")
  if (v.status !== 'draft') return raise('only a draft version can be discarded')
  setRows('report_template_versions', getRows('report_template_versions').filter((x) => x.id !== v.id))
  return { ok: true }
}

const PATCH_KEYS = new Set(['name', 'description', 'active', 'sort_order', 'is_default'])
/** report_template_update(p_template, p_patch) — Director / DD / Owner. */
export function reportTemplateUpdate(args: Args): Fns['report_template_update']['Returns'] {
  if (!isTemplateAdmin()) return denied('only a Director, Deputy Director or the Owner may update a template')
  const tpl = templateById(args.p_template)
  if (!tpl) return raise('template not found')
  const patch = (args.p_patch ?? {}) as Args
  if (typeof patch !== 'object' || Array.isArray(patch)) return raise('patch must be an object')
  for (const k of Object.keys(patch)) if (!PATCH_KEYS.has(k)) return raise(`unknown template field "${k}"`)
  if ('name' in patch && blank(patch.name)) return raise('a template needs a name')
  if (patch.is_default === true) for (const t of rows('report_templates')) t.is_default = false
  Object.assign(tpl, {
    ...('name' in patch ? { name: str(patch.name).trim() } : {}),
    ...('description' in patch ? { description: blank(patch.description) ? null : str(patch.description) } : {}),
    ...('active' in patch ? { active: patch.active === true } : {}),
    ...('sort_order' in patch ? { sort_order: Number(patch.sort_order) || 0 } : {}),
    ...('is_default' in patch ? { is_default: patch.is_default === true } : {}),
    updated_at: now(),
  })
  audit('REPORT_TEMPLATE_UPDATED', 'report_templates', tpl.id, { keys: Object.keys(patch) })
  return { ok: true }
}

/* ── Report flow (return the row, raise on refusal) ─────────────────────── */

/** The BEFORE INSERT pin: a known template key fills template_version_id;
 *  an unknown key (v180's 'initial') keeps NULL. */
export function pinReportTemplateVersion(row: MockRow): MockRow {
  ensureReportTemplates()
  if (row.template_version_id != null) return row
  const tpl = templateByKey(row.template)
  const v = tpl ? publishedVersion(tpl.id) : undefined
  return { ...row, template_version_id: v?.id ?? null }
}

/** block_direct_report_finalize for a PATCH: workflow columns are RPC-only;
 *  `fields` is locked while submitted / approved / finalized. Returns the
 *  refusal (P0403 message) or null when the write may proceed. */
export function reportUpdateGuard(row: MockRow, patch: MockRow): string | null {
  for (const col of Object.keys(patch)) {
    if (REPORT_RPC_COLUMNS.has(col) && patch[col] !== row[col]) return `reports.${col} is read-only for clients — use the report RPCs`
  }
  const locked = row.finalized === true || row.review_status === 'submitted' || row.review_status === 'approved'
  if ('fields' in patch && locked && JSON.stringify(patch.fields) !== JSON.stringify(row.fields)) {
    return "a submitted report's contents are locked until it is returned"
  }
  return null
}

const fieldsOf = (r: Report): Record<string, unknown> =>
  r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields) ? (r.fields as Record<string, unknown>) : {}
const present = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '')
function labelOf(schema: FormSchema, key: string): string {
  for (const s of schema.sections) {
    if (s.type === 'kv') { const f = s.fields.find((x) => x.key === key); if (f) return f.label }
    else if (s.type === 'textarea' && s.key === key) return s.label
    else if (s.type === 'grid' && s.id === key) return s.label
  }
  return key
}
/** The labels of every `required` key the fields do not satisfy. */
function missingRequired(v: Version, r: Report): string[] {
  const f = fieldsOf(r)
  const schema = v.schema as unknown as FormSchema
  return v.required.filter((k) => !present(f[k])).map((k) => labelOf(schema, k))
}
const openTasks = (caseId: string): number =>
  rows('case_tasks').filter((t) => t.case_id === caseId && !t.done && t.waived_at == null && t.deleted_at == null).length

function signatureFor(typed: unknown, badge: unknown): Json {
  const me = profile()!
  return { officer: me.display_name, signer_id: me.id, badge: blank(badge) ? me.badge_number : str(badge), signed_at: now(), typed: blank(typed) ? me.display_name : str(typed) }
}
function seal(r: Report, reviewerSignature: Json | null, selfSealed: boolean): void {
  const n = rows('report_versions').filter((v) => v.report_id === r.id).length + 1
  seedRows('report_versions', [{ created_at: now(), created_by: uid(), fields: r.fields, id: mockId(), report_id: r.id, reviewer_signature: reviewerSignature, signature: r.signature, version_number: n }])
  Object.assign(r, { finalized: true, review_status: 'approved', reviewer_signature: reviewerSignature, updated_at: now() })
  audit('REPORT_FINALIZED', 'reports', r.id, { version_number: n, self_sealed: selfSealed })
}

/** report_create(p_case, p_template, p_kind, p_fields) — refuses an unknown or retired template and pins the version. */
export function reportCreate(args: Args): Fns['report_create']['Returns'] {
  ensureReportTemplates()
  const kase = caseOf(args.p_case)
  if (!kase || !canWriteCase(kase)) return raise('case not found or not writable')
  const tpl = templateByKey(args.p_template)
  const v = tpl && tpl.active ? publishedVersion(tpl.id) : undefined
  if (!tpl || !v) return raise('unknown report template')
  const kind = REPORT_KINDS.has(str(args.p_kind)) ? str(args.p_kind) as Report['kind'] : 'initial'
  const seq = rows('reports').filter((r) => r.case_id === kase.id && r.template === tpl.key && r.kind === kind && r.deleted_at == null).length + 1
  const [r] = seedRows('reports', [{
    author_id: uid(), case_id: str(kase.id), created_at: now(), delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null,
    fields: (args.p_fields ?? {}) as Json, finalized: false, id: mockId(), kind, parent_id: null, review_note: null, review_status: 'draft',
    reviewed_at: null, reviewed_by: null, reviewer_signature: null, seq, signature: null, submitted_at: null, submitted_by: null,
    template: tpl.key, template_version_id: v.id, updated_at: now(),
  }])
  return r
}

/** report_submit(p_report, p_signature, p_badge) — the author; required keys; case_closure task gate; review or self-seal. */
export function reportSubmit(args: Args): Fns['report_submit']['Returns'] {
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return raise('report not found')
  if (r.author_id !== uid()) return raise('only the author may submit a report')
  if (r.finalized || (r.review_status !== 'draft' && r.review_status !== 'returned')) return raise('report is not awaiting submission')
  const kase = caseOf(r.case_id)!
  if (!canWriteCase(kase)) return raise('case is not writable')
  const v = r.template_version_id ? versionById(r.template_version_id) : undefined
  if (!v) return raise('this report has no published template')
  const missing = missingRequired(v, r)
  if (missing.length) return raise(`required fields missing: ${missing.join(', ')}`)
  if (r.template === 'case_closure') {
    const n = openTasks(r.case_id)
    if (n) return raise(`${n} open task(s) must be done or waived before closure`)
  }
  r.signature = signatureFor(args.p_signature, args.p_badge)
  if (v.review_required) {
    Object.assign(r, { review_status: 'submitted', submitted_at: now(), submitted_by: uid(), review_note: null, updated_at: now() })
    audit('REPORT_SUBMITTED', 'reports', r.id, { template: r.template })
    notify(reviewersOf(r, kase), 'report_submitted', payloadFor(r, kase))
    return r
  }
  Object.assign(r, { submitted_at: now(), submitted_by: uid() })
  seal(r, null, true)
  notify([str(kase.lead_detective_id)].filter((id) => id && id !== r.author_id), 'report_finalized', payloadFor(r, kase))
  return r
}

/** private.can_review_report: active, case access, NOT the author, a review rank or the Owner. */
function canReviewReport(r: Report): boolean {
  const me = profile()
  return !!me && r.author_id !== me.id && canReadCase(caseOf(r.case_id)) && (isOwner() || REVIEW_ROLES.has(me.role ?? ''))
}

/** report_review(p_report, p_decision, p_note, p_signature, p_badge). */
export function reportReview(args: Args): Fns['report_review']['Returns'] {
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return raise('report not found')
  if (!canReviewReport(r)) return raise('you may not review this report')
  if (r.review_status !== 'submitted') return raise('report is not awaiting review')
  const kase = caseOf(r.case_id)!
  const decision = str(args.p_decision)
  const note = blank(args.p_note) ? null : str(args.p_note).trim()
  const me = uid()!
  if (decision === 'approve') {
    Object.assign(r, { reviewed_by: me, reviewed_at: now(), review_note: note })
    seal(r, { ...(signatureFor(args.p_signature, args.p_badge) as Record<string, Json>), role: role() }, false)
    audit('REPORT_APPROVED', 'reports', r.id, { reviewer: me })
    notify([r.author_id], 'report_finalized', payloadFor(r, kase))
    return r
  }
  if (decision === 'return') {
    if (!note) return raise('a note is required to return a report')
    Object.assign(r, { review_status: 'returned', review_note: note, reviewed_by: me, reviewed_at: now(), updated_at: now() })
    audit('REPORT_RETURNED', 'reports', r.id, { reviewer: me })
    notify([r.author_id], 'report_returned', payloadFor(r, kase, { reason: note }))
    return r
  }
  return raise('invalid decision')
}

/** report_finalize(p_report, p_badge) — self-seal only when the pinned version is not review-required. */
export function reportFinalize(args: Args): Fns['report_finalize']['Returns'] {
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return raise('report not found')
  const kase = caseOf(r.case_id)!
  if (!canWriteCase(kase)) return raise('case is not writable')
  if (r.finalized) return raise('report is already finalized')
  const v = r.template_version_id ? versionById(r.template_version_id) : undefined
  if (!v) return raise('this report has no published template')
  if (v.review_required) return raise('this template requires review — submit the report for review')
  const missing = missingRequired(v, r)
  if (missing.length) return raise(`required fields missing: ${missing.join(', ')}`)
  r.signature = signatureFor(null, args.p_badge)
  seal(r, null, true)
  notify([str(kase.lead_detective_id)].filter((id) => id && id !== r.author_id), 'report_finalized', payloadFor(r, kase))
  return r
}

/** report_reopen(p_report, p_reason) — Bureau Lead of the case bureau / DD+ / Owner; reason required. */
export function reportReopen(args: Args): Fns['report_reopen']['Returns'] {
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return raise('report not found')
  const kase = caseOf(r.case_id)!
  if (!bureauCommand(kase)) return raise('only a Bureau Lead of the case bureau, a Deputy Director, the Director or the Owner may reopen a report')
  if (blank(args.p_reason)) return raise('a reason is required to reopen a sealed report')
  if (!r.finalized) return raise('report is not finalized')
  const f = fieldsOf(r)
  const log = Array.isArray(f._reopen_log) ? [...(f._reopen_log as Json[])] : []
  log.push({ at: now(), by: uid(), reason: str(args.p_reason).trim(), prev_signature: r.signature, prev_reviewer_signature: r.reviewer_signature })
  Object.assign(r, {
    finalized: false, review_status: 'draft', signature: null, reviewer_signature: null, reviewed_by: null, reviewed_at: null,
    review_note: null, submitted_at: null, submitted_by: null, fields: { ...f, _reopen_log: log } as Json, updated_at: now(),
  })
  audit('REPORT_REOPENED', 'reports', r.id, { reason: str(args.p_reason).trim() })
  notify([r.author_id], 'report_reopened', payloadFor(r, kase, { reason: str(args.p_reason).trim() }))
  return r
}

/* ── Entities + exports (jsonb) ─────────────────────────────────────────── */

/** Is the referenced record readable by the caller? Mirrors the per-kind rule of the contract. */
function refReadable(kind: string, refId: string, r: Report): boolean {
  const liveRow = (table: MockTableName) => { const row = findRow(table, refId); return row && row.deleted_at == null ? row : undefined }
  switch (kind) {
    case 'person': case 'vehicle': case 'gang': case 'place': return !!liveRow(`${kind}s` as MockTableName) && isActive()
    case 'evidence': { const e = liveRow('evidence'); return !!e && canReadCase(caseOf(e.case_id)) }
    case 'media': { const m = liveRow('media'); return !!m && (m.case_id == null ? isActive() : canReadCase(caseOf(m.case_id))) }
    case 'officer': return !!findRow('profiles', refId)
    case 'charge': { const c = findRow('case_charges', refId); return !!c && c.case_id === r.case_id }
    case 'legal_request': { const l = findRow('legal_requests', refId) as Tables<'legal_requests'> | undefined; return !!l && canViewLegalRequest(l) }
    case 'case': return canReadCase(caseOf(refId))
    default: return false
  }
}

/** report_entities_set(p_report, p_items) — REPLACES the set; author or case-writable editor while draft / returned. */
export function reportEntitiesSet(args: Args): Fns['report_entities_set']['Returns'] {
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return denied('report not found')
  const editable = (r.author_id === uid() || canWriteCase(caseOf(r.case_id))) && !r.finalized && (r.review_status === 'draft' || r.review_status === 'returned')
  if (!editable) return denied("a submitted or sealed report's entities are locked")
  const items = Array.isArray(args.p_items) ? args.p_items as Args[] : []
  const picked: Tables<'report_entities'>[] = []
  for (const it of items) {
    const kind = str(it.kind)
    if (!ENTITY_KINDS.has(kind)) return raise(`unknown entity kind "${kind}"`)
    const refId = it.ref_id == null ? null : str(it.ref_id)
    const label = str(it.label).trim()
    if (kind === 'timeline_event') {
      if (refId != null || !label) return raise('a timeline_event entity needs a label and no ref_id')
    } else {
      if (!refId || !label) return raise(`a ${kind} entity needs a ref_id and a label`)
      if (!refReadable(kind, refId, r)) return raise('referenced record not found or not readable')
    }
    picked.push({
      created_at: now(), edited: it.edited === true, id: mockId(), inserted_by: uid(), kind, label,
      ref_id: refId, report_id: r.id, role: blank(it.role) ? null : str(it.role), snapshot: (it.snapshot ?? {}) as Json,
    })
  }
  setRows('report_entities', getRows('report_entities').filter((e) => e.report_id !== r.id))
  seedRows('report_entities', picked)
  audit('REPORT_ENTITIES_SET', 'reports', r.id, { count: picked.length })
  return { ok: true, count: picked.length }
}

/** Deterministic 10-char code. The server uses upper(left(md5(report_id ||
 *  coalesce(version_number::text,'draft')),10)); the mock only guarantees
 *  the SHAPE and stability per (report, version). */
function verificationCode(seed: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  let h2 = 0x9e3779b9
  for (let i = seed.length - 1; i >= 0; i--) { h2 ^= seed.charCodeAt(i); h2 = Math.imul(h2, 0x85ebca6b) >>> 0 }
  return (h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10).toUpperCase()
}

/** report_record_export(p_report, p_format) — any reader; version_number = the latest sealed version (null for a draft). */
export function reportRecordExport(args: Args): Fns['report_record_export']['Returns'] {
  const format = str(args.p_format)
  if (!EXPORT_FORMATS.has(format)) return raise('format must be pdf, docx or md')
  const r = reportOf(args.p_report)
  if (!r || !canReadReport(r)) return denied('you may not export this report')
  const latest = rows('report_versions').filter((v) => v.report_id === r.id).sort((a, b) => b.version_number - a.version_number)[0]
  const version = latest?.version_number ?? null
  const code = verificationCode(`${r.id}${version ?? 'draft'}`)
  const [row] = seedRows('report_exports', [{ exported_at: now(), exported_by: uid(), format, id: mockId(), report_id: r.id, verification_code: code, version_number: version }])
  audit('REPORT_EXPORTED', 'reports', r.id, { format, version_number: version, verification_code: code })
  return { ok: true, id: row.id, version_number: version, verification_code: code }
}

/* ── Task waivers (RB4) ─────────────────────────────────────────────────── */

function waivableTask(args: Args): { task: Tables<'case_tasks'>; kase: MockRow } {
  const task = findRow('case_tasks', args.p_task) as Tables<'case_tasks'> | undefined
  const kase = task ? caseOf(task.case_id) : undefined
  if (!task || task.deleted_at != null || !kase || !canReadCase(kase)) return raise('task not found')
  if (!(kase.lead_detective_id === uid() || bureauCommand(kase))) return raise('only the case lead, a Bureau Lead of the case bureau, a Deputy Director, the Director or the Owner may waive a task')
  if (!canWriteCase(kase)) return raise('case is not writable')
  return { task, kase }
}
/** case_task_waive(p_task, p_reason). */
export function caseTaskWaive(args: Args): Fns['case_task_waive']['Returns'] {
  const { task } = waivableTask(args)
  if (blank(args.p_reason)) return raise('a reason is required to waive a task')
  Object.assign(task, { waived_at: now(), waived_by: uid(), waive_reason: str(args.p_reason).trim(), updated_at: now() })
  audit('TASK_WAIVED', 'case_tasks', task.id, { reason: task.waive_reason })
  return task
}
/** case_task_unwaive(p_task). */
export function caseTaskUnwaive(args: Args): Fns['case_task_unwaive']['Returns'] {
  const { task } = waivableTask(args)
  Object.assign(task, { waived_at: null, waived_by: null, waive_reason: null, updated_at: now() })
  audit('TASK_UNWAIVED', 'case_tasks', task.id, null)
  return task
}

/* ── Registry ───────────────────────────────────────────────────────────── */

/** fn → handler, consumed by the rpc.ts switch's default arm. */
export const REPORT_RPCS: Record<string, (args: Args) => unknown> = {
  report_template_save: reportTemplateSave,
  report_template_publish: reportTemplatePublish,
  report_template_discard: reportTemplateDiscard,
  report_template_update: reportTemplateUpdate,
  report_create: reportCreate,
  report_submit: reportSubmit,
  report_review: reportReview,
  report_finalize: reportFinalize,
  report_reopen: reportReopen,
  report_entities_set: reportEntitiesSet,
  report_record_export: reportRecordExport,
  case_task_waive: caseTaskWaive,
  case_task_unwaive: caseTaskUnwaive,
}

/** Writes to the RPC-only report tables answer PostgREST's grant denial
 *  (42501) before the generic table handler can touch the store. Reads fall
 *  through to postgrest.ts, which filters them with visibleReportRows. */
export const reportHandlers = REPORT_RPC_ONLY_TABLES.flatMap((table) => {
  const refuse = () => HttpResponse.json({ code: '42501', details: null, hint: null, message: `permission denied for table ${table}` }, { status: 403 })
  const url = `${supabaseBaseUrl()}/rest/v1/${table}`
  return [http.post(url, refuse), http.patch(url, refuse), http.delete(url, refuse)]
})

/** The FORM_SCHEMAS the seed mirrors — re-exported so the test pins the
 *  seed against the live catalog rather than a copy. */
export const SEED_TEMPLATE_KEYS: readonly string[] = Object.keys(FORM_SCHEMAS)
