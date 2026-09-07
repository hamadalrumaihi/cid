'use client'

/** Report export (P5-07, RB9): record first, render second.
 *  `report_record_export` audits the export (REPORT_EXPORTED), pins the
 *  version (the latest report_versions number, null for a draft) and
 *  returns the verification code; only then is the document built from the
 *  rows the viewer already holds (lib/reportExport) and downloaded. PDF and
 *  DOCX go through lib/pdf / lib/docx (the PDF renderer is loaded lazily
 *  inside downloadPdf); Markdown is a text download. */
import { readJsonRpc } from '@/components/justice/dossier/rpcJson'
import { Button } from '@/components/ui/Button'
import { rpc } from '@/lib/db'
import { downloadDocx } from '@/lib/docx'
import { downloadTextFile } from '@/lib/format'
import { downloadPdf } from '@/lib/pdf'
import {
  reportDocx, reportExportFilename, reportMarkdown, reportPdfSpec,
  type ReportExportInput, type ReportExportVerification,
} from '@/lib/reportExport'
import { toast } from '@/lib/toast'

export type ReportExportFormat = 'pdf' | 'docx' | 'md'
export type ReportExportInputs = Omit<ReportExportInput, 'verification'>

/** The export flow. Returns true when a file was produced. */
export async function exportReport(format: ReportExportFormat, inp: ReportExportInputs): Promise<boolean> {
  const rec = readJsonRpc<{ verification_code?: string; version_number?: number | null; id?: string }>(
    await rpc('report_record_export', { p_report: inp.report.id, p_format: format }),
  )
  if (!rec.ok) { toast(rec.message ?? 'Export refused.', 'danger'); return false }
  const code = typeof rec.data?.verification_code === 'string' ? rec.data.verification_code : null
  if (!code) { toast('The export was recorded but no verification code came back.', 'danger'); return false }
  const verification: ReportExportVerification = {
    code,
    versionNumber: typeof rec.data?.version_number === 'number' ? rec.data.version_number : null,
    exportedAt: new Date().toISOString(),
    format,
  }
  const input: ReportExportInput = { ...inp, verification }
  const filename = reportExportFilename(input, format, code)
  try {
    if (format === 'pdf') await downloadPdf(reportPdfSpec(input), filename)
    else if (format === 'docx') downloadDocx(`${input.schema.title} — ${input.caseNumber ?? ''}`, reportDocx(input), filename)
    else downloadTextFile(filename, reportMarkdown(input), 'text/markdown')
  } catch (e) {
    toast(`The export was recorded (code ${code}) but the file could not be built: ${e instanceof Error ? e.message : String(e)}`, 'danger')
    return false
  }
  toast(`Report exported — verification code ${code}.`, 'success')
  return true
}

const FORMATS: { id: ReportExportFormat; label: string; title: string }[] = [
  { id: 'pdf', label: 'PDF', title: 'Export as PDF (recorded, with verification code)' },
  { id: 'docx', label: 'DOCX', title: 'Export as Word document (recorded, with verification code)' },
  { id: 'md', label: '.md', title: 'Export as Markdown (recorded, with verification code)' },
]

/** Three recorded-export buttons. `input` is everything but the
 *  verification, which the flow obtains from the server. */
export function ReportExportMenu({ input, disabled, size = 'sm', className = '' }: {
  input: ReportExportInputs
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div role="group" aria-label="Export report" className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span className="mr-1 text-xs font-semibold text-slate-400">Export</span>
      {FORMATS.map((f) => (
        <Button key={f.id} size={size} title={f.title} disabled={disabled} onAction={() => exportReport(f.id, input)}>
          {f.label}
        </Button>
      ))}
    </div>
  )
}
