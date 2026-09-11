'use client'

/** Evidence actions shared by the card overflow menu and the detail sheet —
 *  one place for the confirm copy, the RPC call and the toast, so the two
 *  surfaces can never drift. Every action is server-authoritative; the
 *  `can*` inputs are cosmetic gates that mirror the RPC's own bar. */
import type { ActionItem } from '@/components/ui/ActionMenu'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import {
  isRegisteredEvidence, isStorageHosted, releaseEvidence, requestVerify, sealEvidence, type MediaRow,
} from '@/lib/evidence'
import { toast } from '@/lib/toast'

export async function runVerify(m: MediaRow): Promise<boolean> {
  const r = await requestVerify(m.id)
  if (!r.ok) { toast(r.message ?? 'Verification could not be queued.', 'danger'); return false }
  toast('Integrity verification queued — the result lands in your notifications.', 'success')
  return true
}

export async function runSeal(m: MediaRow): Promise<boolean> {
  const ok = await uiConfirm(
    `Seal ${m.evidence_number ?? m.title}? A sealed item is locked to its verified hash; the seal is audited and cannot be removed here.`,
    { title: 'Seal evidence', confirmText: 'Seal evidence' },
  )
  if (!ok) return false
  const r = await sealEvidence(m.id)
  if (!r.ok) { toast(r.message ?? 'Seal refused.', 'danger'); return false }
  toast('Evidence sealed.', 'success')
  return true
}

export async function runRelease(m: MediaRow): Promise<boolean> {
  const reason = await uiPrompt('A reason is required — it is written to the custody chain and audited.', {
    title: `Release ${m.evidence_number ?? m.title}`,
    placeholder: 'e.g. Returned to owner per court order 26-CR-0113…',
    confirmText: 'Release evidence',
  })
  if (reason === null) return false
  if (!reason.trim()) { toast('A reason is required to release evidence.', 'warn'); return false }
  const r = await releaseEvidence(m.id, reason.trim())
  if (!r.ok) { toast(r.message ?? 'Release refused.', 'danger'); return false }
  toast('Evidence released.', 'success')
  return true
}

/** The overflow menu for one registered evidence row. Verify / Transfer are
 *  offered to anyone who can read the row (the server re-checks); Seal only
 *  with the `evidence_sealing` flag and a verified hash; Release is command. */
export function evidenceMenuItems(opts: {
  m: MediaRow
  sealingEnabled: boolean
  isCommand: boolean
  onDetails: () => void
  onTransfer: () => void
  onChanged: () => void
}): ActionItem[] {
  const { m, sealingEnabled, isCommand, onDetails, onTransfer, onChanged } = opts
  const registered = isRegisteredEvidence(m) && isStorageHosted(m)
  const items: ActionItem[] = [{ label: 'Open details', onClick: onDetails }]
  if (!registered) return items
  items.push(
    { label: 'Verify integrity', onClick: () => { void runVerify(m).then((ok) => { if (ok) onChanged() }) } },
    { label: 'Transfer custody…', onClick: onTransfer, disabled: !!m.sealed_at },
  )
  if (sealingEnabled) {
    items.push({
      label: m.sealed_at ? 'Sealed' : 'Seal evidence…',
      onClick: () => { void runSeal(m).then((ok) => { if (ok) onChanged() }) },
      disabled: !!m.sealed_at || m.integrity_status !== 'verified',
    })
  }
  if (isCommand) {
    items.push({ label: 'Release…', danger: true, separatorBefore: true, onClick: () => { void runRelease(m).then((ok) => { if (ok) onChanged() }) } })
  }
  return items
}
