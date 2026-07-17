'use client'

/** Vehicle profile — panelled drill-down for a single plate (`?vehicle=`).
 *  Left: identity card (round icon tile, model, mono plate) over a labelled
 *  key-value list, then notes. Right: the structured Legal section (RLS-safe
 *  legal_request_exhibits vehicle targets — EntityLegalPanel) and derived
 *  linked cases — there is no vehicle↔case join, so the panel scans RLS-scoped
 *  report fields for the plate string (CrossrefPanel's approach) and folds in
 *  cases linked to the registered owner via case_intel_links. Both fail
 *  CLOSED: any query error shows a Retry banner, never a false "nothing". */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { copyText, fmtDate, timeAgo } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { WatchButton } from '@/components/cases/WatchButton'
import { EntityLegalPanel } from '@/components/justice/EntityLegalSection'
import { VehicleModal, type GangOption, type PersonOption } from './VehiclesView'

type VehicleRow = Tables<'vehicles'>

/* ---- colour swatch --------------------------------------------------------
   `color` is a free-text name, not a hex. Map ~16 common names to a CSS
   swatch (case-insensitive substring; longest name wins, and compound names
   like navy/maroon are listed before their generic tone so "navy blue" reads
   navy). Unmatched text keeps a neutral dot. */
const COLOR_SWATCHES: Record<string, string> = {
  navy: '#1e3a8a', maroon: '#7f1d1d', silver: '#cbd5e1', beige: '#e7dcc7',
  yellow: '#facc15', orange: '#f97316', purple: '#9333ea', brown: '#78350f',
  black: '#111827', white: '#f8fafc', green: '#16a34a', gold: '#d4af37',
  gray: '#9ca3af', grey: '#9ca3af', blue: '#3b82f6', red: '#dc2626', tan: '#d2b48c',
}

function colorSwatch(color: string): string | null {
  const c = color.toLowerCase()
  const names = Object.keys(COLOR_SWATCHES).filter((n) => c.includes(n))
  if (!names.length) return null
  names.sort((a, b) => b.length - a.length) // stable: object order breaks ties
  return COLOR_SWATCHES[names[0]]
}

/* ---- building blocks ---------------------------------------------------- */

const PANEL_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-blue-300/70'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-200">{children}</dd>
    </div>
  )
}

/* ---- derived linked-cases panel ------------------------------------------
   (a) plate string appearing in reports.fields JSON (word-boundary match,
       same escaping as CrossrefPanel), (b) cases linked to the OWNER person
       via case_intel_links kind='person'. Deduped by case id; both reasons
       shown when a case matches twice. All inputs RLS-scoped. */

type MatchReason = 'plate mentioned' | 'owner linked'
interface CaseMeta { id: string; case_number: string; title: string | null }
interface LinkedCase { id: string; reasons: MatchReason[]; meta: CaseMeta | null }

function LinkedCasesPanel({ plate, ownerId }: { plate: string; ownerId: string | null }) {
  const router = useRouter()
  const [scan, setScan] = useState<'loading' | 'failed' | 'done'>('loading')
  const [rows, setRows] = useState<LinkedCase[]>([])
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      setScan('loading')
      try {
        // Fail-closed: no per-query .catch(() => []) here — a degraded leg
        // would masquerade as an authoritative "no linked cases".
        const [reports, links] = await Promise.all([
          list('reports', {}),
          ownerId
            ? list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: ownerId } })
                .then((r) => r as unknown as { case_id: string }[])
            : Promise.resolve([] as { case_id: string }[]),
        ])
        const reasons = new Map<string, Set<MatchReason>>()
        const add = (cid: string, why: MatchReason) => {
          const s = reasons.get(cid) ?? new Set<MatchReason>()
          s.add(why)
          reasons.set(cid, s)
        }
        const re = new RegExp('\\b' + plate.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
        for (const r of reports) {
          if (r.case_id && re.test(JSON.stringify(r.fields ?? {}).toUpperCase())) add(r.case_id, 'plate mentioned')
        }
        for (const l of links) add(l.case_id, 'owner linked')
        const ids = [...reasons.keys()]
        const cases = ids.length
          ? ((await list('cases', { select: 'id,case_number,title', in: { id: ids } })) as unknown as CaseMeta[])
          : []
        if (cancelled) return
        const byId = new Map(cases.map((c) => [c.id, c]))
        const out: LinkedCase[] = ids.map((id) => ({ id, reasons: [...(reasons.get(id) ?? [])], meta: byId.get(id) ?? null }))
        out.sort((a, b) => (a.meta?.case_number ?? '').localeCompare(b.meta?.case_number ?? ''))
        setRows(out)
        setScan('done')
      } catch {
        if (!cancelled) setScan('failed')
      }
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [plate, ownerId, retry])

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={PANEL_TITLE}>Linked cases</h3>
        {scan === 'done' && rows.length > 0 && <span className="text-[11px] text-slate-400">{rows.length}</span>}
      </div>
      {scan === 'loading' ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Scanning case reports…</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : scan === 'failed' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          ⚠ Could not scan case reports for this plate (connection issue).{' '}
          <button onClick={() => setRetry((n) => n + 1)} className="rounded p-1 font-semibold underline">Retry</button>
        </div>
      ) : !rows.length ? (
        <EmptyState
          title="NO LINKED CASES"
          hint="Cases appear here when a report mentions this plate or the registered owner is linked to a case."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) =>
            r.meta ? (
              <button
                key={r.id}
                onClick={() => router.push(`/cases?case=${r.id}`)}
                className="flex min-h-[44px] w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
              >
                <span className="font-mono text-blue-300">{r.meta.case_number}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{r.meta.title || 'Untitled case'}</span>
                {r.reasons.map((why) => (
                  <Badge key={why} tone={why === 'plate mentioned' ? 'warn' : 'accent'}>{why}</Badge>
                ))}
              </button>
            ) : (
              // Belt-and-braces: an id from an RLS-visible report whose case
              // row still isn't readable renders as a restricted stub.
              <div key={r.id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm text-slate-400">
                Linked case — access restricted (other bureau).
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  )
}

/* ---- profile view -------------------------------------------------------- */

export function VehicleProfile({ id, onBack }: { id: string; onBack: () => void }) {
  const { state, canEdit } = useAuth()
  const router = useRouter()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [persons, setPersons] = useState<PersonOption[]>([])
  const [gangs, setGangs] = useState<GangOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const vVehicles = useTableVersion('vehicles')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      // Primary lookup stays unwrapped (real error message, not "not found");
      // owner/gang name lookups degrade to [] like the registry's options.
      const [v, p, g] = await Promise.all([
        withRetry(() => list('vehicles', { eq: { id } })),
        list('persons', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'persons'>[]),
        list('gangs', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'gangs'>[]),
      ])
      if (!v[0]) throw new Error('Vehicle not found — it may have been deleted.')
      setVehicle(v[0])
      setPersons(p as unknown as PersonOption[])
      setGangs(g as unknown as GangOption[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state, id])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vVehicles])

  const v = vehicle
  const owner = v?.owner_id ? persons.find((p) => p.id === v.owner_id)?.name ?? null : null
  const gang = v?.gang_id ? gangs.find((g) => g.id === v.gang_id)?.name ?? null : null
  const swatch = v?.color ? colorSwatch(v.color) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={[{ label: 'Vehicles', onClick: onBack }, { label: v?.plate ?? 'Vehicle' }]} />
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <WatchButton type="vehicle" id={id} label={v?.plate} />
          {canEdit && v && <Button onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-4 lg:flex-row">
          <span className="sr-only">Loading vehicle…</span>
          <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
            <Card>
              <Skeleton className="mx-auto h-16 w-16 rounded-full" />
              <Skeleton className="mx-auto mt-3 h-5 w-2/3" />
              <Skeleton className="mx-auto mt-2 h-6 w-1/3" />
              <div className="mt-5 space-y-3">
                {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
              </div>
            </Card>
            <Card>
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="mt-3 h-3 w-full" />
            </Card>
          </div>
          <div className="min-w-0 flex-1">
            <Card>
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="mt-3 h-11 w-full" />
              <Skeleton className="mt-2 h-11 w-full" />
            </Card>
          </div>
        </div>
      ) : err || !v ? (
        <ErrorNotice message={err ?? 'Vehicle not found.'} onRetry={() => void refresh()} />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* LEFT — identity + key-values, then notes. Owner lives here only
              (no separate right-hand Owner panel — avoids duplication). */}
          <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
            <Card className="text-center">
              <div aria-hidden className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-ink-800 text-3xl">🚗</div>
              <h2 className="mt-3 text-xl font-black text-white">{v.model || 'Unknown model'}</h2>
              <p className="mt-2 inline-block rounded-md border border-white/15 bg-ink-800 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-white">{v.plate}</p>
              <dl className="mt-5 divide-y divide-white/5 border-t border-white/5 text-left">
                <Row label="Model">{v.model || <span className="text-slate-400">Unknown</span>}</Row>
                <Row label="Plate">
                  <button
                    onClick={() => copyText(v.plate, 'Plate')}
                    title="Copy plate"
                    className="-my-1 rounded px-1 py-1 font-mono font-bold tracking-widest text-white transition hover:bg-white/5 hover:text-badge-200"
                  >
                    {v.plate}
                  </button>
                </Row>
                <Row label="Color">
                  {v.color ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-white/25"
                        style={{ backgroundColor: swatch ?? 'rgba(255,255,255,0.12)' }}
                      />
                      {v.color}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Row>
                <Row label="Owner">
                  {owner && v.owner_id ? (
                    <button
                      onClick={() => router.push(`/persons?person=${v.owner_id}`)}
                      className="-my-1 rounded px-1 py-1 text-blue-300 transition hover:text-blue-200"
                    >
                      👤 {owner}
                    </button>
                  ) : (
                    <span className="text-slate-400">Unknown</span>
                  )}
                </Row>
                <Row label="Gang">
                  {gang ? (
                    <button
                      onClick={() => router.push(`/gangs?q=${encodeURIComponent(gang)}`)}
                      className="rounded-md bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 transition hover:bg-violet-500/20"
                    >
                      🚩 {gang}
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Row>
                <Row label="Added">{fmtDate(v.created_at)}</Row>
                <Row label="Updated">{timeAgo(v.updated_at)}</Row>
              </dl>
            </Card>
            <Card>
              <h3 className={PANEL_TITLE}>Notes</h3>
              {v.notes
                ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{v.notes}</p>
                : <p className="mt-2 text-sm text-slate-400">No notes.</p>}
            </Card>
          </div>

          {/* RIGHT — derived intelligence. Legal comes from the STRUCTURED
              legal_request_exhibits target rows (RLS-trimmed, sealed-safe);
              linked cases stay a text-scan derivation. */}
          <div className="min-w-0 flex-1 space-y-4">
            <EntityLegalPanel exhibitType="vehicle" sourceId={id} noun="vehicle" />
            <LinkedCasesPanel plate={v.plate} ownerId={v.owner_id} />
          </div>
        </div>
      )}

      {editing && v && (
        <VehicleModal
          record={v}
          persons={persons}
          gangs={gangs}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void refresh() }}
        />
      )}
    </div>
  )
}
