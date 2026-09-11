// deps — builds the CoreDeps bag for the Node worker (Supabase service-role
// client, Storage, SHA-256, pdf-lib, fflate, unpdf, DNS, sharp).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as pdfLib from 'pdf-lib';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import type { CoreDeps, ImageProvider } from './jobCore.ts';
import { pdfPages } from './providers/pdf.ts';
import { log } from './telemetry.ts';

export const WORKER_VERSION = '1';

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

export function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

/** Resolve A + AAAA; throws when both lookups fail (transient), [] when the name has no records. */
export async function resolveDns(host: string): Promise<string[]> {
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    return all.map((a) => a.address);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw e;
  }
}

let sharpProvider: ImageProvider | null | undefined;
export async function imageProvider(): Promise<ImageProvider | null> {
  if (sharpProvider !== undefined) return sharpProvider;
  try {
    const mod = await import('sharp');
    const sharp = mod.default;
    sharpProvider = {
      name: 'sharp',
      version: String(sharp.versions?.sharp ?? '0.35'),
      async resize(bytes, maxPx) {
        const out = await sharp(bytes, { failOn: 'none' })
          .rotate()
          .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        return { bytes: new Uint8Array(out), mime: 'image/webp', ext: 'webp' };
      },
    };
  } catch (e) {
    log('sharp unavailable; evidence.derive will be skipped', { error: String((e as Error)?.message ?? e).slice(0, 120) });
    sharpProvider = null;
  }
  return sharpProvider;
}

export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function buildDeps(supa: SupabaseClient): Promise<CoreDeps> {
  const images = await imageProvider();
  return {
    // Structural cast: supabase-js's generic rpc/from satisfy the SupaLike subset the core uses.
    supa: supa as unknown as CoreDeps['supa'],
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
    sha256Hex,
    pdfLib,
    zip: (files) => zipSync(files, { level: 6 }),
    pdfPages,
    resolveDns,
    images,
    env,
    fetch: (input, init) => fetch(input, init),
    serviceName: 'worker',
    serviceVersion: WORKER_VERSION,
    log,
  };
}
