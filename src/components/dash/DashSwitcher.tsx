'use client'

/** The wired dashboard switcher: capability set from useCapabilities, route
 *  state from useNav, narrow fallback via useNarrow. The presentational core
 *  (chips/select, label + route maps) lives in DashSwitcherView.tsx so
 *  Storybook renders it without providers. */

import { useNav } from '@/components/shell/useNav'
import { useCapabilities } from '@/lib/capabilities'
import { useNarrow } from '@/lib/useNarrow'
import { DashSwitcherView } from './DashSwitcherView'

export function DashSwitcher() {
  const caps = useCapabilities()
  const narrow = useNarrow()
  const { activeTab, navigate } = useNav()
  // Nothing renders until the capability model settles — gated chrome must
  // not flash in and out during boot.
  if (!caps.ready) return null
  return (
    <DashSwitcherView
      dashboards={caps.dashboards}
      activeTab={activeTab}
      narrow={narrow}
      onNavigate={navigate}
    />
  )
}
