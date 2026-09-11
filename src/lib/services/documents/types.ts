/** Document service adapter — page extraction and page search. The
 *  extraction provider (Docling via the worker, or the runner's `unpdf`
 *  fallback) and the search backend (Postgres FTS, or Meilisearch candidates
 *  re-authorised by `search_authorize`) are server concerns; components see
 *  only this interface. */
import type { DocumentSearchHit } from '@/lib/documents'
import type { MutationResult } from '@/lib/db'
import type { JsonRpcOutcome } from '@/lib/packets'

export type ExtractionRequestResult = JsonRpcOutcome<{ job_id?: string }>

export interface DocumentService {
  /** Enqueue `document.extract` for a media row → `{job_id}`. */
  requestExtraction(mediaId: string): Promise<ExtractionRequestResult>
  /** Full-text search over extracted pages, optionally scoped to a case. */
  searchPages(q: string, caseId: string | null, limit?: number): Promise<MutationResult<DocumentSearchHit[]>>
}
