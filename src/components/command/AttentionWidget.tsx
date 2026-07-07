'use client'

/** Needs-attention widget (Wave 5, command.js:75-120) — three things that
 *  quietly slip: open cases gone stale (≥14d, matching the auto-escalate
 *  rule), open cases with no lead detective, and cases stuck in the sign-off
 *  chain. A STANDING view over the unfiltered RLS-scoped cache (dashboard
 *  filters never shrink it). Hidden when clean. */
import { useRouter } from 'next/navigation'
import { officerName } from '@/lib/profiles'
import { Store } from '@/lib/store'
import { caseStaleDays, persistCaseFilters } from '@/components/cases/caseUtils'
import type { CaseRow } from './commandUtils'

const signoffAgeDays = (c: CaseRow): number =>
  Math.floor((Date.now() - new Date(c.signoff_submitted_at || c.updated_at).getTime()) / 86400000)

export function AttentionWidget({ cases, onDrillAwaiting }: { cases: CaseRow[]; onDrillAwaiting: () => void }) {
  const router = useRouter()
  const isOpen = (c: CaseRow) => c.status === 'open' || c.status === 'active'
  const stale = cases.filter((c) => isOpen(c) && caseStaleDays(c) >= 14).sort((a, b) => caseStaleDays(b) - caseStaleDays(a))
  const unassigned = cases.filter((c) => isOpen(c) && !c.lead_detective_id).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const awaiting = cases.filter((c) => /^awaiting_/.test(c.signoff_status || '')).sort((a, b) => signoffAgeDays(b) - signoffAgeDays(a))
  if (!stale.length && !unassigned.length && !awaiting.length) return null

  const openCase = (id: string) => router.push(`/cases?case=${encodeURIComponent(id)}`)
  /** Stale/unassigned "all →" jumps to the Cases list with the matching filter
   *  applied. Force 'all' scope: the default 'mine' scope would intersect these
   *  bureau-wide lists (esp. unassigned) down to the empty set. */
  const goCasesFiltered = (go: 'stale' | 'unassigned') => {
    Store.set('casesScope', 'all')
    persistCaseFilters({ bureau: '', status: '', assignee: go === 'unassigned' ? 'unassigned' : '', stale: go === 'stale' ? 'stale' : '' })
    router.push('/cases')
  }

  const row = (c: CaseRow, note: string, noteTint: string) => (
    <button
      key={c.id}
      onClick={() => openCase(c.id)}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left transition hover:border-blue-500/30 hover:bg-white/5"
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-mono text-xs text-blue-300">{c.case_number}</span>{' '}
        <span className="text-xs text-slate-300">{c.title || ''}</span>
      </span>
      <span className={`flex-shrink-0 text-[10px] font-semibold ${noteTint}`}>{note}</span>
    </button>
  )

  const col = (dot: string, title: string, list: CaseRow[], tint: string, rows: React.ReactNode, onAll?: () => void) => (
    <div className="min-w-0 rounded-xl border border-white/5 bg-ink-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${tint}`}>
          <span className={`t-dot ${dot} mr-1`} /> {title} ({list.length})
        </p>
        {list.length > 5 && onAll && (
          <button onClick={onAll} className="text-[11px] font-semibold text-blue-300 hover:text-blue-200">all →</button>
        )}
      </div>
      {list.length ? <div className="space-y-1.5">{rows}</div> : <p className="t-readout text-xs text-slate-600">SYSTEM CLEAR</p>}
    </div>
  )

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-ink-900/60 p-4">
      <p className="t-readout mb-3 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">
        <span className="t-dot t-dot-amber pulse-dot mr-1" /> Needs attention // what&apos;s slipping
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {col('t-dot-amber', 'Stale ≥14d', stale, 'text-amber-300',
          stale.slice(0, 5).map((c) => row(c, `${caseStaleDays(c)}d quiet`, 'text-amber-300')),
          () => goCasesFiltered('stale'))}
        {col('t-dot-rose', 'No lead detective', unassigned, 'text-rose-300',
          unassigned.slice(0, 5).map((c) => row(c, 'unassigned', 'text-rose-300')),
          () => goCasesFiltered('unassigned'))}
        {col('t-dot-cyan', 'Stuck in sign-off', awaiting, 'text-blue-300',
          awaiting.slice(0, 5).map((c) => row(c, `${signoffAgeDays(c)}d waiting on ${officerName(c.signoff_assignee_id) || 'reviewer'}`, 'text-blue-300')),
          onDrillAwaiting)}
      </div>
    </div>
  )
}
