/** Supabase Storage evidence upload queue — the storage-host counterpart of
 *  `uppyFivemanage.ts`, with the same framework-free subscribe/getSnapshot
 *  contract so `MediaUploadPanel` renders both queues through one
 *  useSyncExternalStore and the adapter stays unit-testable in node.
 *
 *  Per file: hashing → saving (row) → uploading (object) → registering
 *  (`evidence_register`) → done. There is no byte progress — supabase-js
 *  uploads through fetch, which exposes none — so consumers show the phase
 *  and an indeterminate bar. A failure BEFORE the object landed leaves
 *  nothing behind (`stageEvidence` rolls its own row back); a failure at
 *  registration keeps the staged bytes and retries registration alone. */
import {
  evidenceFileProblem, registerEvidence, stageEvidence, type StagedEvidence, type UploadEvidenceResult, type UploadPhase,
} from './evidence'

export type EvidenceQueueStatus = 'queued' | UploadPhase | 'done' | 'failed'

export type EvidenceFileKind = 'image' | 'video' | 'audio' | 'document'

export interface EvidenceQueueItem {
  id: string
  name: string
  size: number
  kind: EvidenceFileKind
  status: EvidenceQueueStatus
  error: string | null
  /** Set once registration succeeds. */
  evidenceNumber: string | null
  mediaId: string | null
}

export interface EvidenceQueueSnapshot {
  items: EvidenceQueueItem[]
  /** Items still moving (queued or in any phase) — gates modal close. */
  active: number
  /** Unresolved failures. */
  failed: number
}

export interface EvidenceUploaderOptions {
  caseId: string
  uploaderId: string | null
  /** A registered evidence row landed (with its EV number). */
  onRegistered: (result: UploadEvidenceResult) => void
  /** A file was refused before anything moved (type/size/empty). */
  onRejected?: (fileName: string, message: string) => void
  /** A file failed mid-pipeline (also reflected on the item). */
  onFailed?: (fileName: string, message: string) => void
  /** Simultaneous pipelines (hashing 100 MB is CPU-bound; two is plenty). */
  concurrency?: number
}

export interface EvidenceUploader {
  addFiles(files: File[]): void
  /** failed → re-run (registration only when the bytes already landed). */
  retry(id: string): void
  remove(id: string): void
  /** Forgets QUEUED items; in-flight pipelines finish on their own. */
  cancelPending(): void
  subscribe(onChange: () => void): () => void
  getSnapshot(): EvidenceQueueSnapshot
}

export const evidenceFileKind = (mime: string): EvidenceFileKind =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document'

const EMPTY: EvidenceQueueSnapshot = { items: [], active: 0, failed: 0 }
const IN_FLIGHT: ReadonlySet<EvidenceQueueStatus> = new Set(['hashing', 'saving', 'uploading', 'registering'])

export function createEvidenceUploader(opts: EvidenceUploaderOptions): EvidenceUploader {
  const limit = Math.max(1, opts.concurrency ?? 2)
  const items = new Map<string, EvidenceQueueItem>()
  const files = new Map<string, File>()
  const staged = new Map<string, StagedEvidence>()
  const listeners = new Set<() => void>()
  let snapshot = EMPTY
  let seq = 0

  const recompute = () => {
    const list = [...items.values()]
    snapshot = {
      items: list,
      active: list.filter((x) => x.status === 'queued' || IN_FLIGHT.has(x.status)).length,
      failed: list.filter((x) => x.status === 'failed').length,
    }
  }
  const emit = () => { recompute(); for (const l of listeners) l() }
  const patch = (id: string, p: Partial<EvidenceQueueItem>) => {
    const it = items.get(id)
    if (!it) return
    items.set(id, { ...it, ...p })
    emit()
  }

  const run = async (id: string) => {
    const it = items.get(id)
    const file = files.get(id)
    if (!it || !file) return
    const args = { caseId: opts.caseId, uploaderId: opts.uploaderId, file }
    try {
      let s = staged.get(id)
      if (!s) {
        s = await stageEvidence(args, (phase) => patch(id, { status: phase }))
        staged.set(id, s)
      }
      patch(id, { status: 'registering', mediaId: s.mediaId })
      const result = await registerEvidence(s, args)
      staged.delete(id)
      patch(id, { status: 'done', error: null, evidenceNumber: result.evidenceNumber, mediaId: result.mediaId })
      opts.onRegistered(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patch(id, { status: 'failed', error: msg })
      opts.onFailed?.(it.name, msg)
    } finally {
      pump()
    }
  }

  /** Start queued items while under the concurrency limit. */
  const pump = () => {
    const inFlight = [...items.values()].filter((x) => IN_FLIGHT.has(x.status)).length
    let slots = limit - inFlight
    for (const it of items.values()) {
      if (slots <= 0) break
      if (it.status !== 'queued') continue
      slots -= 1
      void run(it.id)
    }
  }

  return {
    addFiles(list) {
      for (const f of list) {
        const problem = evidenceFileProblem(f)
        if (problem) { opts.onRejected?.(f.name, problem); continue }
        seq += 1
        const id = `ev-${seq}-${f.name}`
        if (items.has(id)) { opts.onRejected?.(f.name, 'Already in the upload queue.'); continue }
        files.set(id, f)
        items.set(id, { id, name: f.name, size: f.size, kind: evidenceFileKind(f.type), status: 'queued', error: null, evidenceNumber: null, mediaId: null })
      }
      emit()
      pump()
    },
    retry(id) {
      const it = items.get(id)
      if (!it || it.status !== 'failed') return
      patch(id, { status: 'queued', error: null })
      pump()
    },
    remove(id) {
      const it = items.get(id)
      if (!it || IN_FLIGHT.has(it.status)) return // cannot abort a fetch upload mid-flight
      items.delete(id)
      files.delete(id)
      staged.delete(id)
      emit()
    },
    cancelPending() {
      for (const it of [...items.values()]) {
        if (it.status === 'queued') { items.delete(it.id); files.delete(it.id) }
      }
      emit()
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => { listeners.delete(onChange) }
    },
    getSnapshot: () => snapshot,
  }
}
