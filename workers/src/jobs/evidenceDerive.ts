// evidence.derive — thumbnail (<= 320 px) + preview (<= 1600 px) WebP
// derivatives for image evidence, registered via evidence_derivative_register.
// Same logic as the runner; here deps.images is sharp (native), so this is
// the tier that actually produces them when the edge runtime cannot load an
// image library and completes with {skipped:'no_image_provider'}.
//
// Re-drive: an Owner can `background_job_retry` the skipped job, or a fresh
// `evidence.derive` job is enqueued by evidence_register for new uploads.
import { evidenceDerive, type KindHandler } from '../jobCore.ts';

export const kind = 'evidence.derive';
export const queue = 'evidence';
export const handler: KindHandler = evidenceDerive;
