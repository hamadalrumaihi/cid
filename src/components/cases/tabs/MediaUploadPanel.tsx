'use client'

/** Drag-drop / browse upload panel for the Add-evidence modal. Dynamically
 *  imported by MediaTab so nothing here loads until the modal opens.
 *
 *  Two hosts, one queue UI:
 *  - **Supabase Storage (default)** — `evidenceQueue.ts`: hash → row →
 *    object → `evidence_register`. Each file lands as registered evidence
 *    with an EV number; the row shows the phase (Hashing… → Uploading… →
 *    Registering…) over an indeterminate bar (fetch uploads expose no byte
 *    progress) and then its evidence number.
 *  - **FiveManage (legacy)** — `uppyFivemanage.ts`, loaded on demand: when
 *    `NEXT_PUBLIC_EVIDENCE_HOST=fivemanage`, or as the fallback for a file
 *    over the 100 MB bucket limit when the key is configured. Host-first,
 *    insert-second as before; no hash, no custody.
 *
 *  The panel owns TRANSIT only. Persistence for the storage path happens
 *  inside the queue (row + register); for FiveManage the modal's
 *  `onUploaded` inserts the row and a rejected insert leaves the item
 *  "hosted, not saved" with an insert-only retry. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { AudioIcon, DocumentIcon, PhotoIcon, VideoIcon } from '@/components/shell/icons'
import { EVIDENCE_ACCEPT, MAX_EVIDENCE_BYTES, UPLOAD_PHASE_LABEL, evidenceHost, type UploadEvidenceResult } from '@/lib/evidence'
import { createEvidenceUploader, type EvidenceFileKind, type EvidenceQueueItem, type EvidenceQueueSnapshot, type EvidenceUploader } from '@/lib/evidenceQueue'
import { fmConfigured } from '@/lib/fivemanage'
import { formatBytes } from '@/lib/hash'
import { toast } from '@/lib/toast'
import type { FmUploader, QueueItem, QueueSnapshot, UploadedFile } from '@/lib/uppyFivemanage'

const KIND_ICON: Record<EvidenceFileKind, (p: { size?: number; className?: string }) => React.ReactElement> = {
  image: PhotoIcon, video: VideoIcon, audio: AudioIcon, document: DocumentIcon,
}

// Stable pre-mount store stubs (uploaders are created in effects — the React
// Compiler lint bars ref reads/instance creation during render).
const EMPTY_FM: QueueSnapshot = { items: [], active: 0, failed: 0, totalPercent: 0 }
const EMPTY_EV: EvidenceQueueSnapshot = { items: [], active: 0, failed: 0 }
const getEmptyFm = () => EMPTY_FM
const getEmptyEv = () => EMPTY_EV
const subscribeNothing = () => () => {}

const fmStatusLine = (it: QueueItem): string => {
  switch (it.status) {
    case 'queued': return 'Queued'
    case 'uploading': return `${formatBytes(it.bytesUploaded)} / ${formatBytes(it.size)}`
    case 'saving': return 'Uploaded — saving to case…'
    case 'done': return 'Added to the case'
    case 'upload-failed': return 'Upload failed'
    case 'save-failed': return 'Hosted, not saved'
  }
}

const evStatusLine = (it: EvidenceQueueItem): string => {
  switch (it.status) {
    case 'queued': return 'Queued'
    case 'done': return it.evidenceNumber ? `${it.evidenceNumber} · Added to the case` : 'Added to the case'
    case 'failed': return 'Failed'
    default: return UPLOAD_PHASE_LABEL[it.status]
  }
}

export function MediaUploadPanel({ caseId, uploaderId = null, onUploaded, onRegistered, onQueueChange }: {
  /** The case new evidence belongs to. Omitted (legacy callers) → the panel
   *  is FiveManage-only, exactly as before the storage path existed. */
  caseId?: string
  uploaderId?: string | null
  /** FiveManage path: inserts the media row for a hosted file; a rejection = save-failed. */
  onUploaded: (file: UploadedFile) => Promise<void>
  /** Storage path: a registered evidence row landed. */
  onRegistered?: (result: UploadEvidenceResult) => void
  /** Mirrors queue counts to the modal (Done gating + dirty guard). */
  onQueueChange: (active: number, failed: number) => void
}) {
  // Latest-callback refs: uploaders are created once, while the modal's
  // closures re-render freely; uploads read them late.
  const onUploadedRef = useRef(onUploaded)
  const onRegisteredRef = useRef(onRegistered)
  useEffect(() => { onUploadedRef.current = onUploaded; onRegisteredRef.current = onRegistered }, [onUploaded, onRegistered])

  const host = evidenceHost()
  const fmOk = fmConfigured()
  const storageDefault = host === 'supabase' && !!caseId

  // Storage queue — created whenever a case is known (it is the default host
  // and needs nothing external).
  const [ev, setEv] = useState<EvidenceUploader | null>(null)
  useEffect(() => {
    if (!caseId) return
    const u = createEvidenceUploader({
      caseId,
      uploaderId,
      onRegistered: (r) => onRegisteredRef.current?.(r),
      onRejected: (name, message) => toast(`${name}: ${message}`, 'warn'),
      onFailed: (name, message) => toast(`${name}: ${message}`, 'danger'),
    })
    setEv(u)
    return () => { u.cancelPending() }
  }, [caseId, uploaderId])

  // FiveManage queue — created on demand (dynamic import keeps @uppy out of
  // the chunk unless the legacy host is actually used).
  const [fm, setFm] = useState<FmUploader | null>(null)
  const fmRef = useRef<FmUploader | null>(null)
  const fmLoading = useRef<Promise<FmUploader> | null>(null)
  const ensureFm = (): Promise<FmUploader> => {
    if (fmRef.current) return Promise.resolve(fmRef.current)
    if (!fmLoading.current) {
      fmLoading.current = import('@/lib/uppyFivemanage').then((mod) => {
        const u = mod.createFmUploader({
          onUploaded: (f) => onUploadedRef.current(f),
          onRejected: (name, message) => toast(`${name}: ${message}`, 'warn'),
          onUploadFailed: (name, message) => toast(`${name}: ${message}`, 'danger'),
        })
        fmRef.current = u
        setFm(u)
        return u
      })
    }
    return fmLoading.current
  }
  useEffect(() => () => { fmRef.current?.cancelPending() }, [])

  const evSnap = useSyncExternalStore(ev?.subscribe ?? subscribeNothing, ev?.getSnapshot ?? getEmptyEv, ev?.getSnapshot ?? getEmptyEv)
  const fmSnap = useSyncExternalStore(fm?.subscribe ?? subscribeNothing, fm?.getSnapshot ?? getEmptyFm, fm?.getSnapshot ?? getEmptyFm)

  const active = evSnap.active + fmSnap.active
  const failed = evSnap.failed + fmSnap.failed
  useEffect(() => { onQueueChange(active, failed) }, [active, failed, onQueueChange])

  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  /** Route each picked file to its host. */
  const pick = (list: FileList | null) => {
    const fs = Array.from(list ?? [])
    if (!fs.length) return
    const toFm: File[] = []
    const toEv: File[] = []
    for (const f of fs) {
      if (!storageDefault) { if (fmOk) toFm.push(f); else toast(`${f.name}: file upload is not configured.`, 'warn'); continue }
      if (f.size > MAX_EVIDENCE_BYTES && fmOk) {
        toast(`${f.name} is over ${formatBytes(MAX_EVIDENCE_BYTES)} — hosted on FiveManage without integrity tracking.`, 'info')
        toFm.push(f)
        continue
      }
      toEv.push(f)
    }
    if (toEv.length) ev?.addFiles(toEv)
    if (toFm.length) void ensureFm().then((u) => u.addFiles(toFm))
  }

  const total = evSnap.items.length + fmSnap.items.length
  const uploadAvailable = storageDefault || fmOk

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
        className={`rounded-lg border border-dashed p-6 text-center transition ${dragOver ? 'border-badge-400 bg-blue-500/10' : 'border-white/15 bg-white/[0.03]'}`}
      >
        <input
          ref={fileRef}
          type="file"
          name="evidence"
          multiple
          accept={storageDefault ? EVIDENCE_ACCEPT : 'image/*,video/*,audio/*'}
          className="hidden"
          onChange={(e) => { pick(e.target.files); e.target.value = '' }}
          aria-label="Choose evidence files"
        />
        <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={!uploadAvailable}>Choose files to upload</Button>
        <p className="mt-2 text-xs text-slate-400">
          {storageDefault
            ? <>…or drag files here. Images, audio, video, PDF, text, ZIP or Office files up to {formatBytes(MAX_EVIDENCE_BYTES)} each — every file is hashed and registered as evidence; details are editable after upload.</>
            : <>…or drag files here. Images, video and audio up to {formatBytes(MAX_EVIDENCE_BYTES)} each — details are editable after upload.</>}
        </p>
        {storageDefault && fmOk && (
          <p className="mt-1 text-xs text-slate-500">Files over {formatBytes(MAX_EVIDENCE_BYTES)} fall back to FiveManage (no integrity tracking).</p>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-white">Upload queue ({total})</h4>
            {active > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { ev?.cancelPending(); fmRef.current?.cancelPending() }}>Cancel pending</Button>
            )}
          </div>
          {evSnap.active > 0 && (
            // Indeterminate: fetch uploads expose no byte progress; the pulse
            // is the existing skeleton keyframe (no new animation).
            <div role="progressbar" aria-label="Evidence upload in progress" aria-valuetext="In progress" className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <Skeleton className="h-full w-full rounded-full" />
            </div>
          )}
          {fmSnap.active > 0 && (
            <div
              role="progressbar"
              aria-label="FiveManage upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fmSnap.totalPercent}
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full rounded-full bg-badge-500 transition-[width]" style={{ width: `${fmSnap.totalPercent}%` }} />
            </div>
          )}
          <ul className="list-none space-y-1.5">
            {evSnap.items.map((it) => (
              <EvidenceRow key={it.id} it={it} onRetry={() => ev?.retry(it.id)} onRemove={() => ev?.remove(it.id)} />
            ))}
            {fmSnap.items.map((it) => (
              <FmRow key={it.id} it={it} onRetry={() => fmRef.current?.retry(it.id)} onRemove={() => fmRef.current?.remove(it.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EvidenceRow({ it, onRetry, onRemove }: { it: EvidenceQueueItem; onRetry: () => void; onRemove: () => void }) {
  const isFailed = it.status === 'failed'
  const inFlight = it.status !== 'queued' && it.status !== 'done' && !isFailed
  const Icon = KIND_ICON[it.kind]
  return (
    <li className={`rounded-lg border px-3 py-2 ${isFailed ? 'border-rose-400/30 bg-rose-500/[0.06]' : 'border-white/10 bg-ink-950/50'}`}>
      <div className="flex items-center gap-2">
        <Icon size={16} className="flex-shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={it.name}>{it.name}</span>
        <span className="flex-shrink-0 text-xs text-slate-500">{formatBytes(it.size)}</span>
        <span
          aria-live="polite"
          className={`flex-shrink-0 text-xs ${it.status === 'done' ? 'font-semibold text-emerald-300' : isFailed ? 'font-semibold text-rose-300' : 'text-slate-400'}`}
        >
          {it.status === 'done' ? '✓ ' : ''}{evStatusLine(it)}
        </span>
        {isFailed && <Button size="sm" variant="secondary" onClick={onRetry} aria-label={`Retry ${it.name}`}>Retry</Button>}
        {(isFailed || it.status === 'queued') && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${it.name} from the queue`}>✕</Button>
        )}
      </div>
      {inFlight && <p className="mt-1 text-[11px] text-slate-500">Hashing → Uploading → Registering</p>}
      {isFailed && it.error && <p className="mt-1 text-xs text-rose-300">{it.error}</p>}
    </li>
  )
}

function FmRow({ it, onRetry, onRemove }: { it: QueueItem; onRetry: () => void; onRemove: () => void }) {
  const isFailed = it.status === 'upload-failed' || it.status === 'save-failed'
  const inFlight = it.status === 'queued' || it.status === 'uploading'
  const pct = it.size > 0
    ? Math.min(100, Math.round((it.bytesUploaded / it.size) * 100))
    : it.status === 'queued' || it.status === 'uploading' ? 0 : 100
  const Icon = KIND_ICON[it.kind]
  return (
    <li className={`rounded-lg border px-3 py-2 ${isFailed ? 'border-rose-400/30 bg-rose-500/[0.06]' : 'border-white/10 bg-ink-950/50'}`}>
      <div className="flex items-center gap-2">
        <Icon size={16} className="flex-shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={it.name}>{it.name}</span>
        <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500" title="Hosted on FiveManage — integrity not tracked">FiveManage</span>
        <span className={`flex-shrink-0 text-xs ${it.status === 'done' ? 'font-semibold text-emerald-300' : isFailed ? 'font-semibold text-rose-300' : 'text-slate-400'}`}>
          {it.status === 'done' ? '✓ ' : ''}{fmStatusLine(it)}
        </span>
        {isFailed && (
          <Button size="sm" variant="secondary" onClick={onRetry} aria-label={`Retry ${it.name}`}>
            {it.status === 'save-failed' ? 'Retry save' : 'Retry'}
          </Button>
        )}
        {(isFailed || inFlight) && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${it.name} from the queue`}>✕</Button>
        )}
      </div>
      {inFlight && (
        <div
          role="progressbar"
          aria-label={`Upload progress — ${it.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-badge-500 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {isFailed && it.error && <p className="mt-1 text-xs text-rose-300">{it.error}</p>}
      {it.status === 'save-failed' && (
        <p className="mt-0.5 text-xs text-rose-200/80">The file is hosted but was not added to the case — retry the save (no re-upload).</p>
      )}
    </li>
  )
}
