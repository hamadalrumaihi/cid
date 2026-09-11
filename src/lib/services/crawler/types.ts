/** Crawler adapter contract (contract §5.1). Components import the adapter,
 *  never a provider: the portal only ever ASKS for a fetch — the runner or
 *  the worker (basic fetch / Crawl4AI, both behind the `crawler_policy` SSRF
 *  wall) does the crawling as a `source.fetch` background job. Results land
 *  on `external_sources` / `external_source_versions` through the service
 *  RPCs, never through the browser. */

export interface CrawlSubmitResult {
  ok: true
  /** The new (or already existing) `external_sources` row. */
  id: string
  sourceNumber: string
  /** The queued `source.fetch` job, when the server reported one. */
  jobId: string | null
}

export interface CrawlRefusal {
  ok: false
  /** Server code (`bad_request`, `denied`, `blocked_domain`, …) or the SQLSTATE. */
  code: string
  message: string
}

export type CrawlResult = CrawlSubmitResult | CrawlRefusal

export interface CrawlerAdapter {
  /** `external_source_submit` — validates the URL server-side and enqueues the first fetch. */
  submit: (url: string, caseId?: string | null, notes?: string | null) => Promise<CrawlResult>
  /** `external_source_recrawl` — enqueues another fetch; a new version only appears if the content changed. */
  recrawl: (sourceId: string) => Promise<CrawlResult>
}
