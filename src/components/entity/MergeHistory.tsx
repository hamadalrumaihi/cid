'use client'

/** MergeHistory — the entity_merges ledger rows whose survivor is this
 *  record (RLS follows the survivor): what was merged in, by whom, why, and
 *  whether it has been reversed. **Unmerge** shows while the 30-day window is
 *  open and the viewer is command/owner (cosmetic — `entity_unmerge` decides
 *  and its `{ ok:false }` is rendered in the server's words). `MergeHistory`
 *  reads usePermissions; `MergeHistoryPanel` takes `canUnmerge` so it can be
 *  rendered without an AuthProvider. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { listMergeHistory, refusalText, unmergeEntities, unmergeWindowOpen, type MergeKind, type MergeManifest } from '@/lib/entity'
import { fmtDateTime } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { ListSkeleton } from '@/components/ui/Skeleton'

type MergeRow = Tables<'entity_merges'>

export interface MergeHistoryProps { kind: MergeKind; recordId: string; className?: string }

export function MergeHistory(props: MergeHistoryProps) {
  const { perms } = usePermissions()
  return <MergeHistoryPanel {...props} canUnmerge={perms.access_class === 'owner' || perms.access_class === 'command'} />
}

/** Victim labels come from the manifest the server wrote at merge time —
 *  the victims are tombstones now and may not be readable any more. */
function victimLabels(row: MergeRow): string[] {
  const m = row.manifest as unknown as Partial<MergeManifest> | null
  const fromManifest = m?.victims?.map((v) => v.label).filter(Boolean) ?? []
  return fromManifest.length ? fromManifest : row.victim_ids
}

export function MergeHistoryPanel({ kind, recordId, canUnmerge, className = '' }: MergeHistoryProps & { canUnmerge: boolean }) {
  const [rows, setRows] = useState<MergeRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await listMergeHistory(kind, recordId)) } catch { setRows([]) }
  }, [kind, recordId])

  useEffect(() => {
    let live = true
    void (async () => { await Promise.resolve(); if (live) await load() })()
    return () => { live = false }
  }, [load])

  const unmerge = async (row: MergeRow) => {
    const reason = await uiPrompt(
      'The merged records come back as they were; rows that moved to this record move back, and the survivor keeps only what it had before. Recorded in the audit trail.',
      { title: 'Reverse this merge', placeholder: 'Why? e.g. different subjects — DOB mismatch confirmed by ID.', confirmText: 'Unmerge' },
    )
    if (reason === null) return
    if (!reason.trim()) { toast('A reason is required to reverse a merge.', 'warn'); return }
    setBusyId(row.id)
    const res = await unmergeEntities(row.id, reason.trim())
    setBusyId(null)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Unmerge failed.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast(`Merge reversed — ${res.data.restored} record${res.data.restored === 1 ? '' : 's'} restored.`, 'success')
    await load()
  }

  if (rows === null) return <ListSkeleton count={2} />
  if (!rows.length) return <p className={`text-sm text-slate-400 ${className}`}>Nothing has been merged into this record.</p>

  return (
    <ul className={`space-y-2 ${className}`}>
      {rows.map((row) => {
        const reversed = !!row.reversed_at
        const labels = victimLabels(row)
        return (
          <li key={row.id} className="rounded-lg border border-white/10 bg-ink-900 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Merged {labels.length} record{labels.length === 1 ? '' : 's'}
              </span>
              {reversed ? <Badge tone="warn">Reversed</Badge> : <Badge tone="good">Merged</Badge>}
              <span className="text-xs text-slate-400">
                {officerName(row.actor_id) ?? 'Somebody'} · {fmtDateTime(row.created_at)}
              </span>
              {!reversed && canUnmerge && unmergeWindowOpen(row) && (
                <span className="ml-auto">
                  <Button size="sm" variant="secondary" loading={busyId === row.id} onClick={() => void unmerge(row)}>Unmerge</Button>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-300">{labels.join(', ')}</p>
            <p className="mt-1 text-xs text-slate-400"><span className="text-slate-500">Reason:</span> {row.reason}</p>
            {reversed && (
              <p className="mt-1 text-xs text-slate-400">
                <span className="text-slate-500">Reversed</span> {fmtDateTime(row.reversed_at)} by {officerName(row.reversed_by) ?? 'somebody'}
                {row.reverse_reason ? ` — ${row.reverse_reason}` : ''}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
