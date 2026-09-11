// semantic-query — embeds the caller's query with the server-side provider
// key, then calls public.hybrid_search (and public.semantic_search when
// mode === 'semantic') AS THE CALLER: the Supabase client is built from the
// anon key plus the user's own Authorization header, so RLS and the INVOKER
// RPCs apply exactly as they would from the browser. The service role is
// never used here. JWT verification is left on (default deploy).
//
// Body: { q: string, limit?: number, case_id?: uuid, mode?: 'hybrid'|'semantic' }
// 503 { code: 'unavailable' } when EMBEDDINGS_API_KEY is not configured.
// Deploy: supabase functions deploy semantic-query
import { createClient } from 'npm:@supabase/supabase-js@2.109.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

async function embed(q: string): Promise<number[]> {
  const key = Deno.env.get('EMBEDDINGS_API_KEY')!;
  const base = (Deno.env.get('EMBEDDINGS_BASE_URL') || 'https://api.openai.com').replace(/\/$/, '');
  const model = Deno.env.get('EMBEDDINGS_MODEL') || 'text-embedding-3-small';
  const res = await fetch(`${base}/v1/embeddings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: [q], encoding_format: 'float' }),
  });
  if (!res.ok) throw new Error(`embeddings_http_${res.status}`);
  const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const v = body.data?.[0]?.embedding;
  if (!Array.isArray(v) || !v.length) throw new Error('embeddings_bad_response');
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ code: 'method' }, 405);
  if (!Deno.env.get('EMBEDDINGS_API_KEY')) return json({ code: 'unavailable', message: 'Semantic search is not configured.' }, 503);
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ code: 'unauthorized' }, 401);
  let body: { q?: unknown; limit?: unknown; case_id?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: 'bad_request', message: 'JSON body required.' }, 400);
  }
  const q = typeof body.q === 'string' ? body.q.trim().slice(0, 1000) : '';
  if (!q) return json({ code: 'bad_request', message: 'q is required.' }, 400);
  // A confidential-informant number never leaves the compartment — not even
  // to the embeddings provider.
  if (/\bCI-\d+/i.test(q)) return json({ code: 'bad_request', message: 'That query cannot be searched semantically.' }, 400);
  const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
  const caseId = typeof body.case_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.case_id) ? body.case_id : null;
  const mode = body.mode === 'semantic' ? 'semantic' : 'hybrid';

  // Caller-scoped client: anon key + the user's JWT. RLS applies.
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const vector = await embed(q);
    const embedding = '[' + vector.join(',') + ']';
    if (mode === 'semantic') {
      const { data, error } = await supa.rpc('semantic_search', { p_embedding: embedding, p_limit: limit, p_case: caseId });
      if (error) return json(error.code === 'P0403' ? { code: 'denied' } : { code: 'rpc_failed', message: 'The search could not be completed.' }, error.code === 'P0403' ? 403 : 500);
      return json({ mode, rows: data ?? [] });
    }
    const { data, error } = await supa.rpc('hybrid_search', { p_q: q, p_embedding: embedding, p_limit: limit, p_case: caseId });
    if (error) return json(error.code === 'P0403' ? { code: 'denied' } : { code: 'rpc_failed', message: 'The search could not be completed.' }, error.code === 'P0403' ? 403 : 500);
    return json({ mode, rows: data ?? [] });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.startsWith('embeddings_')) return json({ code: 'unavailable', message: 'Embedding provider error.' }, 503);
    return json({ code: 'error', message: msg.slice(0, 200) }, 500);
  }
});
