/** `ci_export` answers → a download. The server audits CI_EXPORTED and shapes
 *  the body (profile or roster); the client only renders it — as JSON
 *  verbatim, or as a PDF through the shared `downloadPdf` spec by walking the
 *  document generically (arrays → tables, objects → meta grids, scalars →
 *  lines). Generic on purpose: the export body may grow without a client
 *  change, and nothing is ever dropped silently. */
import type { Json } from '@/lib/database.types'
import { downloadTextFile, fmtDateTime } from '@/lib/format'
import type { PdfDocSpec, PdfSection } from '@/lib/pdf'

type Doc = Record<string, Json>

const isObj = (v: Json | undefined): v is { [k: string]: Json | undefined } => !!v && typeof v === 'object' && !Array.isArray(v)
const title = (k: string): string => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const cell = (v: Json | undefined): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v)
  return String(v)
}

/** Pick a reference code for the letterhead: ci_number for a profile, the
 *  count of rows for a roster. */
function refCode(doc: Doc, scope: 'profile' | 'roster'): string {
  if (scope === 'profile') {
    const ci = isObj(doc.ci) ? doc.ci : doc
    return typeof ci.ci_number === 'string' ? ci.ci_number : 'CI'
  }
  const rows = Array.isArray(doc.rows) ? doc.rows : Array.isArray(doc.roster) ? doc.roster : null
  return rows ? `${rows.length} sources` : 'Roster'
}

export function buildCiPdfSpec(doc: Doc, scope: 'profile' | 'roster', exportedBy: string): PdfDocSpec {
  const sections: PdfSection[] = []
  const meta: [string, string][] = [['Exported', fmtDateTime(new Date())], ['Exported by', exportedBy], ['Scope', scope]]
  const scalars: string[] = []
  for (const [k, v] of Object.entries(doc)) {
    if (Array.isArray(v)) {
      const rows = v.filter(isObj)
      if (!rows.length) { sections.push({ title: title(k), paras: ['None.'] }); continue }
      const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 8)
      sections.push({ title: title(k), headers: headers.map(title), rows: rows.map((r) => headers.map((h) => cell(r[h]))) })
    } else if (isObj(v)) {
      sections.push({ title: title(k), paras: Object.entries(v).map(([kk, vv]) => `${title(kk)}: ${cell(vv)}`) })
    } else {
      scalars.push(`${title(k)}: ${cell(v)}`)
    }
  }
  if (scalars.length) sections.unshift({ title: 'Record', paras: scalars })
  return {
    docType: scope === 'profile' ? 'CONFIDENTIAL SOURCE FILE' : 'CONFIDENTIAL SOURCE ROSTER',
    refCode: refCode(doc, scope),
    subtitle: 'Restricted — handlers and CI command only',
    meta,
    sections,
    signatures: ['Exported by', 'Reviewed by'],
  }
}

export function downloadCiJson(doc: Doc, scope: 'profile' | 'roster'): void {
  const name = `${refCode(doc, scope).replace(/[^a-z0-9]+/gi, '-')}-${scope}.json`
  downloadTextFile(name, JSON.stringify(doc, null, 2), 'application/json')
}

export async function downloadCiPdf(doc: Doc, scope: 'profile' | 'roster', exportedBy: string): Promise<void> {
  const { downloadPdf } = await import('@/lib/pdf')
  await downloadPdf(buildCiPdfSpec(doc, scope, exportedBy), `${refCode(doc, scope).replace(/[^a-z0-9]+/gi, '-')}-${scope}.pdf`)
}
