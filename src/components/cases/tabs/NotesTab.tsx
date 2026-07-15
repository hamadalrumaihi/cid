'use client'

import { useEffect, useState } from 'react'
import { update } from '@/lib/db'
import { copyText, downloadTextFile } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { RichEditor } from '@/components/ui/RichEditor'
import type { CaseRow } from './shared'

export function NotesTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.notes ?? '')
  useEffect(() => { queueMicrotask(() => setText(c.notes ?? '')) }, [c.notes])
  const save = async () => {
    const res = await update('cases', c.id, { notes: text || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Notes saved.', 'success'); setEditing(false); onChanged() }
  }
  if (editing) return (
    <div className="space-y-3">
      <RichEditor value={text} onChange={setText} />
      <div className="flex justify-end gap-2"><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
    </div>
  )
  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <Button onClick={() => copyText(c.notes ?? '', 'Notes copied.')}>Copy</Button>
        <Button onClick={() => downloadTextFile(`${c.case_number}-notes.md`, c.notes ?? '')}>.md</Button>
        {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      <div className="prose prose-invert max-w-none rounded-xl border border-white/10 bg-ink-950/50 p-4 text-sm text-slate-200">{c.notes ? renderMarkdown(c.notes) : <p className="text-slate-500">No case notes yet.</p>}</div>
    </div>
  )
}
