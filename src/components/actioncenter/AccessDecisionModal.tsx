'use client'

/** Grant/deny a pending case access request — the same canonical writes the
 *  owning surfaces make: a case_access_grants row (grant only) + the request
 *  decision stamp + a best-effort notification to the requester (notify() is
 *  already best-effort, so a failed notification never blocks the decision).
 *  Denial persists no note (the table has no column), so the modal stays a
 *  minimal confirm. */
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { insert, update } from '@/lib/db'
import { notify } from '@/lib/notify'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import type { ActionItem } from '@/lib/actionItems'

interface AccessMeta {
  requester_id?: unknown
  requester_name?: unknown
  case_id?: unknown
  reason?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function AccessDecisionModal({ item, onClose, onDecided }: {
  /** The access_request action item under decision (null = closed). */
  item: ActionItem | null
  onClose: () => void
  /** Fired after a successful grant/deny so the queue refreshes. */
  onDecided: () => void
}) {
  const { profile } = useAuth()
  const meta = (item?.sourceMetadata ?? {}) as AccessMeta
  const requesterId = str(meta.requester_id)
  const caseId = str(meta.case_id) ?? item?.caseId ?? null
  // The model routes the requester's own words into item.reason (with a
  // generic fallback we don't echo back as a quote).
  const reason = str(meta.reason)
    ?? (item?.reason && item.reason !== 'Pending access decision' ? item.reason : null)
  const requesterName = str(meta.requester_name) ?? officerName(requesterId) ?? 'An officer'

  const decide = async (grant: boolean) => {
    if (!item || !profile) return
    if (!caseId) {
      toast('Request details are incomplete — decide it from the case page instead.', 'warn')
      return
    }
    if (grant) {
      if (!requesterId) {
        toast('Request details are incomplete — decide it from the case page instead.', 'warn')
        return
      }
      const gr = await insert('case_access_grants', { case_id: caseId, officer_id: requesterId })
      if (gr.error) { toast(gr.error.message, 'danger'); return }
    }
    const up = await update('case_access_requests', item.sourceId, {
      status: grant ? 'approved' : 'denied',
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
    })
    if (up.error) { toast(up.error.message, 'danger'); return }
    if (requesterId) {
      await notify(requesterId, grant ? 'access_granted' : 'access_denied', {
        case_id: caseId,
        case_number: item.caseNumber ?? undefined,
        title: item.title,
      }).catch(() => { /* best-effort — the decision already landed */ })
    }
    toast(grant ? 'Access granted.' : 'Request denied.', 'success')
    onDecided()
    onClose()
  }

  return (
    <Modal open={!!item} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Case access request" onClose={onClose} />
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-white">{requesterName}</span> requested access to
          {item?.caseNumber
            ? <> case <span className="font-mono text-slate-200">{item.caseNumber}</span>.</>
            : <> this case.</>}
        </p>
        {reason && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">{reason}</p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Granting adds a standing access grant for this officer; denying closes the request. The requester is notified either way.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button className="min-h-[44px] sm:min-h-0" onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="min-h-[44px] sm:min-h-0" onAction={() => decide(false)}>Deny</Button>
          <Button variant="success" className="min-h-[44px] sm:min-h-0" onAction={() => decide(true)}>Grant access</Button>
        </div>
      </div>
    </Modal>
  )
}
