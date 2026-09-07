'use client'

/** "This case is in the Trash" (P3-07). Reached when the case row resolves
 *  only with `includeDeleted` — i.e. the viewer may read soft-deleted cases
 *  (the Owner; command via the Trash policies) and this one is deleted.
 *  Restore goes through the shared restore_record RPC (db.restoreRecord),
 *  which re-checks the caller's standing server-side; the button is only a
 *  cosmetic gate for command. */
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { restoreRecord } from '@/lib/db'
import { toast } from '@/lib/toast'
import { TrashIcon } from '@/components/shell/icons'
import { Button } from '@/components/ui/Button'

export function DeletedCaseNotice({ caseId, caseNumber, onRestored }: {
  caseId: string
  caseNumber: string | null
  onRestored: () => void
}) {
  const { isCommand } = useAuth()
  const [busy, setBusy] = useState(false)

  const restore = async () => {
    setBusy(true)
    const res = await restoreRecord('cases', caseId)
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Case restored.', 'success')
    onRestored()
  }

  return (
    <section aria-labelledby="case-trash-title" className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-ink-900/60 p-6">
      <div className="mb-3 flex items-center gap-2 text-slate-300">
        <TrashIcon size={18} className="flex-shrink-0" />
        <h2 id="case-trash-title" className="text-sm font-semibold text-white">This case is in the Trash</h2>
      </div>
      <p className="text-sm text-slate-300">
        {caseNumber ? <span className="font-mono font-semibold text-white">{caseNumber}</span> : 'This case'} was deleted.
        {isCommand ? ' Command can restore it here; nothing is lost until the Trash is emptied.' : ' Ask a command member to restore it.'}
      </p>
      {isCommand && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => void restore()} loading={busy}>Restore case</Button>
        </div>
      )}
    </section>
  )
}
