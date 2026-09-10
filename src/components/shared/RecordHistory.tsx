'use client'

/** Field-level record history (Phase 8, P8-04) over `record_history(kind,
 *  id)` / `restore_version(kind, id, version_no, reason)` for the twelve
 *  versioned kinds (lib/recordHistory VERSION_KINDS; AUTHORIZATION §10).
 *
 *  Each version lists its changes (field · from · to — long text and jsonb
 *  through DiffView), Compare puts any two versions' resulting states side
 *  by side (compareVersions), and Restore writes a version's fields back as
 *  an ordinary UPDATE (a NEW version with source = 'restore'; the server
 *  strips RPC-governed columns and refuses a sealed report / a legal
 *  request as display-only — its `{ok:false, message}` is shown verbatim).
 *
 *  Access is the parent row's: `record_versions_sel` asks whether the
 *  caller can see the parent, so nothing here decides who may read. The
 *  Restore button is cosmetic — `canRestore` from the caller, or, when
 *  omitted, `can_record('restore_version', kind, id)` asked once per mount
 *  (a transport error reads as false). VersionViewer stays for SOP
 *  document versions; this component is for `record_versions`. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { rpc } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { canRecord } from '@/lib/permissions'
import { officerName } from '@/lib/profiles'
import { compareVersions, historyRows, versionChanges, type FieldChange, type VersionKind, type VersionRow } from '@/lib/recordHistory'
import { toast } from '@/lib/toast'
import { fieldLabel } from '@/components/entity/labels'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DiffView } from '@/components/sops/docDiff'

export interface RecordHistoryProps {
  kind: VersionKind
  id: string
  /** Show "Restore this version". Omit to ask can_record('restore_version')
   *  once per mount; pass false to hide it regardless (sealed reports). */
  canRestore?: boolean
  onRestored?: () => void
  /** Column → human label; anything absent falls back to fieldLabel(). */
  fieldLabels?: Record<string, string>
  /** Custom cell rendering (e.g. a status chip); return undefined to fall
   *  back to the default text / diff rendering. */
  renderValue?: (field: string, value: unknown) => ReactNode
  className?: string
}

const MIN_REASON = 3

type Row = VersionRow & { burst: boolean }

/** A value long enough (or structured enough) to read as a diff rather than
 *  as a from → to cell. */
function isLong(v: unknown): boolean {
  if (v && typeof v === 'object') return true
  if (typeof v !== 'string') return false
  return v.length > 80 || v.includes('\n')
}

/** Text form for cells and diffs — jsonb pretty-printed so a diff reads
 *  line by line, everything else as the user typed it. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v, null, 2)
}

function normalise(raw: unknown): VersionRow[] {
  return ((raw ?? []) as Array<Omit<VersionRow, 'old' | 'new'> & { old: unknown; new: unknown }>).map((r) => ({
    ...r,
    old: (r.old && typeof r.old === 'object' ? r.old : {}) as Record<string, unknown>,
    new: (r.new && typeof r.new === 'object' ? r.new : {}) as Record<string, unknown>,
  }))
}

export function RecordHistory({ kind, id, canRestore, onRestored, fieldLabels, renderValue, className = '' }: RecordHistoryProps) {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openNo, setOpenNo] = useState<number | null>(null)
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null)
  const [restoreNo, setRestoreNo] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  // The server's per-record answer, asked only when the caller passes nothing.
  const [askedRestore, setAskedRestore] = useState(false)
  const mayRestore = canRestore ?? askedRestore

  const load = useCallback(async () => {
    setError(null)
    const res = await rpc('record_history', { p_kind: kind, p_id: id })
    if (res.error) { setError(res.error.message); return }
    setRows(normalise(res.data))
  }, [kind, id])
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  // The caller's answer wins; otherwise ask the server once per mount (a
  // transport error is a refusal).
  useEffect(() => {
    if (canRestore !== undefined) return
    let live = true
    void canRecord('restore_version', kind, id).then((ok) => { if (live) setAskedRestore(ok) }).catch(() => { if (live) setAskedRestore(false) })
    return () => { live = false }
  }, [canRestore, kind, id])

  const ordered: Row[] = useMemo(() => (rows ? historyRows(rows) : []), [rows])
  const byNo = useMemo(() => new Map(ordered.map((v) => [v.version_no, v])), [ordered])
  const label = useCallback((f: string) => fieldLabels?.[f] ?? fieldLabel(f), [fieldLabels])

  const restore = async () => {
    if (restoreNo === null) return
    const why = reason.trim()
    if (why.length < MIN_REASON) { setRestoreError(`A reason of at least ${MIN_REASON} characters is required.`); return }
    setRestoreError(null)
    const res = await rpc('restore_version', { p_kind: kind, p_id: id, p_version_no: restoreNo, p_reason: why })
    if (res.error) { setRestoreError(res.error.message); return }
    const out = (res.data ?? {}) as { ok?: boolean; code?: string; message?: string }
    if (!out.ok) { setRestoreError(out.message || out.code || 'The restore was refused.'); return }
    toast(`Restored to v${restoreNo}.`, 'success')
    setRestoreNo(null); setReason('')
    await load()
    onRestored?.()
  }

  const cell = (field: string, v: unknown): ReactNode => {
    const custom = renderValue?.(field, v)
    if (custom !== undefined) return custom
    const t = valueText(v)
    return t ? <span className="whitespace-pre-wrap break-words">{t}</span> : <span className="text-slate-500">—</span>
  }

  const changes = (list: FieldChange[]) => (
    <ul className="space-y-2">
      {list.map((ch) => (
        <li key={ch.field} className="text-xs">
          <p className="mb-1 font-semibold text-slate-200">{label(ch.field)}</p>
          {isLong(ch.from) || isLong(ch.to) ? (
            <DiffView base={valueText(ch.from)} other={valueText(ch.to)} />
          ) : (
            <p className="text-slate-300">
              <span className="text-rose-200/90">{cell(ch.field, ch.from)}</span>
              <span aria-hidden className="mx-1.5 text-slate-500">→</span>
              <span className="sr-only">changed to</span>
              <span className="text-emerald-200/90">{cell(ch.field, ch.to)}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  )

  if (error) return <ErrorNotice message={error} onRetry={() => void load()} className={className} />
  if (rows === null) return <div className={className}><ListSkeleton count={3} /></div>
  if (!ordered.length) {
    return <EmptyState className={className} title="No edits recorded yet" hint="This is the record as first written. Every later save appears here, field by field." />
  }

  const cmpA = compare ? byNo.get(compare.a) : undefined
  const cmpB = compare ? byNo.get(compare.b) : undefined
  const restoreTarget = restoreNo !== null ? byNo.get(restoreNo) : undefined

  return (
    <div className={`space-y-3 ${className}`}>
      {ordered.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" aria-expanded={!!compare} onClick={() => setCompare(compare ? null : { a: ordered[1].version_no, b: ordered[0].version_no })}>
            {compare ? 'Hide compare' : 'Compare versions'}
          </Button>
        </div>
      )}

      {compare && (
        <section aria-label="Compare two versions" className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="From">
              {(fid) => (
                <Select id={fid} value={compare.a} onChange={(e) => setCompare({ ...compare, a: Number(e.target.value) })}>
                  {ordered.map((v) => <option key={v.version_no} value={v.version_no}>v{v.version_no} · {fmtDateTime(v.created_at)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="To">
              {(fid) => (
                <Select id={fid} value={compare.b} onChange={(e) => setCompare({ ...compare, b: Number(e.target.value) })}>
                  {ordered.map((v) => <option key={v.version_no} value={v.version_no}>v{v.version_no} · {fmtDateTime(v.created_at)}</option>)}
                </Select>
              )}
            </Field>
          </div>
          {cmpA && cmpB ? (() => {
            const diff = compareVersions(cmpA, cmpB)
            return diff.length ? changes(diff) : <p className="text-sm text-slate-400">These two versions leave the record in the same state.</p>
          })() : null}
        </section>
      )}

      {restoreTarget && (
        <section aria-label={`Restore version ${restoreTarget.version_no}`} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <h4 className="mb-1 text-[13px] font-semibold text-amber-200">Restore v{restoreTarget.version_no}</h4>
          <p className="mb-2 text-xs text-slate-400">
            Writes the fields that version recorded back onto the record as a new save — nothing is rewritten in the history.
            Columns the workflow governs (status, identity, seals) are never touched.
          </p>
          <Field label="Reason" required hint="Recorded on the restore version for the audit trail.">
            {(fid) => <Textarea id={fid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this version is being restored" />}
          </Field>
          {restoreError && <p className="mt-2 text-xs font-semibold text-rose-300">{restoreError}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={() => { setRestoreNo(null); setReason(''); setRestoreError(null) }}>Cancel</Button>
            <Button size="sm" variant="warn" disabled={reason.trim().length < MIN_REASON} onAction={restore}>Restore version</Button>
          </div>
        </section>
      )}

      <ul className="space-y-1.5">
        {ordered.map((v, i) => {
          const open = openNo === v.version_no
          const who = officerName(v.actor_id)
          return (
            <li key={v.version_no} className="rounded-lg border border-white/10 bg-ink-950/50">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenNo(open ? null : v.version_no)}
                  aria-expanded={open}
                  className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-2 text-left lg:min-h-0"
                >
                  <span className="font-mono text-xs font-bold text-blue-300">v{v.version_no}</span>
                  {i === 0 && <Badge tone="accent">latest</Badge>}
                  {v.source === 'restore' && <Badge tone="warn" title="Written by restoring an earlier version">restore</Badge>}
                  {v.burst && <Badge tone="neutral" title={`Several saves between ${fmtDateTime(v.created_at)} and ${fmtDateTime(v.updated_at)}`}>several saves</Badge>}
                  <span className="truncate text-sm text-slate-200">{v.changed_fields.map(label).join(', ')}</span>
                  <span className="text-xs text-slate-400">
                    <time dateTime={v.created_at} title={fmtDateTime(v.created_at)}>{timeAgo(v.created_at)}</time>
                    {who ? ` · ${who}` : ''}
                  </span>
                  <span aria-hidden className="text-xs text-slate-500">{open ? '▾' : '▸'}</span>
                </button>
                {mayRestore && i > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => { setRestoreNo(v.version_no); setReason(''); setRestoreError(null) }} aria-label={`Restore version ${v.version_no}`}>
                    Restore
                  </Button>
                )}
              </div>
              {open && (
                <div className="border-t border-white/10 p-3">
                  {changes(versionChanges(v))}
                  {v.reason && <p className="mt-2 text-[11px] text-slate-400">Reason: {v.reason}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
