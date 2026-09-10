/** Mobile narrative editing (P8-07) — the pure pieces behind
 *  components/mobile/MobileNarrativeEditor. A report's narrative is the set
 *  of `textarea` sections of its pinned template, MINUS the `mediaPick`
 *  ones (attachment reference lists — ReportView treats them the same way).
 *  Saving merges ONE narrative key into the existing `fields` jsonb and
 *  never drops the other keys (workflow metadata such as `_warrant_log`
 *  rides along untouched). Deliberately free of database imports so the
 *  helpers unit-test offline. */
import type { FormSchema, FormSection, FormValues } from '@/lib/forms'

export type NarrativeSection = Extract<FormSection, { type: 'textarea' }>

/** The template's narrative sections: `textarea` and not a media pick-list
 *  (`schema.sections.filter(s => s.type === 'textarea' && !s.mediaPick)`,
 *  the ReportView rule). */
export function narrativeSections(schema: FormSchema | null | undefined): NarrativeSection[] {
  if (!schema) return []
  return schema.sections.filter((s): s is NarrativeSection => s.type === 'textarea' && !s.mediaPick)
}

/** A new `fields` object with only `key` replaced — every other key (other
 *  sections, grids, `_refs` / `_warrant_status` metadata) is carried over
 *  by reference. A non-object `fields` (null, legacy string) starts from an
 *  empty object rather than throwing. */
export function mergeNarrativeFields(fields: unknown, key: string, md: string): FormValues {
  const base: FormValues = fields && typeof fields === 'object' && !Array.isArray(fields) ? (fields as FormValues) : {}
  return { ...base, [key]: md }
}

export interface NarrativeReport {
  author_id?: string | null
  review_status?: string | null
  finalized?: boolean | null
  deleted_at?: string | null
}

/** Mirror of report_submit's author gate minus the submit itself (see
 *  permissions/mirrors canSubmitReport): the AUTHOR, while the report is
 *  `draft` or `returned`, not finalized / sealed, not in the Trash. The
 *  fields trigger is the authority — a submitted or sealed report refuses
 *  the UPDATE regardless; this only decides whether the phone shows the
 *  editor. Rows written before `review_status` existed derive from
 *  `finalized`. */
export function canEditNarrativeOnMobile(report: NarrativeReport, viewerId: string | null | undefined): boolean {
  if (!viewerId || report.author_id !== viewerId) return false
  if (report.finalized || report.deleted_at) return false
  const s = report.review_status
  const state = s === 'submitted' || s === 'returned' || s === 'approved' || s === 'draft' ? s : 'draft'
  return state === 'draft' || state === 'returned'
}
