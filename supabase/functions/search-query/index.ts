// search-query — Meilisearch candidates re-authorised in Postgres.
//
// The index only ever yields CANDIDATES: every hit is passed to
// public.search_authorize under the CALLER's JWT (anon key + the user's
// Authorization header — never the service role), which returns only rows
// the caller can see via RLS, with labels attached. JWT verification stays
// on (default deploy). 503 when MEILI_URL / MEILI_MASTER_KEY are unset.
//
// Body: { q: string, limit?: number, kinds?: ('document_page'|'external_source'|'report')[] }
// Deploy: supabase functions deploy search-query
import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
const KINDS = new Set(['document_page', 'external_source', 'report']);

interface Hit {
  kind: string;
  ref_id: string;
  page_no: number | null;
  _rankingScore?: number;
  _formatted?: { title?: string; text?: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ code: 'method' }, 405);
  const meiliUrl = (Deno.env.get('MEILI_URL') ?? '').replace(/\/$/, '');
  const meiliKey = Deno.env.get('MEILI_MASTER_KEY') ?? '';
  if (!meiliUrl || !meiliKey) return json({ code: 'unavailable', message: 'Index search is not configured.' }, 503);
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ code: 'unauthorized' }, 401);
  let body: { q?: unknown; limit?: unknown; kinds?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: 'bad_request', message: 'JSON body required.' }, 400);
  }
  const q = typeof body.q === 'string' ? body.q.trim().slice(0, 500) : '';
  if (!q) return json({ code: 'bad_request', message: 'q is required.' }, 400);
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 20));
  const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is string => typeof k === 'string' && KINDS.has(k)) : [];

  let hits: Hit[];
  try {
    const res = await fetch(`${meiliUrl}/indexes/cid/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${meiliKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        q,
        limit,
        filter: kinds.length ? `kind IN [${kinds.map((k) => JSON.stringify(k)).join(', ')}]` : undefined,
        attributesToHighlight: ['title', 'text'],
        attributesToCrop: ['text'],
        cropLength: 40,
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
        showRankingScore: true,
        attributesToRetrieve: ['kind', 'ref_id', 'page_no'],
      }),
    });
    if (!res.ok) return json({ code: 'unavailable', message: `Index responded ${res.status}.` }, 503);
    hits = ((await res.json()) as { hits?: Hit[] }).hits ?? [];
  } catch {
    return json({ code: 'unavailable', message: 'Index unreachable.' }, 503);
  }
  const candidates = hits
    .filter((h) => KINDS.has(h.kind) && typeof h.ref_id === 'string')
    .map((h) => ({
      kind: h.kind,
      id: h.ref_id,
      page_no: h.page_no ?? null,
      score: typeof h._rankingScore === 'number' ? h._rankingScore : 0,
      highlight: (h._formatted?.text ?? h._formatted?.title ?? '').slice(0, 600),
    }));
  if (!candidates.length) return json({ hits: [] });

  // Caller-scoped client: anon key + the user's JWT; search_authorize is INVOKER.
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supa.rpc('search_authorize', { p_hits: candidates });
  if (error) return json(error.code === 'P0403' ? { code: 'denied' } : { code: 'rpc_failed', message: 'The search could not be completed.' }, error.code === 'P0403' ? 403 : 500);
  return json({ hits: data ?? [], candidates: candidates.length });
});
