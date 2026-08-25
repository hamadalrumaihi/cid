'use client'

import { useAuth } from '@/lib/auth'
import { activeProfiles, officerName } from '@/lib/profiles'
import { useSavedViews } from '@/lib/savedViews'
import { activeCaseFilterCount, EMPTY_FILTERS, type CaseFilters, type SavedCaseViewConfig } from './caseUtils'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Button } from '@/components/ui/Button'
import { HelpTip } from '@/components/ui/HelpTip'
import { toast } from '@/lib/toast'
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
 *  cross-device via user_prefs); applying one only re-applies client filter
 *  state — RLS still decides what the filters can match. */
export function CaseFilterBar({ filters, scope, query, activeViewName, onFilters, onScope, onQuery, onActiveViewName }: Props) {
  const { isCommand } = useAuth()
  const sv = useSavedViews<SavedCaseViewConfig>('cases')
  const count = activeCaseFilterCount(filters)
  const patch = (p: Partial<CaseFilters>) => onFilters({ ...filters, ...p })

  const saveView = async () => {
    const name = await sv.saveViaPrompt({ filters, scope, q: query }, 'Name this case view.')
    if (name) onActiveViewName(name)
  }

  const applyView = (name: string) => {
    onActiveViewName(name)
    const v = sv.views.find((x) => x.name === name)
    if (!v) return
    onFilters({ ...EMPTY_FILTERS, ...v.config.filters })
    if (v.config.scope) onScope(v.config.scope)
    onQuery(v.config.q ?? '')
  }

  const isDefault = sv.defaultView?.name === activeViewName
  const viewMenu: ActionItem[] = [
    {
      label: 'Rename…',
      onClick: () => {
        void sv.renameViaPrompt(activeViewName).then((next) => { if (next) onActiveViewName(next) })
      },
    },
    {
      label: isDefault ? 'Clear default' : 'Set as default',
      onClick: () => {
        void sv.setDefault(isDefault ? null : activeViewName).then((ok) => {
          if (ok) toast(isDefault ? 'Default view cleared.' : `"${activeViewName}" is now your default case view.`, 'success')
        })
      },
    },
    {
      label: `Delete "${activeViewName}"`,
      danger: true,
      separatorBefore: true,
      onClick: () => {
        void sv.remove(activeViewName).then((ok) => {
          if (ok) { onActiveViewName(''); toast('Case view deleted.', 'success') }
        })
      },
    },
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/50 p-3">
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
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onFilters(EMPTY_FILTERS)}>
            Clear{count ? ` (${count})` : ''}
          </Button>
          <Button onClick={() => void saveView()} title="Save the current filters, scope and search as a named view">Save</Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select aria-label="Saved views" value={activeViewName} onChange={(e) => applyView(e.target.value)} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">Saved views</option>
          {/* A ?view= deep link can name a view deleted on another device —
              keep the select honest until the user picks something else. */}
          {activeViewName && !sv.views.some((v) => v.name === activeViewName) && (
            <option value={activeViewName}>{activeViewName}</option>
          )}
          {sv.views.map((v) => <option key={v.name} value={v.name}>{v.name}{v.isDefault ? ' · default' : ''}</option>)}
        </select>
        {activeViewName && <ActionMenu label={`Actions for view "${activeViewName}"`} align="left" items={viewMenu} />}
        {isDefault && activeViewName && <span className="text-xs text-slate-400">Default view — applies when you open Case Files with no filters.</span>}
      </div>
    </div>
  )
}
