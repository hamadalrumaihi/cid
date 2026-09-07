/** Report templates — the client half of the DB-backed template catalog
 *  (plan §5.7 / §8.5, issues P5-01 … P5-03, decisions RB1 / RB2 / RB4).
 *
 *  ── What lives here ────────────────────────────────────────────────────────
 *  - The zod validator for a FormSchema (`formSchemaZ`) — the SAME shape rules
 *    `report_template_save` applies server-side, so the template editor can
 *    refuse a broken draft before the round trip. Exported for the tests.
 *  - Loaders over `report_templates` / `report_template_versions`. Reads only:
 *    both tables are SELECT-for-active and every write goes through a definer
 *    RPC (`report_template_save` / `_publish` / `_discard` / `_update`).
 *  - The version-aware required-field checker (`requiredGaps` /
 *    `advisoryGaps`) over lib/forms' pure `formGapsForKeys`.
 *  - Review-flow vocabulary (`REPORT_REVIEW_LABEL`, tones, `isReportEditable`).
 *
 *  ── Fallback ───────────────────────────────────────────────────────────────
 *  When the catalog is empty or unreadable (a fresh project, a transport
 *  error) the Reports tab must not dead-end: `loadPublishedTemplates` falls
 *  back to in-memory versions derived from FORM_SCHEMAS (`fallbackVersionFor`)
 *  with the migration's required map shape. A fallback version has no id, so
 *  nothing is ever pinned to it — `report_create` pins server-side by key.
 *
 *  ── Authority ──────────────────────────────────────────────────────────────
 *  Nothing here decides anything. The RPCs raise (report flow) or return
 *  `{ok:false, message}` (template admin) and the screens show the message;
 *  the permission mirrors live in lib/permissions/mirrors. */
import { z } from 'zod'
import { list, rpc, type MutationResult } from '@/lib/db'
import type { Json, Tables } from '@/lib/database.types'
import {
  FORM_SCHEMAS, REPORT_TEMPLATES, fallbackRequiredKeys, formGapsForKeys, formValueKeys,
  type FormKeyLabel, type FormSchema, type FormValues,
} from '@/lib/forms'

/* ---- schema validation (mirror of report_template_save) ----------------- */

export const FORM_FIELD_TYPES = ['text', 'date', 'money', 'select', 'textarea', 'checks'] as const
export const FORM_SECTION_TYPES = ['kv', 'grid', 'textarea', 'note'] as const

const keyZ = z.string().trim().min(1, 'a key is required')
const optsZ = z.array(z.string())
const fieldZ = z.object({
  key: keyZ,
  label: z.string(),
  type: z.enum(FORM_FIELD_TYPES),
  opts: optsZ.optional(),
  person: z.boolean().optional(),
}).refine((f) => (f.type !== 'select' && f.type !== 'checks') || Array.isArray(f.opts), {
  message: 'select / checks fields need opts',
  path: ['opts'],
})
const colZ = z.object({
  key: keyZ,
  label: z.string(),
  type: z.enum(FORM_FIELD_TYPES).optional(),
  opts: optsZ.optional(),
  person: z.boolean().optional(),
})
const base = { id: keyZ, label: z.string() }
export const formSectionZ = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('kv'), fields: z.array(fieldZ).min(1, 'a kv section needs at least one field'), evidenceLookup: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('grid'), cols: z.array(colZ).min(1, 'a grid needs at least one column'), evidencePick: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('textarea'), key: keyZ, mediaPick: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('note'), text: z.string() }),
])

/** The FormSchema shape exactly as src/lib/forms.ts declares it, plus the
 *  server's uniqueness rules: section ids unique, value keys (kv fields +
 *  textarea keys) unique, grid column keys unique within their grid. */
export const formSchemaZ = z.object({
  title: z.string().trim().min(1, 'a title is required'),
  subtitle: z.string(),
  sections: z.array(formSectionZ).min(1, 'at least one section is required'),
}).superRefine((s, ctx) => {
  const ids = new Set<string>()
  const keys = new Set<string>()
  s.sections.forEach((sec, i) => {
    if (ids.has(sec.id)) ctx.addIssue({ code: 'custom', message: `duplicate section id "${sec.id}"`, path: ['sections', i, 'id'] })
    ids.add(sec.id)
    const own = sec.type === 'kv' ? sec.fields.map((f) => f.key) : sec.type === 'textarea' ? [sec.key] : []
    own.forEach((k) => {
      if (keys.has(k)) ctx.addIssue({ code: 'custom', message: `duplicate field key "${k}"`, path: ['sections', i] })
      keys.add(k)
    })
    if (sec.type === 'grid') {
      const cols = new Set<string>()
      sec.cols.forEach((c, j) => {
        if (cols.has(c.key)) ctx.addIssue({ code: 'custom', message: `duplicate column key "${c.key}"`, path: ['sections', i, 'cols', j, 'key'] })
        cols.add(c.key)
      })
    }
  })
})

export type SchemaValidation = { ok: true; schema: FormSchema } | { ok: false; error: string }

/** Validate a candidate schema; the first issue is rendered as
 *  "<path>: <message>" so the editor can say what to fix. */
export function validateFormSchema(json: unknown): SchemaValidation {
  const r = formSchemaZ.safeParse(json)
  if (r.success) return { ok: true, schema: r.data }
  const issue = r.error.issues[0]
  const path = issue?.path.map(String).join('.') || 'schema'
  return { ok: false, error: `${path}: ${issue?.message ?? 'invalid schema'}` }
}

/** Tolerant parse: a valid FormSchema or null (never throws). */
export const parseFormSchema = (json: unknown): FormSchema | null => {
  const v = validateFormSchema(json)
  return v.ok ? v.schema : null
}

/** required / advisory keys that do not exist in the schema (the server
 *  refuses a draft carrying one). */
export function missingSchemaKeys(schema: FormSchema, keys: readonly string[]): string[] {
  const known = new Set(formValueKeys(schema).map((k) => k.key))
  return keys.filter((k) => !known.has(k))
}

/** Template keys are snake_case identifiers (the FORM_SCHEMAS convention). */
export const isTemplateKey = (s: string): boolean => /^[a-z][a-z0-9_]{1,63}$/.test(s)

/** Starter schema for a brand-new template — the minimal narrative report
 *  every seeded template shares (details + narrative). */
export function starterSchema(name: string): FormSchema {
  return {
    title: name.trim() || 'New Report',
    subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
    sections: [
      { id: 'details', label: 'Report Details', type: 'kv', fields: [
        { key: 'case_number', label: 'Case Number', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'detective', label: 'Reporting Detective', type: 'text' },
      ] },
      { id: 'narrative', label: 'Narrative', type: 'textarea', key: 'narrative' },
    ],
  }
}
export const STARTER_REQUIRED = ['case_number', 'date', 'detective', 'narrative'] as const

/* ---- versions and templates --------------------------------------------- */

export type TemplateVersionStatus = 'draft' | 'published' | 'superseded'

export interface TemplateVersion {
  /** null for an in-memory fallback — nothing can be pinned to it. */
  id: string | null
  templateId: string | null
  templateKey: string
  versionNumber: number
  schema: FormSchema
  /** Keys that hard-block submit / seal (server-enforced). */
  required: string[]
  /** Keys that only warn. */
  advisory: string[]
  /** false → self-seal (submit seals immediately; Finalize stays valid). */
  reviewRequired: boolean
  status: TemplateVersionStatus
  changeSummary: string | null
  createdAt: string | null
  createdBy: string | null
  publishedAt: string | null
  /** true when derived from FORM_SCHEMAS rather than a database row. */
  fallback: boolean
}

export interface ReportTemplateSummary {
  id: string
  key: string
  name: string
  description: string | null
  isDefault: boolean
  sortOrder: number
  active: boolean
  fallback: boolean
}

/** An active template with its published version — what the picker offers. */
export interface PublishedTemplate extends ReportTemplateSummary {
  version: TemplateVersion
}

/** Legal drafting forms carry their own review (a legal request) — the seed
 *  marks them review_required = false. Fallback only; the DB row decides. */
export const SELF_SEAL_FALLBACK_KEYS: ReadonlySet<string> = new Set(['arrest_warrant', 'search_warrant', 'wiretap_warrant', 'subpoena'])

type VersionRow = Tables<'report_template_versions'>
type TemplateRow = Tables<'report_templates'>

const asStatus = (s: string): TemplateVersionStatus => (s === 'draft' || s === 'superseded' ? s : 'published')

/** Typed view of a version row; null when its schema does not validate (a
 *  row nothing should render from). */
export function versionFromRow(row: VersionRow, templateKey: string): TemplateVersion | null {
  const schema = parseFormSchema(row.schema)
  if (!schema) return null
  return {
    id: row.id,
    templateId: row.template_id,
    templateKey,
    versionNumber: row.version_number,
    schema,
    required: Array.isArray(row.required) ? row.required.map(String) : [],
    advisory: Array.isArray(row.advisory) ? row.advisory.map(String) : [],
    reviewRequired: row.review_required !== false,
    status: asStatus(row.status),
    changeSummary: row.change_summary ?? null,
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
    publishedAt: row.published_at ?? null,
    fallback: false,
  }
}

export function summaryFromRow(row: TemplateRow): ReportTemplateSummary {
  return {
    id: row.id, key: row.key, name: row.name, description: row.description ?? null,
    isDefault: !!row.is_default, sortOrder: row.sort_order ?? 0, active: row.active !== false, fallback: false,
  }
}

/** In-memory version of a FORM_SCHEMAS template (see the header). */
export function fallbackVersionFor(key: string | null | undefined): TemplateVersion | null {
  const schema = key ? FORM_SCHEMAS[key] : undefined
  if (!schema || !key) return null
  return {
    id: null, templateId: null, templateKey: key, versionNumber: 0, schema,
    required: fallbackRequiredKeys(key, schema), advisory: [],
    reviewRequired: !SELF_SEAL_FALLBACK_KEYS.has(key),
    status: 'published', changeSummary: null, createdAt: null, createdBy: null, publishedAt: null, fallback: true,
  }
}

/** The FORM_SCHEMAS catalog as published templates (fallback only). */
export function fallbackTemplates(): PublishedTemplate[] {
  return REPORT_TEMPLATES.flatMap((t, i) => {
    const version = fallbackVersionFor(t.id)
    return version ? [{
      id: `fallback:${t.id}`, key: t.id, name: t.name, description: null,
      isDefault: t.isDefault, sortOrder: i, active: true, fallback: true, version,
    }] : []
  })
}

/** Picker order: the default template first, then sort_order, then name. */
export function sortTemplates<T extends ReportTemplateSummary>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export interface TemplateCatalog {
  templates: PublishedTemplate[]
  source: 'db' | 'fallback'
}

/** Active templates with a published version — the new-report picker.
 *  Retired templates are excluded (existing reports keep their pinned
 *  version and still render). Falls back to FORM_SCHEMAS when the tables
 *  are empty or unreadable so the tab never dead-ends. */
export async function loadPublishedTemplates(): Promise<TemplateCatalog> {
  try {
    const [tpls, vers] = await Promise.all([
      list('report_templates', { eq: { active: true }, order: 'sort_order' }),
      list('report_template_versions', { eq: { status: 'published' } }),
    ])
    const out: PublishedTemplate[] = []
    for (const t of tpls) {
      const row = vers.find((v) => v.template_id === t.id)
      const version = row ? versionFromRow(row, t.key) : null
      if (version) out.push({ ...summaryFromRow(t), version })
    }
    if (!out.length) return { templates: fallbackTemplates(), source: 'fallback' }
    return { templates: sortTemplates(out), source: 'db' }
  } catch {
    return { templates: fallbackTemplates(), source: 'fallback' }
  }
}

/** Resolved-version cache: a report's pinned version is immutable, so one
 *  fetch per id per session is enough (lists, detail and editor share it). */
const versionCache = new Map<string, Promise<TemplateVersion | null>>()

/** One version by id (the pinned `reports.template_version_id`). Null when
 *  missing, unreadable or unparsable — callers fall back by template key. */
export function loadTemplateVersion(id: string): Promise<TemplateVersion | null> {
  const hit = versionCache.get(id)
  if (hit) return hit
  const p = (async () => {
    try {
      const [row] = await list('report_template_versions', { eq: { id } })
      if (!row) return null
      const [tpl] = await list('report_templates', { eq: { id: row.template_id } })
      return versionFromRow(row, tpl?.key ?? '')
    } catch {
      return null
    }
  })()
  versionCache.set(id, p)
  // A transport failure must not poison the session — retry next time.
  void p.then((v) => { if (!v) versionCache.delete(id) })
  return p
}

/** Test / admin hook — forget cached versions (a publish changes nothing
 *  pinned, but the admin preview reloads rows it just wrote). */
export function resetTemplateVersionCache(): void { versionCache.clear() }

/** The version a report renders from: its pinned version, else the
 *  catalog's published version for its key, else the FORM_SCHEMAS fallback. */
export async function resolveReportVersion(
  r: { template: string; template_version_id?: string | null },
  catalog?: readonly PublishedTemplate[] | null,
): Promise<TemplateVersion | null> {
  if (r.template_version_id) {
    const pinned = await loadTemplateVersion(r.template_version_id)
    if (pinned) return pinned
  }
  return catalog?.find((t) => t.key === r.template)?.version ?? fallbackVersionFor(r.template)
}

/* ---- template administration --------------------------------------------- */

export interface TemplateAdminRow {
  template: ReportTemplateSummary
  published: TemplateVersion | null
  draft: TemplateVersion | null
  /** Every version, newest first (history for the admin list). */
  versions: TemplateVersion[]
}

/** Every template (retired included) with its published and draft versions.
 *  THROWS on a read error (list() semantics) so the panel can show a retry. */
export async function loadTemplateAdmin(): Promise<TemplateAdminRow[]> {
  const [tpls, vers] = await Promise.all([
    list('report_templates', { order: 'sort_order' }),
    list('report_template_versions', { order: 'version_number', ascending: false }),
  ])
  return sortTemplates(tpls.map(summaryFromRow)).map((template) => {
    const versions = vers.filter((v) => v.template_id === template.id).flatMap((v) => { const x = versionFromRow(v, template.key); return x ? [x] : [] })
    return {
      template,
      published: versions.find((v) => v.status === 'published') ?? null,
      draft: versions.find((v) => v.status === 'draft') ?? null,
      versions,
    }
  })
}

export type AdminResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; message: string }

/** The template-admin RPCs return jsonb `{ok:true, …}` or
 *  `{ok:false, code:'denied', message}`; a transport / raise error arrives as
 *  `res.error`. Both collapse to one shape the screens can toast. */
export function unwrapAdminResult<T extends Record<string, unknown>>(res: MutationResult<Json>): AdminResult<T> {
  if (res.error) return { ok: false, message: res.error.message }
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, message: 'Unexpected response.' }
  const obj = d as Record<string, unknown>
  if (obj.ok === true) return { ok: true, data: obj as T }
  return { ok: false, message: typeof obj.message === 'string' && obj.message ? obj.message : 'Not allowed.' }
}

export interface SaveTemplateDraftArgs {
  key: string
  name: string
  schema: FormSchema
  required: readonly string[]
  advisory?: readonly string[]
  reviewRequired: boolean
  changeSummary?: string | null
  description?: string | null
}

/** Create or replace the template's single draft version (a NEW key also
 *  creates the template row — Director / Deputy Director / Owner). */
export async function saveTemplateDraft(a: SaveTemplateDraftArgs): Promise<AdminResult<{ template_id: string; version_id: string; version_number: number }>> {
  const res = await rpc('report_template_save', {
    p_key: a.key,
    p_name: a.name,
    p_schema: a.schema as unknown as Json,
    p_required: [...a.required] as Json,
    p_advisory: [...(a.advisory ?? [])] as Json,
    p_review_required: a.reviewRequired,
    p_change_summary: a.changeSummary || undefined,
    p_description: a.description || undefined,
  })
  return unwrapAdminResult(res)
}

export async function publishTemplateVersion(versionId: string, note?: string | null): Promise<AdminResult<{ version_id: string; superseded_version_id: string | null }>> {
  return unwrapAdminResult(await rpc('report_template_publish', { p_version: versionId, p_note: note || undefined }))
}

export async function discardTemplateDraft(versionId: string): Promise<AdminResult> {
  return unwrapAdminResult(await rpc('report_template_discard', { p_version: versionId }))
}

export interface TemplatePatch {
  name?: string
  description?: string | null
  active?: boolean
  sort_order?: number
  is_default?: boolean
}

export async function updateTemplate(templateId: string, patch: TemplatePatch): Promise<AdminResult> {
  return unwrapAdminResult(await rpc('report_template_update', { p_template: templateId, p_patch: patch as Json }))
}

/* ---- report flow RPCs (return the reports row, RAISE on refusal) --------- */

type ReportRow = Tables<'reports'>

export const submitReport = (reportId: string, signature?: string | null, badge?: string | null): Promise<MutationResult<ReportRow>> =>
  rpc('report_submit', { p_report: reportId, p_signature: signature || undefined, p_badge: badge || undefined })

export const reviewReport = (
  reportId: string, decision: 'approve' | 'return', note?: string | null, signature?: string | null, badge?: string | null,
): Promise<MutationResult<ReportRow>> =>
  rpc('report_review', { p_report: reportId, p_decision: decision, p_note: note || undefined, p_signature: signature || undefined, p_badge: badge || undefined })

export const reopenReport = (reportId: string, reason: string): Promise<MutationResult<ReportRow>> =>
  rpc('report_reopen', { p_report: reportId, p_reason: reason })

/* ---- required-field gaps --------------------------------------------------- */

/** Required keys of the version not satisfied by `values` (server hard-block). */
export const requiredGaps = (v: Pick<TemplateVersion, 'schema' | 'required'>, values: FormValues): FormKeyLabel[] =>
  formGapsForKeys(v.schema, v.required, values)

/** Advisory keys not satisfied — warn only. */
export const advisoryGaps = (v: Pick<TemplateVersion, 'schema' | 'advisory'>, values: FormValues): FormKeyLabel[] =>
  formGapsForKeys(v.schema, v.advisory, values)

/* ---- review-flow vocabulary ----------------------------------------------- */

export type ReportReviewStatus = 'draft' | 'submitted' | 'returned' | 'approved'

export const REPORT_REVIEW_LABEL: Record<ReportReviewStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting review',
  returned: 'Returned for revision',
  approved: 'Sealed',
}

export interface ReviewStateLike {
  review_status?: string | null
  finalized?: boolean | null
}

/** Tolerant read: rows written before the column existed derive from
 *  `finalized` (the backfill sets finalized → approved). */
export function reviewStatusOf(r: ReviewStateLike): ReportReviewStatus {
  const s = r.review_status
  if (s === 'submitted' || s === 'returned' || s === 'approved' || s === 'draft') return s
  return r.finalized ? 'approved' : 'draft'
}

/** Badge tone per status (ui/Badge tones). */
export function reportReviewTone(status: ReportReviewStatus): 'neutral' | 'accent' | 'warn' | 'good' {
  if (status === 'submitted') return 'accent'
  if (status === 'returned') return 'warn'
  if (status === 'approved') return 'good'
  return 'neutral'
}

/** Editable = draft or returned, and not sealed (the trigger locks fields
 *  while submitted / approved / finalized). */
export function isReportEditable(r: ReviewStateLike): boolean {
  const s = reviewStatusOf(r)
  return !r.finalized && (s === 'draft' || s === 'returned')
}

/* ---- signatures ----------------------------------------------------------- */

const signatureZ = z.object({
  officer: z.string().catch('Officer'),
  signer_id: z.string().optional(),
  badge: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  typed: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
})
export type ReportSignatureInfo = z.infer<typeof signatureZ>

/** Tolerant parse of `reports.signature` / `reports.reviewer_signature`
 *  (both carry {officer, signer_id, badge, signed_at, typed[, role]}). */
export function parseSignatureInfo(v: Json | null | undefined): ReportSignatureInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = signatureZ.safeParse(v)
  return r.success ? r.data : null
}

const reopenEntryZ = z.object({
  at: z.string().optional(),
  by: z.string().optional(),
  reason: z.string().nullable().optional(),
  prev_signature: signatureZ.nullable().optional(),
  prev_reviewer_signature: signatureZ.nullable().optional(),
})
export type ReopenEntry = z.infer<typeof reopenEntryZ>

/** `fields._reopen_log` with BOTH superseded signatures (report_reopen
 *  keeps prev_signature and prev_reviewer_signature per entry). */
export function reopenEntries(fields: FormValues): ReopenEntry[] {
  const raw = fields._reopen_log
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => { const r = reopenEntryZ.safeParse(e); return r.success ? [r.data] : [] })
}
