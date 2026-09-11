// source.fetch — Crawl4AI when CRAWL4AI_URL is set, else the basic guarded
// fetch shared with the runner. Both paths run the same SSRF pre-checks
// (urlStaticCheck + DNS via dns.promises.lookup) and end in
// external_source_ingest / external_source_failed.
import { JobError, ingestFromPage, sourceFetchBasic, sourceFetchFailure, type KindHandler } from '../jobCore.ts';
import { crawl, crawl4aiConfigured } from '../providers/crawl4ai.ts';

export const kind = 'source.fetch';
export const queue = 'crawler';

const CRAWL4AI_VERSION = '1';

export const handler: KindHandler = async (ctx) => {
  if (!crawl4aiConfigured()) return sourceFetchBasic(ctx);
  const { job, deps, heartbeat } = ctx;
  const sourceId = String(job.args?.source_id ?? job.subject_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new JobError('bad_args: source_id', false);
  const { data: source, error } = await deps.supa.from('external_sources').select('id,url,status,deleted_at').eq('id', sourceId).maybeSingle();
  if (error) throw new JobError(`external_sources: ${error.message}`, true);
  if (!source) throw new JobError('missing_row: external_source', false);
  if (source.deleted_at) return { skipped: 'deleted' };
  const { data: policyRow } = await deps.supa.from('crawler_policy').select('*').eq('id', 1).maybeSingle();
  const policy = (policyRow ?? {}) as Record<string, unknown>;
  try {
    await deps.supa.from('external_sources').update({ status: 'fetching' }).eq('id', sourceId);
    await heartbeat({ pct: 10, step: 'crawl' });
    const r = await crawl(deps, String(source.url), policy);
    await heartbeat({ pct: 60, step: 'snapshot' });
    const raw = new TextEncoder().encode(r.html);
    const payload = await ingestFromPage(
      deps,
      sourceId,
      { http_status: r.http_status, content_type: 'text/html', final_url: r.final_url, bytes: raw },
      'crawl4ai',
      CRAWL4AI_VERSION,
      { title: r.title, author: r.author, published_at: r.published_at, text: r.text, markdown: r.markdown },
    );
    await heartbeat({ pct: 90, step: 'ingest' });
    const { data: result, error: ingestErr } = await deps.supa.rpc('external_source_ingest', { p_job: job.id, p_source: sourceId, p_result: payload });
    if (ingestErr) throw new JobError(`external_source_ingest: ${ingestErr.message}`, true);
    return { http_status: r.http_status, byte_size: r.byte_size, service: 'crawl4ai', ingest: result };
  } catch (e) {
    return sourceFetchFailure(ctx, sourceId, e);
  }
};
