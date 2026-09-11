// stirling — Stirling-PDF REST provider (STIRLING_URL, optional STIRLING_API_KEY
// sent as `X-API-KEY` when security is enabled on the instance).
//
// Endpoint names as of Stirling-PDF 1.x (all multipart/form-data POST, file
// field `fileInput`; multi-file tools take repeated `fileInput` parts).
// Responses are the produced file (PDF / image / zip) unless noted.
//
//   merge            POST /api/v1/general/merge-pdfs           fileInput[], sortType=orderProvided
//   split            POST /api/v1/general/split-pages          pageNumbers="1,3,5-7"           → zip of PDFs
//   extract_pages    POST /api/v1/general/rearrange-pages      pageNumbers="1,3-5" customMode=  (select + order)
//   rearrange        POST /api/v1/general/rearrange-pages      pageNumbers=order, customMode=
//   remove_pages     POST /api/v1/general/remove-pages         pageNumbers
//   rotate           POST /api/v1/general/rotate-pdf           angle=90|180|270
//   crop             POST /api/v1/general/crop                 x,y,width,height (points)
//   compress         POST /api/v1/misc/compress-pdf            optimizeLevel=1..9, grayscale
//   ocr              POST /api/v1/misc/ocr-pdf                 languages[]=eng, ocrType=skip-text|force-ocr, ocrRenderType=hocr|sandwich
//   image_to_pdf     POST /api/v1/convert/img/pdf              fileInput[], fitOption=fillPage|fitDocumentToImage|maintainAspectRatio, colorType=color, autoRotate
//   pdf_to_images    POST /api/v1/convert/pdf/img              imageFormat=png|jpg|webp, singleOrMultiple=multiple, colorType=color, dpi=150 → zip (multiple) or image (single)
//   watermark        POST /api/v1/security/add-watermark       watermarkType=text, watermarkText, fontSize, rotation, opacity(0-1), widthSpacer, heightSpacer, convertPDFToImage
//   page_numbers     POST /api/v1/misc/add-page-numbers        customMargin=medium, position=1..9 (numpad layout; 9=bottom right), startingNumber, pagesToNumber, customText="Page {n} of {total}"
//   flatten          POST /api/v1/misc/flatten                 flattenOnlyForms=false
//   metadata_inspect POST /api/v1/security/get-info-on-pdf     → JSON
//   metadata_remove  POST /api/v1/misc/update-metadata         deleteAll=true
//   sanitize         POST /api/v1/security/sanitize-pdf        removeJavaScript, removeEmbeddedFiles, removeXMPMetadata, removeMetadata, removeLinks, removeFonts
//   repair           POST /api/v1/misc/repair
//   redact (auto)    POST /api/v1/security/auto-redact         listOfText (newline-separated), useRegex, wholeWordSearch, customPadding, convertPDFToImage=true
//   compare          — Stirling-PDF 1.x has no server-side compare endpoint (compare is a browser feature);
//                      `compare()` below diffs extracted page text locally with unpdf and returns JSON.
//   health           GET  /api/v1/info/status                  → {"status":"UP"}
import { env } from '../deps.ts';
import { pdfPages } from './pdf.ts';

export interface StirlingFile {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

export interface StirlingOutput {
  bytes: Uint8Array;
  contentType: string;
  filename: string | null;
}

export class StirlingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StirlingError';
    this.status = status;
  }
}

export function stirlingConfigured(): boolean {
  return !!env('STIRLING_URL');
}

function base(): string {
  const b = env('STIRLING_URL');
  if (!b) throw new StirlingError('needs_stirling', 0);
  return b.replace(/\/$/, '');
}

async function post(endpoint: string, files: StirlingFile[], fields: Record<string, string | number | boolean | undefined>, timeoutMs = 180_000): Promise<StirlingOutput> {
  const form = new FormData();
  for (const f of files) form.append('fileInput', new Blob([f.bytes as BlobPart], { type: f.mime ?? 'application/pdf' }), f.name);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    const key = env('STIRLING_API_KEY');
    if (key) headers['X-API-KEY'] = key;
    const res = await fetch(base() + endpoint, { method: 'POST', body: form, headers, signal: ctrl.signal });
    if (!res.ok) throw new StirlingError(`stirling_http_${res.status}`, res.status);
    const cd = res.headers.get('content-disposition') ?? '';
    const fn = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0], filename: fn };
  } catch (e) {
    if (e instanceof StirlingError) throw e;
    throw new StirlingError(ctrl.signal.aborted ? 'stirling_timeout' : 'stirling_unreachable', 0);
  } finally {
    clearTimeout(t);
  }
}

async function postJson(endpoint: string, files: StirlingFile[], fields: Record<string, string | number | boolean | undefined>): Promise<Record<string, unknown>> {
  const out = await post(endpoint, files, fields);
  try {
    return JSON.parse(new TextDecoder().decode(out.bytes)) as Record<string, unknown>;
  } catch {
    throw new StirlingError('stirling_bad_json', 502);
  }
}

export const stirling = {
  merge: (files: StirlingFile[]) => post('/api/v1/general/merge-pdfs', files, { sortType: 'orderProvided', removeCertSign: false }),
  split: (file: StirlingFile, pageNumbers: string) => post('/api/v1/general/split-pages', [file], { pageNumbers }),
  extractPages: (file: StirlingFile, pageNumbers: string) => post('/api/v1/general/rearrange-pages', [file], { pageNumbers, customMode: '' }),
  rearrange: (file: StirlingFile, order: string) => post('/api/v1/general/rearrange-pages', [file], { pageNumbers: order, customMode: '' }),
  removePages: (file: StirlingFile, pageNumbers: string) => post('/api/v1/general/remove-pages', [file], { pageNumbers }),
  rotate: (file: StirlingFile, angle: number) => post('/api/v1/general/rotate-pdf', [file], { angle: ((Math.round(angle / 90) * 90) % 360 + 360) % 360 }),
  crop: (file: StirlingFile, box: { x: number; y: number; width: number; height: number }) => post('/api/v1/general/crop', [file], box),
  compress: (file: StirlingFile, level = 5, grayscale = false) => post('/api/v1/misc/compress-pdf', [file], { optimizeLevel: Math.min(9, Math.max(1, level)), grayscale }),
  ocr: (file: StirlingFile, languages = ['eng'], force = false) =>
    post('/api/v1/misc/ocr-pdf', [file], { languages: languages.join(','), ocrType: force ? 'force-ocr' : 'skip-text', ocrRenderType: 'sandwich', sidecar: false, deskew: true, clean: true }, 600_000),
  imageToPdf: (images: StirlingFile[]) => post('/api/v1/convert/img/pdf', images, { fitOption: 'maintainAspectRatio', colorType: 'color', autoRotate: true }),
  pdfToImages: (file: StirlingFile, format: 'png' | 'jpg' | 'webp' = 'png', dpi = 150) =>
    post('/api/v1/convert/pdf/img', [file], { imageFormat: format, singleOrMultiple: 'multiple', colorType: 'color', dpi, pageNumbers: 'all' }),
  watermark: (file: StirlingFile, text: string, opacity = 0.15) =>
    post('/api/v1/security/add-watermark', [file], { watermarkType: 'text', watermarkText: text, fontSize: 40, rotation: 45, opacity, widthSpacer: 100, heightSpacer: 100, alphabet: 'roman', convertPDFToImage: false }),
  pageNumbers: (file: StirlingFile, opts: { start?: number; position?: number; text?: string } = {}) =>
    post('/api/v1/misc/add-page-numbers', [file], { customMargin: 'medium', position: opts.position ?? 9, startingNumber: opts.start ?? 1, pagesToNumber: 'all', customText: opts.text ?? 'Page {n} of {total}' }),
  flatten: (file: StirlingFile, onlyForms = false) => post('/api/v1/misc/flatten', [file], { flattenOnlyForms: onlyForms }),
  info: (file: StirlingFile) => postJson('/api/v1/security/get-info-on-pdf', [file], {}),
  metadataRemove: (file: StirlingFile) => post('/api/v1/misc/update-metadata', [file], { deleteAll: true }),
  sanitize: (file: StirlingFile) =>
    post('/api/v1/security/sanitize-pdf', [file], { removeJavaScript: true, removeEmbeddedFiles: true, removeXMPMetadata: true, removeMetadata: true, removeLinks: false, removeFonts: false }),
  repair: (file: StirlingFile) => post('/api/v1/misc/repair', [file], {}),
  autoRedact: (file: StirlingFile, terms: string[], useRegex = false) =>
    post('/api/v1/security/auto-redact', [file], { listOfText: terms.join('\n'), useRegex, wholeWordSearch: false, customPadding: 0.1, convertPDFToImage: true, redactColor: '#000000' }),
  /** Local text diff: Stirling 1.x exposes no compare endpoint. */
  async compare(a: Uint8Array, b: Uint8Array): Promise<Record<string, unknown>> {
    const [pa, pb] = await Promise.all([pdfPages(a), pdfPages(b)]);
    const pages = Math.max(pa.length, pb.length);
    const diff: Array<{ page: number; changed: boolean; added: number; removed: number }> = [];
    for (let i = 0; i < pages; i++) {
      const la = new Set((pa[i] ?? '').split('\n').map((s) => s.trim()).filter(Boolean));
      const lb = new Set((pb[i] ?? '').split('\n').map((s) => s.trim()).filter(Boolean));
      let added = 0;
      let removed = 0;
      for (const l of lb) if (!la.has(l)) added++;
      for (const l of la) if (!lb.has(l)) removed++;
      diff.push({ page: i + 1, changed: added + removed > 0, added, removed });
    }
    return { pages_a: pa.length, pages_b: pb.length, changed_pages: diff.filter((d) => d.changed).length, pages: diff, method: 'local-text-diff' };
  },
  async health(): Promise<{ ok: boolean; latency_ms: number }> {
    const t = Date.now();
    try {
      const res = await fetch(base() + '/api/v1/info/status', { signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, latency_ms: Date.now() - t };
    } catch {
      return { ok: false, latency_ms: Date.now() - t };
    }
  },
};
