// pdf.tool — document tools requested through document_tool_request.
//
// args: { case_id, tool, inputs: { media_ids: uuid[], pages?, order?, angle?, text?, terms?, box?, level?, languages?, format? }, options? }
// Stirling-PDF when STIRLING_URL is set (providers/stirling.ts documents the
// endpoints). Without Stirling, pdf-lib covers merge / split / extract_pages
// / rearrange / rotate / page_numbers / watermark / metadata_remove /
// metadata_inspect / compare; every other tool fails non-retryably with
// `needs_stirling` so the requester sees a clear reason.
//
// Outputs are uploaded to case-evidence at case/<case_id>/<parent_media_id>/<tool>-<ts>.<ext>
// and registered as derivative media through evidence_derivative_register
// (derivative_type: ocr → 'ocr', redact → 'redacted', compress →
// 'compressed', everything else → 'converted'). Tools that only produce data
// (metadata_inspect, compare) return it in the job result.
import { JobError, mediaPathOk, rpc, type CoreDeps, type JobRow, type KindHandler } from '../jobCore.ts';
import * as pdf from '../providers/pdf.ts';
import { StirlingError, stirling, stirlingConfigured, type StirlingFile } from '../providers/stirling.ts';

export const kind = 'pdf.tool';
export const queue = 'pdf';

const PDFLIB_TOOLS = new Set(['merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'page_numbers', 'watermark', 'metadata_remove', 'metadata_inspect', 'compare']);
const ALL_TOOLS = new Set([
  ...PDFLIB_TOOLS,
  'crop',
  'compress',
  'ocr',
  'image_to_pdf',
  'pdf_to_images',
  'flatten',
  'sanitize',
  'repair',
  'redact',
]);
const MAX_INPUT_BYTES = 100 * 1024 * 1024;

interface MediaRow {
  id: string;
  case_id: string | null;
  storage_path: string | null;
  mime: string | null;
  byte_size: number | null;
  original_filename: string | null;
  title: string | null;
  restricted: boolean;
  deleted_at: string | null;
}

interface Output {
  bytes: Uint8Array;
  mime: string;
  ext: string;
  suffix?: string;
}

function derivativeType(tool: string): string {
  if (tool === 'ocr') return 'ocr';
  if (tool === 'redact') return 'redacted';
  if (tool === 'compress') return 'compressed';
  return 'converted';
}

function pageSpecString(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(',');
  return String(v ?? 'all');
}

async function loadInputs(deps: CoreDeps, job: JobRow, ids: string[]): Promise<Array<{ row: MediaRow; bytes: Uint8Array }>> {
  const { data, error } = await deps.supa.from('media').select('id,case_id,storage_path,mime,byte_size,original_filename,title,restricted,deleted_at').in('id', ids);
  if (error) throw new JobError(`media: ${error.message}`, true);
  const rows = (data ?? []) as MediaRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Array<{ row: MediaRow; bytes: Uint8Array }> = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.deleted_at || !row.storage_path) throw new JobError(`missing_row: media ${id}`, false);
    if (job.case_id && row.case_id !== job.case_id) throw new JobError('bad_args: media not in case', false);
    if (!mediaPathOk(row)) throw new JobError('bad_args: storage path outside the media folder', false);
    if (Number(row.byte_size ?? 0) > MAX_INPUT_BYTES) throw new JobError('too_large', false);
    out.push({ row, bytes: await deps.storage.download('case-evidence', row.storage_path) });
  }
  return out;
}

async function runPdfLib(tool: string, inputs: Array<{ row: MediaRow; bytes: Uint8Array }>, args: Record<string, unknown>): Promise<Output[] | Record<string, unknown>> {
  const first = inputs[0].bytes;
  switch (tool) {
    case 'merge':
      return [{ bytes: await pdf.merge(inputs.map((i) => i.bytes)), mime: 'application/pdf', ext: 'pdf' }];
    case 'split': {
      const parts = await pdf.split(first, Array.isArray(args.ranges) ? args.ranges.map(String) : undefined);
      return parts.map((bytes, i) => ({ bytes, mime: 'application/pdf', ext: 'pdf', suffix: `part${i + 1}` }));
    }
    case 'extract_pages':
      return [{ bytes: await pdf.extractPages(first, args.pages as string | number[] | undefined), mime: 'application/pdf', ext: 'pdf' }];
    case 'rearrange':
      return [{ bytes: await pdf.rearrange(first, (args.order as number[]) ?? []), mime: 'application/pdf', ext: 'pdf' }];
    case 'rotate':
      return [{ bytes: await pdf.rotate(first, Number(args.angle ?? 90), args.pages as string | number[] | undefined), mime: 'application/pdf', ext: 'pdf' }];
    case 'page_numbers':
      return [{ bytes: await pdf.pageNumbers(first, { start: Number(args.start ?? 1), position: args.position as 'bottom-right' | undefined, format: args.text as string | undefined }), mime: 'application/pdf', ext: 'pdf' }];
    case 'watermark':
      return [{ bytes: await pdf.watermark(first, String(args.text ?? 'LAW ENFORCEMENT SENSITIVE')), mime: 'application/pdf', ext: 'pdf' }];
    case 'metadata_remove':
      return [{ bytes: await pdf.metadataRemove(first), mime: 'application/pdf', ext: 'pdf' }];
    case 'metadata_inspect':
      return { info: await pdf.info(first), service: 'pdf-lib' };
    case 'compare': {
      if (inputs.length < 2) throw new JobError('bad_args: compare needs two media_ids', false);
      return { compare: await stirling.compare(inputs[0].bytes, inputs[1].bytes), service: 'unpdf' };
    }
    default:
      throw new JobError('needs_stirling', false);
  }
}

function sfile(i: { row: MediaRow; bytes: Uint8Array }): StirlingFile {
  return { name: i.row.original_filename ?? `${i.row.id}.pdf`, bytes: i.bytes, mime: i.row.mime ?? 'application/pdf' };
}

async function runStirling(tool: string, inputs: Array<{ row: MediaRow; bytes: Uint8Array }>, args: Record<string, unknown>): Promise<Output[] | Record<string, unknown>> {
  const f = sfile(inputs[0]);
  const asPdf = (o: { bytes: Uint8Array; contentType: string }): Output[] => {
    if (/zip/.test(o.contentType)) return [{ bytes: o.bytes, mime: 'application/zip', ext: 'zip' }];
    if (/^image\//.test(o.contentType)) return [{ bytes: o.bytes, mime: o.contentType, ext: o.contentType.split('/')[1].replace('jpeg', 'jpg') }];
    return [{ bytes: o.bytes, mime: 'application/pdf', ext: 'pdf' }];
  };
  switch (tool) {
    case 'merge':
      return asPdf(await stirling.merge(inputs.map(sfile)));
    case 'split':
      return asPdf(await stirling.split(f, pageSpecString(args.pages ?? args.ranges)));
    case 'extract_pages':
      return asPdf(await stirling.extractPages(f, pageSpecString(args.pages)));
    case 'rearrange':
      return asPdf(await stirling.rearrange(f, pageSpecString(args.order)));
    case 'rotate':
      return asPdf(await stirling.rotate(f, Number(args.angle ?? 90)));
    case 'crop': {
      const box = (args.box ?? {}) as { x?: number; y?: number; width?: number; height?: number };
      return asPdf(await stirling.crop(f, { x: Number(box.x ?? 0), y: Number(box.y ?? 0), width: Number(box.width ?? 612), height: Number(box.height ?? 792) }));
    }
    case 'compress':
      return asPdf(await stirling.compress(f, Number(args.level ?? 5), args.grayscale === true));
    case 'ocr':
      return asPdf(await stirling.ocr(f, Array.isArray(args.languages) ? args.languages.map(String) : ['eng'], args.force === true));
    case 'image_to_pdf':
      return asPdf(await stirling.imageToPdf(inputs.map(sfile)));
    case 'pdf_to_images':
      return asPdf(await stirling.pdfToImages(f, (args.format as 'png' | 'jpg' | 'webp') ?? 'png', Number(args.dpi ?? 150)));
    case 'watermark':
      return asPdf(await stirling.watermark(f, String(args.text ?? 'LAW ENFORCEMENT SENSITIVE'), Number(args.opacity ?? 0.15)));
    case 'page_numbers':
      return asPdf(await stirling.pageNumbers(f, { start: Number(args.start ?? 1), text: args.text as string | undefined }));
    case 'flatten':
      return asPdf(await stirling.flatten(f, args.only_forms === true));
    case 'metadata_inspect':
      return { info: await stirling.info(f), service: 'stirling' };
    case 'metadata_remove':
      return asPdf(await stirling.metadataRemove(f));
    case 'sanitize':
      return asPdf(await stirling.sanitize(f));
    case 'repair':
      return asPdf(await stirling.repair(f));
    case 'compare':
      if (inputs.length < 2) throw new JobError('bad_args: compare needs two media_ids', false);
      return { compare: await stirling.compare(inputs[0].bytes, inputs[1].bytes), service: 'unpdf' };
    case 'redact': {
      const terms = Array.isArray(args.terms) ? args.terms.map(String).filter(Boolean) : [];
      if (!terms.length) throw new JobError('bad_args: redact needs terms', false);
      return asPdf(await stirling.autoRedact(f, terms, args.use_regex === true));
    }
    default:
      throw new JobError(`bad_args: unknown tool ${tool}`, false);
  }
}

export const handler: KindHandler = async ({ job, deps, heartbeat }) => {
  const tool = String(job.args?.tool ?? '');
  if (!ALL_TOOLS.has(tool)) throw new JobError(`bad_args: tool ${tool}`, false);
  const inputsArg = (job.args?.inputs ?? {}) as Record<string, unknown>;
  const ids = (Array.isArray(inputsArg.media_ids) ? inputsArg.media_ids : []).map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (!ids.length) throw new JobError('bad_args: media_ids', false);
  const options = { ...((job.args?.options ?? {}) as Record<string, unknown>), ...inputsArg };
  await heartbeat({ pct: 5, step: 'download' });
  const inputs = await loadInputs(deps, job, ids);
  const useStirling = stirlingConfigured();
  if (!useStirling && !PDFLIB_TOOLS.has(tool)) throw new JobError('needs_stirling', false);
  await heartbeat({ pct: 30, step: useStirling ? 'stirling' : 'pdf-lib' });
  let produced: Output[] | Record<string, unknown>;
  try {
    produced = useStirling ? await runStirling(tool, inputs, options) : await runPdfLib(tool, inputs, options);
  } catch (e) {
    if (e instanceof StirlingError) {
      // Fall back to pdf-lib for the tools it can do when Stirling is down.
      if (PDFLIB_TOOLS.has(tool) && (e.status === 0 || e.status >= 500)) produced = await runPdfLib(tool, inputs, options);
      else throw new JobError(e.message, e.status === 0 || e.status >= 500);
    } else throw e;
  }
  if (!Array.isArray(produced)) return { tool, ...produced };
  const parent = inputs[0].row;
  if (!parent.case_id) throw new JobError('bad_state: media has no case', false);
  const service = useStirling ? 'stirling' : 'pdf-lib';
  const stamp = Date.now();
  const registered: Array<{ media_id: string; path: string; byte_size: number }> = [];
  for (const [i, out] of produced.entries()) {
    await heartbeat({ pct: 60 + Math.round((i / produced.length) * 30), step: 'register' });
    const name = `${tool}-${stamp}${out.suffix ? '-' + out.suffix : ''}.${out.ext}`;
    const path = `case/${parent.case_id}/${parent.id}/${name}`;
    await deps.storage.upload('case-evidence', path, out.bytes, out.mime);
    const sha256 = await deps.sha256Hex(out.bytes);
    const mediaId = await rpc<string>(deps, 'evidence_derivative_register', {
      p_job: job.id,
      p_parent: parent.id,
      p_storage_path: path,
      p_derivative_type: derivativeType(tool),
      p_sha256: sha256,
      p_byte_size: out.bytes.byteLength,
      p_mime: out.mime,
      p_service: service,
      p_service_version: '1',
      p_title: `${parent.title ?? parent.original_filename ?? 'Document'} (${tool.replace(/_/g, ' ')})`,
    });
    registered.push({ media_id: mediaId, path, byte_size: out.bytes.byteLength });
  }
  return { tool, service, outputs: registered };
};
