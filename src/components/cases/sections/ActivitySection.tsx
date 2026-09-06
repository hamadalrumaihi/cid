'use client'

/** ActivitySection — the case's activity feed (P3-04): `case_audit_feed`
 *  rows, each already re-checked server-side against the viewer's own read
 *  predicate (a sealed legal request, a restricted photo, an
 *  SIB-compartmented link, a command-only note are simply ABSENT — nothing
 *  here renders placeholders for them, and `detail` never carries a body).
 *  Actor name through the roster cache, a verb from the action, the entity
 *  kind + label, field chips from `changed_fields`. Filters: actor and kind
 *  narrow the loaded rows; "Until" reloads with `p_before`; "Since" stops
 *  "Load older" once the feed is past it. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { fieldLabel } from '@/components/entity/labels'
import type { CaseRow } from '../tabs/shared'
import { actionVerb, entityKindLabel } from './sectionShared'

type FeedRow = Database['public']['Functions']['case_audit_feed']['Returns'][number]
const PAGE = 50

export function ActivitySection({ c }: { c: CaseRow }) {
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [exhausted, setExhausted] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actor, setActor] = useState('')
  const [kind, setKind] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchRoster = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchRoster() }, [rosterLoaded, fetchRoster])

  const untilIso = until ? new Date(`${until}T23:59:59.999`).toISOString() : undefined
  const sinceMs = since ? Date.parse(`${since}T00:00:00`) : null

  const fetchPage = useCallback(async (before?: string): Promise<FeedRow[] | null> => {
    const res = await rpc('case_audit_feed', before ? { p_case: c.id, p_limit: PAGE, p_before: before } : { p_case: c.id, p_limit: PAGE })
    if (res.error) { setError(res.error); return null }
    return res.data ?? []
  }, [c.id])

  const load = useCallback(async () => {
    setRows(null); setError(null); setExhausted(false)
    const page = await fetchPage(untilIso)
    if (!page) return
    setRows(page)
    setExhausted(page.length < PAGE)
  }, [fetchPage, untilIso])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  const loadOlder = async () => {
    const last = rows?.[rows.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    const page = await fetchPage(last.at)
    setLoadingMore(false)
    if (!page) return
    setRows((prev) => [...(prev ?? []), ...page])
    if (page.length < PAGE || (sinceMs !== null && Date.parse(page[page.length - 1]!.at) < sinceMs)) setExhausted(true)
  }

  const actors = useMemo(() => [...new Set((rows ?? []).map((r) => r.actor_id).filter((a): a is string => !!a))], [rows])
  const kinds = useMemo(() => [...new Set((rows ?? []).map((r) => r.kind))].sort(), [rows])
  const visible = useMemo(() => (rows ?? []).filter((r) =>
    (!actor || r.actor_id === actor)
    && (!kind || r.kind === kind)
    && (sinceMs === null || Date.parse(r.at) >= sinceMs)), [rows, actor, kind, sinceMs])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-white/10 bg-ink-950/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Actor">
          {(id) => (
            <Select id={id} value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Anyone</option>
              {actors.map((a) => <option key={a} value={a}>{officerName(a) || 'Officer'}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Everything</option>
              {kinds.map((k) => <option key={k} value={k}>{entityKindLabel(k)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Since">
          {(id) => <Input id={id} type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} />}
        </Field>
        <Field label="Until" hint="Reloads the feed from this day backwards.">
          {(id) => <Input id={id} type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
      </div>
      <section aria-label="Case activity" aria-live="polite" className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-bold text-white">Activity</h3>
          <Button size="sm" onClick={() => void load()}>Refresh</Button>
        </div>
        {error ? (
          <ErrorNotice message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <ListSkeleton count={5} />
        ) : visible.length === 0 ? (
          <EmptyState title="No activity to show" hint={rows.length ? 'Nothing in the loaded rows matches these filters.' : 'Changes to this case and its records will appear here.'} />
        ) : (
          <ol className="divide-y divide-white/5">
            {visible.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm">
                <time dateTime={r.at} title={fmtDateTime(r.at)} className="w-20 flex-shrink-0 font-mono text-xs text-slate-400">{timeAgo(r.at)}</time>
                <span className="font-semibold text-slate-200">{officerName(r.actor_id) || (r.actor_id ? 'Officer' : 'System')}</span>
                <span className="text-slate-300">{actionVerb(r.action)}</span>
                <span className="text-slate-400">{entityKindLabel(r.kind)}</span>
                {r.label && <span className="truncate text-slate-200">{r.label}</span>}
                {r.changed_fields && r.changed_fields.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {r.changed_fields.map((f) => <Badge key={f} tone="neutral">{fieldLabel(f)}</Badge>)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {rows && rows.length > 0 && !exhausted && (
          <div className="mt-3">
            <Button size="sm" loading={loadingMore} onClick={() => void loadOlder()}>Load older</Button>
          </div>
        )}
      </section>
    </div>
  )
}
