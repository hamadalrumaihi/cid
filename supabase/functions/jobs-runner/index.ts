// jobs-runner — in-Supabase drain for the lightweight background_jobs kinds.
//
// Auth: shared secret. `x-jobs-secret` must equal public.app_secrets key
// JOBS_SECRET (read with the service role; the table is deny-all for app
// users, same model as sops-sync). 403 on mismatch, 503 when the row is
// missing (so a misconfigured project fails loudly instead of open).
// Invoked by private.jobs_kick() (pg_net) after every enqueue and by the
// `background-jobs-kick` cron every 2 minutes. Deploy with
//   supabase functions deploy jobs-runner --no-verify-jwt
//
// Each invocation claims up to 5 jobs, one at a time, via public.job_claim
// (p_worker 'runner', only the queues/kinds implemented here — pdf.tool,
// docx/OCR extraction and anything else stays for the worker). It stops
// claiming after ~45 s so the whole request fits the edge wall-clock limit;
// each job gets a 50 s budget. All kind logic lives in ../_shared/jobCore.ts,
// which the worker runs byte-identically with richer providers.
//
// Logging: job ids, kinds and counters only — never content, evidence bytes
// or URLs.

import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import * as pdfLib from 'npm:pdf-lib@1.17.1';
import { zipSync } from 'npm:fflate@0.8.3';
import { CORE_HANDLERS, CORE_KINDS_BY_QUEUE, runJob, type CoreDeps, type ImageProvider, type JobRow, type RunOutcome } from '../_shared/jobCore.ts';

const RUNNER_VERSION = '1';
const CLAIM_BUDGET_MS = 45_000;
const JOB_BUDGET_MS = 50_000;
const MAX_JOBS = 5;
const QUEUES = Object.keys(CORE_KINDS_BY_QUEUE);
const KINDS = Object.values(CORE_KINDS_BY_QUEUE).flat();

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- optional image provider (sharp if it loads, else imagescript, else none) ----
let imageProviderPromise: Promise<ImageProvider | null> | null = null;
function imageProvider(): Promise<ImageProvider | null> {
  if (!imageProviderPromise) {
    imageProviderPromise = (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const mod: any = await import('npm:sharp@0.35.4');
        const sharp = mod.default ?? mod;
        // Probe once: sharp needs a native binary that the edge runtime may not ship.
        await sharp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).metadata().catch(() => undefined);
        return {
          name: 'sharp',
          version: String(mod.versions?.sharp ?? '0.35'),
          async resize(bytes, maxPx) {
            const out = await sharp(bytes, { failOn: 'none' }).rotate().resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
            return { bytes: new Uint8Array(out), mime: 'image/webp', ext: 'webp' };
          },
        } satisfies ImageProvider;
      } catch {
        /* fall through */
      }
      try {
        // deno-lint-ignore no-explicit-any
        const mod: any = await import('https://deno.land/x/imagescript@1.3.0/mod.ts');
        return {
          name: 'imagescript',
          version: '1.3.0',
          async resize(bytes, maxPx) {
            const img = await mod.decode(bytes);
            const frame = img.constructor?.name === 'GIF' ? img[0] : img;
            const scale = Math.min(1, maxPx / Math.max(frame.width, frame.height));
            const resized = scale < 1 ? frame.resize(Math.max(1, Math.round(frame.width * scale)), Math.max(1, Math.round(frame.height * scale))) : frame;
            try {
              const webp = await resized.encodeWEBP(82);
              return { bytes: new Uint8Array(webp), mime: 'image/webp', ext: 'webp' };
            } catch {
              const jpg = await resized.encodeJPEG(82);
              return { bytes: new Uint8Array(jpg), mime: 'image/jpeg', ext: 'jpg' };
            }
          },
        } satisfies ImageProvider;
      } catch {
        return null;
      }
    })();
  }
  return imageProviderPromise;
}

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const unpdf = await import('npm:unpdf@1.7.0');
  const doc = await unpdf.getDocumentProxy(bytes);
  const { text } = await unpdf.extractText(doc, { mergePages: false });
  return Array.isArray(text) ? text : [String(text ?? '')];
}

async function resolveDns(host: string): Promise<string[]> {
  const out: string[] = [];
  let failures = 0;
  for (const type of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, type)));
    } catch {
      failures++;
    }
  }
  if (failures === 2 && !out.length) throw new Error('dns_failed');
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method' }, 405);
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !svc) return json({ error: 'runner_unconfigured' }, 500);
  const supa = createClient(supaUrl, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- shared-secret gate (env override, then app_secrets) ----
  let expected = Deno.env.get('JOBS_SECRET') ?? '';
  if (!expected) {
    const { data, error } = await supa.from('app_secrets').select('value').eq('key', 'JOBS_SECRET').maybeSingle();
    if (error) return json({ error: 'secret_lookup_failed' }, 503);
    expected = String(data?.value ?? '');
  }
  if (!expected) return json({ error: 'JOBS_SECRET not configured' }, 503);
  const given = req.headers.get('x-jobs-secret') ?? '';
  if (!timingSafeEqual(given, expected)) return new Response('forbidden', { status: 403 });

  const images = await imageProvider();
  const deps: CoreDeps = {
    supa,
    storage: {
      async download(bucket, path) {
        const { data, error } = await supa.storage.from(bucket).download(path);
        if (error || !data) throw new Error(`storage_download_failed: ${bucket}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      async upload(bucket, path, bytes, contentType) {
        const { error } = await supa.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
        if (error) throw new Error(`storage_upload_failed: ${bucket}: ${error.message}`);
      },
    },
    sha256Hex: async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)),
    pdfLib,
    zip: (files) => zipSync(files, { level: 6 }),
    pdfPages,
    resolveDns,
    images,
    env: (name) => Deno.env.get(name) || undefined,
    fetch: (input, init) => fetch(input, init),
    serviceName: 'runner',
    serviceVersion: RUNNER_VERSION,
    log: (msg, meta) => console.log(JSON.stringify({ msg, ...(meta ?? {}) })),
  };

  // ---- claim loop ----
  const started = Date.now();
  const outcomes: RunOutcome[] = [];
  let claimed = 0;
  try {
    while (claimed < MAX_JOBS && Date.now() - started < CLAIM_BUDGET_MS) {
      const { data, error } = await supa.rpc('job_claim', { p_worker: 'runner', p_queues: QUEUES, p_kinds: KINDS, p_batch: 1 });
      if (error) return json({ ok: false, error: 'claim_failed', claimed, outcomes }, 500);
      const jobs = (data ?? []) as JobRow[];
      if (!jobs.length) break;
      claimed += jobs.length;
      for (const job of jobs) outcomes.push(await runJob(job, deps, CORE_HANDLERS, JOB_BUDGET_MS));
    }
  } catch (e) {
    console.log(JSON.stringify({ msg: 'runner error', error: String((e as Error)?.message ?? e).slice(0, 200) }));
    return json({ ok: false, claimed, outcomes, image_provider: images?.name ?? null }, 500);
  }
  return json({ ok: true, claimed, ms: Date.now() - started, image_provider: images?.name ?? null, outcomes });
});

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
