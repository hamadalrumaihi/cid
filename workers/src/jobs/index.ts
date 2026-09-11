// Job registry: one module per kind. `KINDS_BY_QUEUE` drives job_claim's
// p_kinds so the worker never claims a kind it cannot run.
import type { KindHandler } from '../jobCore.ts';
import * as evidenceVerify from './evidenceVerify.ts';
import * as evidenceDerive from './evidenceDerive.ts';
import * as packetRender from './packetRender.ts';
import * as bundleBuild from './bundleBuild.ts';
import * as sourceFetch from './sourceFetch.ts';
import * as documentExtract from './documentExtract.ts';
import * as searchSync from './searchSync.ts';
import * as embeddingsGenerate from './embeddingsGenerate.ts';
import * as healthProbe from './healthProbe.ts';
import * as pdfTool from './pdfTool.ts';

interface JobModule {
  kind: string;
  queue: string;
  handler: KindHandler;
}

const MODULES: JobModule[] = [evidenceVerify, evidenceDerive, packetRender, bundleBuild, sourceFetch, documentExtract, searchSync, embeddingsGenerate, healthProbe, pdfTool];

export const HANDLERS: Record<string, KindHandler> = Object.fromEntries(MODULES.map((m) => [m.kind, m.handler]));

export const KINDS_BY_QUEUE: Record<string, string[]> = MODULES.reduce<Record<string, string[]>>((acc, m) => {
  (acc[m.queue] ??= []).push(m.kind);
  return acc;
}, {});

export const WORKER_QUEUES = Object.keys(KINDS_BY_QUEUE);
