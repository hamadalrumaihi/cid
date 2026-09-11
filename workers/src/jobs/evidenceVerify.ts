// evidence.verify — SHA-256 the original in case-evidence and report via evidence_verify_result.
// Identical to the runner (jobCore); the worker just has no size ceiling concerns beyond 100 MB.
import { evidenceVerify, type KindHandler } from '../jobCore.ts';

export const kind = 'evidence.verify';
export const queue = 'evidence';
export const handler: KindHandler = evidenceVerify;
