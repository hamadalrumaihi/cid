'use client'

/** Presets + saved views for the Action Center (Phase 7, P7-05 / #377).
 *  One labelled <select> — the role presets the viewer is offered
 *  (lib/actionPresets) above the member's own saved views
 *  (lib/savedViews, section 'action', cross-device via user_prefs) — plus
 *  "Save view" and, for the active saved view, a ⋯ menu with Rename / Set
 *  as default / Delete (the CaseFilterBar idiom).
 *
 *  Selecting only changes URL filter state (`?preset=` / `?view=`); RLS
 *  still decides what any re-applied filter can match. */
import type { SavedViewsApi } from '@/lib/savedViews'
import { availablePresets, defaultPresetFor, type ActionViewConfig, type PresetViewer } from '@/lib/actionPresets'
import { toast } from '@/lib/toast'
import { ActionMenu, type ActionItem as MenuItem } from '@/components/ui/ActionMenu'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'

export function ViewsMenu({ viewer, sv, activePreset, activeView, currentConfig, onSelect }: {
  viewer: PresetViewer
  sv: SavedViewsApi<ActionViewConfig>
  /** `?preset=` in the URL, when it names a real preset. */
  activePreset: string | null
  /** `?view=` in the URL, when it names a saved view. */
  activeView: string | null
  /** What "Save view" snapshots — the URL's f / s / b + the open lanes. */
  currentConfig: ActionViewConfig
  /** `{preset}` / `{view}` to apply, or null to clear both. */
  onSelect: (sel: { preset?: string; view?: string } | null) => void
}) {
  const presets = availablePresets(viewer)
  const suggested = defaultPresetFor(viewer)
  const value = activeView ? `view:${activeView}` : activePreset ? `preset:${activePreset}` : ''

  const saveView = async () => {
    const name = await sv.saveViaPrompt({ ...currentConfig, preset: null }, 'Name this queue view.')
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
        void sv.save(activeView, { ...currentConfig, preset: null }).then((ok) => { if (ok) toast('View updated.', 'success') })
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
    <div className="flex items-center gap-1.5">
      <Select
        aria-label="Queue view"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (!v) onSelect(null)
          else if (v.startsWith('preset:')) onSelect({ preset: v.slice(7) })
          else onSelect({ view: v.slice(5) })
        }}
        className="w-auto min-w-[10rem] py-2 text-xs"
      >
        <option value="">Full queue</option>
        {presets.length > 0 && (
          <optgroup label="Presets">
            {presets.map((p) => (
              <option key={p.id} value={`preset:${p.id}`}>{p.label}{p.id === suggested ? ' (suggested)' : ''}</option>
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
