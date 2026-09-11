// meilisearch — thin REST client for the `cid` index (MEILI_URL + MEILI_MASTER_KEY).
// Index documents are candidates only; search-query re-authorises every hit
// in Postgres. The document builder + queue drain live in jobCore.searchSync
// (shared with the runner); this module adds boot-time index setup, a health
// check and a full-reindex helper for operators.
import type { CoreDeps } from '../jobCore.ts';
import { ensureMeiliIndex } from '../jobCore.ts';
import { env } from '../deps.ts';

export function meiliConfigured(): boolean {
  return !!(env('MEILI_URL') && env('MEILI_MASTER_KEY'));
}

function base(): string {
  return (env('MEILI_URL') ?? '').replace(/\/$/, '');
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { authorization: `Bearer ${env('MEILI_MASTER_KEY') ?? ''}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return res;
}

export async function ensureIndex(deps: CoreDeps): Promise<void> {
  await ensureMeiliIndex(deps);
}

export async function health(): Promise<{ ok: boolean; latency_ms: number }> {
  const t = Date.now();
  try {
    const res = await call('/health');
    return { ok: res.ok, latency_ms: Date.now() - t };
  } catch {
    return { ok: false, latency_ms: Date.now() - t };
  }
}

/** Remove every document from the index (operators re-queue rows in search_index_queue afterwards). */
export async function clearIndex(): Promise<void> {
  await call('/indexes/cid/documents', { method: 'DELETE' });
}

export async function stats(): Promise<Record<string, unknown>> {
  const res = await call('/indexes/cid/stats');
  return res.ok ? ((await res.json()) as Record<string, unknown>) : { error: res.status };
}
