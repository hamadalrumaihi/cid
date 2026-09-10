/** "Deleted — Undo · In Trash" (Phase 8, P8-02) — the ONE delete helper for
 *  soft-deletable tables, replacing the vanilla-era deleteWithUndo and its
 *  snapshot-and-reinsert branch. Every table here soft-deletes through the
 *  `soft_delete` RPC (SOFT_DELETE_KIND), so nothing is snapshotted: the row
 *  stays in the database, the Trash lists it, and Undo is `restore_record`
 *  — which is why Undo keeps working after the toast is gone (open /trash).
 *
 *  Sequence: confirm (unless the caller already did) → reason prompt for the
 *  kinds the server requires one for (REASON_REQUIRED) → soft_delete per row
 *  → `after()` → one toast carrying Undo and an "Open Trash" link. Refusals
 *  come back as `{ok:false, code}` from the RPC and are shown as the
 *  server phrased them; a `denied` is silent per row and summarised.
 *
 *  Tables that do NOT soft-delete (case_templates, commendations,
 *  case_assignments) are not accepted — those call sites use a plain
 *  confirmed remove() / update() and say so in their copy. */
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { REASON_REQUIRED, SOFT_DELETE_KIND, restoreRecord, softDeleteRecord, type SoftDeleteTable } from './db'
import { toast, undoToast } from './toast'
import { bumpTrash } from './trash'

export interface DeleteRecordOptions {
  /** Noun for the dialogs and the toast ("task", `Person "Ana"`, "3 gangs"). */
  label?: string
  /** Confirm dialog heading (e.g. "Delete task"). */
  confirmTitle?: string
  /** Override the confirm body with a message that names exactly what is
   *  being removed. Falls back to the generic "Move {label} to the Trash?". */
  confirmMessage?: string
  /** Confirm button label (e.g. "Delete task"). */
  confirmText?: string
  /** Callers that already showed their own uiConfirm pass true. */
  noConfirm?: boolean
  /** Runs after the delete and again after an Undo (refresh the list). */
  after?: () => void
}

export const TRASH_LINK = { label: 'Open Trash', href: '/trash' } as const

/** Soft-delete one row or several. Resolves true when at least one row was
 *  deleted, false when the user cancelled or every row was refused. */
export async function deleteRecord(
  table: SoftDeleteTable,
  rows: { id: string } | ReadonlyArray<{ id: string }>,
  opts: DeleteRecordOptions = {},
): Promise<boolean> {
  const listRows = Array.isArray(rows) ? [...rows] as { id: string }[] : [rows as { id: string }]
  if (!listRows.length) return false
  const one = listRows.length === 1
  const noun = opts.label || (one ? 'this record' : `${listRows.length} records`)

  if (!opts.noConfirm && !(await uiConfirm(
    opts.confirmMessage || `Move ${noun} to the Trash? You can undo this, and the Trash keeps it until it is restored or permanently deleted.`,
    { title: opts.confirmTitle, confirmText: opts.confirmText || 'Delete' },
  ))) return false

  const kind = SOFT_DELETE_KIND[table]
  let reason: string | null = null
  if (REASON_REQUIRED.has(kind)) {
    reason = await uiPrompt(`Reason for deleting ${noun}`, {
      title: opts.confirmTitle || 'Reason required',
      placeholder: 'Why is this record being removed?…',
      confirmText: opts.confirmText || 'Delete',
    })
    if (reason === null) return false
    if (!reason.trim()) { toast('A reason is required to delete this record.', 'warn'); return false }
  }

  const done: string[] = []
  let failed = 0
  for (const row of listRows) {
    const r = await softDeleteRecord(table, row.id, reason)
    if (r.error) {
      failed++
      if (r.error.code && r.error.code !== 'denied') toast(r.error.message, 'danger')
    } else done.push(row.id)
  }
  opts.after?.()
  if (!done.length) {
    toast(`${one ? noun.charAt(0).toUpperCase() + noun.slice(1) : noun} could not be deleted${failed && listRows.length > 1 ? ` (${failed} refused)` : ''}.`, 'danger')
    return false
  }
  bumpTrash()

  const headline = one ? `${noun.charAt(0).toUpperCase() + noun.slice(1)} deleted` : `${done.length} deleted`
  undoToast(`${headline}${failed ? ` · ${failed} failed` : ''} · In Trash`, () => {
    void (async () => {
      let ok = 0, bad = 0
      for (const id of done) {
        const r = await restoreRecord(table, id, 'undo')
        if (r.error) bad++
        else ok++
      }
      toast(
        bad ? `Restored ${ok} of ${done.length}` : (one ? `${noun.charAt(0).toUpperCase() + noun.slice(1)} restored` : `${ok} restored`),
        bad ? (ok ? 'warn' : 'danger') : 'success',
      )
      bumpTrash()
      opts.after?.()
    })()
  }, undefined, { link: TRASH_LINK })
  return true
}
