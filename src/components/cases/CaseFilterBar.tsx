'use client'

import { useAuth } from '@/lib/auth'
import { activeProfiles, officerName } from '@/lib/profiles'
import { useSavedViews } from '@/lib/savedViews'
import { activeCaseFilterCount, EMPTY_FILTERS, type CaseFilters, type SavedCaseViewConfig } from './caseUtils'
import { ViewsMenu } from '@/components/shared/ViewsMenu'
import { Button } from '@/components/ui/Button'
import { HelpTip } from '@/components/ui/HelpTip'
import { PERMANENT_BUREAUS, bureauLabel } from '@/lib/roles'

/** Filterable bureaus: the permanent bureaus, SIB (rows the viewer is cleared
 *  for — RLS already scopes the list), and the temporary JTF designation. */
const BUREAUS = [...PERMANENT_BUREAUS, 'special_investigations', 'JTF']
const STATUSES = ['open', 'active', 'cold', 'closed']

interface Props {
  filters: CaseFilters
  scope: string
  query: string
  activeViewName: string
  onFilters: (next: CaseFilters) => void
  onScope: (scope: string) => void
  onQuery: (query: string) => void
  onActiveViewName: (name: string) => void
}

/** The filter bar is shared by all three case layouts (table/grid/board) —
 *  CasesView renders it above the layout switch, so saved views stay visible
 *  and applicable in every mode. Views live in lib/savedViews ('cases',
 *  cross-device via user_prefs) behind the shared `ViewsMenu`; applying one
 *  only re-applies client filter state — RLS still decides what the filters
 *  can match. */
export function CaseFilterBar({ filters, scope, query, activeViewName, onFilters, onScope, onQuery, onActiveViewName }: Props) {
  const { isCommand } = useAuth()
  const sv = useSavedViews<SavedCaseViewConfig>('cases')
  const count = activeCaseFilterCount(filters)
  const patch = (p: Partial<CaseFilters>) => onFilters({ ...filters, ...p })

  // Selecting a view applies its snapshot; clearing only drops the ?view=
  // marker (the filters stay as they are, as before). A ?view= deep link can
  // name a view deleted on another device — the menu then shows no active
  // view until the user picks one.
  const selectView = (sel: { preset?: string; view?: string } | null) => {
    if (!sel?.view) { onActiveViewName(''); return }
    onActiveViewName(sel.view)
    const v = sv.views.find((x) => x.name === sel.view)
    if (!v) return
    onFilters({ ...EMPTY_FILTERS, ...v.config.filters })
    if (v.config.scope) onScope(v.config.scope)
    onQuery(v.config.q ?? '')
  }
  const knownActive = sv.views.some((v) => v.name === activeViewName) ? activeViewName : null

  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
      <div className="grid gap-2 md:grid-cols-5">
        <select aria-label="Filter by bureau" value={filters.bureau} onChange={(e) => patch({ bureau: e.target.value })} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">All bureaus</option>
          {BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => patch({ status: e.target.value })} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <select aria-label="Filter by lead" value={filters.assignee} onChange={(e) => patch({ assignee: e.target.value })} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">Any lead</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <select aria-label="Filter by case age" value={filters.stale} onChange={(e) => patch({ stale: e.target.value })} className="w-full min-w-0 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
            <option value="">Any age</option>
            <option value="stale">Stale (14d+)</option>
            <option value="fresh">Fresh</option>
            {/* Command triage lens (lib/caseHealth's list-safe flags). Also kept
                when a saved view / persisted filter already carries it, so the
                select never shows a blank for an active value. */}
            {(isCommand || filters.stale === 'attention') && <option value="attention">Needs attention</option>}
            {/* Sign-off / task lenses (Phase-2A overview strip + presets) —
                client filters over RLS-visible rows, like every other value. */}
            <option value="awaiting">Awaiting sign-off</option>
            <option value="returned">Returned (sign-off)</option>
            <option value="overdue_tasks">Overdue tasks</option>
          </select>
          {isCommand && (
            <HelpTip label="What counts as needs attention" align="right" className="shrink-0">
              <p><span className="font-semibold text-white">Needs attention</span> shows open cases with at least one health flag a list row can see: no lead detective, no summary, quiet 14 days or more, or a follow-up date that has passed.</p>
            </HelpTip>
          )}
        </div>
        <Button onClick={() => onFilters(EMPTY_FILTERS)}>
          Clear{count ? ` (${count})` : ''}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ViewsMenu<SavedCaseViewConfig>
          label="Case view"
          emptyLabel="All cases"
          sv={sv}
          activeView={knownActive}
          currentConfig={{ filters, scope, q: query }}
          onSelect={selectView}
          savePrompt="Name this case view."
        />
      </div>
    </div>
  )
}
