'use client'

/** The one crawler adapter (contract §5.1 `crawler/`). Two RPCs, nothing
 *  else: the server owns URL validation (`private.url_static_check`), the
 *  crawler policy, the SSRF wall and the job queue. Both calls answer the
 *  jsonb `{ok, …}` contract; a P0403 refusal (perm_raise) and a network
 *  failure both come back as `{ok:false}` so a dialog can show one line. */
import { rpc } from '@/lib/db'
import { humanizeError } from '@/lib/toast'
import type { CrawlResult, CrawlerAdapter } from './types'

function shape(res: { data: unknown; error: { message: string; code?: string } | null }): CrawlResult {
  if (res.error) return { ok: false, code: res.error.code ?? 'error', message: humanizeError(res.error.message) }
  const d = (res.data ?? {}) as { ok?: boolean; code?: string; message?: string; id?: string; source_number?: string; job_id?: string | null }
  if (d.ok === false) return { ok: false, code: d.code ?? 'refused', message: d.message ?? 'The server refused this request.' }
  if (!d.id) return { ok: false, code: 'bad_response', message: 'The server answered without a source id.' }
  return { ok: true, id: d.id, sourceNumber: d.source_number ?? '', jobId: d.job_id ?? null }
}

export const CrawlerService: CrawlerAdapter = {
  async submit(url, caseId = null, notes = null) {
    return shape(await rpc('external_source_submit', { p_url: url.trim(), p_case: caseId ?? null, p_notes: notes?.trim() || null }))
  },
  async recrawl(sourceId) {
    return shape(await rpc('external_source_recrawl', { p_source: sourceId }))
  },
}
