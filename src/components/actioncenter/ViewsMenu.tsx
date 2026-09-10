'use client'

/** Presets + saved views for the Action Center (Phase 7, P7-05 / #377) —
 *  the shared `components/shared/ViewsMenu` fed with the role presets the
 *  viewer is offered (lib/actionPresets). Selecting only changes URL filter
 *  state (`?preset=` / `?view=`); RLS still decides what a filter can match. */
import type { SavedViewsApi } from '@/lib/savedViews'
import { availablePresets, defaultPresetFor, type ActionViewConfig, type PresetViewer } from '@/lib/actionPresets'
import { ViewsMenu as SharedViewsMenu } from '@/components/shared/ViewsMenu'

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
  const suggested = defaultPresetFor(viewer)
  const presets = availablePresets(viewer).map((p) => ({ id: p.id, label: p.label, suggested: p.id === suggested }))
  return (
    <SharedViewsMenu<ActionViewConfig>
      label="Queue view"
      emptyLabel="Full queue"
      presets={presets}
      sv={sv}
      activePreset={activePreset}
      activeView={activeView}
      currentConfig={currentConfig}
      onSelect={onSelect}
      savePrompt="Name this queue view."
      normalize={(c) => ({ ...c, preset: null })}
    />
  )
}
