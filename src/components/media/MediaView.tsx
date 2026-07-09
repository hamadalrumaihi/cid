'use client'

/** Media Vault — port of the vanilla vault (personnel.js media section).
 *  Universal media-to-case intake: filter chips (all/by-case/by-gang/preset
 *  tags), thumbnail cards with tag chips, lightbox preview, "forward to
 *  case", tag editing, and the ingest modal with FiveManage upload (or
 *  paste-a-URL fallback when the key isn't configured). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Json, Tables } from '@/lib/database.types'
import { insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { parseFormValues, parseStringArray } from '@/lib/jsonShapes'

type MediaRow = Tables<'media'>
interface CaseOption { id: string; case_number: string }
interface GangOption { id: string; name: string }

const PRESET_TAGS = ['Mugshot', 'Scene', 'Weapon', 'Surveillance', 'Document', 'Vehicle', 'Evidence']
const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500'
const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

const mediaSrc = (m: MediaRow) => m.external_url || m.storage_path || ''
const tagsOf = (m: MediaRow): Record<string, unknown> => parseFormValues(m.tags)
const labelsOf = (m: MediaRow): string[] => parseStringArray(tagsOf(m).labels)
const parseTags = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]

export function MediaView() {
  const { state, canEdit } = useAuth()
  const router = useRouter()
  const [media, setMedia] = useState<MediaRow[]>([])
  const [cases, setCases] = useState<CaseOption[]>([])
  const [gangs, setGangs] = useState<GangOption[]>([])
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState<MediaRow | null>(null)
  const [tagEdit, setTagEdit] = useState<MediaRow | null>(null)
  const [forward, setForward] = useState<MediaRow | null>(null)
  const [ingest, setIngest] = useState(false)
  const version = useTableVersion('media')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try {
      const [m, cs, gs] = await Promise.all([
        withRetry(() => list('media', { order: 'created_at', ascending: false })),
        list('cases', { select: 'id,case_number', order: 'case_number' }).catch(() => [] as Tables<'cases'>[]),
        list('gangs', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'gangs'>[]),
      ])
      setMedia(m)
      setCases(cs as unknown as CaseOption[])
      setGangs(gs as unknown as GangOption[])
    } catch { toast('Could not load the media vault — check your connection.', 'danger') }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const caseNum = useCallback((id: string | null) => cases.find((c) => c.id === id)?.case_number ?? null, [cases])
  const gangName = useCallback((id: string | null) => gangs.find((g) => g.id === id)?.name ?? null, [gangs])

  const items = useMemo(() => media.filter((m) => {
    if (filter === 'all') return true
    if (filter === 'case') return !!m.case_id
    if (filter === 'gang') return !!m.gang_id
    if (filter.startsWith('tag:')) {
      const want = filter.slice(4).toLowerCase()
      if (labelsOf(m).some((l) => l.toLowerCase() === want)) return true
      if (want === 'mugshot' && tagsOf(m).person) return true // legacy mugshots
      return false
    }
    return !!tagsOf(m)[filter]
  }), [media, filter])

  if (state !== 'in') return <Notice text="Sign in to view the evidence vault." />

  const chips: [string, string][] = [['all', 'All'], ['case', 'By Case'], ['gang', 'By Gang'], ...PRESET_TAGS.map((t) => [`tag:${t}`, `🏷️ ${t}`] as [string, string])]

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {chips.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === k ? 'border-badge-500 bg-blue-500/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {l}
            </button>
          ))}
        </div>
        {canEdit && (
          <button onClick={() => setIngest(true)} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            + Ingest Media
          </button>
        )}
      </div>

      {!items.length ? (
        <Notice text={media.length ? 'No assets match this filter.' : `No media yet.${canEdit ? ' Use “+ Ingest Media”.' : ''}`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <MediaCard
              key={m.id}
              m={m}
              canEdit={canEdit}
              caseNum={caseNum}
              gangName={gangName}
              onOpen={() => setLightbox(m)}
              onCase={(cid) => router.push(`/cases?case=${cid}`)}
              onForward={() => setForward(m)}
              onTags={() => setTagEdit(m)}
            />
          ))}
        </div>
      )}

      {lightbox && <Lightbox m={lightbox} caseNum={caseNum} gangName={gangName} onClose={() => setLightbox(null)} />}
      {tagEdit && <TagsModal m={tagEdit} onClose={() => setTagEdit(null)} onSaved={() => { setTagEdit(null); void refresh() }} />}
      {forward && (
        <ForwardModal
          m={forward}
          cases={cases}
          onClose={() => setForward(null)}
          onDone={(cn) => { setForward(null); toast(`"${forward.title}" forwarded → ${cn}`, 'success'); void refresh() }}
        />
      )}
      {ingest && <IngestModal cases={cases} gangs={gangs} onClose={() => setIngest(false)} onSaved={() => { setIngest(false); void refresh() }} />}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}

function TagChips({ m, caseNum, gangName, onCase }: { m: MediaRow; caseNum: (id: string | null) => string | null; gangName: (id: string | null) => string | null; onCase?: (cid: string) => void }) {
  const t = tagsOf(m)
  const cn = caseNum(m.case_id)
  const gn = gangName(m.gang_id)
  return (
    <>
      {cn && m.case_id && (
        <button onClick={(e) => { e.stopPropagation(); onCase?.(m.case_id!) }} className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-300 transition hover:bg-blue-500/20 hover:text-white" title={`Open ${cn}`}>
          {cn}
        </button>
      )}
      {gn && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">🚩 {gn}</span>}
      {!!t.location && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">📍 {String(t.location)}</span>}
      {!!t.person && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">👤 {String(t.person)}</span>}
      {labelsOf(m).map((l) => <span key={l} className="rounded bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300">🏷️ {l}</span>)}
    </>
  )
}

function MediaCard({ m, canEdit, caseNum, gangName, onOpen, onCase, onForward, onTags }: {
  m: MediaRow
  canEdit: boolean
  caseNum: (id: string | null) => string | null
  gangName: (id: string | null) => string | null
  onOpen: () => void
  onCase: (cid: string) => void
  onForward: () => void
  onTags: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const src = mediaSrc(m)
  const safe = safeUrl(src)
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
      {m.type === 'image' && safe && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- external evidence URL
        <img src={safe} alt={m.title} onError={() => setImgFailed(true)} onClick={onOpen} className="h-40 w-full cursor-zoom-in object-cover" />
      ) : m.type === 'video' ? (
        <button onClick={onOpen} className="flex h-40 w-full items-center justify-center bg-ink-800 text-4xl" aria-label={`Preview ${m.title}`}>🎬</button>
      ) : (
        <button onClick={onOpen} className="flex h-40 w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-ink-800 to-ink-700" aria-label={`Preview ${m.title}`}>
          <span className="text-3xl" aria-hidden>📡</span>
          <span className="max-w-full truncate px-3 font-mono text-[10px] text-slate-400">{src || 'fivemanage'}</span>
        </button>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-semibold text-white">{m.title}</p>
          <span className="ml-2 flex-shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{m.kind || m.type}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1"><TagChips m={m} caseNum={caseNum} gangName={gangName} onCase={onCase} /></div>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={onForward} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition hover:bg-white/10">↗ Forward to Case</button>
            <button onClick={onTags} title="Edit tags" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-fuchsia-200 transition hover:bg-white/10">🏷️</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Lightbox({ m, caseNum, gangName, onClose }: { m: MediaRow; caseNum: (id: string | null) => string | null; gangName: (id: string | null) => string | null; onClose: () => void }) {
  const src = mediaSrc(m)
  const safe = safeUrl(src)
  const isVid = m.type === 'video' || /\.(mp4|webm|mov|m4v)($|\?)/i.test(src)
  // media_type enum has no 'audio' member — detect by extension only.
  const isAud = /\.(mp3|wav|ogg|m4a)($|\?)/i.test(src)
  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={m.title} onClose={onClose} />
      {!safe ? (
        <div className="flex h-64 items-center justify-center rounded-lg bg-ink-800 text-5xl" aria-hidden>📡</div>
      ) : m.type === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- external evidence URL
        <img src={safe} alt={m.title} className="max-h-[70vh] w-full rounded-lg object-contain" />
      ) : isVid ? (
         
        <video src={safe} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black" />
      ) : isAud ? (
         
        <div className="rounded-lg bg-ink-800 p-6"><audio src={safe} controls autoPlay className="w-full" /></div>
      ) : (
        <iframe src={safe} title={m.title} className="h-[70vh] w-full rounded-lg bg-black" />
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1"><TagChips m={m} caseNum={caseNum} gangName={gangName} /></div>
        {safe && <a href={safe} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-xs text-blue-300 underline">Open ↗</a>}
      </div>
    </Modal>
  )
}

/* ---- Tags field (input + preset chips), shared by ingest + edit ---------- */

function TagsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const addPreset = (t: string) => {
    const set = parseTags(value)
    if (!set.some((s) => s.toLowerCase() === t.toLowerCase())) set.push(t)
    onChange(set.join(', '))
  }
  return (
    <div>
      <label className={labelCls}>Tags</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Mugshot, Scene, Weapon…" className={inputCls} />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PRESET_TAGS.map((t) => (
          <button key={t} type="button" onClick={() => addPreset(t)} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-white/10">
            + {t}
          </button>
        ))}
      </div>
    </div>
  )
}

function TagsModal({ m, onClose, onSaved }: { m: MediaRow; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(labelsOf(m).join(', '))
  const save = async () => {
    // Preserve the other tag keys (location/person); only rewrite `labels`.
    const tags = { ...tagsOf(m), labels: parseTags(value) }
    const res = await update('media', m.id, { tags: tags as Json })
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Tags updated', 'success')
    onSaved()
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Edit Tags" onClose={onClose} />
      <p className="mb-3 truncate text-xs text-slate-400">{m.title || 'Untitled'}</p>
      <TagsField value={value} onChange={setValue} />
      <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save tags</button>
    </Modal>
  )
}

function ForwardModal({ m, cases, onClose, onDone }: { m: MediaRow; cases: CaseOption[]; onClose: () => void; onDone: (cn: string) => void }) {
  const send = async (c: CaseOption) => {
    const res = await update('media', m.id, { case_id: c.id })
    if (res.error) { toast(`Forward failed: ${res.error.message}`, 'danger'); return }
    onDone(c.case_number)
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Forward to Case" onClose={onClose} />
      <p className="mb-3 truncate text-xs text-slate-400">{m.title}</p>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        {cases.length ? cases.map((c) => (
          <button key={c.id} onClick={() => void send(c)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-blue-500/15 hover:text-white">
            <span className="font-mono">{c.case_number}</span>
          </button>
        )) : <p className="px-3 py-2 text-xs text-slate-500">No cases</p>}
      </div>
    </Modal>
  )
}

function IngestModal({ cases, gangs, onClose, onSaved }: { cases: CaseOption[]; gangs: GangOption[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('image')
  const [src, setSrc] = useState('')
  const [caseId, setCaseId] = useState('')
  const [gangId, setGangId] = useState('')
  const [location, setLocation] = useState('')
  const [person, setPerson] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const out = await fmUpload(file)
      setSrc(out.url)
      setType(out.kind === 'video' ? 'video' : out.kind === 'audio' ? 'fivemanage' : 'image')
      if (!title) setTitle(file.name.replace(/\.[a-z0-9]+$/i, ''))
      toast('Uploaded to FiveManage', 'success')
    } catch (e) {
      toast(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, 'danger')
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (!title.trim()) { toast('A title is required.', 'warn'); return }
    setBusy(true)
    const kind = type === 'image' ? 'Image URL' : type === 'video' ? 'MP4 Video' : 'FiveManage Embed'
    const res = await insert('media', {
      title: title.trim(),
      type: (type === 'fivemanage' ? 'fivemanage' : type) as MediaRow['type'],
      kind,
      external_url: src.trim() || null,
      case_id: caseId || null,
      gang_id: gangId || null,
      tags: { location: location.trim(), person: person.trim(), labels: parseTags(tags) } as Json,
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Media ingested into vault', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(title || src)}>
      <ModalHeader title="Ingest Media Asset" onClose={onClose} />
      <div className="space-y-3">
        <div><label className={labelCls}>Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dashcam — Vinewood pursuit" className={inputCls} /></div>
        <div>
          <label className={labelCls}>Source Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="image">Direct Image URL</option>
            <option value="video">MP4 Video Link</option>
            <option value="fivemanage">FiveManage CDN Embed</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>URL / Embed ID</label>
          <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://… or fm_xxxxx" className={`${inputCls} font-mono text-xs`} />
          {fmConfigured() ? (
            <div className="mt-1.5">
              <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-white/10 disabled:opacity-60">
                {uploading ? 'Uploading…' : '📤 Upload a file instead (FiveManage)'}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-slate-500">File upload not configured (NEXT_PUBLIC_FIVEMANAGE_API_KEY) — paste a URL.</p>
          )}
        </div>
        <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Evidence Tags</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Case</label>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Gang</label>
            <select value={gangId} onChange={(e) => setGangId(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Area / place" className={inputCls} /></div>
          <div><label className={labelCls}>Person (mugshot)</label><input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Subject name" className={inputCls} /></div>
        </div>
        <TagsField value={tags} onChange={setTags} />
      </div>
      <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
        Add to Vault
      </button>
    </Modal>
  )
}
