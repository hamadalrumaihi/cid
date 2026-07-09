'use client'

/** Case Files — Attachments — port of vanilla casefiles.js §ATTACHMENTS.
 *  Files upload to FiveManage; their URL + metadata live in `case_files`
 *  keyed by case_number (RLS: read = case bureau via can_access_case_number,
 *  insert stamps added_by, delete = command). Grouped by case, inline
 *  preview per type, multi-file attach. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState } from '@/components/ui/Notice'

type FileRow = Tables<'case_files'>

const CF_ICON: Record<string, string> = { image: '🖼️', video: '🎬', audio: '🔊', pdf: '📄', file: '📎' }

function cfKind(f: FileRow): string {
  const m = (f.mime_type ?? '').toLowerCase()
  if (m.startsWith('image')) return 'image'
  if (m.startsWith('video')) return 'video'
  if (m.startsWith('audio')) return 'audio'
  if (m.includes('pdf') || /\.pdf($|\?)/i.test(f.web_view_link ?? '')) return 'pdf'
  return 'file'
}

export function CaseFilesView() {
  const { state, profile, canDelete } = useAuth()
  const [files, setFiles] = useState<FileRow[]>([])
  const [caseNumbers, setCaseNumbers] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [caseNo, setCaseNo] = useState('')
  const [preview, setPreview] = useState<FileRow | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const version = useTableVersion('case_files')
  const fmReady = fmConfigured()

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try {
      const [rows, cs] = await Promise.all([
        withRetry(() => list('case_files', { order: 'case_number' })),
        list('cases', { select: 'id,case_number', order: 'case_number' }).catch(() => [] as Tables<'cases'>[]),
      ])
      setFiles(rows)
      const nums = new Set<string>()
      for (const c of cs as unknown as { case_number: string }[]) if (c.case_number) nums.add(c.case_number)
      for (const r of rows) if (r.case_number) nums.add(r.case_number)
      setCaseNumbers([...nums].sort())
    } catch {
      setFiles([])
      toast("Couldn't load case files — check your connection.", 'danger')
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = files.filter((r) => !q || r.case_number.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    const by: Record<string, FileRow[]> = {}
    for (const r of rows) (by[r.case_number] = by[r.case_number] ?? []).push(r)
    return Object.entries(by).sort(([a], [b]) => a.localeCompare(b))
  }, [files, query])

  const attach = () => {
    if (!caseNo.trim()) { toast('Enter or pick a case number first.', 'warn'); return }
    if (!fmReady) { toast('FiveManage upload is not configured.', 'warn'); return }
    fileRef.current?.click()
  }

  const onFiles = async (picked: FileList | null) => {
    const cn = caseNo.trim()
    const arr = [...(picked ?? [])]
    if (!cn || !arr.length) return
    setUploading(true)
    let ok = 0
    for (const f of arr) {
      try {
        const out = await fmUpload(f)
        // drive_file_id is NOT NULL (legacy Drive column repurposed as the
        // file's unique id; unique per case) — vanilla inserted null here and
        // would fail. Use the FiveManage URL: unique per uploaded file.
        const res = await insert('case_files', { case_number: cn, drive_file_id: out.url, name: f.name, mime_type: f.type || null, web_view_link: out.url, added_by: profile?.id ?? null })
        if (res.error) throw new Error(res.error.message)
        ok++
      } catch (e) {
        toast(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, 'danger')
      }
    }
    setUploading(false)
    if (ok) { toast(`${ok} file${ok === 1 ? '' : 's'} attached to ${cn}`, 'success'); void refresh() }
  }

  const rm = async (f: FileRow) => {
    if (!(await uiConfirm('Remove this attachment from the case? The uploaded file link is discarded.', { confirmText: 'Remove' }))) return
    const res = await remove('case_files', f.id)
    if (res.error) { toast(`Remove failed: ${res.error.message}`, 'danger'); return }
    toast('Attachment removed', 'info')
    void refresh()
  }

  if (state !== 'in') return <Notice text="Sign in to view and attach case files." />

  return (
    <div>
      {!fmReady && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          File upload not configured — set <code>NEXT_PUBLIC_FIVEMANAGE_API_KEY</code> to upload files. Existing attachments are still listed below.
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          list="cf-case-list"
          value={caseNo}
          onChange={(e) => setCaseNo(e.target.value)}
          placeholder="Case number (e.g. SAB-9000026)"
          aria-label="Case number"
          className="w-72 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
        />
        <datalist id="cf-case-list">{caseNumbers.map((n) => <option key={n} value={n} />)}</datalist>
        <button onClick={attach} disabled={uploading} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {uploading ? 'Uploading…' : '📎 Attach file'}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by case or filename…"
          aria-label="Filter attachments"
          className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-badge-500"
        />
      </div>

      {!grouped.length ? (
        files.length ? (
          <Notice text="No files match your filter." />
        ) : (
          <EmptyState
            icon="🗂️"
            title="No case files attached yet"
            hint="Pick a case number above and use “Attach file” to upload evidence to a case."
          />
        )
      ) : (
        <div className="space-y-4">
          {grouped.map(([cn, rows]) => (
            <div key={cn} className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg" aria-hidden>🗂️</span>
                <h3 className="font-mono text-sm font-semibold text-blue-300">{cn}</h3>
                <span className="text-[11px] text-slate-400">{rows.length} file{rows.length === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rows.map((f) => {
                  const k = cfKind(f)
                  return (
                    <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
                      <button onClick={() => setPreview(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm text-slate-200 hover:text-white">
                        {k === 'image' && safeUrl(f.web_view_link) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- uploaded attachment
                          <img src={safeUrl(f.web_view_link)} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                        ) : (
                          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded bg-ink-800 text-lg" aria-hidden>{CF_ICON[k]}</span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{f.name}</span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500">{k} · preview</span>
                        </span>
                      </button>
                      {canDelete && (
                        <button onClick={() => void rm(f)} title="Remove attachment" aria-label="Remove attachment" className="-m-1 flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10">✕</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && <PreviewModal f={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function PreviewModal({ f, onClose }: { f: FileRow; onClose: () => void }) {
  const k = cfKind(f)
  const url = safeUrl(f.web_view_link)
  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={<>{CF_ICON[k]} {f.name}</>} onClose={onClose} />
      {!url ? (
        <div className="flex h-48 items-center justify-center rounded-lg bg-ink-800 text-sm text-slate-300">No preview available.</div>
      ) : k === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded attachment
        <img src={url} alt={f.name} className="max-h-[72vh] w-full rounded-lg object-contain" />
      ) : k === 'video' ? (
         
        <video src={url} controls autoPlay playsInline className="max-h-[72vh] w-full rounded-lg bg-black" />
      ) : k === 'audio' ? (
         
        <div className="rounded-lg bg-ink-800 p-6"><audio src={url} controls autoPlay className="w-full" /></div>
      ) : k === 'pdf' ? (
        <iframe src={url} title={f.name} className="h-[72vh] w-full rounded-lg bg-white" />
      ) : (
        <div className="flex h-48 items-center justify-center rounded-lg bg-ink-800 text-sm text-slate-300">No inline preview for this type.</div>
      )}
      {url && (
        <div className="mt-3 text-right">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 underline">Open original ↗</a>
        </div>
      )}
    </Modal>
  )
}

