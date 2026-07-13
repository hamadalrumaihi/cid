'use client'

/** SOPs & Library — port of the vanilla doc engine (drive.js). Doc shelf for
 *  the SOPs + Resources folders (RLS folder guard makes them command-write-
 *  only; content also arrives via the sops-sync edge function — backend,
 *  unaffected by the rebuild). Reader renders through the shared safe
 *  mini-Markdown engine (lib/markdown — same renderer as case notes: pipe
 *  tables, status chips, note blocks). Editing captures a version snapshot
 *  first (documents_versions), with a history modal + restore. The
 *  structured roster form editor stays lean in v1 (raw text editing). */
import { useCallback, useEffect, useState } from 'react'
import type { Json, Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { renderMarkdown } from '@/lib/markdown'
import { RichEditor } from '@/components/ui/RichEditor'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { VersionViewer } from '@/components/shared/VersionViewer'

type DocRow = Tables<'documents'>
type VersionRow = Tables<'documents_versions'>

const SOP_FOLDER = 'SOPs'
const LIB_FOLDER = 'Resources'
const CARD_TAG: Record<string, string> = { [LIB_FOLDER]: 'LIBRARY', Personnel: 'ROSTER', 'Gang Intel': 'GANG INTEL' }
const READER_TAG: Record<string, string> = { [LIB_FOLDER]: 'Reference library document', Personnel: 'Division roster', 'Gang Intel': 'Gang intelligence document' }

const sopTitle = (d: DocRow) => d.name.replace(/\.(docx?|pdf|sheet)$/i, '')
const contentOf = (d: DocRow): Record<string, unknown> => (d.content && typeof d.content === 'object' && !Array.isArray(d.content) ? (d.content as Record<string, unknown>) : {})
const bodyOf = (d: DocRow): string => { const b = contentOf(d).body; return typeof b === 'string' ? b : '' }
const isSynced = (d: DocRow): boolean => { const s = contentOf(d).sync; return !!(s && typeof s === 'object' && (s as { source?: string }).source === 'gdrive') }
const versionBody = (v: VersionRow): string => { const c = v.content; if (c && typeof c === 'object' && !Array.isArray(c)) { const b = (c as Record<string, unknown>).body; if (typeof b === 'string') return b } return '' }

export function SopsView() {
  const { state, isCommand } = useAuth()
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reader, setReader] = useState<DocRow | null>(null)
  const [editor, setEditor] = useState<{ record: DocRow | null } | null>(null)
  const [history, setHistory] = useState<DocRow | null>(null)
  const version = useTableVersion('documents')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try { setDocs(await withRetry(() => list('documents', { order: 'name' }))) }
    catch {
      setDocs([])
      toast("Couldn't load the SOP library — check your connection.", 'danger')
    }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  if (state !== 'in') return <Notice text="Sign in to read division SOPs." />

  const sops = docs.filter((d) => d.folder === SOP_FOLDER)
  const lib = docs.filter((d) => d.folder === LIB_FOLDER)
  const shelf = [...sops, ...lib]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <PageHeader
          className="flex-1"
          title="📚 SOPs & Library"
          subtitle="Division policy & reference library, managed by command staff."
          actions={isCommand && (
            <button onClick={() => setEditor({ record: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              + New SOP
            </button>
          )}
        />
      </div>

      {loading && !shelf.length ? (
        <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
      ) : !shelf.length ? (
        <EmptyState
          icon="📚"
          title="No SOPs published yet"
          hint={isCommand ? 'Publish a division SOP or reference document to start the library.' : 'Command staff haven’t published any SOPs yet.'}
          action={isCommand ? { label: '+ New SOP', onClick: () => setEditor({ record: null }) } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shelf.map((d) => (
            <button key={d.id} onClick={() => setReader(d)} className="rounded-2xl border border-white/5 bg-ink-900/60 p-5 text-left transition hover:border-blue-500/30 hover:bg-white/5">
              <p className="text-sm font-semibold text-white">{sopTitle(d)}</p>
              <p className="mt-1 line-clamp-3 text-xs text-slate-400">{bodyOf(d).slice(0, 200) || 'No content yet.'}</p>
              <p className="t-readout mt-3 text-[10px] uppercase text-slate-500">{`${CARD_TAG[d.folder] ?? 'SOP'} // ${d.modified_label || 'undated'}`}</p>
            </button>
          ))}
        </div>
      )}

      {reader && (
        <ReaderModal
          d={reader}
          canManage={isCommand}
          onClose={() => setReader(null)}
          onEdit={() => { setEditor({ record: reader }); setReader(null) }}
          onHistory={() => { setHistory(reader); setReader(null) }}
          onDeleted={() => { setReader(null); void refresh() }}
        />
      )}
      {editor && <EditorModal record={editor.record} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
      {history && <HistoryModal d={history} canManage={isCommand} onClose={() => setHistory(null)} onRestored={() => { setHistory(null); void refresh() }} />}
    </div>
  )
}

function ReaderModal({ d, canManage, onClose, onEdit, onHistory, onDeleted }: {
  d: DocRow
  canManage: boolean
  onClose: () => void
  onEdit: () => void
  onHistory: () => void
  onDeleted: () => void
}) {
  const del = async () => {
    if (!(await uiConfirm(`Delete SOP “${d.name}”? Restorable via Undo.`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('documents', d, { label: `SOP “${d.name}”`, noConfirm: true, after: onDeleted })
  }
  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={sopTitle(d)} onClose={onClose} />
      <p className="t-readout mb-3 text-[10px] uppercase tracking-widest text-slate-500">
        {`${READER_TAG[d.folder] ?? 'Standard operating procedure'} // ${d.modified_label || 'undated'}`}
        {isSynced(d) && ' // SYNCED FROM GOOGLE DRIVE'}
      </p>
      <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-white/5 bg-ink-900 p-6">
        {renderMarkdown(bodyOf(d))}
      </div>
      {canManage && (
        <div className="mt-4 flex gap-2">
          <button onClick={onEdit} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Edit</button>
          <button onClick={onHistory} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-blue-200 transition hover:bg-white/10">History</button>
          <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
        </div>
      )}
    </Modal>
  )
}

function EditorModal({ record, onClose, onSaved }: { record: DocRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(record?.name ?? '')
  const [body, setBody] = useState(record ? bodyOf(record) : '')
  const [busy, setBusy] = useState(false)
  const synced = record ? isSynced(record) : false

  const dirty = () => name !== (record?.name ?? '') || body !== (record ? bodyOf(record) : '')

  const save = async () => {
    const n = name.trim()
    if (!n) { toast('A title is required.', 'warn'); return }
    if (!body.trim()) { toast('Procedure text is required.', 'warn'); return }
    setBusy(true)
    // Snapshot the CURRENT server copy before overwriting (vanilla
    // captureDocVersion) so History can restore it.
    if (record) {
      await insert('documents_versions', {
        document_id: record.id, name: record.name, kind: record.kind,
        content: record.content, modified_label: record.modified_label,
      }).catch?.(() => null)
    }
    const content = { ...(record ? contentOf(record) : {}), body } as Json
    const payload = {
      folder: record?.folder ?? SOP_FOLDER,
      name: n,
      kind: 'doc' as DocRow['kind'],
      content,
      modified_label: new Date().toLocaleDateString('en-GB'),
    }
    const res = record ? await update('documents', record.id, payload) : await insert('documents', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'SOP updated' : 'SOP published', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} wide dirty={dirty}>
      <ModalHeader title={record ? 'Edit SOP' : 'New SOP'} onClose={onClose} />
      {synced && <p className="t-readout mb-3 text-[10px] uppercase tracking-widest text-amber-400/80">SYNCED FROM GOOGLE DRIVE // THE NEXT DRIVE EDIT OVERWRITES PORTAL CHANGES</p>}
      <label htmlFor="sop-title" className="mb-1 block text-xs font-semibold text-slate-400">Title *</label>
      <input id="sop-title" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Use of Force Policy" className="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
      <label className="mb-1 block text-xs font-semibold text-slate-400">Procedure text * <span className="font-normal text-slate-400">(Markdown: # headings, **bold**, &gt; notes, lists, | tables |)</span></label>
      <RichEditor value={body} onChange={setBody} minHeight="22rem" />
      <button onClick={() => void save()} disabled={busy} className="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
        {record ? 'Save changes' : 'Publish SOP'}
      </button>
    </Modal>
  )
}

function HistoryModal({ d, canManage, onClose, onRestored }: { d: DocRow; canManage: boolean; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)

  useEffect(() => {
    const t = window.setTimeout(async () => {
      try { setVersions(await list('documents_versions', { order: 'saved_at', ascending: false, eq: { document_id: d.id } })) }
      catch { setVersions([]) }
    }, 0)
    return () => window.clearTimeout(t)
  }, [d.id])

  const restore = async (v: VersionRow) => {
    if (!(await uiConfirm('Restore this version? The current text is snapshotted first.', { confirmText: 'Restore' }))) return
    // Snapshot current, then overwrite with the chosen version (vanilla flow).
    await insert('documents_versions', { document_id: d.id, name: d.name, kind: d.kind, content: d.content, modified_label: d.modified_label })
    const res = await update('documents', d.id, { name: v.name ?? d.name, kind: v.kind ?? d.kind, content: v.content, modified_label: new Date().toLocaleDateString('en-GB') })
    if (res.error) { toast(`Restore failed: ${res.error.message}`, 'danger'); return }
    toast('Version restored', 'success')
    onRestored()
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title={`History — ${sopTitle(d)}`} onClose={onClose} />
      {!versions ? (
        <p className="text-sm text-slate-400">Loading versions…</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <VersionViewer
            versions={versions.map((v, i) => ({ id: v.id, number: versions.length - i, label: v.name ?? d.name, at: v.saved_at, byName: officerName(v.saved_by) ?? 'Unknown' }))}
            empty="No saved versions yet — a snapshot is captured each time the document is edited."
            renderContent={(item) => {
              const v = versions.find((x) => x.id === item.id)
              return v ? renderMarkdown(versionBody(v)) : null
            }}
            actions={canManage ? (item) => {
              const v = versions.find((x) => x.id === item.id)
              return v ? (
                <button onClick={() => void restore(v)} className="flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">
                  Restore
                </button>
              ) : null
            } : undefined}
          />
        </div>
      )}
    </Modal>
  )
}
