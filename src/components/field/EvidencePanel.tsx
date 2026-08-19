'use client'

/** Attach evidence to a draft report.
 *
 *  Two ways in, because officers have evidence in two shapes. A screenshot on
 *  the machine gets uploaded into the private `field-evidence` bucket. A Medal
 *  clip is a page on medal.tv, not a file — so it is kept as a link, exactly as
 *  pasted, and never exported and re-uploaded.
 *
 *  Nothing here is a security control. The storage policies decide who may put
 *  bytes in the bucket and who may read them, and both derive from the
 *  submission's own ownership rules — see the migration. This component only
 *  tries to fail politely before a 50 MB upload runs and then gets rejected.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import {
  attachLink, attachUpload, detachEvidence, evidenceLabel, evidenceUrl,
  loadEvidence, looksLikeMedal, urlProblem, type FieldEvidenceRow,
} from '@/lib/fieldEvidence'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'

export function EvidencePanel({ submissionId }: { submissionId: string }) {
  const [rows, setRows] = useState<FieldEvidenceRow[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setRows(await loadEvidence(submissionId))
  }, [submissionId])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    // Sequential rather than parallel: a patrol connection uploading four
    // clips at once tends to lose all four rather than three.
    let failures = 0
    for (const file of Array.from(files)) {
      const err = await attachUpload(submissionId, file)
      if (err) { failures += 1; toast(`${file.name}: ${err}`, 'danger') }
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    await refresh()
    if (!failures) toast('Attached.', 'success')
  }

  const onLink = async () => {
    const problem = urlProblem(url)
    if (problem) { toast(problem, 'warn'); return }
    setBusy(true)
    const err = await attachLink(submissionId, url)
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setUrl('')
    await refresh()
    toast('Link attached.', 'success')
  }

  /** Check you attached the right thing. An upload resolves to a short-lived
   *  signed URL — the bucket is private, so there is no permanent address to
   *  link to and none is invented here. */
  const onOpen = async (e: FieldEvidenceRow) => {
    const href = await evidenceUrl(e)
    if (!href) { toast('That attachment could not be opened.', 'danger'); return }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const onRemove = async (e: FieldEvidenceRow) => {
    const err = await detachEvidence(e)
    if (err) { toast(err, 'danger'); return }
    await refresh()
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Evidence</h3>
      <p className="mt-1 text-xs text-slate-500">
        Screenshots, photos, clips or documents. Paste a Medal link rather than
        exporting the clip — the link is kept as-is and plays for the investigator.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Upload a file" hint="Images, MP4/WebM/MOV or PDF, up to 50 MB each.">
          {(id) => (
            <input
              id={id} ref={fileRef} type="file" multiple disabled={busy}
              accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf"
              onChange={(e) => void onFiles(e.target.files)}
              className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white"
            />
          )}
        </Field>
        <Field label="Or paste a link" hint="Medal, or any other hosted image or video.">
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} value={url} disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://medal.tv/clips/…" />
              <Button size="sm" variant="ghost" disabled={busy || !url.trim()}
                onClick={() => void onLink()}>Attach</Button>
            </div>
          )}
        </Field>
      </div>

      {url.trim() && looksLikeMedal(url) && (
        <p className="mt-2 text-xs text-blue-300">
          Recognised as a Medal clip — it will be shown to the investigator as a video.
        </p>
      )}
      {busy && <p className="mt-2 text-xs text-slate-400">Uploading…</p>}

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-200">
                {evidenceLabel(e)}
                <span className="ml-2 text-[11px] uppercase tracking-wider text-slate-500">
                  {e.kind === 'upload' ? 'file' : e.is_medal ? 'medal' : 'link'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <button onClick={() => void onOpen(e)}
                  className="text-xs font-semibold text-blue-300 hover:text-blue-200">
                  Open
                </button>
                <button onClick={() => void onRemove(e)}
                  className="text-xs font-semibold text-rose-300 hover:text-rose-200">
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
