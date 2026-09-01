'use client'

/** Drag-drop / browse upload panel for the Add-photos modal (Uppy pilot).
 *  Dynamically imported by MediaTab so @uppy/core + @uppy/xhr-upload never
 *  load until the modal opens with a configured FiveManage key.
 *
 *  The panel owns TRANSIT only: queue rows with real byte progress, per-file
 *  retry/remove, cancel-pending. Persistence stays in the modal — its
 *  `onUploaded` inserts the media row (host-first, insert-second) and a
 *  rejected insert leaves the row here as "hosted, not saved" with a retry
 *  that re-runs the insert alone. Done items leave the queue and appear in
 *  the modal's "Added to the case" edit list. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/Button'
import { AudioIcon, PhotoIcon, VideoIcon } from '@/components/shell/icons'
import { toast } from '@/lib/toast'
import {
  ACCEPTED_FILE_TYPES, MAX_UPLOAD_BYTES, createFmUploader, fmtBytes,
  type FmUploader, type QueueItem, type QueueSnapshot, type UploadedFile,
} from '@/lib/uppyFivemanage'

const KIND_ICON: Record<QueueItem['kind'], (p: { size?: number; className?: string }) => React.ReactElement> = {
  image: PhotoIcon, video: VideoIcon, audio: AudioIcon,
}

// Stable pre-mount store stubs (the uploader is created in a mount effect —
// the React Compiler lint bars ref reads/instance creation during render).
const EMPTY_SNAPSHOT: QueueSnapshot = { items: [], active: 0, failed: 0, totalPercent: 0 }
const getEmptySnapshot = () => EMPTY_SNAPSHOT
const subscribeNothing = () => () => {}

const statusLine = (it: QueueItem): string => {
  switch (it.status) {
    case 'queued': return 'Queued'
    case 'uploading': return `${fmtBytes(it.bytesUploaded)} / ${fmtBytes(it.size)}`
    case 'saving': return 'Uploaded — saving to case…'
    case 'done': return 'Added to the case'
    case 'upload-failed': return 'Upload failed'
    case 'save-failed': return 'Hosted, not saved'
  }
}

export function MediaUploadPanel({ onUploaded, onQueueChange }: {
  /** Inserts the media row for a hosted file; a rejection = save-failed. */
  onUploaded: (file: UploadedFile) => Promise<void>
  /** Mirrors queue counts to the modal (Done gating + dirty guard). */
  onQueueChange: (active: number, failed: number) => void
}) {
  // Latest-callback ref: the uploader is created once (mount effect), while
  // the modal's insert closure re-renders freely; uploads read it late.
  const onUploadedRef = useRef(onUploaded)
  useEffect(() => { onUploadedRef.current = onUploaded }, [onUploaded])

  const [uploader, setUploader] = useState<FmUploader | null>(null)
  useEffect(() => {
    const u = createFmUploader({
      onUploaded: (f) => onUploadedRef.current(f),
      onRejected: (name, message) => toast(`${name}: ${message}`, 'warn'),
      onUploadFailed: (name, message) => toast(`${name}: ${message}`, 'danger'),
    })
    setUploader(u)
    // Unmount (modal close — dirty() already made the user confirm) abandons
    // whatever is still in transit; hosted/saving items finish on their own.
    return () => { u.cancelPending() }
  }, [])

  const { items, active, failed, totalPercent } = useSyncExternalStore(
    uploader?.subscribe ?? subscribeNothing,
    uploader?.getSnapshot ?? getEmptySnapshot,
    uploader?.getSnapshot ?? getEmptySnapshot,
  )

  useEffect(() => { onQueueChange(active, failed) }, [active, failed, onQueueChange])

  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const pick = (files: FileList | null) => {
    const fs = Array.from(files ?? [])
    if (fs.length) uploader?.addFiles(fs)
  }

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
          multiple
          accept={ACCEPTED_FILE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => { pick(e.target.files); e.target.value = '' }}
        />
        <Button variant="primary" onClick={() => fileRef.current?.click()}>Choose photos to upload</Button>
        <p className="mt-2 text-xs text-slate-400">
          …or drag files here. Images, video and audio up to {fmtBytes(MAX_UPLOAD_BYTES)} each — details are editable after upload.
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-white">
              Upload queue ({items.length})
            </h4>
            {active > 0 && (
              <Button size="sm" variant="ghost" onClick={() => uploader?.cancelPending()}>Cancel pending</Button>
            )}
          </div>
          {active > 0 && (
            <div
              role="progressbar"
              aria-label="Overall upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totalPercent}
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full rounded-full bg-badge-500 transition-[width]" style={{ width: `${totalPercent}%` }} />
            </div>
          )}
          <ul className="list-none space-y-1.5">
            {items.map((it) => (
              <QueueRow key={it.id} it={it} onRetry={() => uploader?.retry(it.id)} onRemove={() => uploader?.remove(it.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function QueueRow({ it, onRetry, onRemove }: { it: QueueItem; onRetry: () => void; onRemove: () => void }) {
  const isFailed = it.status === 'upload-failed' || it.status === 'save-failed'
  const inFlight = it.status === 'queued' || it.status === 'uploading'
  const pct = it.size > 0
    ? Math.min(100, Math.round((it.bytesUploaded / it.size) * 100))
    : it.status === 'queued' || it.status === 'uploading' ? 0 : 100
  return (
    <li className={`rounded-lg border px-3 py-2 ${isFailed ? 'border-rose-400/30 bg-rose-500/[0.06]' : 'border-white/10 bg-ink-950/50'}`}>
      <div className="flex items-center gap-2">
        {(() => { const Icon = KIND_ICON[it.kind]; return <Icon size={16} className="flex-shrink-0 text-slate-400" /> })()}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={it.name}>{it.name}</span>
        <span className={`flex-shrink-0 text-xs ${it.status === 'done' ? 'font-semibold text-emerald-300' : isFailed ? 'font-semibold text-rose-300' : 'text-slate-400'}`}>
          {it.status === 'done' ? '✓ ' : ''}{statusLine(it)}
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
