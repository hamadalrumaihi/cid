/** The Supabase implementation of DocumentService — `document_extract_request`
 *  and the INVOKER `document_search` RPC (RLS through document_pages →
 *  media, so a restricted or SIB-blocked page never surfaces). */
import { requestExtraction, searchDocumentPages } from '@/lib/documents'
import type { DocumentService } from './types'

const supabaseDocumentService: DocumentService = {
  requestExtraction: (mediaId) => requestExtraction(mediaId),
  searchPages: (q, caseId, limit) => searchDocumentPages(q, caseId, limit),
}

export const documentService: DocumentService = supabaseDocumentService
