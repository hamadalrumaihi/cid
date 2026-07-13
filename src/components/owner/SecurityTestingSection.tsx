'use client'

/** Owner Portal — Security Testing (v1.14). A read-only window onto the live
 *  RLS security suites: latest sanitized run results (reported by the suites
 *  themselves via security_test_report(), from CI or a local run), live
 *  fixture health, and leftover test-data counts. HARD RULES honored here:
 *  the browser never runs privileged tests, never sees fixture passwords or
 *  a service key, and never gets raw row content — owner_security_overview()
 *  is is_owner()-gated, audited, and returns sanitized data only. */
import { useCallback, useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { parseSecurityOverview, type SecurityOverview } from '@/lib/schemas'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/Button'

const EXPECTED_MATRIX: { user: string; ownCase: string; otherBureau: string; joint: string; legal: string; justiceAdmin: string; owner: string }[] = [
  { user: 'Detective', ownCase: 'Yes', otherBureau: 'No', joint: 'Assigned only', legal: 'Own / participant', justiceAdmin: 'No', owner: 'No' },
  { user: 'Bureau Lead', ownCase: 'Bureau-wide', otherBureau: 'No', joint: 'Bureau + assigned', legal: 'Supervisor review', justiceAdmin: 'No', owner: 'No' },
  { user: 'ADA', ownCase: 'None', otherBureau: 'No', joint: 'No', legal: 'Assigned requests', justiceAdmin: 'No', owner: 'No' },
  { user: 'DA / AG', ownCase: 'None', otherBureau: 'No', joint: 'No', legal: 'DOJ oversight', justiceAdmin: 'Yes', owner: 'No' },
  { user: 'Judge', ownCase: 'None', otherBureau: 'No', joint: 'No', legal: 'Assigned judicial', justiceAdmin: 'No', owner: 'No' },
  { user: 'Owner', ownCase: 'Oversight', otherBureau: 'Oversight', joint: 'Oversight', legal: 'Oversight', justiceAdmin: 'Yes', owner: 'Yes' },
]

export function SecurityTestingSection() {
  const [data, setData] = useState<SecurityOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    const res = await rpc('owner_security_overview', {} as never)
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    setError(null)
    setData(parseSecurityOverview(res.data))
  }, [])
  useEffect(() => { const t = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(t) }, [load])

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          Could not load the security overview: {error}
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    )
  }
  if (!data) return <p className="text-sm text-slate-400">Loading security overview…</p>

  const unhealthy = data.fixtures.filter((f) => !f.present || f.issues.length > 0)
  const leftoverEntries = Object.entries(data.leftovers).filter(([, n]) => n > 0)
  const latestBySuite = new Map<string, SecurityOverview['runs'][number]>()
  for (const r of data.runs) if (!latestBySuite.has(r.suite)) latestBySuite.set(r.suite, r)

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        Results are reported by the live RLS suites themselves (CI <code className="text-blue-300">security-suites</code> job
        or a local <code className="text-blue-300">npm run test:rls</code>) through an audited, fixture-only RPC — this page
        never runs privileged tests and never sees fixture credentials or raw row content.
      </p>

      {/* Latest run per suite */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Latest runs</h3>
        {latestBySuite.size === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
            No reported runs yet — run <code>npm run test:rls</code> locally or add the fixture-password
            secrets so CI reports here.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from(latestBySuite.values()).map((r) => (
            <div key={r.id} className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-white">{r.suite}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${r.failed > 0 ? 'border-rose-500/25 bg-rose-500/10 text-rose-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'}`}>
                  {r.failed > 0 ? `${r.failed} FAILED` : 'PASSING'}
                </span>
                <span className="text-xs text-slate-500">{timeAgo(r.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {r.passed} passed · {r.failed} failed · {r.skipped} skipped
                {r.duration_ms ? ` · ${Math.round(r.duration_ms / 1000)}s` : ''}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {r.source === 'ci' ? 'CI' : 'local'}
                {r.commit_sha ? ` · ${r.commit_sha.slice(0, 8)}` : ''}
                {r.branch ? ` · ${r.branch}` : ''}
                {r.release ? ` · v${r.release}` : ''}
              </p>
              {r.failures.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {r.failures.map((f, i) => (
                    <li key={i} className="rounded border border-rose-500/20 bg-rose-500/5 p-2 text-xs">
                      <p className="font-semibold text-rose-200">FAIL: {f.name}</p>
                      {f.expected && <p className="text-rose-100/80">Expected: {f.expected}</p>}
                      {f.actual && <p className="text-rose-100/80">Actual: {f.actual}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <Button disabled={busy} onClick={() => void load()}>Refresh</Button>
      </section>

      {/* Fixture health */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Fixture health <span className="normal-case tracking-normal text-slate-500">({data.fixtures.length - unhealthy.length}/{data.fixtures.length} healthy)</span>
        </h3>
        {unhealthy.length === 0
          ? <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">All rls-test fixtures match their expected identity.</p>
          : (
            <div className="space-y-1.5">
              {unhealthy.map((f) => (
                <div key={f.email} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-amber-200">{f.email}</span>
                  <span className="ml-2 text-amber-100/90">{f.present ? f.issues.join(' · ') : 'missing account'}</span>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* Leftover test data */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Leftover test data</h3>
        {leftoverEntries.length === 0
          ? <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">No test-authored records remain — the suites cleaned up after themselves.</p>
          : (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100/90">
              <p className="mb-1 font-semibold text-amber-200">A crashed run may have left residue (the next suite run purges it at startup):</p>
              <p className="font-mono text-xs">{leftoverEntries.map(([k, n]) => `${k}: ${n}`).join(' · ')}</p>
            </div>
          )}
      </section>

      {/* Expected access matrix (documentation, verified by the suites) */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Expected access matrix</h3>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-ink-950/60 text-slate-400">
              <tr>
                {['Identity', 'Own case', 'Other bureau', 'Joint case', 'Legal requests', 'Justice admin', 'Owner portal'].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {EXPECTED_MATRIX.map((row) => (
                <tr key={row.user} className="border-t border-white/5">
                  <td className="px-3 py-2 font-semibold text-white">{row.user}</td>
                  <td className="px-3 py-2">{row.ownCase}</td>
                  <td className="px-3 py-2">{row.otherBureau}</td>
                  <td className="px-3 py-2">{row.joint}</td>
                  <td className="px-3 py-2">{row.legal}</td>
                  <td className="px-3 py-2">{row.justiceAdmin}</td>
                  <td className="px-3 py-2">{row.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          The matrix documents intent; the live suites (99+ assertions) are what verify it. Fixture management is
          test-runner-side by design — see tests/rls/README.md.
        </p>
      </section>
    </div>
  )
}
