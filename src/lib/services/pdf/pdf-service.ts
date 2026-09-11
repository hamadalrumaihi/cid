/** The Supabase implementation of PdfService: both requests are definer
 *  RPCs that validate, snapshot and enqueue a `background_jobs` row; the
 *  provider is chosen server-side from the feature flags. Components import
 *  `pdfService` — never `lib/packets` / `lib/documents` request functions
 *  directly — so a second provider is a one-line swap here. */
import { requestTool } from '@/lib/documents'
import { requestPacket } from '@/lib/packets'
import type { PdfService } from './types'

const supabasePdfService: PdfService = {
  requestTool: (caseId, tool, mediaIds, options) => requestTool(caseId, tool, mediaIds, options),
  requestPacket: (caseId, type, sections, options) => requestPacket(caseId, type, sections, options),
}

export const pdfService: PdfService = supabasePdfService
