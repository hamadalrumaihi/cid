'use client'

/** Permanent deletion of ONE record from the Trash (Phase 8, P8-03) — the
 *  generalisation of owner/PermanentDelete (the member flow, which stays as
 *  it is) over `permanent_delete_record_preview / _arm / _execute`
 *  (migration 20261013120000, AUTHORIZATION §12).
 *
 *  Everything here is a shell over the three RPCs. Every rule — Owner only,
 *  the record already in the Trash (a case may also be archived), a sign-in
 *  fresher than five minutes, a recorded reason, the dependant walk
 *  (blockers / destroyed / unlinked), a single-use five-minute token and the
 *  typed `DELETE <label>` — is enforced server-side. This component
 *  sequences the steps and shows the server's errors VERBATIM (ServerError
 *  from the member flow, including its fresh-sign-in hint).
 *
 *  Arming and executing happen inside one action, exactly as the member flow
 *  does: `_arm` hands back the confirmation string it expects and `_execute`
 *  is called with it — the server still re-runs the preview at execute time
 *  and fails closed if anything changed. Nothing here is typed by hand.
 *
 *  CALLERS MUST PASS `key={id}`: an armed token belongs to one record, so a
 *  target change remounts rather than inheriting a half-finished flow.
 *
 *  The button is hidden unless `usePermissions().perms.is_owner` — cosmetic;
 *  the RPCs raise 'permanent deletion is restricted to the owner' anyway. */
import { useState } from 'react'
import type { Json } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { toast } from '@/lib/toast'
import { bumpTrash, trashKindLabel } from '@/lib/trash'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ServerError } from '@/components/owner/PermanentDelete'

/** `permanent_delete_record_preview` — the keys the migration writes
 *  (`blockers` / `destroyed` / `unlinked` + `blocker_total` from the
 *  dependant walk, `storage_objects` / `external_assets` from the asset
 *  enumeration) plus the buckets the member flow's preview uses, which a
 *  later migration may add for parity. Everything is optional on read. */
export interface RecordDeletePreview {
  target: { kind: string; table: string; id: string; label: string | null; deleted_at: string | null; delete_batch?: string | null; archived_at: string | null; case_id: string | null }
  eligible: boolean
  ineligible_reasons: string[]
  blocker_total?: number
  blockers?: Record<string, number>
  active_work?: Record<string, number>
  repoint?: Record<string, number>
  cascade?: Record<string, number>
  destroyed?: Record<string, number>
  deleted?: Record<string, number>
  set_null?: Record<string, number>
  unlinked?: Record<string, number>
  storage_objects?: string[]
  external_assets?: string[]
  assets?: Record<string, number> | string[]
}

interface ArmedToken { token: string; expires_at: string; confirm: string }

function CountList({ counts, tone }: { counts: Record<string, number>; tone: 'blocker' | 'info' }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0)
  if (!entries.length) return <p className="text-sm text-emerald-300">none</p>
  return (
    <ul className="space-y-0.5">
      {entries.sort(([a], [b]) => a.localeCompare(b)).map(([ref, n]) => (
        <li key={ref} className={`font-mono text-xs ${tone === 'blocker' ? 'text-rose-300' : 'text-slate-300'}`}>
          {ref} <b className={tone === 'blocker' ? 'text-rose-200' : 'text-white'}>{n}</b>
        </li>
      ))}
    </ul>
  )
}

function Bucket({ title, sub, counts, tone }: { title: string; sub: string; counts: Record<string, number>; tone: 'blocker' | 'info' }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'blocker' ? 'border-rose-500/25 bg-rose-500/5' : 'border-white/10 bg-ink-950/50'}`}>
      <p className={`text-[13px] font-semibold ${tone === 'blocker' ? 'text-rose-300' : 'text-white'}`}>{title}</p>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{sub}</p>
      <CountList counts={counts} tone={tone} />
    </div>
  )
}

const merge = (...parts: (Record<string, number> | undefined)[]): Record<string, number> => Object.assign({}, ...parts.filter(Boolean))

/** The preview, bucket by bucket. Exported so the Owner console can reuse it. */
export function RecordDeletePreviewView({ preview }: { preview: RecordDeletePreview }) {
  const blockers = merge(preview.blockers, preview.active_work)
  const destroyed = merge(preview.destroyed, preview.cascade, preview.deleted)
  const unlinked = merge(preview.unlinked, preview.set_null, preview.repoint)
  const storage = preview.storage_objects ?? []
  const external = preview.external_assets ?? []
  const assetCounts = preview.assets && !Array.isArray(preview.assets) ? preview.assets : null
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div><dt className="text-slate-400">Kind</dt><dd className="text-slate-200">{trashKindLabel(preview.target.kind)} <span className="font-mono text-slate-500">({preview.target.table})</span></dd></div>
        <div><dt className="text-slate-400">Deleted</dt><dd className="text-slate-200">{preview.target.deleted_at ? fmtDateTime(preview.target.deleted_at) : preview.target.archived_at ? `archived ${fmtDateTime(preview.target.archived_at)}` : 'not in the Trash'}</dd></div>
        {preview.target.case_id && <div><dt className="text-slate-400">Case</dt><dd className="font-mono text-slate-200">{preview.target.case_id}</dd></div>}
      </dl>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Bucket title="Blockers" tone="blocker" sub="Live material or a legal hold that still depends on this record — clear these first; the server refuses while any remain." counts={blockers} />
        <Bucket title="Destroyed with it" tone="info" sub="The Trash batch that goes with the record and rows behind CASCADE keys — snapshotted into the deleted-record ledger." counts={destroyed} />
        <Bucket title="Unlinked" tone="info" sub="References set to null (SET NULL keys) or repointed — the referencing rows stay." counts={unlinked} />
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
          <p className="text-[13px] font-semibold text-white">Media assets</p>
          <p className="mb-2 mt-0.5 text-xs text-slate-400">Storage paths and external URLs of media that goes with it. The database cannot delete storage objects itself — they are listed in the ledger for removal through the Storage API.</p>
          {assetCounts && <CountList counts={assetCounts} tone="info" />}
          {storage.length + external.length === 0 && !assetCounts
            ? <p className="text-sm text-emerald-300">none</p>
            : (
              <ul className="max-h-32 space-y-0.5 overflow-auto">
                {storage.map((p) => <li key={`s:${p}`} className="truncate font-mono text-xs text-slate-300" title={p}>{p}</li>)}
                {external.map((u) => <li key={`u:${u}`} className="truncate font-mono text-xs text-slate-300" title={u}>{u}</li>)}
              </ul>
            )}
        </div>
      </div>
    </div>
  )
}

export function RecordPermanentDelete({ kind, id, label, onDeleted }: {
  kind: string
  id: string
  /** The row's on-screen label (the server's confirmation label is what
   *  `_arm` returns — this one is for copy only). */
  label: string
  onDeleted?: () => void
}) {
  const { perms } = usePermissions()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<RecordDeletePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState<ArmedToken | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!perms.is_owner) return null

  // Read-only: what would go, what blocks. Runs when the panel opens.
  const doPreview = async () => {
    setLoading(true); setError(null)
    const res = await rpc('permanent_delete_record_preview', { p_kind: kind, p_id: id })
    setLoading(false)
    if (res.error) { setPreview(null); setError(res.error.message); return }
    setPreview(res.data as unknown as RecordDeletePreview)
  }

  // Two steps, two clicks. Arm writes the audit row and hands back a
  // single-use token plus the confirmation the server expects; the Owner
  // then TYPES that confirmation and it goes to the server verbatim — the
  // client never echoes the server's own string back (review M2). The server
  // re-runs the preview before writing the ledger and fails closed.
  const doArm = async () => {
    setError(null); setBusy(true)
    const armRes = await rpc('permanent_delete_record_arm', { p_kind: kind, p_id: id, p_reason: reason.trim() })
    setBusy(false)
    if (armRes.error) { setError(armRes.error.message); return }
    setArmed(armRes.data as unknown as ArmedToken); setTyped('')
  }
  const doDelete = async () => {
    if (!armed) return
    setError(null); setBusy(true)
    const res = await rpc('permanent_delete_record_execute', { p_token: armed.token, p_confirm: typed.trim() })
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    const out = res.data as unknown as { ledger_id?: string; label?: string; destroyed?: Json }
    toast(`${out.label || label} was permanently deleted${out.ledger_id ? ` — ledger entry ${out.ledger_id}` : ''}.`, 'success')
    bumpTrash()
    setOpen(false); setPreview(null); setReason(''); setArmed(null); setTyped('')
    onDeleted?.()
  }

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => { setOpen(true); void doPreview() }}>
        Permanently delete…
      </Button>
    )
  }

  return (
    <div className="mt-2 w-full space-y-3 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
      <div>
        <p className="text-sm font-bold text-rose-200">
          This permanently deletes {label} and cannot be undone.
        </p>
        <p className="mt-1 text-xs text-rose-200/80">
          Restoring from the Trash is the default and keeps everything. Permanent deletion removes the record and its
          Trash batch for good; an Owner-only ledger entry keeps the snapshot, the reason and what was unlinked.
          Requires a sign-in fresher than five minutes.
        </p>
      </div>

      {loading && <ListSkeleton count={2} />}
      {preview && (
        <>
          <p className="text-sm text-slate-300">
            {preview.eligible
              ? <span className="text-emerald-300">Eligible for permanent deletion.</span>
              : <span className="font-semibold text-rose-300">Not eligible: {preview.ineligible_reasons.join('; ')}</span>}
          </p>
          <RecordDeletePreviewView preview={preview} />
        </>
      )}

      <Field label="Reason (required — lands in the audit log and the ledger)">
        {(fid) => (
          <Textarea id={fid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why this record must be erased rather than left in the Trash…" />
        )}
      </Field>

      {armed && (
        <Field label={`Type ${armed.confirm} to confirm (the token expires in five minutes)`}>
          {(fid) => (
            <input id={fid} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              className="w-full rounded-lg border border-rose-400/30 bg-ink-950 px-3 py-2 font-mono text-sm text-white"
              placeholder={armed.confirm} />
          )}
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!armed ? (
          <Button variant="danger" disabled={!preview?.eligible || !reason.trim() || busy} loading={busy} onAction={doArm}>
            Arm permanent deletion
          </Button>
        ) : (
          <Button variant="danger" disabled={typed.trim() !== armed.confirm || busy} loading={busy} onAction={doDelete}>
            Permanently delete {label}
          </Button>
        )}
        <Button variant="ghost" onClick={() => { setOpen(false); setError(null); setArmed(null); setTyped('') }}>Cancel</Button>
      </div>

      {error && <ServerError message={error} />}
    </div>
  )
}
