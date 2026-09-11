// jobCore — the background job kinds shared by the edge runner and the worker.
// Pure TypeScript, import-free apart from the sibling shared modules: every
// runtime dependency (Supabase client, storage, hashing, pdf-lib, zip, PDF
// text, DNS, image resizing, env) is injected through `CoreDeps`, so
// supabase/functions/_shared/jobCore.ts and workers/src/jobCore.ts are
// byte-identical and behave the same. The worker layers richer providers on
// top (Stirling, Crawl4AI, Docling, sharp) in workers/src/jobs/*.ts.
//
// Logging rule: only job ids, kinds and counters. Never document content,
// URLs with credentials or evidence bytes.

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

import { urlStaticCheck, isBlockedAddress } from './urlPolicy.ts';
import { extractHtml } from './htmlText.ts';
import { buildManifest, canonicalJson, type ManifestFile } from './manifest.ts';
import { chunkText } from './chunk.ts';
import { renderPacketPdf, type PacketImage } from './packetPdf.ts';

export interface JobRow {
  id: string;
  queue: string;
  kind: string;
  args: Record<string, unknown>;
  case_id: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  attempts: number;
  max_attempts: number;
  created_by: string | null;
  priority?: number;
  idempotency_key?: string;
}

export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string; details?: string | null } | null;
}

/** Structural subset of supabase-js used here (rpc + from). */
export interface SupaLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): any;
}

export interface StorageLike {
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface ImageProvider {
  name: string;
  version: string;
  /** Resize so the longest edge is <= maxPx; returns encoded bytes + mime + extension. */
  resize(bytes: Uint8Array, maxPx: number): Promise<{ bytes: Uint8Array; mime: string; ext: string }>;
}

export interface CoreDeps {
  supa: SupaLike;
  storage: StorageLike;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  pdfLib: any;
  zip(files: Record<string, Uint8Array>): Uint8Array;
  /** Per-page text of a PDF (index 0 = page 1). */
  pdfPages(bytes: Uint8Array): Promise<string[]>;
  /** Resolve A + AAAA records; [] when none. */
  resolveDns(host: string): Promise<string[]>;
  images: ImageProvider | null;
  env(name: string): string | undefined;
  fetch: typeof fetch;
  serviceName: string;
  serviceVersion: string;
  log(msg: string, meta?: Record<string, unknown>): void;
}

export interface JobProgress {
  pct?: number;
  step?: string;
  message?: string;
}

export interface JobContext {
  job: JobRow;
  deps: CoreDeps;
  heartbeat(progress: JobProgress): Promise<void>;
  /** Epoch ms after which the handler should stop taking on more work (runner budget). */
  deadline: number;
}

export class JobError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'JobError';
    this.retryable = retryable;
  }
}

export type KindHandler = (ctx: JobContext) => Promise<unknown>;

export const QUEUES = ['pdf', 'crawler', 'documents', 'ocr', 'search', 'embeddings', 'evidence', 'exports', 'notifications', 'health'] as const;

/** queue → the kinds this core implements on it. */
export const CORE_KINDS_BY_QUEUE: Record<string, string[]> = {
  evidence: ['evidence.verify', 'evidence.derive'],
  pdf: ['packet.render'],
  exports: ['bundle.build'],
  crawler: ['source.fetch'],
  documents: ['document.extract'],
  search: ['search.sync'],
  embeddings: ['embeddings.generate'],
  health: ['health.probe'],
};

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;
const MAX_PACKET_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RUNNER_PDF_BYTES = 50 * 1024 * 1024;
const TEXT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/json'];

/** Every object the service fetches from case-evidence must live in the row's
 *  own folder — case/<case_id>/<media_id>/… — the shape evidence_register and
 *  the RPCs enforce. An unregistered row's path is client-chosen, so the job
 *  refuses anything else instead of fetching it with the service key. */
export function mediaPathOk(row: { id?: string | null; case_id?: string | null; storage_path?: string | null }): boolean {
  const p = String(row.storage_path ?? '');
  return !!row.id && !!row.case_id && p.startsWith(`case/${row.case_id}/${row.id}/`) && !p.includes('/../');
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export async function rpc<T = unknown>(deps: CoreDeps, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await deps.supa.rpc(fn, args);
  if (error) {
    const permanent = /^(P0403|22P02|23|42)/.test(error.code ?? '') || /not found|bad_args|bad_state/i.test(error.message);
    throw new JobError(`${fn}: ${error.message}`.slice(0, 500), !permanent);
  }
  return data as T;
}

async function selectOne<T = Record<string, any>>(deps: CoreDeps, table: string, columns: string, filters: Record<string, unknown>): Promise<T | null> {
  let q = deps.supa.from(table).select(columns);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) throw new JobError(`${table}: ${error.message}`.slice(0, 300), true);
  return (data as T) ?? null;
}

async function selectMany<T = Record<string, any>>(deps: CoreDeps, table: string, columns: string, build: (q: any) => any): Promise<T[]> {
  const { data, error } = await build(deps.supa.from(table).select(columns));
  if (error) throw new JobError(`${table}: ${error.message}`.slice(0, 300), true);
  return (data as T[]) ?? [];
}

function arg<T = unknown>(job: JobRow, key: string): T | undefined {
  const v = job.args?.[key];
  return v === null ? undefined : (v as T);
}

function uuidArg(job: JobRow, key: string, fallbackSubject?: string): string {
  const v = (arg<string>(job, key) ?? (fallbackSubject && job.subject_kind === fallbackSubject ? job.subject_id : undefined) ?? job.subject_id ?? '') as string;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new JobError(`bad_args: ${key}`, false);
  return v;
}

function isImageMime(m: string | null | undefined): boolean {
  return /^image\/(jpeg|png|webp|gif|bmp|tiff|avif)$/i.test(m ?? '');
}

async function getPolicy(deps: CoreDeps): Promise<Record<string, any>> {
  const row = await selectOne(deps, 'crawler_policy', '*', { id: 1 });
  return row ?? { allow_domains: [], block_domains: [], max_bytes: 5 * 1024 * 1024, timeout_ms: 20000, max_pages: 5, max_depth: 1 };
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file';
}

function sizeOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Should a media row be a candidate for the search index / embeddings?
 * Conservative rule evaluable without SIU context: restricted rows never;
 * rows attached to a registry entity (person/gang/place/vehicle) only when
 * the case is not an SIU-classified case. SIU-blocked sections cannot be
 * evaluated from a service-role process, so those cases are skipped entirely
 * — search_authorize re-checks every hit under the caller anyway.
 */
export function mediaIndexable(media: Record<string, any>, caseRow: Record<string, any> | null): boolean {
  if (!media || media.deleted_at) return false;
  if (media.restricted === true) return false;
  const entityBound = !!(media.person_id || media.gang_id || media.place_id || media.vehicle_id);
  const siuCase = !!caseRow?.siu_classification;
  if (siuCase) return false;
  if (entityBound && caseRow === null && media.case_id) return false;
  return true;
}

function classifyHttpError(status: number): 'permanent' | 'transient' {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

// ---------------------------------------------------------------------------
// evidence.verify
// ---------------------------------------------------------------------------

export const evidenceVerify: KindHandler = async ({ job, deps, heartbeat }) => {
  const mediaId = uuidArg(job, 'media_id', 'media');
  const media = await selectOne(deps, 'media', 'id,case_id,storage_path,byte_size,sha256,deleted_at', { id: mediaId });
  if (!media) throw new JobError('missing_row: media', false);
  if (!media.storage_path) throw new JobError('bad_state: media has no storage_path', false);
  if (!mediaPathOk(media)) throw new JobError('bad_state: storage path outside the media folder', false);
  if (sizeOrZero(media.byte_size) > MAX_EVIDENCE_BYTES) throw new JobError('too_large', false);
  await heartbeat({ pct: 10, step: 'download' });
  const bytes = await deps.storage.download('case-evidence', media.storage_path);
  await heartbeat({ pct: 70, step: 'hash' });
  const sha256 = await deps.sha256Hex(bytes);
  const result = await rpc(deps, 'evidence_verify_result', { p_job: job.id, p_media: mediaId, p_sha256: sha256, p_byte_size: bytes.byteLength });
  return { byte_size: bytes.byteLength, verify: result };
};

// ---------------------------------------------------------------------------
// evidence.derive (images only here; PDFs/OCR are worker work)
// ---------------------------------------------------------------------------

export const evidenceDerive: KindHandler = async ({ job, deps, heartbeat }) => {
  const mediaId = uuidArg(job, 'media_id', 'media');
  const media = await selectOne(deps, 'media', 'id,case_id,storage_path,mime,byte_size,deleted_at,parent_media_id,title', { id: mediaId });
  if (!media) throw new JobError('missing_row: media', false);
  if (media.parent_media_id) return { skipped: 'is_derivative' };
  if (!isImageMime(media.mime)) return { skipped: 'not_image' };
  if (!deps.images) return { skipped: 'no_image_provider' };
  if (!media.storage_path || !media.case_id) throw new JobError('bad_state: media has no storage_path/case', false);
  if (!mediaPathOk(media)) throw new JobError('bad_state: storage path outside the media folder', false);
  if (sizeOrZero(media.byte_size) > MAX_EVIDENCE_BYTES) throw new JobError('too_large', false);
  await heartbeat({ pct: 10, step: 'download' });
  const original = await deps.storage.download('case-evidence', media.storage_path);
  const out: Record<string, unknown> = {};
  const variants: Array<['thumbnail' | 'preview', number]> = [['thumbnail', 320], ['preview', 1600]];
  for (const [i, [type, px]] of variants.entries()) {
    await heartbeat({ pct: 30 + i * 30, step: type });
    let resized: { bytes: Uint8Array; mime: string; ext: string };
    try {
      resized = await deps.images.resize(original, px);
    } catch (e) {
      // A decoder failure is a property of the file, not of the run.
      throw new JobError(`image_decode_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, false);
    }
    const path = `case/${media.case_id}/${media.id}/${type}.${resized.ext}`;
    await deps.storage.upload('case-evidence', path, resized.bytes, resized.mime);
    const sha256 = await deps.sha256Hex(resized.bytes);
    const id = await rpc<string>(deps, 'evidence_derivative_register', {
      p_job: job.id,
      p_parent: media.id,
      p_storage_path: path,
      p_derivative_type: type,
      p_sha256: sha256,
      p_byte_size: resized.bytes.byteLength,
      p_mime: resized.mime,
      p_service: deps.images.name,
      p_service_version: deps.images.version,
      p_title: `${media.title ?? 'Evidence'} (${type})`,
    });
    out[type] = { media_id: id, path, byte_size: resized.bytes.byteLength };
  }
  return out;
};

// ---------------------------------------------------------------------------
// packet.render
// ---------------------------------------------------------------------------

export const packetRender: KindHandler = async ({ job, deps, heartbeat }) => {
  const packetId = uuidArg(job, 'packet_id', 'case_packet');
  const packet = await selectOne(deps, 'case_packets', 'id,case_id,packet_type,sections,options,status,requested_by,snapshot,watermark,deleted_at', { id: packetId });
  if (!packet) throw new JobError('missing_row: case_packet', false);
  try {
    if (packet.deleted_at) throw new JobError('bad_state: packet deleted', false);
    if (packet.status === 'cancelled') return { skipped: 'cancelled' };
    const snapshot = (packet.snapshot ?? {}) as Record<string, any>;
    const caseRow = await selectOne(deps, 'cases', 'id,case_number,title', { id: packet.case_id });
    const requester = packet.requested_by ? await selectOne(deps, 'profiles', 'id,display_name', { id: packet.requested_by }) : null;
    const options = (packet.options ?? {}) as Record<string, any>;
    const snapCase = (snapshot.case ?? {}) as Record<string, any>;
    const caseNumber = String(snapCase.case_number ?? caseRow?.case_number ?? '');
    const caseTitle = String(snapCase.title ?? caseRow?.title ?? '');
    const classification = String(snapshot.classification ?? options.classification ?? 'LAW ENFORCEMENT SENSITIVE');
    const watermark = String(options.watermark ?? packet.watermark ?? 'LAW ENFORCEMENT SENSITIVE');
    const generatedAt = new Date().toISOString();
    const generatedBy = { id: requester?.id ?? null, name: requester?.display_name ?? null };
    const sections: string[] = Array.isArray(snapshot.sections) ? snapshot.sections.map(String) : Array.isArray(packet.sections) ? packet.sections : [];
    if (!Array.isArray(snapshot.sections)) snapshot.sections = sections;

    // The snapshot's `evidence` list (built under the requester, restricted
    // rows only with an approval) is the evidence index AND the image source.
    const evidenceRows: Record<string, any>[] = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
    // Evidence images: originals from case-evidence, jpg/png only, <= 8 MB each,
    // and only from the row's own folder (never a client-chosen path).
    const images: PacketImage[] = [];
    const imageRows: Record<string, any>[] = sections.includes('evidence_images') ? evidenceRows.filter((r) => /^image\/(jpeg|png)$/i.test(String(r?.mime ?? ''))) : [];
    let skippedImages = 0;
    for (const [i, row] of imageRows.entries()) {
      await heartbeat({ pct: 10 + Math.round((i / Math.max(imageRows.length, 1)) * 30), step: 'images' });
      const mime = String(row.mime ?? '');
      const path = String(row.storage_path ?? '');
      if (!/^image\/(jpeg|png)$/i.test(mime) || !path || !mediaPathOk({ id: row.id, case_id: packet.case_id, storage_path: path }) || sizeOrZero(row.byte_size) > MAX_PACKET_IMAGE_BYTES || row.restricted === true) {
        skippedImages++;
        continue;
      }
      try {
        const bytes = await deps.storage.download('case-evidence', path);
        if (bytes.byteLength > MAX_PACKET_IMAGE_BYTES) {
          skippedImages++;
          continue;
        }
        images.push({ label: `${row.evidence_number ?? ''} ${row.title ?? ''}`.trim() || basename(path), bytes, mime });
      } catch {
        skippedImages++;
      }
    }

    await heartbeat({ pct: 45, step: 'render' });
    const rendered = await renderPacketPdf({
      pdfLib: deps.pdfLib,
      snapshot,
      caseNumber,
      caseTitle,
      packetType: String(packet.packet_type ?? 'custom'),
      classification,
      generatedAt,
      generatedBy: generatedBy.name ?? '',
      watermark,
      images,
    });
    await heartbeat({ pct: 75, step: 'upload' });
    const base = `case/${packet.case_id}/${packet.id}`;
    const pdfPath = `${base}/packet.pdf`;
    const pdfSha = await deps.sha256Hex(rendered.bytes);
    await deps.storage.upload('case-packets', pdfPath, rendered.bytes, 'application/pdf');

    const evidenceIds = new Set<string>();
    for (const r of evidenceRows) if (r?.id) evidenceIds.add(String(r.id));
    const manifest = buildManifest({
      bundle_id: packet.id,
      kind: 'case_packet',
      case_id: packet.case_id,
      case_number: caseNumber || null,
      generated_at: generatedAt,
      generated_by: generatedBy,
      classification,
      files: [{ path: 'packet.pdf', size: rendered.bytes.byteLength, sha256: pdfSha, source: { kind: 'packet', id: packet.id } }],
      source_evidence_ids: Array.from(evidenceIds),
    });
    const manifestText = canonicalJson(manifest);
    const manifestBytes = new TextEncoder().encode(manifestText);
    const manifestSha = await deps.sha256Hex(manifestBytes);
    await deps.storage.upload('case-packets', `${base}/manifest.json`, manifestBytes, 'application/json');
    await deps.storage.upload('case-packets', `${base}/manifest.sha256`, new TextEncoder().encode(manifestSha + '\n'), 'text/plain');
    await heartbeat({ pct: 90, step: 'record' });
    const result = await rpc(deps, 'case_packet_render_result', {
      p_job: job.id,
      p_packet: packet.id,
      p_storage_path: pdfPath,
      p_sha256: pdfSha,
      p_byte_size: rendered.bytes.byteLength,
      p_page_count: rendered.pageCount,
      p_manifest: manifest,
      p_manifest_sha256: manifestSha,
    });
    return { storage_path: pdfPath, page_count: rendered.pageCount, byte_size: rendered.bytes.byteLength, images: images.length, skipped_images: skippedImages, record: result };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    try {
      await deps.supa.rpc('case_packet_failed', { p_job: job.id, p_packet: packetId, p_error: msg });
    } catch {
      /* the job failure below is still recorded */
    }
    throw e;
  }
};

// ---------------------------------------------------------------------------
// bundle.build
// ---------------------------------------------------------------------------

export const bundleBuild: KindHandler = async ({ job, deps, heartbeat }) => {
  const mediaIds = (arg<unknown[]>(job, 'media_ids') ?? []).map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (!mediaIds.length) throw new JobError('bad_args: media_ids', false);
  if (!job.created_by) throw new JobError('bad_args: created_by', false);
  const caseId = (arg<string>(job, 'case_id') ?? job.case_id) || null;
  const caseRow = caseId ? await selectOne(deps, 'cases', 'id,case_number', { id: caseId }) : null;
  const requester = await selectOne(deps, 'profiles', 'id,display_name', { id: job.created_by });
  const rows = await selectMany(deps, 'media', 'id,case_id,storage_path,mime,byte_size,sha256,evidence_number,original_filename,title,restricted,classification,deleted_at', (q) => q.in('id', mediaIds));
  const files: Record<string, Uint8Array> = {};
  const manifestFiles: ManifestFile[] = [];
  let excludedRestricted = 0;
  let total = 0;
  let classification = 'unclassified';
  const rank: Record<string, number> = { unclassified: 0, sensitive: 1, restricted: 2 };
  for (const [i, m] of rows.entries()) {
    await heartbeat({ pct: Math.round((i / rows.length) * 70), step: 'collect' });
    if (m.deleted_at || !m.storage_path || !mediaPathOk(m)) continue;
    if (m.restricted === true && arg<boolean>(job, 'allow_restricted') !== true) {
      excludedRestricted++;
      continue;
    }
    if (sizeOrZero(m.byte_size) > MAX_EVIDENCE_BYTES) continue;
    const bytes = await deps.storage.download('case-evidence', m.storage_path);
    const sha = await deps.sha256Hex(bytes);
    if (m.sha256 && String(m.sha256).replace(/^\\x/, '').toLowerCase() !== sha) {
      // Never ship evidence whose bytes no longer match the registered hash.
      throw new JobError(`integrity_mismatch: ${m.id}`, false);
    }
    const folder = safeName(String(m.evidence_number ?? m.id));
    const name = safeName(String(m.original_filename ?? basename(m.storage_path)));
    const path = `evidence/${folder}/${name}`;
    files[path] = bytes;
    total += bytes.byteLength;
    manifestFiles.push({ path, size: bytes.byteLength, sha256: sha, source: { kind: 'media', id: m.id, evidence_number: m.evidence_number ?? null } });
    if ((rank[m.classification ?? 'unclassified'] ?? 0) > rank[classification]) classification = m.classification;
  }
  if (!manifestFiles.length) throw new JobError('bad_state: no exportable media', false);
  const generatedAt = new Date().toISOString();
  const manifest = buildManifest({
    bundle_id: job.id,
    kind: 'evidence_bundle',
    case_id: caseId,
    case_number: caseRow?.case_number ?? null,
    generated_at: generatedAt,
    generated_by: { id: job.created_by, name: requester?.display_name ?? null },
    classification,
    files: manifestFiles,
    source_evidence_ids: manifestFiles.map((f) => f.source.id),
  });
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const manifestSha = await deps.sha256Hex(manifestBytes);
  files['manifest.json'] = manifestBytes;
  files['manifest.sha256'] = new TextEncoder().encode(manifestSha + '\n');
  await heartbeat({ pct: 80, step: 'zip' });
  const zipBytes = deps.zip(files);
  const zipSha = await deps.sha256Hex(zipBytes);
  const path = `export/${job.created_by}/${job.id}/bundle.zip`;
  await deps.storage.upload('exports', path, zipBytes, 'application/zip');
  await heartbeat({ pct: 95, step: 'record' });
  const result = await rpc(deps, 'evidence_bundle_result', { p_job: job.id, p_storage_path: path, p_sha256: zipSha, p_byte_size: zipBytes.byteLength, p_manifest: manifest, p_manifest_sha256: manifestSha });
  return { storage_path: path, files: manifestFiles.length, bytes_in: total, byte_size: zipBytes.byteLength, excluded_restricted: excludedRestricted, record: result };
};

// ---------------------------------------------------------------------------
// source.fetch (basic provider). Worker swaps in Crawl4AI when configured.
// ---------------------------------------------------------------------------

export class FetchRefused extends Error {
  kind: 'permanent' | 'transient';
  constructor(message: string, kind: 'permanent' | 'transient' = 'permanent') {
    super(message);
    this.name = 'FetchRefused';
    this.kind = kind;
  }
}

export interface FetchedPage {
  http_status: number;
  content_type: string;
  final_url: string;
  bytes: Uint8Array;
}

/** DNS-validate a host: every A/AAAA answer must be publicly routable. */
export async function assertHostResolvesPublic(deps: CoreDeps, host: string): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) {
    if (isBlockedAddress(bare)) throw new FetchRefused('address_blocked');
    return;
  }
  let addrs: string[] = [];
  try {
    addrs = await deps.resolveDns(bare);
  } catch {
    throw new FetchRefused('dns_failed', 'transient');
  }
  if (!addrs.length) throw new FetchRefused('dns_no_records');
  if (addrs.some(isBlockedAddress)) throw new FetchRefused('address_blocked');
}

/**
 * Guarded HTTP GET: static policy + DNS check on the first URL and on every
 * redirect hop (<= 5), manual redirects, timeout, streaming byte cap and an
 * allow-list of textual content types. The connection itself re-resolves
 * DNS (no IP pinning is possible from fetch), which is documented as a
 * residual TOCTOU risk — the worker behind Crawl4AI has the same property.
 */
export async function guardedFetch(deps: CoreDeps, startUrl: string, policy: Record<string, any>): Promise<FetchedPage> {
  const maxBytes = Math.max(64 * 1024, Number(policy.max_bytes) || 5 * 1024 * 1024);
  const timeoutMs = Math.min(60_000, Math.max(3_000, Number(policy.timeout_ms) || 20_000));
  let url = startUrl;
  for (let hop = 0; hop <= 5; hop++) {
    const check = urlStaticCheck(url, policy);
    if (!check.ok || !check.canonical || !check.host) throw new FetchRefused(`policy:${check.code}`);
    await assertHostResolvesPublic(deps, check.host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await deps.fetch(check.canonical, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'CIDPortal-SourceFetch/1 (+evidence snapshot)', accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1' },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new FetchRefused(ctrl.signal.aborted ? 'timeout' : 'network_error', 'transient');
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer);
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      const loc = res.headers.get('location');
      if (!loc) throw new FetchRefused('redirect_without_location');
      if (hop === 5) throw new FetchRefused('too_many_redirects');
      url = new URL(loc, check.canonical).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new FetchRefused(`http_${res.status}`, classifyHttpError(res.status));
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const baseType = contentType.split(';')[0].trim();
    if (!TEXT_TYPES.includes(baseType)) {
      clearTimeout(timer);
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new FetchRefused(`unsupported_content_type`);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      clearTimeout(timer);
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new FetchRefused('too_large');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      const reader = res.body?.getReader();
      if (!reader) throw new FetchRefused('empty_body');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new FetchRefused('too_large');
          }
          chunks.push(value);
        }
      }
    } catch (e) {
      if (e instanceof FetchRefused) throw e;
      throw new FetchRefused(ctrl.signal.aborted ? 'timeout' : 'network_error', 'transient');
    } finally {
      clearTimeout(timer);
    }
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return { http_status: res.status, content_type: baseType, final_url: check.canonical, bytes };
  }
  throw new FetchRefused('too_many_redirects');
}

export interface SourceIngest {
  http_status: number;
  content_type: string;
  title: string | null;
  author: string | null;
  published_at: string | null;
  markdown: string;
  text: string;
  content_hash: string;
  byte_size: number;
  snapshot_path: string;
  canonical_url: string;
  service: string;
  service_version: string;
}

/** Turn a fetched page into the external_source_ingest payload (snapshot upload included). */
export async function ingestFromPage(deps: CoreDeps, sourceId: string, page: FetchedPage, service: string, serviceVersion: string, pre?: Partial<SourceIngest>): Promise<SourceIngest> {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes);
  let title: string | null = pre?.title ?? null;
  let author: string | null = pre?.author ?? null;
  let published: string | null = pre?.published_at ?? null;
  let text = pre?.text ?? '';
  let markdown = pre?.markdown ?? '';
  let ext = 'txt';
  if (page.content_type === 'text/html' || page.content_type === 'application/xhtml+xml') {
    const ex = extractHtml(raw);
    title = title ?? ex.title;
    author = author ?? ex.author;
    published = published ?? ex.published_at;
    if (!text) text = ex.text;
    if (!markdown) markdown = ex.markdown;
    ext = 'html';
  } else if (page.content_type === 'application/json') {
    text = text || raw;
    markdown = markdown || '```json\n' + raw.slice(0, 200_000) + '\n```';
    ext = 'json';
  } else {
    text = text || raw;
    markdown = markdown || raw;
  }
  const contentHash = await deps.sha256Hex(new TextEncoder().encode(text));
  const snapshotPath = `source/${sourceId}/${Date.now()}.${ext}`;
  await deps.storage.upload('external-source-snapshots', snapshotPath, page.bytes, page.content_type === 'text/html' ? 'text/html; charset=utf-8' : page.content_type);
  return {
    http_status: page.http_status,
    content_type: page.content_type,
    title: title ? title.slice(0, 500) : null,
    author: author ? author.slice(0, 200) : null,
    published_at: published,
    markdown: markdown.slice(0, 2_000_000),
    text: text.slice(0, 2_000_000),
    content_hash: contentHash,
    byte_size: page.bytes.byteLength,
    snapshot_path: snapshotPath,
    canonical_url: page.final_url,
    service,
    service_version: serviceVersion,
  };
}

/** Shared failure path: mark the source failed for permanent errors, retry transient ones. */
export async function sourceFetchFailure(ctx: JobContext, sourceId: string, e: unknown): Promise<never> {
  const { job, deps } = ctx;
  const refused = e instanceof FetchRefused ? e : null;
  const reason = (refused?.message ?? String((e as Error)?.message ?? e)).slice(0, 200);
  const transient = refused ? refused.kind === 'transient' : !(e instanceof JobError && !e.retryable);
  const lastAttempt = job.attempts >= job.max_attempts;
  if (!transient || lastAttempt) {
    try {
      await deps.supa.rpc('external_source_failed', { p_job: job.id, p_source: sourceId, p_error: reason });
    } catch {
      /* job failure still recorded */
    }
    throw new JobError(`fetch_failed: ${reason}`, false);
  }
  throw new JobError(`fetch_failed: ${reason}`, true);
}

export const sourceFetchBasic: KindHandler = async (ctx) => {
  const { job, deps, heartbeat } = ctx;
  const sourceId = uuidArg(job, 'source_id', 'external_source');
  const source = await selectOne(deps, 'external_sources', 'id,url,status,deleted_at', { id: sourceId });
  if (!source) throw new JobError('missing_row: external_source', false);
  if (source.deleted_at) return { skipped: 'deleted' };
  const policy = await getPolicy(deps);
  try {
    await deps.supa.from('external_sources').update({ status: 'fetching' }).eq('id', sourceId);
    await heartbeat({ pct: 10, step: 'fetch' });
    const page = await guardedFetch(deps, source.url, policy);
    await heartbeat({ pct: 60, step: 'extract' });
    const payload = await ingestFromPage(deps, sourceId, page, 'runner-basic', '1');
    await heartbeat({ pct: 90, step: 'ingest' });
    const result = await rpc(deps, 'external_source_ingest', { p_job: job.id, p_source: sourceId, p_result: payload });
    return { http_status: page.http_status, byte_size: page.bytes.byteLength, ingest: result };
  } catch (e) {
    return sourceFetchFailure(ctx, sourceId, e);
  }
};

// ---------------------------------------------------------------------------
// document.extract (basic: PDF via injected pdfPages, text/plain passthrough)
// ---------------------------------------------------------------------------

export const documentExtractBasic: KindHandler = async ({ job, deps, heartbeat }) => {
  const mediaId = uuidArg(job, 'media_id', 'media');
  const media = await selectOne(deps, 'media', 'id,case_id,storage_path,mime,byte_size,deleted_at', { id: mediaId });
  if (!media) throw new JobError('missing_row: media', false);
  if (media.deleted_at) return { skipped: 'deleted' };
  if (!media.storage_path) throw new JobError('bad_state: media has no storage_path', false);
  if (!mediaPathOk(media)) throw new JobError('bad_state: storage path outside the media folder', false);
  const mime = String(media.mime ?? '').toLowerCase();
  const isPdf = mime === 'application/pdf';
  const isText = mime === 'text/plain' || mime === 'text/markdown';
  if (!isPdf && !isText) {
    // docx / images / OCR need the worker (Docling). Leave the job to it: a
    // retryable failure re-queues with backoff (see notes2/runner.md).
    throw new JobError('needs_worker', true);
  }
  if (isPdf && sizeOrZero(media.byte_size) > MAX_RUNNER_PDF_BYTES) throw new JobError('needs_worker', true);
  await heartbeat({ pct: 10, step: 'download' });
  const bytes = await deps.storage.download('case-evidence', media.storage_path);
  await heartbeat({ pct: 40, step: 'extract' });
  let pages: Array<{ page_no: number; text: string }>;
  try {
    if (isPdf) {
      const texts = await deps.pdfPages(bytes);
      pages = texts.map((t, i) => ({ page_no: i + 1, text: (t ?? '').replace(/\u0000/g, '').trim() }));
    } else {
      pages = [{ page_no: 1, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\u0000/g, '') }];
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    try {
      await deps.supa.rpc('document_extract_failed', { p_job: job.id, p_media: mediaId, p_error: msg });
    } catch {
      /* ignore */
    }
    throw new JobError(`extract_failed: ${msg}`, false);
  }
  await heartbeat({ pct: 85, step: 'record' });
  await rpc(deps, 'document_extract_result', {
    p_job: job.id,
    p_media: mediaId,
    p_service: isPdf ? 'unpdf' : 'passthrough',
    p_service_version: '1',
    p_pages: pages,
    p_structure: null,
    p_tables: null,
  });
  return { page_count: pages.length, chars: pages.reduce((n, p) => n + p.text.length, 0) };
};

// ---------------------------------------------------------------------------
// search.sync (Meilisearch index "cid")
// ---------------------------------------------------------------------------

export interface MeiliDoc {
  id: string;
  kind: string;
  ref_id: string;
  case_id: string | null;
  title: string;
  text: string;
  page_no: number | null;
}

/** Meilisearch ids allow only [A-Za-z0-9_-]; colons are not permitted, hence underscores. */
export function meiliDocId(kind: string, ref: string, page: number | null): string {
  return `${kind}_${ref}_${page ?? 0}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

async function meili(deps: CoreDeps, path: string, init: RequestInit): Promise<Response> {
  const base = (deps.env('MEILI_URL') ?? '').replace(/\/$/, '');
  const key = deps.env('MEILI_MASTER_KEY') ?? '';
  const res = await deps.fetch(base + path, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  if (!res.ok && res.status !== 404) throw new JobError(`meilisearch ${res.status}`, true);
  return res;
}

export async function ensureMeiliIndex(deps: CoreDeps): Promise<void> {
  await meili(deps, '/indexes', { method: 'POST', body: JSON.stringify({ uid: 'cid', primaryKey: 'id' }) }).catch(() => undefined);
  await meili(deps, '/indexes/cid/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      searchableAttributes: ['title', 'text'],
      filterableAttributes: ['kind', 'case_id', 'ref_id'],
      displayedAttributes: ['id', 'kind', 'ref_id', 'case_id', 'title', 'page_no'],
    }),
  });
}

async function buildIndexDoc(deps: CoreDeps, row: Record<string, any>): Promise<MeiliDoc | null> {
  if (row.kind === 'document_page') {
    const media = await selectOne(deps, 'media', 'id,case_id,title,evidence_number,restricted,person_id,gang_id,place_id,vehicle_id,deleted_at', { id: row.ref_id });
    if (!media) return null;
    const caseRow = media.case_id ? await selectOne(deps, 'cases', 'id,siu_classification,deleted_at', { id: media.case_id }) : null;
    if (caseRow?.deleted_at || !mediaIndexable(media, caseRow)) return null;
    const page = await selectOne(deps, 'document_pages', 'media_id,page_no,text', { media_id: row.ref_id, page_no: row.page_no ?? 1 });
    if (!page || !page.text) return null;
    return {
      id: meiliDocId('document_page', row.ref_id, row.page_no ?? 1),
      kind: 'document_page',
      ref_id: row.ref_id,
      case_id: media.case_id ?? null,
      title: [media.evidence_number, media.title].filter(Boolean).join(' '),
      text: String(page.text).slice(0, 100_000),
      page_no: row.page_no ?? 1,
    };
  }
  if (row.kind === 'external_source') {
    const src = await selectOne(deps, 'external_sources', 'id,case_id,title,source_number,current_version_id,deleted_at,status', { id: row.ref_id });
    if (!src || src.deleted_at || !src.current_version_id) return null;
    if (src.case_id) {
      const caseRow = await selectOne(deps, 'cases', 'id,siu_classification,deleted_at', { id: src.case_id });
      if (!caseRow || caseRow.deleted_at || caseRow.siu_classification) return null;
    }
    const ver = await selectOne(deps, 'external_source_versions', 'id,title,text', { id: src.current_version_id });
    if (!ver) return null;
    return {
      id: meiliDocId('external_source', src.id, null),
      kind: 'external_source',
      ref_id: src.id,
      case_id: src.case_id ?? null,
      title: [src.source_number, ver.title ?? src.title].filter(Boolean).join(' '),
      text: String(ver.text ?? '').slice(0, 100_000),
      page_no: null,
    };
  }
  if (row.kind === 'report') {
    const rep = await selectOne(deps, 'reports', 'id,case_id,fields,kind,deleted_at', { id: row.ref_id });
    if (!rep || rep.deleted_at) return null;
    const caseRow = await selectOne(deps, 'cases', 'id,siu_classification,deleted_at,case_number', { id: rep.case_id });
    if (!caseRow || caseRow.deleted_at || caseRow.siu_classification) return null;
    const fields = (rep.fields ?? {}) as Record<string, unknown>;
    const narrative = Object.entries(fields)
      .filter(([, v]) => typeof v === 'string' && (v as string).trim())
      .map(([, v]) => v as string)
      .join('\n\n');
    if (!narrative) return null;
    return {
      id: meiliDocId('report', rep.id, null),
      kind: 'report',
      ref_id: rep.id,
      case_id: rep.case_id,
      title: `${caseRow.case_number ?? ''} ${rep.kind ?? 'report'}`.trim(),
      text: narrative.slice(0, 100_000),
      page_no: null,
    };
  }
  return null;
}

export const searchSync: KindHandler = async ({ deps, heartbeat, deadline }) => {
  const configured = !!(deps.env('MEILI_URL') && deps.env('MEILI_MASTER_KEY'));
  let processed = 0;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;
  if (configured) await ensureMeiliIndex(deps);
  for (let batch = 0; batch < 50; batch++) {
    if (Date.now() > deadline) break;
    const rows = await selectMany(deps, 'search_index_queue', 'id,kind,ref_id,page_no,op,attempts', (q) => q.is('indexed_at', null).order('id', { ascending: true }).limit(100));
    if (!rows.length) break;
    const now = new Date().toISOString();
    if (!configured) {
      const ids = rows.map((r) => r.id);
      await deps.supa.from('search_index_queue').update({ indexed_at: now, error: 'meili_unconfigured' }).in('id', ids);
      processed += rows.length;
      continue;
    }
    const docs: MeiliDoc[] = [];
    const delIds: string[] = [];
    const done: number[] = [];
    const failed: Array<{ id: number; error: string; attempts: number }> = [];
    for (const r of rows) {
      try {
        if (r.op === 'delete') {
          delIds.push(meiliDocId(r.kind, r.ref_id, r.kind === 'document_page' ? r.page_no ?? 1 : null));
        } else {
          const doc = await buildIndexDoc(deps, r);
          if (doc) docs.push(doc);
          else {
            // Not indexable (restricted / SIU / deleted / empty): make sure no stale copy remains.
            delIds.push(meiliDocId(r.kind, r.ref_id, r.kind === 'document_page' ? r.page_no ?? 1 : null));
            skipped++;
          }
        }
        done.push(r.id);
      } catch (e) {
        failed.push({ id: r.id, error: String((e as Error)?.message ?? e).slice(0, 200), attempts: (r.attempts ?? 0) + 1 });
      }
    }
    if (docs.length) await meili(deps, '/indexes/cid/documents?primaryKey=id', { method: 'POST', body: JSON.stringify(docs) });
    if (delIds.length) await meili(deps, '/indexes/cid/documents/delete-batch', { method: 'POST', body: JSON.stringify(delIds) });
    if (done.length) await deps.supa.from('search_index_queue').update({ indexed_at: now, error: null }).in('id', done);
    for (const f of failed) {
      await deps.supa.from('search_index_queue').update({ attempts: f.attempts, error: f.error, ...(f.attempts >= 5 ? { indexed_at: now } : {}) }).eq('id', f.id);
    }
    processed += rows.length;
    upserted += docs.length;
    deleted += delIds.length;
    await heartbeat({ pct: Math.min(95, batch * 5), step: 'index', message: `${processed} rows` });
  }
  return configured ? { processed, upserted, deleted, skipped } : { skipped: 'meili_unconfigured', processed };
};

// ---------------------------------------------------------------------------
// embeddings.generate (OpenAI-compatible /v1/embeddings)
// ---------------------------------------------------------------------------

export async function embedTexts(deps: CoreDeps, inputs: string[]): Promise<{ vectors: number[][]; model: string }> {
  const key = deps.env('EMBEDDINGS_API_KEY');
  if (!key) throw new JobError('embeddings_unconfigured', false);
  const base = (deps.env('EMBEDDINGS_BASE_URL') || 'https://api.openai.com').replace(/\/$/, '');
  const model = deps.env('EMBEDDINGS_MODEL') || 'text-embedding-3-small';
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += 32) {
    const slice = inputs.slice(i, i + 32);
    const res = await deps.fetch(`${base}/v1/embeddings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: slice, encoding_format: 'float' }),
    });
    if (!res.ok) throw new JobError(`embeddings_http_${res.status}`, res.status === 429 || res.status >= 500);
    const json = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> };
    const rows = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
    if (rows.length !== slice.length) throw new JobError('embeddings_bad_response', true);
    for (const r of rows) vectors.push(r.embedding);
  }
  return { vectors, model };
}

export const embeddingsGenerate: KindHandler = async ({ job, deps, heartbeat }) => {
  if (!deps.env('EMBEDDINGS_API_KEY')) return { skipped: 'embeddings_unconfigured' };
  const sourceKind = String(arg<string>(job, 'source_kind') ?? (job.subject_kind === 'external_source' ? 'external_source' : job.subject_kind === 'report' ? 'report' : 'document'));
  const units: Array<{ page_no: number | null; text: string }> = [];
  let sourceId: string;
  let caseId: string | null = null;
  let mediaId: string | null = null;
  if (sourceKind === 'document' || sourceKind === 'evidence') {
    sourceId = uuidArg(job, 'media_id', 'media');
    mediaId = sourceId;
    const media = await selectOne(deps, 'media', 'id,case_id,restricted,person_id,gang_id,place_id,vehicle_id,deleted_at', { id: sourceId });
    if (!media) throw new JobError('missing_row: media', false);
    const caseRow = media.case_id ? await selectOne(deps, 'cases', 'id,siu_classification,deleted_at', { id: media.case_id }) : null;
    if (!mediaIndexable(media, caseRow)) {
      await rpc(deps, 'semantic_chunks_replace', { p_source_kind: 'document', p_source_id: sourceId, p_chunks: [] });
      return { skipped: 'not_indexable' };
    }
    caseId = media.case_id ?? null;
    const pages = await selectMany(deps, 'document_pages', 'page_no,text', (q) => q.eq('media_id', sourceId).order('page_no', { ascending: true }));
    for (const p of pages) if (p.text) units.push({ page_no: p.page_no, text: String(p.text) });
  } else if (sourceKind === 'external_source') {
    sourceId = uuidArg(job, 'source_id', 'external_source');
    const src = await selectOne(deps, 'external_sources', 'id,case_id,current_version_id,deleted_at', { id: sourceId });
    if (!src || src.deleted_at || !src.current_version_id) return { skipped: 'no_version' };
    if (src.case_id) {
      const caseRow = await selectOne(deps, 'cases', 'id,siu_classification', { id: src.case_id });
      if (caseRow?.siu_classification) return { skipped: 'not_indexable' };
    }
    caseId = src.case_id ?? null;
    const ver = await selectOne(deps, 'external_source_versions', 'text', { id: src.current_version_id });
    if (ver?.text) units.push({ page_no: null, text: String(ver.text) });
  } else if (sourceKind === 'report') {
    sourceId = uuidArg(job, 'report_id', 'report');
    const rep = await selectOne(deps, 'reports', 'id,case_id,fields,deleted_at', { id: sourceId });
    if (!rep || rep.deleted_at) return { skipped: 'missing' };
    const caseRow = await selectOne(deps, 'cases', 'id,siu_classification', { id: rep.case_id });
    if (caseRow?.siu_classification) return { skipped: 'not_indexable' };
    caseId = rep.case_id;
    const narrative = Object.values((rep.fields ?? {}) as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && !!v.trim()).join('\n\n');
    if (narrative) units.push({ page_no: null, text: narrative });
  } else {
    throw new JobError(`bad_args: source_kind ${sourceKind}`, false);
  }
  const chunks: Array<{ page_no: number | null; chunk_no: number; content: string }> = [];
  for (const u of units) {
    chunkText(u.text).forEach((content, chunk_no) => chunks.push({ page_no: u.page_no, chunk_no, content }));
  }
  if (!chunks.length) {
    await rpc(deps, 'semantic_chunks_replace', { p_source_kind: sourceKind, p_source_id: sourceId, p_chunks: [] });
    return { chunks: 0 };
  }
  if (chunks.length > 2000) chunks.length = 2000;
  await heartbeat({ pct: 20, step: 'embed', message: `${chunks.length} chunks` });
  const { vectors, model } = await embedTexts(deps, chunks.map((c) => c.content));
  await heartbeat({ pct: 80, step: 'store' });
  const payload = [];
  for (const [i, c] of chunks.entries()) {
    payload.push({
      page_no: c.page_no,
      chunk_no: c.chunk_no,
      content: c.content,
      content_hash: await deps.sha256Hex(new TextEncoder().encode(c.content)),
      embedding: vectors[i],
      model,
      case_id: caseId,
      media_id: mediaId,
    });
  }
  const count = await rpc<number>(deps, 'semantic_chunks_replace', { p_source_kind: sourceKind, p_source_id: sourceId, p_chunks: payload });
  return { chunks: chunks.length, stored: count, model };
};

// ---------------------------------------------------------------------------
// health.probe
// ---------------------------------------------------------------------------

const HEALTH_PATHS: Record<string, string> = {
  STIRLING_URL: '/api/v1/info/status',
  CRAWL4AI_URL: '/health',
  DOCLING_URL: '/health',
  MEILI_URL: '/health',
};
const HEALTH_SERVICE: Record<string, string> = { STIRLING_URL: 'stirling', CRAWL4AI_URL: 'crawl4ai', DOCLING_URL: 'docling', MEILI_URL: 'meilisearch' };

async function probeUrl(deps: CoreDeps, url: string, extraHeaders: Record<string, string> = {}): Promise<{ status: 'healthy' | 'degraded' | 'offline'; latency_ms: number; http?: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  const started = Date.now();
  try {
    const res = await deps.fetch(url, { signal: ctrl.signal, headers: extraHeaders });
    const latency = Date.now() - started;
    if (!res.ok) return { status: 'offline', latency_ms: latency, http: res.status };
    return { status: latency > 2000 ? 'degraded' : 'healthy', latency_ms: latency, http: res.status };
  } catch {
    return { status: 'offline', latency_ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

export const healthProbe: KindHandler = async ({ deps }) => {
  const events: Array<{ service: string; status: string; latency_ms: number | null; detail: Record<string, unknown> }> = [];
  events.push({ service: deps.serviceName === 'runner' ? 'runner' : 'worker', status: 'healthy', latency_ms: 0, detail: { version: deps.serviceVersion } });
  const started = Date.now();
  const { error } = await deps.supa.from('feature_flags').select('key').limit(1);
  const latency = Date.now() - started;
  events.push({ service: 'supabase', status: error ? 'offline' : latency > 2000 ? 'degraded' : 'healthy', latency_ms: latency, detail: error ? { error: 'rest_query_failed' } : {} });
  for (const [envName, path] of Object.entries(HEALTH_PATHS)) {
    const base = deps.env(envName);
    if (!base) continue;
    const headers: Record<string, string> = {};
    if (envName === 'MEILI_URL' && deps.env('MEILI_MASTER_KEY')) headers.authorization = `Bearer ${deps.env('MEILI_MASTER_KEY')}`;
    const r = await probeUrl(deps, base.replace(/\/$/, '') + path, headers);
    events.push({ service: HEALTH_SERVICE[envName], status: r.status, latency_ms: r.latency_ms, detail: r.http ? { http: r.http } : {} });
  }
  if (deps.env('EMBEDDINGS_API_KEY')) events.push({ service: 'embeddings', status: 'healthy', latency_ms: null, detail: { configured: true, probed: false } });
  const { error: insErr } = await deps.supa.from('service_health_events').insert(events);
  if (insErr) throw new JobError(`service_health_events: ${insErr.message}`, true);
  return { services: events.map((e) => `${e.service}:${e.status}`) };
};

// ---------------------------------------------------------------------------
// registry + driver
// ---------------------------------------------------------------------------

export const CORE_HANDLERS: Record<string, KindHandler> = {
  'evidence.verify': evidenceVerify,
  'evidence.derive': evidenceDerive,
  'packet.render': packetRender,
  'bundle.build': bundleBuild,
  'source.fetch': sourceFetchBasic,
  'document.extract': documentExtractBasic,
  'search.sync': searchSync,
  'embeddings.generate': embeddingsGenerate,
  'health.probe': healthProbe,
};

export interface RunOutcome {
  id: string;
  kind: string;
  status: 'succeeded' | 'failed';
  retryable?: boolean;
  ms: number;
}

/** Run one claimed job: heartbeat wrapper, complete/fail bookkeeping, scrubbed logging. */
export async function runJob(job: JobRow, deps: CoreDeps, handlers: Record<string, KindHandler>, budgetMs = 50_000): Promise<RunOutcome> {
  const started = Date.now();
  const handler = handlers[job.kind];
  const heartbeat = async (progress: JobProgress) => {
    try {
      await deps.supa.rpc('job_heartbeat', { p_id: job.id, p_progress: progress });
    } catch {
      /* heartbeats are best effort */
    }
  };
  const ticker = setInterval(() => void heartbeat({ step: 'running' }), 30_000);
  try {
    if (!handler) throw new JobError(`unsupported_kind: ${job.kind}`, true);
    await heartbeat({ pct: 0, step: 'start' });
    const result = await handler({ job, deps, heartbeat, deadline: started + budgetMs });
    const { error } = await deps.supa.rpc('job_complete', { p_id: job.id, p_result: (result ?? {}) as Record<string, unknown> });
    if (error) deps.log('job_complete failed', { id: job.id, kind: job.kind });
    deps.log('job succeeded', { id: job.id, kind: job.kind, ms: Date.now() - started });
    return { id: job.id, kind: job.kind, status: 'succeeded', ms: Date.now() - started };
  } catch (e) {
    const retryable = e instanceof JobError ? e.retryable : true;
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    try {
      await deps.supa.rpc('job_fail', { p_id: job.id, p_error: message, p_retryable: retryable });
    } catch {
      /* nothing else to do */
    }
    deps.log('job failed', { id: job.id, kind: job.kind, retryable, ms: Date.now() - started });
    return { id: job.id, kind: job.kind, status: 'failed', retryable, ms: Date.now() - started };
  } finally {
    clearInterval(ticker);
  }
}
