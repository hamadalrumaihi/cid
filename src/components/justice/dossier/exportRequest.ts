'use client'

/** Export flow (P4-11): record first, render second. `legal_record_export`
 *  audits the export (LEGAL_EXPORTED), pins the version and returns the
 *  verification code; only then is the document built from the rows the
 *  viewer already holds and downloaded. A refusal (an instrument on an
 *  undecided request, a viewer without read) is the server's message. */
import { rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { downloadDocx } from '@/lib/docx'
import { fulfilmentLabel, reviewStatusLabel } from '@/lib/justice'
import {
  legalExportFilename, legalInstrumentSpec, legalPacketSpec, specToDocx,
  type ExportVerification, type LegalChargeRow, type TargetDecisionRow, type TimelineRow,
} from '@/lib/legalExport'
import { downloadPdf } from '@/lib/pdf'
import { toast } from '@/lib/toast'
import { readJsonRpc } from './rpcJson'

export interface ExportInputs {
  r: Tables<'legal_requests'>
  version: Tables<'legal_request_versions'> | null
  versions: Tables<'legal_request_versions'>[]
  exhibits: Tables<'legal_request_exhibits'>[]
  timeline: TimelineRow[]
  charges: LegalChargeRow[]
  targetDecisions: TargetDecisionRow[]
  signatures: Tables<'legal_request_signatures'>[]
  name: (id: string | null | undefined) => string
  restrictedSourceIds: ReadonlySet<string>
}

export async function exportLegalDocument(kind: 'instrument' | 'packet', format: 'pdf' | 'docx', inp: ExportInputs): Promise<boolean> {
  const rec = readJsonRpc<{ verification_code?: string; version_id?: string }>(
    await rpc('legal_record_export', { p_request: inp.r.id, p_format: format, p_kind: kind }),
  )
  if (!rec.ok) { toast(rec.message ?? 'Export refused.', 'danger'); return false }
  const code = typeof rec.data?.verification_code === 'string' ? rec.data.verification_code : null
  if (!code) { toast('The export was recorded but no verification code came back.', 'danger'); return false }
  // The export pins the version the server chose (the judicial version for
  // an instrument); render that one when the viewer holds it.
  const pinned = typeof rec.data?.version_id === 'string' ? inp.versions.find((v) => v.id === rec.data?.version_id) ?? null : null
  const version = pinned ?? inp.version
  const verification: ExportVerification = { code, exportedAt: new Date().toISOString(), format }
  const opts = {
    name: inp.name, restrictedSourceIds: inp.restrictedSourceIds, versions: inp.versions,
    statusLabel: reviewStatusLabel, fulfilmentLabel,
  }
  const spec = kind === 'instrument'
    ? legalInstrumentSpec(inp.r, version, inp.charges, inp.targetDecisions, inp.signatures, verification, { ...opts, exhibits: inp.exhibits })
    : legalPacketSpec(inp.r, version, inp.exhibits, inp.timeline, inp.charges, inp.signatures, verification, { ...opts, targetDecisions: inp.targetDecisions })
  const filename = legalExportFilename(inp.r, kind, format, code)
  try {
    if (format === 'pdf') await downloadPdf(spec, filename)
    else downloadDocx(`${spec.docType} — ${spec.refCode}`, specToDocx(spec), filename)
  } catch (e) {
    toast(`The export was recorded (code ${code}) but the file could not be built: ${e instanceof Error ? e.message : String(e)}`, 'danger')
    return false
  }
  toast(`${kind === 'instrument' ? 'Instrument' : 'Court packet'} exported — verification code ${code}.`, 'success')
  return true
}
