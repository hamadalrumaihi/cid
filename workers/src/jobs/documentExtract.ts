// document.extract — Docling when DOCLING_URL is set (PDF/docx/pptx/xlsx/
// html/images with OCR, tables and structure), else the unpdf/text
// passthrough shared with the runner. Without Docling, docx/images cannot be
// extracted anywhere, so they fail non-retryably as `unsupported_mime` and
// document_extract_failed is recorded (the runner instead re-queues them as
// `needs_worker`, which this tier picks up).
import { JobError, documentExtractBasic, mediaPathOk, type KindHandler } from '../jobCore.ts';
import { DOCLING_MIMES, DoclingError, convert, doclingConfigured } from '../providers/docling.ts';

export const kind = 'document.extract';
export const queue = 'documents';

const MAX_BYTES = 100 * 1024 * 1024;

export const handler: KindHandler = async (ctx) => {
  const { job, deps, heartbeat } = ctx;
  const mediaId = String(job.args?.media_id ?? job.subject_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new JobError('bad_args: media_id', false);
  const { data: media, error } = await deps.supa.from('media').select('id,case_id,storage_path,mime,byte_size,original_filename,deleted_at').eq('id', mediaId).maybeSingle();
  if (error) throw new JobError(`media: ${error.message}`, true);
  if (!media) throw new JobError('missing_row: media', false);
  if (media.deleted_at) return { skipped: 'deleted' };
  const mime = String(media.mime ?? '').toLowerCase();
  const basicOk = mime === 'application/pdf' || mime === 'text/plain' || mime === 'text/markdown';
  const failPermanent = async (reason: string): Promise<never> => {
    try {
      await deps.supa.rpc('document_extract_failed', { p_job: job.id, p_media: mediaId, p_error: reason });
    } catch {
      /* job failure still recorded */
    }
    throw new JobError(reason, false);
  };
  if (!doclingConfigured()) {
    if (!basicOk) return failPermanent('unsupported_mime');
    return documentExtractBasic(ctx);
  }
  if (!DOCLING_MIMES.has(mime)) return failPermanent('unsupported_mime');
  if (!media.storage_path) throw new JobError('bad_state: media has no storage_path', false);
  if (!mediaPathOk(media)) throw new JobError('bad_state: storage path outside the media folder', false);
  if (Number(media.byte_size ?? 0) > MAX_BYTES) return failPermanent('too_large');
  await heartbeat({ pct: 10, step: 'download' });
  const bytes = await deps.storage.download('case-evidence', media.storage_path);
  await heartbeat({ pct: 30, step: 'docling' });
  let result;
  try {
    result = await convert(bytes, String(media.original_filename ?? 'document'), mime);
  } catch (e) {
    if (e instanceof DoclingError && e.retryable) {
      // Service hiccup: retry with backoff, but fall back to unpdf for PDFs on the last attempt.
      if (job.attempts >= job.max_attempts && basicOk) return documentExtractBasic(ctx);
      throw new JobError(e.message, true);
    }
    if (e instanceof DoclingError) return basicOk ? documentExtractBasic(ctx) : failPermanent(e.message);
    throw e;
  }
  if (!result.pages.length) return failPermanent('no_text_extracted');
  await heartbeat({ pct: 85, step: 'record' });
  const { error: rpcErr } = await deps.supa.rpc('document_extract_result', {
    p_job: job.id,
    p_media: mediaId,
    p_service: 'docling',
    p_service_version: result.version,
    p_pages: result.pages,
    p_structure: result.structure,
    p_tables: result.tables,
  });
  if (rpcErr) throw new JobError(`document_extract_result: ${rpcErr.message}`, !/P0403|bad_/.test(rpcErr.code ?? rpcErr.message));
  return { page_count: result.pages.length, tables: result.tables.length, service: 'docling' };
};
