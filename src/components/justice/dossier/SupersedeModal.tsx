'use client'

/** Supersede (P4-09, decision L13): command / AG / Owner retire a decided
 *  instrument in favour of an APPROVED replacement on the same case
 *  (`legal_mark_superseded(p_old, p_new, p_reason)` — the server checks the
 *  replacement's status and the caller's authority). The candidate list is
 *  the case's approved / partially-approved requests the viewer can read. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { reviewStatusLabel } from '@/lib/justice'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type Candidate = Pick<Tables<'legal_requests'>, 'id' | 'request_number' | 'title' | 'review_status'>

export function SupersedeModal({ r, busy, onSubmit, onClose }: {
  r: Pick<Tables<'legal_requests'>, 'id' | 'request_number' | 'case_id'>
  busy: boolean
  onSubmit: (v: { replacementId: string; reason: string }) => void
  onClose: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [replacement, setReplacement] = useState('')
  const [reason, setReason] = useState('')
  useEffect(() => {
    let cancelled = false
    void list('legal_requests', {
      select: 'id,request_number,title,review_status',
      eq: { case_id: r.case_id },
      in: { review_status: ['approved', 'partially_approved'] },
      order: 'created_at', ascending: false,
    }).then((rows) => {
      if (!cancelled) setCandidates((rows as unknown as Candidate[]).filter((x) => x.id !== r.id))
    }).catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [r.id, r.case_id])
  const ready = !!replacement && reason.trim() !== ''
  return (
    <Modal open onClose={onClose} dirty={() => replacement !== '' || reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={`Supersede ${r.request_number}`} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Marks this request superseded and links the replacement. The replacement must already be approved on the same case.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Replacement request" required>
            {(id) => (
              <Select id={id} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">{candidates === null ? 'Loading…' : candidates.length ? 'Choose…' : 'No approved request on this case'}</option>
                {candidates?.map((c) => (
                  <option key={c.id} value={c.id}>{c.request_number} — {c.title} ({reviewStatusLabel(c.review_status)})</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason" required>
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ replacementId: replacement, reason: reason.trim() })}>
            {busy ? 'Recording…' : 'Mark superseded'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
