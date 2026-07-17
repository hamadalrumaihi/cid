'use client'

/** Bureau ADA coverage — the `doj_bureau_coverage()` RPC rendered as
 *  per-bureau cards (routing precedence acting → primary; a gap is the
 *  parked-at-DOJ condition) plus a compact overview strip for DA/AG/Owner.
 *  Reads stay on the existing definer RPC; writes keep the existing
 *  set_primary_ada / set_acting_ada / assign_ada_to_bureau RPCs verbatim —
 *  never direct table writes. */
import { useCallback, useEffect, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/Field'
import { SectionHeader } from '@/components/ui/PageHeader'
import { useJusticeDirectory } from './legalShared'

export type CoverageRow = Database['public']['Functions']['doj_bureau_coverage']['Returns'][number]

/** RLS-safe coverage read (definer RPC, no request data). `enabled` mirrors
 *  the old portal's render gate so judges never fire the call. */
export function useBureauCoverage(enabled: boolean): { rows: CoverageRow[]; reload: () => void } {
  const [rows, setRows] = useState<CoverageRow[]>([])
  const v = useTableVersion('prosecutor_bureau_assignments')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void rpc('doj_bureau_coverage', {} as never).then((r) => {
      if (!cancelled && !r.error && r.data) setRows(r.data)
    })
    return () => { cancelled = true }
  }, [enabled, v, tick])
  return { rows, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** The live routing ADA for a bureau (acting wins over primary — the exact
 *  precedence get_routing_ada_for_bureau applies server-side). */
function routingName(b: CoverageRow): string | null {
  if (b.acting_name) return `${b.acting_name}${b.acting_role === 'district_attorney' ? ' (DA)' : ''}`
  return b.primary_ada_name
}

/* ── Overview strip (DA/AG/Owner) ───────────────────────────────────────────── */
export function CoverageStrip({ rows, onOpen }: { rows: CoverageRow[]; onOpen: () => void }) {
  if (rows.length === 0) return null
  const gaps = rows.filter((b) => !b.covered)
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Bureau coverage"
        subtitle="Routing ADA per bureau — a gap parks new submissions at DOJ."
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((b) => (
          <Card
            key={b.bureau}
            pad="sm"
            interactive
            role="button"
            tabIndex={0}
            aria-label={`Open roster and coverage for ${b.bureau}`}
            onClick={onOpen}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge-500"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-white">{b.bureau}</span>
              <Badge tone={b.covered ? 'good' : 'danger'}>{b.covered ? 'Covered' : 'No routing ADA'}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">
              Routing: <span className="text-slate-300">{routingName(b) ?? 'None'}</span>
            </p>
          </Card>
        ))}
      </div>
      {gaps.length > 0 && (
        <p className="text-xs text-rose-200">
          New submissions for {gaps.map((g) => g.bureau).join(', ')} park at DOJ until a District Attorney,
          Attorney General or the Owner assigns a routing ADA.
        </p>
      )}
    </section>
  )
}

/* ── Per-bureau coverage cards (Roster & Coverage view) ─────────────────────── */
export function CoverageCards({ rows, canManage, onChanged }: {
  rows: CoverageRow[]
  canManage: boolean
  onChanged: () => void
}) {
  const { entries } = useJusticeDirectory()
  const prosecutors = entries.filter((e) => e.active && e.justice_role === 'assistant_district_attorney')

  const assign = async (bureau: string, type: 'primary' | 'acting' | 'supporting', adaId: string) => {
    const target = entries.find((e) => e.user_id === adaId)
    if (!target) return
    const ok = await uiConfirm(`Make ${target.display_name} the ${type} prosecutor for ${bureau}?`, { title: 'Assign prosecutor' })
    if (!ok) return
    const res = type === 'primary'
      ? await rpc('set_primary_ada', { p_prosecutor: adaId, p_bureau: bureau as 'LSB' })
      : type === 'acting'
        ? await rpc('set_acting_ada', { p_prosecutor: adaId, p_bureau: bureau as 'LSB' })
        : await rpc('assign_ada_to_bureau', { p_prosecutor: adaId, p_bureau: bureau as 'LSB', p_type: 'supporting' })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Assignment recorded.', 'success'); onChanged() }
  }

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Bureau ADA coverage"
        subtitle={canManage
          ? 'Routing precedence: acting, then primary. Supporting assignments carry no routing.'
          : 'Read-only — coverage is managed by a District Attorney, the Attorney General or the Owner.'}
      />
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((b) => {
          const supporting = Array.isArray(b.supporting) ? (b.supporting as { id: string; name: string }[]) : []
          return (
            <Card key={b.bureau} pad="sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-white">{b.bureau}</h3>
                <Badge tone={b.covered ? 'good' : 'danger'}>{b.covered ? 'Covered' : 'No routing ADA'}</Badge>
              </div>
              <dl className="space-y-1 text-xs">
                <div className="flex gap-1.5">
                  <dt className="text-slate-500">Primary</dt>
                  <dd className="text-slate-300">{b.primary_ada_name ?? 'None'}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-slate-500">Acting</dt>
                  <dd className="text-slate-300">
                    {b.acting_name ? `${b.acting_name}${b.acting_role === 'district_attorney' ? ' (DA)' : ''}` : 'None'}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="flex-shrink-0 text-slate-500">Supporting</dt>
                  <dd className="min-w-0 text-slate-300">{supporting.length ? supporting.map((s) => s.name).join(', ') : 'None'}</dd>
                </div>
              </dl>
              {!b.covered && (
                <p className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-[11px] text-rose-200">
                  {b.bureau} currently has no assigned ADA. A District Attorney or Owner must assign a primary or acting
                  ADA before standard legal requests can be submitted to DOJ.
                </p>
              )}
              {canManage && prosecutors.length > 0 && (
                <div className="mt-3 space-y-2">
                  {(['primary', 'acting', 'supporting'] as const).map((t) => (
                    <Field key={t} label={`Assign ${t} prosecutor`}>
                      {(id) => (
                        <Select id={id} value="" onChange={(e) => { if (e.target.value) void assign(b.bureau, t, e.target.value) }}>
                          <option value="">Assign…</option>
                          {prosecutors.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
                        </Select>
                      )}
                    </Field>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
        {rows.length === 0 && <p className="text-sm text-slate-400">Coverage unavailable.</p>}
      </div>
    </section>
  )
}
