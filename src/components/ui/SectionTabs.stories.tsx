import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from './Card'
import {
  SectionTabs, panelDomId, tabDomId,
  type SectionTab, type SectionTabGroup,
} from './SectionTabs'

/** Horizontally-scrolling tab strip with roving-tabindex keyboard focus
 *  (arrows/Home/End move focus, click activates) and scroll-position overflow
 *  fades. The parent owns the active id — stories hold it in local state. */
const meta = {
  title: 'UI/SectionTabs',
  component: SectionTabs,
} satisfies Meta<typeof SectionTabs>

export default meta
// The parent owns the active id, so every story is a render-only wrapper.
type Story = StoryObj

function TabsDemo({ tabs, groups, idBase }: {
  tabs: ReadonlyArray<SectionTab<string>>
  groups?: ReadonlyArray<SectionTabGroup<string>>
  idBase: string
}) {
  const [active, setActive] = useState(tabs[0].id)
  const current = tabs.find((t) => t.id === active)
  return (
    <div className="max-w-2xl">
      <SectionTabs tabs={tabs} groups={groups} active={active} onChange={setActive} idBase={idBase} />
      <Card
        className="mt-3"
        role="tabpanel"
        id={panelDomId(idBase, active)}
        aria-labelledby={tabDomId(idBase, active)}
      >
        <p className="text-sm text-slate-300">Panel for “{current?.label}”.</p>
      </Card>
    </div>
  )
}

export const Default: Story = {
  render: () => (
    <TabsDemo
      idBase="sb-tabs-default"
      tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'reports', label: 'Reports' },
        { id: 'tasks', label: 'Tasks' },
        { id: 'media', label: 'Media' },
      ]}
    />
  ),
}

/** Counts render as trailing pills (`0` renders a muted zero, `undefined`
 *  renders nothing); `marker` adds the amber needs-attention dot. */
export const CountsAndMarker: Story = {
  render: () => (
    <TabsDemo
      idBase="sb-tabs-counts"
      tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'reports', label: 'Reports', count: 4 },
        { id: 'tasks', label: 'Tasks', count: 0 },
        { id: 'intel', label: 'Intel', marker: true, markerLabel: 'Stale intel — review needed' },
      ]}
    />
  ),
}

export const Grouped: Story = {
  render: () => (
    <TabsDemo
      idBase="sb-tabs-grouped"
      tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'reports', label: 'Reports', count: 2 },
        { id: 'tasks', label: 'Tasks', count: 5 },
        { id: 'media', label: 'Media', count: 12 },
        { id: 'legal', label: 'Legal', count: 1 },
        { id: 'graph', label: 'Graph' },
      ]}
      groups={[
        { label: 'Casework', tabs: ['overview', 'reports', 'tasks'] },
        { label: 'Evidence', tabs: ['media', 'legal'] },
      ]}
    />
  ),
}

/** Enough tabs to overflow a narrow container — scroll to see the edge fades
 *  track the real scroll position. */
export const Overflowing: Story = {
  render: () => (
    <div className="max-w-md">
      <TabsDemo
        idBase="sb-tabs-overflow"
        tabs={Array.from({ length: 12 }, (_, i) => ({
          id: `section-${i + 1}`,
          label: `Section ${i + 1}`,
          count: i % 3 === 0 ? i : undefined,
        }))}
      />
    </div>
  ),
}
