'use client'

/** One authored case note (P3-03): author, time, edited marker, the pinned
 *  / command-only / legacy badges, and the actions the server allows —
 *  pin (author or command), restrict to command (command only), edit
 *  (author or command; draft key `note:<caseId>:<noteId>`), soft delete with
 *  undo (soft_delete kind case_note), and History over record_history
 *  (VersionViewer, body diffs through DiffView). Client checks are
 *  cosmetic; every write reads the refusal (42501 / zero rows). */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { deleteWithUndo, rpc, update } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { officerName } from '@/lib/profiles'
import { historyRows, versionChanges, type VersionRow } from '@/lib/recordHistory'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { VersionViewer, type VersionItem } from '@/components/shared/VersionViewer'
import { DiffView } from '@/components/sops/docDiff'
import { NoteEditor } from './NoteEditor'
import { writeRefusal } from './sectionShared'

export type NoteRow = Tables<'case_notes'>

export function NoteCard({ note, canManage, canRestrict, onChanged }: {
  note: NoteRow
  /** Author or command on a writable case — edit, pin, delete. */
  canManage: boolean
  /** Command on a writable case — the restrict-to-command toggle. */
  canRestrict: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const edited = Date.parse(note.updated_at) - Date.parse(note.created_at) > 2_000

  const patch = async (p: Partial<Pick<NoteRow, 'pinned' | 'restricted_to_command' | 'body_md'>>, done: string): Promise<boolean> => {
    const res = await update('case_notes', note.id, p)
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return false }
    toast(done, 'success')
    onChanged()
    return true
  }

  return (
    <li className={`rounded-lg border p-4 ${note.pinned ? 'border-amber-500/25 bg-amber-500/5' : 'border-white/10 bg-ink-950/50'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{officerName(note.author_id) || 'Officer'}</span>
        <time dateTime={note.created_at} title={fmtDateTime(note.created_at)}>{timeAgo(note.created_at)}</time>
        {edited && <span title={`Edited ${fmtDateTime(note.updated_at)}`}>· edited</span>}
        {note.pinned && <Badge tone="warn">Pinned</Badge>}
        {note.restricted_to_command && <Badge tone="danger" title="Only command, the Owner and the author can read this note">Command only</Badge>}
        {note.source === 'legacy' && <Badge tone="neutral" title="Copied from the retired cases.notes column">Migrated from the old working notes</Badge>}
      </div>
      {editing ? (
        <div className="mt-3">
          <NoteEditor
            draftKey={`note:${note.case_id}:${note.id}`}
            initial={note.body_md}
            submitLabel="Save note"
            onSubmit={async (body) => { const ok = await patch({ body_md: body }, 'Note saved.'); if (ok) setEditing(false); return ok }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="prose prose-invert mt-2 max-w-none text-sm text-slate-200">{renderMarkdown(note.body_md)}</div>
      )}
      {!editing && (canManage || canRestrict) && (
        <div className="mt-3 flex flex-wrap gap-1">
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="ghost" aria-pressed={note.pinned} onAction={() => patch({ pinned: !note.pinned }, note.pinned ? 'Note unpinned.' : 'Note pinned.')}>
                {note.pinned ? 'Unpin' : 'Pin'}
              </Button>
            </>
          )}
          {canRestrict && (
            <Button size="sm" variant="ghost" aria-pressed={note.restricted_to_command} onAction={() => patch({ restricted_to_command: !note.restricted_to_command }, note.restricted_to_command ? 'Note visible to the case team.' : 'Note restricted to command.')}>
              {note.restricted_to_command ? 'Unrestrict' : 'Restrict to command'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>History</Button>
          {canManage && (
            <Button
              size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200"
              onClick={() => void deleteWithUndo('case_notes', note, {
                confirmTitle: 'Delete note', confirmMessage: 'Move this note to the Trash? You can undo this for a few seconds.',
                confirmText: 'Delete note', label: 'note', after: onChanged,
              })}
            >
              Delete
            </Button>
          )}
        </div>
      )}
      {history && <NoteHistory noteId={note.id} onClose={() => setHistory(false)} />}
    </li>
  )
}

/* ── History modal — record_history('case_note', id) ─────────────────────── */
function NoteHistory({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    const res = await rpc('record_history', { p_kind: 'case_note', p_id: noteId })
    if (res.error) { setError(res.error.message); return }
    setRows(((res.data ?? []) as unknown as Array<Omit<VersionRow, 'old' | 'new'> & { old: unknown; new: unknown }>)
      .map((r) => ({ ...r, old: (r.old ?? {}) as Record<string, unknown>, new: (r.new ?? {}) as Record<string, unknown> })))
  }, [noteId])
  // Versions load when the modal opens (state lives with the modal).
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  const ordered = rows ? historyRows(rows) : []
  const items: VersionItem[] = ordered.map((v) => ({
    id: String(v.version_no), number: v.version_no, at: v.created_at, byName: officerName(v.actor_id),
    label: v.changed_fields.join(', ') + (v.burst ? ' · several saves' : ''),
  }))
  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Note history" onClose={onClose} />
        {error ? <ErrorNotice message={error} onRetry={() => void load()} />
          : rows === null ? <ListSkeleton count={3} />
          : (
            <VersionViewer
              versions={items}
              empty="No edits recorded yet — this is the note as first written."
              renderContent={(item) => {
                const v = ordered.find((x) => String(x.version_no) === item.id)
                if (!v) return null
                return (
                  <div className="space-y-2">
                    {versionChanges(v).map((ch) => ch.field === 'body_md' ? (
                      <DiffView key={ch.field} base={String(ch.from ?? '')} other={String(ch.to ?? '')} />
                    ) : (
                      <p key={ch.field} className="text-xs text-slate-300">
                        <span className="font-semibold">{ch.field}</span>: {String(ch.from ?? '—')} → {String(ch.to ?? '—')}
                      </p>
                    ))}
                    {v.reason && <p className="text-[11px] text-slate-400">Reason: {v.reason}</p>}
                  </div>
                )
              }}
            />
          )}
      </div>
    </Modal>
  )
}
