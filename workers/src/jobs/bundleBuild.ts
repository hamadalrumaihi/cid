// bundle.build — zip of evidence originals + manifest.json + manifest.sha256
// into exports/export/<created_by>/<job_id>/bundle.zip (fflate, shared logic).
import { bundleBuild, type KindHandler } from '../jobCore.ts';

export const kind = 'bundle.build';
export const queue = 'exports';
export const handler: KindHandler = bundleBuild;
