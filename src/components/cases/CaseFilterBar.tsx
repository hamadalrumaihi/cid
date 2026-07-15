'use client'

import { activeProfiles, officerName } from '@/lib/profiles'
import { activeCaseFilterCount, caseViews, EMPTY_FILTERS, setCaseViews, type CaseFilters, type SavedCaseView } from './caseUtils'
import { uiPrompt } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

const BUREAUS = ['LSB', 'BCB', 'SAB', 'JTF']
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

export function CaseFilterBar({ filters, scope, query, activeViewName, onFilters, onScope, onQuery, onActiveViewName }: Props) {
  const views = caseViews()
  const count = activeCaseFilterCount(filters)
  const patch = (p: Partial<CaseFilters>) => onFilters({ ...filters, ...p })

  const saveView = async () => {
    const name = await uiPrompt('Name this case view.', { title: 'Save view', placeholder: 'Active BCB follow-ups', confirmText: 'Save' })
    if (!name) return
    const next: SavedCaseView = { name, filters, scope, q: query }
    setCaseViews([...views.filter((v) => v.name !== name), next])
    onActiveViewName(name)
    toast('Saved case view.', 'success')
  }

  const applyView = (name: string) => {
    onActiveViewName(name)
    const v = views.find((x) => x.name === name)
    if (!v) return
    onFilters({ ...EMPTY_FILTERS, ...v.filters })
    if (v.scope) onScope(v.scope)
    onQuery(v.q ?? '')
  }

  const deleteView = () => {
    if (!activeViewName) return
    setCaseViews(views.filter((v) => v.name !== activeViewName))
    onActiveViewName('')
    toast('Case view deleted.', 'success')
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/50 p-3">
      <div className="grid gap-2 md:grid-cols-5">
        <select aria-label="Filter by bureau" value={filters.bureau} onChange={(e) => patch({ bureau: e.target.value })} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">All bureaus</option>
          {BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}
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
        <select aria-label="Filter by case age" value={filters.stale} onChange={(e) => patch({ stale: e.target.value })} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">Any age</option>
          <option value="stale">Stale (14d+)</option>
          <option value="fresh">Fresh</option>
        </select>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onFilters(EMPTY_FILTERS)}>
            Clear{count ? ` (${count})` : ''}
          </Button>
          <Button onClick={saveView} title="Save view">Save</Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select aria-label="Saved views" value={activeViewName} onChange={(e) => applyView(e.target.value)} className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white">
          <option value="">Saved views</option>
          {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
        {activeViewName && <button onClick={deleteView} className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20">Delete &quot;{activeViewName}&quot;</button>}
      </div>
    </div>
  )
}
