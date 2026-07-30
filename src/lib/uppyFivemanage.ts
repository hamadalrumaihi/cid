/** Uppy → FiveManage upload adapter (pilot: Case Detail → Photos & Media).
 *
 *  Headless @uppy/core + @uppy/xhr-upload wired to the exact FiveManage
 *  transport contract that src/lib/fivemanage.ts established (and which the
 *  other surfaces still use single-shot):
 *    - endpoint `${BASE}/api/{image|video|audio}` — kind from the MIME prefix,
 *      image fallback;
 *    - multipart field named BY KIND (not `file`), plus a `metadata` part
 *      containing JSON.stringify({ name });
 *    - `Authorization: <raw key>` — NO `Bearer` prefix;
 *    - Content-Type left to the browser (FormData boundary);
 *    - hosted URL from `url` || `link` || `data.url`.
 *
 *  What Uppy adds over the bare fetch: a real queue with per-file byte
 *  progress, per-file retry, cancel of pending files, and restrictions
 *  (size cap + accepted types) enforced before a byte leaves the browser.
 *
 *  Two-phase seam (deliberate): the adapter uploads to the host FIRST, then
 *  calls the caller's `onUploaded` (which inserts the `media` row). A failed
 *  insert leaves the item in `save-failed` — hosted but NOT in the case — so
 *  the UI can retry the insert alone without re-uploading bytes.
 *
 *  Framework-free on purpose (no React import): views subscribe via
 *  subscribe/getSnapshot (useSyncExternalStore-shaped), so the adapter is
 *  unit-testable in node and reusable by other surfaces later. */
import Uppy from '@uppy/core'
import XHRUpload from '@uppy/xhr-upload'
import type { Meta } from '@uppy/core'
import type { FmKind } from '@/lib/fivemanage'

const API_KEY = process.env.NEXT_PUBLIC_FIVEMANAGE_API_KEY ?? ''
const BASE_URL = (process.env.NEXT_PUBLIC_FIVEMANAGE_BASE_URL ?? 'https://api.fivemanage.com').replace(/\/+$/, '')

/** 100 MB per file — generous for stills and dashcam clips; FiveManage's
 *  single-shot POST destination has no resumable protocol, so anything larger
 *  should not be attempted in one request anyway. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** Mirrors the fmUpload contract: three media kinds, nothing else. */
export const ACCEPTED_FILE_TYPES = ['image/*', 'video/*', 'audio/*'] as const

/** MIME → FiveManage kind. Image is the deliberate fallback (fmUpload parity). */
export const fmKindOf = (mime: string): FmKind =>
  mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'image'

/** FiveManage keys the upload PATH by kind. */
export const fmEndpointFor = (kind: FmKind, base: string = BASE_URL): string => `${base}/api/${kind}`

/** …and the multipart FIELD by kind too (never `file`). */
export const fmFieldFor = (kind: FmKind): string => kind

/** Hosted URL out of a FiveManage response body: url || link || data.url. */
export function extractFmUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { url?: unknown; link?: unknown; data?: unknown }
  const nested = b.data && typeof b.data === 'object' ? (b.data as { url?: unknown }).url : undefined
  const url = b.url ?? b.link ?? nested
  return typeof url === 'string' && url ? url : null
}

/** Compact byte formatter for queue rows (1023 B / 4.2 MB / 100 MB). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB'] as const
  let v = n
  let i = -1
  do { v /= 1024; i += 1 } while (v >= 1024 && i < units.length - 1)
  return `${v >= 10 ? Math.round(v).toString() : v.toFixed(1)} ${units[i]}`
}

/* ── Queue model ─────────────────────────────────────────────────────────── */

export type QueueStatus =
  | 'queued' // added, upload not started yet
  | 'uploading' // bytes moving to FiveManage
  | 'upload-failed' // host rejected / network error — retry re-uploads
  | 'saving' // hosted; the caller's onUploaded (media insert) is in flight
  | 'save-failed' // hosted but NOT in the case — retry re-runs the insert only
  | 'done' // hosted + inserted

export interface QueueItem {
  id: string
  name: string
  kind: FmKind
  size: number
  bytesUploaded: number
  status: QueueStatus
  error: string | null
  /** Hosted URL — set from upload success onward (survives a failed insert). */
  url: string | null
}

export interface QueueSnapshot {
  items: QueueItem[]
  /** Items still moving (queued/uploading/saving) — gates modal close. */
  active: number
  /** Unresolved failures (upload or insert) — the partial-success signal. */
  failed: number
  /** 0–100 across every queued byte (done items count as complete). */
  totalPercent: number
}

/** Phase-2 payload: the host upload landed; the caller inserts the row. */
export interface UploadedFile { name: string; kind: FmKind; size: number; url: string }

export interface FmUploaderOptions {
  /** Called once per file AFTER the host upload succeeds (host-first,
   *  insert-second — the row must never exist without a URL). A rejection
   *  marks the item `save-failed`; retry(id) re-runs this alone. */
  onUploaded: (file: UploadedFile) => Promise<void>
  /** A file was refused before upload (size/type/duplicate restriction). */
  onRejected?: (fileName: string, message: string) => void
  /** A host upload failed (also reflected on the item) — for loud toasts. */
  onUploadFailed?: (fileName: string, message: string) => void
}

export interface FmUploader {
  addFiles(files: File[]): void
  /** upload-failed → re-upload; save-failed → re-run the insert only. */
  retry(id: string): void
  remove(id: string): void
  /** Aborts/forgets queued + uploading items; hosted/failed/done stay put. */
  cancelPending(): void
  subscribe(onChange: () => void): () => void
  getSnapshot(): QueueSnapshot
}

/* ── Factory ─────────────────────────────────────────────────────────────── */

type FmBody = Record<string, unknown>

const EMPTY_SNAPSHOT: QueueSnapshot = { items: [], active: 0, failed: 0, totalPercent: 0 }

/** Read the FiveManage error message out of a non-2xx response (verbatim
 *  `message`/`error` when the body is JSON, `HTTP <status>` otherwise) —
 *  same surfacing rule as fmUpload. */
const readFmError = (xhr: XMLHttpRequest): string => {
  try {
    const j = JSON.parse(xhr.responseText) as { message?: string; error?: string }
    const msg = j.message || j.error
    if (msg) return msg
  } catch { /* keep status */ }
  return `HTTP ${xhr.status}`
}

export function createFmUploader(opts: FmUploaderOptions): FmUploader {
  const items = new Map<string, QueueItem>()
  const listeners = new Set<() => void>()
  let snapshot = EMPTY_SNAPSHOT

  const recompute = () => {
    const list = [...items.values()]
    const active = list.filter((x) => x.status === 'queued' || x.status === 'uploading' || x.status === 'saving').length
    const failed = list.filter((x) => x.status === 'upload-failed' || x.status === 'save-failed').length
    const totalBytes = list.reduce((n, x) => n + x.size, 0)
    const doneBytes = list.reduce((n, x) => n + (x.status === 'done' || x.status === 'saving' ? x.size : x.bytesUploaded), 0)
    const totalPercent = totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0
    snapshot = { items: list, active, failed, totalPercent }
  }
  const emit = () => { recompute(); for (const l of listeners) l() }
  const patch = (id: string, p: Partial<QueueItem>) => {
    const it = items.get(id)
    if (!it) return
    items.set(id, { ...it, ...p })
    emit()
  }

  const uppy = new Uppy<Meta, FmBody>({
    autoProceed: true,
    restrictions: { maxFileSize: MAX_UPLOAD_BYTES, allowedFileTypes: [...ACCEPTED_FILE_TYPES] },
    // Route each file BEFORE it enters state: FiveManage keys both the path
    // and the multipart field by media kind, and wants a `metadata` part.
    // (Returning a new object skips Uppy's duplicate check, so re-guard it.)
    onBeforeFileAdded: (file) => {
      if (uppy.checkIfFileAlreadyExists(file.id)) {
        opts.onRejected?.(file.name ?? 'File', 'Already in the upload queue.')
        return false
      }
      const kind = fmKindOf(file.type ?? '')
      return {
        ...file,
        meta: { ...file.meta, metadata: JSON.stringify({ name: file.name }) },
        xhrUpload: { endpoint: fmEndpointFor(kind), fieldName: fmFieldFor(kind) },
      }
    },
  })

  uppy.use(XHRUpload, {
    // Per-file endpoint/fieldName are pinned on file.xhrUpload above; this
    // function is the required fallback and computes the same route.
    endpoint: (input) => {
      const f = Array.isArray(input) ? input[0] : input
      return fmEndpointFor(fmKindOf(f?.type ?? ''))
    },
    headers: { Authorization: API_KEY }, // raw key — FiveManage takes no Bearer prefix
    allowedMetaFields: ['metadata'],
    limit: 3,
    shouldRetry: () => false, // retries are user-driven from the queue UI
    // Non-2xx: throw the server's own message so upload-error carries it
    // verbatim (the default path would reduce it to the HTTP statusText).
    onAfterResponse: (xhr) => {
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(readFmError(xhr))
    },
    // Success body → { url } via the url || link || data.url contract; a
    // 2xx without a usable URL is still a failure.
    getResponseData: (xhr) => {
      let parsed: unknown = null
      try { parsed = JSON.parse(xhr.responseText) } catch { /* handled below */ }
      const url = extractFmUrl(parsed)
      if (!url) throw new Error('FiveManage returned no URL')
      return { url }
    },
  })

  /** Phase 2: hand the hosted URL to the caller's insert. Never re-uploads. */
  const save = async (id: string) => {
    const it = items.get(id)
    if (!it?.url) return
    try {
      await opts.onUploaded({ name: it.name, kind: it.kind, size: it.size, url: it.url })
      patch(id, { status: 'done', error: null })
    } catch (e) {
      patch(id, { status: 'save-failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  uppy.on('restriction-failed', (file, error) => {
    opts.onRejected?.(file?.name ?? 'File', error.message)
  })
  uppy.on('file-added', (file) => {
    items.set(file.id, {
      id: file.id,
      name: file.name ?? 'file',
      kind: fmKindOf(file.type ?? ''),
      size: file.size ?? 0,
      bytesUploaded: 0,
      status: 'queued',
      error: null,
      url: null,
    })
    emit()
  })
  uppy.on('upload-progress', (file, progress) => {
    if (!file || !items.has(file.id)) return
    patch(file.id, { status: 'uploading', bytesUploaded: Math.round(progress.bytesUploaded || 0) })
  })
  uppy.on('upload-error', (file, error) => {
    if (!file || !items.has(file.id)) return
    const msg = error.message || 'Upload failed'
    patch(file.id, { status: 'upload-failed', error: msg })
    opts.onUploadFailed?.(items.get(file.id)?.name ?? 'File', msg)
  })
  uppy.on('upload-success', (file, response) => {
    if (!file) return
    const it = items.get(file.id)
    if (!it) return
    const url = extractFmUrl(response.body) ?? response.uploadURL ?? null
    if (!url) { // defensive — getResponseData already rejects URL-less bodies
      patch(file.id, { status: 'upload-failed', error: 'FiveManage returned no URL' })
      return
    }
    patch(file.id, { status: 'saving', url, bytesUploaded: it.size })
    void save(file.id)
  })
  // Removal of an in-flight/queued file (remove button, cancelPending) drops
  // it from the queue; anything hosted or resolved keeps its row.
  uppy.on('file-removed', (file) => {
    const it = items.get(file.id)
    if (it && (it.status === 'queued' || it.status === 'uploading')) {
      items.delete(file.id)
      emit()
    }
  })

  return {
    addFiles(files) {
      try {
        uppy.addFiles(files.map((f) => ({ name: f.name, type: f.type, data: f })))
      } catch (e) { // non-restriction failure (restrictions emit, not throw)
        opts.onRejected?.('Files', e instanceof Error ? e.message : String(e))
      }
    },
    retry(id) {
      const it = items.get(id)
      if (!it) return
      if (it.status === 'upload-failed') {
        patch(id, { status: 'queued', error: null, bytesUploaded: 0 })
        void uppy.retryUpload(id).catch(() => { /* upload-error already patched the item */ })
      } else if (it.status === 'save-failed') {
        patch(id, { status: 'saving', error: null })
        void save(id)
      }
    },
    remove(id) {
      if (!items.has(id)) return
      if (uppy.getFile(id)) uppy.removeFile(id) // aborts if in flight
      items.delete(id)
      emit()
    },
    cancelPending() {
      for (const it of [...items.values()]) {
        if (it.status === 'queued' || it.status === 'uploading') {
          if (uppy.getFile(it.id)) uppy.removeFile(it.id)
          items.delete(it.id)
        }
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
