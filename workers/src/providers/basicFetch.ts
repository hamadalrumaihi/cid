// basicFetch — the guarded HTTP provider shared with the edge runner
// (static URL policy + DNS pre-check per hop, manual redirects, byte cap,
// timeout, textual content types only). Used when CRAWL4AI_URL is unset,
// and as the SSRF pre-check before handing a URL to Crawl4AI.
export { guardedFetch, ingestFromPage, assertHostResolvesPublic, FetchRefused, sourceFetchFailure } from '../jobCore.ts';
export type { FetchedPage, SourceIngest } from '../jobCore.ts';
