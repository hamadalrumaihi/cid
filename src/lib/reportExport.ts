/** Report export specs (plan P5-07, decision RB9).
 *
 *  Pure spec builders — no React, no db, no clock. They turn the rows a
 *  viewer ALREADY holds (RLS returned them) into the document spec lib/pdf
 *  renders, the paragraph list lib/docx writes and a markdown text, so the
 *  three formats can never disagree about what a report says.
 *
 *  Rules (contract §6):
 *   · letterhead = the pinned schema's title + subtitle;
 *   · a SEALED report exports the sealed version's fields (report_versions);
 *     a draft exports the live fields under a "DRAFT — not sealed" banner;
 *   · both signatures (author + reviewer), the template name and version,
 *     the report version number and the verification code footer that
 *     `report_record_export` returned;
 *   · media exhibits by title only, never a URL; a restricted media item is
 *     omitted and counted;
 *   · narrative `[kind:id]` mention tokens flatten to the record's label
 *     from the report's own entity snapshots — never the raw id; an
 *     unresolved token prints "Restricted record". */
import type { DocxPara } from './docx'
import type { Tables } from './database.types'
import { fmtDateTime } from './format'
import type { FormSchema } from './forms'
import { parseFormValues } from './jsonShapes'
import { specToDocx } from './legalExport'
import { parseMediaRefEntries } from './mediaRefs'
import { mentionsToText, withMentionLabels, type EntityItem, type MentionLabels } from './mentions'
import type { PdfDocSpec, PdfSection } from './pdf'

/** Loose read of a `reports.signature` / `reviewer_signature` jsonb — the
 *  seal writes {officer, signer_id, badge, signed_at, typed} and the
 *  reviewer block adds `role`. Anything malformed reads as no signature. */
export interface ReportSignatureLike {
  officer: string
  signer_id?: string | null
  badge?: string | null
  signed_at?: string | null
  typed?: string | null
  role?: string | null
}
export function parseSignatureLike(v: unknown): ReportSignatureLike | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  return {
    officer: str('officer') || 'Officer',
    signer_id: str('signer_id'),
    badge: str('badge'),
    signed_at: str('signed_at'),
    typed: str('typed'),
    role: str('role'),
  }
}

export type ReportExportRow = Pick<Tables<'reports'>,
  'id' | 'template' | 'kind' | 'seq' | 'fields' | 'finalized' | 'review_status' | 'created_at' | 'signature' | 'reviewer_signature'>
export type ReportExportEntity = Pick<EntityItem, 'kind' | 'ref_id' | 'role' | 'label' | 'edited'>

export interface ReportExportVerification {
  /** report_exports.verification_code */
  code: string
  /** The report_versions number the export was recorded against (null for
   *  an unsealed draft). */
  versionNumber: number | null
  exportedAt?: string
  format?: 'pdf' | 'docx' | 'md'
}

export interface ReportExportInput {
  report: ReportExportRow
  /** The sealed snapshot to export (the latest report_versions row) — null
   *  for a draft. */
  version: Tables<'report_versions'> | null
  /** The PINNED template schema (report_template_versions.schema). */
  schema: FormSchema
  templateName: string
  /** report_template_versions.version_number of the pinned template. */
  templateVersion?: number | null
  caseNumber?: string | null
  caseTitle?: string | null
  entities: readonly ReportExportEntity[]
  authorSignature: ReportSignatureLike | null
  reviewerSignature: ReportSignatureLike | null
  /** Null = a screen copy that was NOT recorded; the document says so. */
  verification: ReportExportVerification | null
  /** media.id values the viewer must not see beyond the fact one was
   *  omitted (restricted media without break-glass). */
  restrictedMediaIds?: ReadonlySet<string>
  /** Review-status label (contract §4) — injected so the builder never
   *  imports the model. */
  reviewStatusLabel?: (s: string) => string
  authorName?: string | null
}

const dash = (v: string | null | undefined): string => (v && v.trim()) || '—'
const humanize = (s: string | null | undefined): string =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''
const DEFAULT_REVIEW_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting review', returned: 'Returned for revision', approved: 'Sealed',
}
const URL_RE = /\s*[-—]?\s*https?:\/\/\S+/gi
/** Media list lines never carry a URL — a legacy "title — url" line is
 *  trimmed to its title. */
const stripUrls = (s: string): string => s.replace(URL_RE, '').trim()

/** A sealed report exports its frozen snapshot; a draft its live fields. */
export const isSealedExport = (input: Pick<ReportExportInput, 'report'>): boolean => !!input.report.finalized

function fieldText(v: unknown, labels: MentionLabels): string {
  const raw = Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v)
  return mentionsToText(raw, labels).trim()
}

function signatureLine(s: ReportSignatureLike | null, what: string): string {
  if (!s) return `${what}: not signed`
  const bits = [s.officer, s.badge ? `#${s.badge}` : '', s.role ? `(${humanize(s.role)})` : ''].filter(Boolean).join(' ')
  const typed = s.typed && s.typed !== s.officer ? ` — signed as “${s.typed}”` : ''
  return `${what}: ${bits}${typed}${s.signed_at ? ` · ${fmtDateTime(s.signed_at)}` : ''}`
}

/** The version-bound signatures when sealed (the snapshot's own blocks),
 *  else the live ones the caller passed. */
function signaturesOf(input: ReportExportInput): { author: ReportSignatureLike | null; reviewer: ReportSignatureLike | null } {
  if (isSealedExport(input) && input.version) {
    return {
      author: parseSignatureLike(input.version.signature) ?? input.authorSignature,
      reviewer: parseSignatureLike(input.version.reviewer_signature) ?? input.reviewerSignature,
    }
  }
  return { author: input.authorSignature, reviewer: input.reviewerSignature }
}

/* ── Spec ─────────────────────────────────────────────────────────────────── */
export function reportPdfSpec(input: ReportExportInput): PdfDocSpec {
  const sealed = isSealedExport(input)
  const values = parseFormValues(sealed && input.version ? input.version.fields : input.report.fields)
  const labels = withMentionLabels({}, input.entities.map((e) => ({ kind: e.kind, ref_id: e.ref_id, label: e.label })))
  const restricted = input.restrictedMediaIds ?? new Set<string>()
  const reviewLabel = input.reviewStatusLabel ?? ((s: string) => DEFAULT_REVIEW_LABEL[s] ?? humanize(s))
  const { author, reviewer } = signaturesOf(input)
  let omittedMedia = 0

  const sections: PdfSection[] = []
  if (!sealed) {
    sections.push({
      title: 'Draft — not sealed',
      paras: ['This report has not been sealed. Its contents may still change; the verification code below is bound to the draft as exported, not to a sealed version.'],
    })
  }
  for (const s of input.schema.sections) {
    if (s.type === 'note') { sections.push({ title: s.label, paras: [s.text] }); continue }
    if (s.type === 'textarea') {
      if (s.mediaPick) {
        const rows: string[][] = []
        for (const e of parseMediaRefEntries(typeof values[s.key] === 'string' ? (values[s.key] as string) : '')) {
          if (e.id && restricted.has(e.id)) { omittedMedia++; continue }
          rows.push([stripUrls(e.label) || 'Attachment', e.id ? 'Case media' : 'Reference'])
        }
        sections.push({ title: s.label, headers: ['Title', 'Type'], widths: [3, 1], rows })
        continue
      }
      const text = fieldText(values[s.key], labels)
      sections.push({ title: s.label, paras: text ? text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : ['—'] })
      continue
    }
    if (s.type === 'kv') {
      sections.push({
        title: s.label, headers: ['Field', 'Value'], widths: [1, 3],
        rows: s.fields.map((f) => [f.label, dash(fieldText(values[f.key], labels))]),
      })
      continue
    }
    const rows = (Array.isArray(values[s.id]) ? (values[s.id] as unknown[]) : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => s.cols.map((c) => dash(fieldText(r[c.key], labels))))
      .filter((r) => r.some((c) => c !== '—'))
    sections.push({ title: s.label, headers: s.cols.map((c) => c.label), rows })
  }

  // Referenced records — the report_entities set: mentions, inserted
  // people / vehicles / exhibits / officers / charges / events. Media by
  // title only; restricted media omitted and counted.
  const entityRows: string[][] = []
  for (const e of input.entities) {
    if (e.kind === 'media' && e.ref_id && restricted.has(e.ref_id)) { omittedMedia++; continue }
    entityRows.push([humanize(e.kind), humanize(e.role) || '—', e.kind === 'media' ? stripUrls(e.label) : e.label, e.edited ? 'Differs from record' : '—'])
  }
  sections.push({
    title: `Referenced records${omittedMedia ? ` (${omittedMedia} restricted media item${omittedMedia === 1 ? '' : 's'} omitted)` : ''}`,
    headers: ['Kind', 'Role', 'Record', 'Note'], widths: [1, 1, 3, 1.3],
    rows: entityRows,
  })

  sections.push({
    title: 'Signatures',
    paras: [
      signatureLine(author, 'Author'),
      signatureLine(reviewer, 'Reviewer'),
      ...(sealed && input.version ? [`Sealed version v${input.version.version_number} · ${fmtDateTime(input.version.created_at)}`] : []),
    ],
  })

  const v = input.verification
  sections.push({
    title: 'Verification',
    paras: v
      ? [
          `Verification code ${v.code} — recorded ${v.format ? `${v.format.toUpperCase()} ` : ''}export${v.exportedAt ? ` at ${fmtDateTime(v.exportedAt)}` : ''} of ${v.versionNumber != null ? `sealed version v${v.versionNumber}` : 'the unsealed draft'}.`,
          'Present this code with the document; the portal export log confirms the version it was produced from.',
        ]
      : ['Screen copy — not a recorded export. Use Export PDF, DOCX or Markdown for a copy with a verification code.'],
  })

  const templateLabel = `${input.templateName}${input.templateVersion != null ? ` (template v${input.templateVersion})` : ''}`
  return {
    docType: sealed ? 'CID REPORT' : 'DRAFT REPORT',
    refCode: input.schema.title,
    subtitle: sealed ? input.schema.subtitle : `DRAFT — not sealed · ${input.schema.subtitle}`,
    meta: [
      ['Case', `${input.caseNumber ?? '—'}${input.caseTitle ? ` — ${input.caseTitle}` : ''}`],
      ['Template', templateLabel],
      ['Status', sealed ? `Sealed${input.version ? ` · v${input.version.version_number}` : ''}` : reviewLabel(input.report.review_status)],
      ['Report version', sealed && input.version ? `v${input.version.version_number} · ${fmtDateTime(input.version.created_at)}` : 'Draft — not sealed'],
      ['Author', dash(input.authorName ?? author?.officer)],
      ['Reviewer', dash(reviewer?.officer)],
      ['Verification', v?.code ?? 'Screen copy'],
      ['Filed', fmtDateTime(input.report.created_at)],
      ...(input.report.kind !== 'initial' ? [[humanize(input.report.kind), `#${input.report.seq ?? '—'}`] as [string, string]] : []),
    ],
    sections,
    signatures: ['Author / detective', 'Reviewer'],
  }
}

/* ── DOCX — the same spec flattened (lib/legalExport.specToDocx) ─────────── */
export function reportDocx(input: ReportExportInput): DocxPara[] {
  return specToDocx(reportPdfSpec(input))
}

/* ── Markdown — the same spec as text ────────────────────────────────────── */
const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function specToMarkdown(spec: PdfDocSpec): string {
  const out: string[] = [`# ${spec.docType} — ${spec.refCode}`]
  if (spec.subtitle) out.push(`_${spec.subtitle}_`)
  out.push('')
  for (const [k, v] of spec.meta) out.push(`**${k}:** ${v || '—'}  `)
  for (const s of spec.sections) {
    out.push('', `## ${s.title}`, '')
    if (s.headers && s.rows) {
      if (!s.rows.length) { out.push('None on file.'); continue }
      out.push(`| ${s.headers.map(mdCell).join(' | ')} |`, `| ${s.headers.map(() => '---').join(' | ')} |`)
      for (const row of s.rows) out.push(`| ${s.headers.map((_, i) => mdCell(row[i] || '—')).join(' | ')} |`)
    } else {
      for (const p of s.paras?.length ? s.paras : ['—']) out.push(p, '')
    }
  }
  if (spec.signatures?.length) {
    out.push('', '## Signature lines', '')
    for (const label of spec.signatures) out.push(`${label}: ______________________________`, '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function reportMarkdown(input: ReportExportInput): string {
  return specToMarkdown(reportPdfSpec(input))
}

/** Stable file name: `<case>-<template>-<vN|draft>-<code|screen>.<ext>`. */
export function reportExportFilename(
  input: Pick<ReportExportInput, 'report' | 'version' | 'caseNumber'>,
  format: 'pdf' | 'docx' | 'md',
  code: string | null,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '_')
  const ver = isSealedExport(input) && input.version ? `v${input.version.version_number}` : 'draft'
  return `${safe(input.caseNumber || 'report')}-${safe(input.report.template)}-${ver}-${code ?? 'screen'}.${format}`
}
