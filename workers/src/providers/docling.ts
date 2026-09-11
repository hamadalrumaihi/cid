// docling — docling-serve provider (DOCLING_URL).
//
// POST {DOCLING_URL}/v1alpha/convert/file  multipart: files=<document>, to_formats=json,md,
//      do_ocr=true, image_export_mode=placeholder, table_mode=accurate
//   → { status, document: { md_content, json_content (DoclingDocument), text_content }, processing_time }
// Newer builds serve the same contract at /v1/convert/file — we try the
// configured path (DOCLING_CONVERT_PATH, default /v1alpha/convert/file) and
// fall back to /v1/convert/file on 404.
//
// Mapping to the document_extract_result payload:
//   pages     — DoclingDocument.texts grouped by prov[0].page_no (joined with newlines)
//   structure — {outline:[{level,title,page}], page_count, service:'docling'} from section_header items
//   tables    — [{page, rows:[[cell,...]]}] from DoclingDocument.tables[].data.grid
import { env } from '../deps.ts';

export interface DoclingPage {
  page_no: number;
  text: string;
}

export interface DoclingResult {
  pages: DoclingPage[];
  structure: Record<string, unknown>;
  tables: Array<{ page: number | null; rows: string[][] }>;
  markdown: string | null;
  version: string;
}

export class DoclingError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'DoclingError';
    this.retryable = retryable;
  }
}

export function doclingConfigured(): boolean {
  return !!env('DOCLING_URL');
}

/** MIME types docling-serve accepts (beyond what unpdf covers). */
export const DOCLING_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/html',
  'text/markdown',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
]);

interface DoclingItem {
  label?: string;
  text?: string;
  level?: number;
  prov?: Array<{ page_no?: number }>;
}
interface DoclingTable {
  prov?: Array<{ page_no?: number }>;
  data?: { grid?: Array<Array<{ text?: string }>> };
}
interface DoclingDocument {
  texts?: DoclingItem[];
  tables?: DoclingTable[];
  pages?: Record<string, unknown>;
  version?: string;
}

async function post(path: string, bytes: Uint8Array, filename: string, mime: string, timeoutMs: number): Promise<Response> {
  const form = new FormData();
  form.append('files', new Blob([bytes as BlobPart], { type: mime }), filename);
  form.append('to_formats', 'json');
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  form.append('image_export_mode', 'placeholder');
  form.append('table_mode', 'accurate');
  const headers: Record<string, string> = {};
  const key = env('DOCLING_API_KEY');
  if (key) headers['X-Api-Key'] = key;
  return fetch((env('DOCLING_URL') ?? '').replace(/\/$/, '') + path, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(timeoutMs) });
}

export async function convert(bytes: Uint8Array, filename: string, mime: string): Promise<DoclingResult> {
  if (!doclingConfigured()) throw new DoclingError('docling_unconfigured', false);
  const timeoutMs = Number(env('DOCLING_TIMEOUT_MS') ?? 600_000);
  const primary = env('DOCLING_CONVERT_PATH') ?? '/v1alpha/convert/file';
  let res: Response;
  try {
    res = await post(primary, bytes, filename, mime, timeoutMs);
    if (res.status === 404 && primary !== '/v1/convert/file') res = await post('/v1/convert/file', bytes, filename, mime, timeoutMs);
  } catch (e) {
    throw new DoclingError((e as Error)?.name === 'TimeoutError' ? 'docling_timeout' : 'docling_unreachable', true);
  }
  if (res.status === 415 || res.status === 422) throw new DoclingError('unsupported_mime', false);
  if (!res.ok) throw new DoclingError(`docling_http_${res.status}`, res.status >= 500);
  const body = (await res.json()) as { status?: string; document?: { md_content?: string | null; json_content?: DoclingDocument | null; text_content?: string | null }; errors?: unknown[] };
  if (body.status && body.status !== 'success' && body.status !== 'partial_success') throw new DoclingError(`docling_${body.status}`, false);
  const doc = body.document?.json_content ?? null;
  const byPage = new Map<number, string[]>();
  const outline: Array<{ level: number; title: string; page: number | null }> = [];
  for (const item of doc?.texts ?? []) {
    const text = (item.text ?? '').replace(/\u0000/g, '').trim();
    if (!text) continue;
    const page = item.prov?.[0]?.page_no ?? 1;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(text);
    if (item.label === 'section_header' || item.label === 'title') outline.push({ level: item.level ?? 1, title: text.slice(0, 200), page });
  }
  let pages: DoclingPage[] = Array.from(byPage.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([page_no, parts]) => ({ page_no, text: parts.join('\n') }));
  if (!pages.length) {
    const fallback = (body.document?.text_content ?? body.document?.md_content ?? '').replace(/\u0000/g, '').trim();
    if (fallback) pages = [{ page_no: 1, text: fallback }];
  }
  const tables = (doc?.tables ?? []).map((t) => ({
    page: t.prov?.[0]?.page_no ?? null,
    rows: (t.data?.grid ?? []).map((row) => row.map((c) => (c.text ?? '').replace(/\u0000/g, '').trim())),
  }));
  const pageCount = doc?.pages ? Object.keys(doc.pages).length : pages.length;
  return {
    pages,
    structure: { outline: outline.slice(0, 500), page_count: pageCount, tables: tables.length },
    tables: tables.slice(0, 200),
    markdown: body.document?.md_content ?? null,
    version: String(doc?.version ?? 'docling-serve'),
  };
}

export async function health(): Promise<{ ok: boolean; latency_ms: number }> {
  const t = Date.now();
  try {
    const res = await fetch((env('DOCLING_URL') ?? '').replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, latency_ms: Date.now() - t };
  } catch {
    return { ok: false, latency_ms: Date.now() - t };
  }
}
