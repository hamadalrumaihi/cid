'use client'

/** NotesSection — the case's authored notes (P3-03, decision CW5): one row
 *  per note in `case_notes`, pinned first then newest, with a composer whose
 *  draft survives navigation (`note:<caseId>`) and @mentions that notify
 *  through `case_note_mention` once the row exists. The legacy working
 *  notes arrive as a `source='legacy'` note (badge). A note restricted to
 *  command never reaches a non-command reader — RLS keeps the row out of the
 *  result, so nothing here needs to hide anything. Realtime: the
 *  case-scoped `case_notes` channel (P3-08). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { insert, list, rpc } from '@/lib/db'
import { usePermissions } from '@/lib/permissions'
import { useProfilesStore } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import type { CaseRow } from '../tabs/shared'
import { NoteCard, type NoteRow } from './NoteCard'
import { NoteEditor } from './NoteEditor'
import { orderNotes, writeRefusal } from './sectionShared'
import { useTabDirty } from '@/components/workspace/WorkspaceProvider'

export function NotesSection({ c, canEdit }: { c: CaseRow; canEdit: boolean }) {
  useTabDirty(`note:${c.id}`) // workspace tab dot while a new-note draft is flushing
  const { profile } = useAuth()
  const { perms } = usePermissions()
  const isCommand = perms.access_class === 'command' || perms.access_class === 'owner'
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const v = useCaseTableVersion('case_notes', c.id)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchRoster = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchRoster() }, [rosterLoaded, fetchRoster])

  const refresh = useCallback(async () => {
    try {
      setNotes(await list('case_notes', { eq: { case_id: c.id }, order: 'created_at', ascending: false }))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const ordered = useMemo(() => (notes ? orderNotes(notes) : []), [notes])

  const add = async (body: string, mentionIds: string[]): Promise<boolean> => {
    const res = await insert('case_notes', { case_id: c.id, author_id: profile?.id ?? null, body_md: body })
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return false }
    const id = res.data?.[0]?.id
    if (id && mentionIds.length) {
      const m = await rpc('case_note_mention', { p_note: id, p_user_ids: mentionIds })
      const sent = (m.data as { ok?: boolean; sent?: number } | null)?.sent ?? 0
      if (m.error) toast('Note saved, but the mentions could not be sent.', 'warn')
      else toast(sent ? `Note added · ${sent} member${sent === 1 ? '' : 's'} notified.` : 'Note added.', 'success')
    } else toast('Note added.', 'success')
    void refresh()
    return true
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card pad="sm">
          <h3 className="mb-2 text-[13px] font-semibold text-white">Add a note</h3>
          <NoteEditor draftKey={`note:${c.id}`} submitLabel="Add note" onSubmit={add} label="New note" />
        </Card>
      )}
      <section aria-label="Case notes" aria-live="polite">
        {error ? (
          <ErrorNotice message={error} onRetry={() => void refresh()} />
        ) : notes === null ? (
          <ListSkeleton count={3} />
        ) : ordered.length === 0 ? (
          <EmptyState title="No notes yet" hint={canEdit ? 'Add the first note above — pinned notes stay on top.' : undefined} />
        ) : (
          <ul className="space-y-3">
            {ordered.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                canManage={canEdit && (n.author_id === profile?.id || isCommand)}
                canRestrict={canEdit && isCommand}
                onChanged={() => void refresh()}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
