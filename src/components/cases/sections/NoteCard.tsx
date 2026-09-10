'use client'

/** One authored case note (P3-03): author, time, edited marker, the pinned
 *  / command-only / legacy badges, and the actions the server allows —
 *  pin (author or command), restrict to command (command only), edit
 *  (author or command; draft key `note:<caseId>:<noteId>`), soft delete with
 *  undo (soft_delete kind case_note — the Trash keeps it), and History over
 *  record_history (shared RecordHistory: body diffs, compare, restore).
 *  Client checks are cosmetic; every write reads the refusal (42501 / zero
 *  rows). */
import { useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { update } from '@/lib/db'
import { deleteRecord } from '@/lib/deleteRecord'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { RecordHistory } from '@/components/shared/RecordHistory'
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
              onClick={() => void deleteRecord('case_notes', note, {
                confirmTitle: 'Delete note', confirmMessage: 'Move this note to the Trash? You can undo this from the toast or the Trash.',
                confirmText: 'Delete note', label: 'note', after: onChanged,
              })}
            >
              Delete
            </Button>
          )}
        </div>
      )}
      {history && <NoteHistory noteId={note.id} canManage={canManage} onClose={() => setHistory(false)} onChanged={onChanged} />}
    </li>
  )
}

/* ── History modal — RecordHistory kind="case_note" (P8-04) ─────────────── */
function NoteHistory({ noteId, canManage, onClose, onChanged }: { noteId: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Note history" onClose={onClose} />
        {/* canManage is the local edit mirror (author or command on a writable
            case); restore_version re-checks edit authority server-side. */}
        <RecordHistory kind="case_note" id={noteId} canRestore={canManage ? undefined : false} onRestored={onChanged} fieldLabels={{ body_md: 'Note' }} />
      </div>
    </Modal>
  )
}
