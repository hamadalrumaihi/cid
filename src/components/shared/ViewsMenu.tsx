'use client'

/** ONE saved-views control for every list surface (cases, BOLO, legal,
 *  persons, the Action Center, the Informants roster …) — the Action Center's
 *  Phase 7 menu, generalised. One labelled <select>: the optional presets the
 *  surface offers, then the member's own saved views (lib/savedViews, one
 *  `user_prefs` row per section, cross-device), plus "Save view" and, for the
 *  active saved view, a ⋯ menu with Rename / Update / Set as default / Delete.
 *
 *  The config is opaque to this component: the surface decides what a view
 *  snapshots and how a selection is applied (usually URL state). Selecting a
 *  view changes filters only — RLS still decides what any filter can match. */
import type { SavedViewsApi } from '@/lib/savedViews'
import { toast } from '@/lib/toast'
import { ActionMenu, type ActionItem as MenuItem } from '@/components/ui/ActionMenu'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'

export interface ViewPreset {
  id: string
  label: string
  /** Marked "(suggested)" in the list — the preset the surface would pick by default. */
  suggested?: boolean
}

export interface ViewsMenuProps<C> {
  /** Accessible name of the select ("Queue view", "Case view" …). */
  label: string
  /** The first option — what "no preset, no view" means ("Full queue", "All cases"). */
  emptyLabel?: string
  /** Optional role / surface presets listed above the saved views. */
  presets?: readonly ViewPreset[]
  sv: SavedViewsApi<C>
  /** The active preset id (e.g. `?preset=`), when it names a real preset. */
  activePreset?: string | null
  /** The active saved view name (e.g. `?view=`), when it names a saved view. */
  activeView: string | null
  /** What "Save view" snapshots — the surface's current filter state. */
  currentConfig: C
  /** `{preset}` / `{view}` to apply, or null to clear both. */
  onSelect: (sel: { preset?: string; view?: string } | null) => void
  /** Prompt copy for the save dialog. */
  savePrompt?: string
  /** Applied to the saved config (e.g. clear a `preset` key) before storing. */
  normalize?: (config: C) => C
  className?: string
}

export function ViewsMenu<C>({
  label, emptyLabel = 'All', presets = [], sv, activePreset = null, activeView, currentConfig, onSelect,
  savePrompt = 'Name this view.', normalize, className,
}: ViewsMenuProps<C>) {
  const value = activeView ? `view:${activeView}` : activePreset ? `preset:${activePreset}` : ''
  const snapshot = () => (normalize ? normalize(currentConfig) : currentConfig)

  const saveView = async () => {
    const name = await sv.saveViaPrompt(snapshot(), savePrompt)
    if (name) onSelect({ view: name })
  }

  const isDefault = !!activeView && sv.defaultView?.name === activeView
  const viewMenu: MenuItem[] = activeView ? [
    {
      label: 'Rename…',
      onClick: () => {
        void sv.renameViaPrompt(activeView).then((next) => { if (next) onSelect({ view: next }) })
      },
    },
    {
      label: 'Update with current filters',
      onClick: () => {
        void sv.save(activeView, snapshot()).then((ok) => { if (ok) toast('View updated.', 'success') })
      },
    },
    {
      label: isDefault ? 'Clear default' : 'Set as default',
      onClick: () => {
        void sv.setDefault(isDefault ? null : activeView).then((ok) => {
          if (ok) toast(isDefault ? 'Default view cleared.' : `"${activeView}" opens by default now.`, 'success')
        })
      },
    },
    {
      label: `Delete "${activeView}"`,
      danger: true,
      separatorBefore: true,
      onClick: () => {
        void sv.remove(activeView).then((ok) => { if (ok) { onSelect(null); toast('View deleted.', 'success') } })
      },
    },
  ] : []

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <Select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (!v) onSelect(null)
          else if (v.startsWith('preset:')) onSelect({ preset: v.slice(7) })
          else onSelect({ view: v.slice(5) })
        }}
        className="w-auto min-w-[10rem] py-2 text-xs"
      >
        <option value="">{emptyLabel}</option>
        {presets.length > 0 && (
          <optgroup label="Presets">
            {presets.map((p) => (
              <option key={p.id} value={`preset:${p.id}`}>{p.label}{p.suggested ? ' (suggested)' : ''}</option>
            ))}
          </optgroup>
        )}
        {sv.views.length > 0 && (
          <optgroup label="My views">
            {sv.views.map((v) => (
              <option key={v.name} value={`view:${v.name}`}>{v.name}{v.isDefault ? ' (default)' : ''}</option>
            ))}
          </optgroup>
        )}
      </Select>
      <Button size="sm" className="min-h-[40px] lg:min-h-0" onAction={saveView} title="Save the current filters as a named view">
        Save view
      </Button>
      {activeView && <ActionMenu items={viewMenu} label={`View "${activeView}" actions`} buttonClassName="min-h-[40px] lg:min-h-9" />}
    </div>
  )
}
