import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { WorkspaceTab } from '@/lib/workspace/model'
import { WorkspaceTabBar } from './WorkspaceTabBar'

/** The unified workspace's tab strip: Directory chip, then tool / record /
 *  case tabs (kind icon; case numbers in mono), a dirty dot for unsaved
 *  work, close / close others / close all (right-click menu and the "Open
 *  tabs" sheet), drag or Alt+arrow reorder. Presentational — the provider
 *  owns the state; here a tiny wrapper keeps it in React state so the
 *  controls work in the canvas. */
const TABS: WorkspaceTab[] = [
  { key: 'tool:persons', kind: 'tool', id: 'persons', toolId: 'persons', title: 'Persons' },
  { key: 'record:persons:p1', kind: 'record', id: 'p1', toolId: 'persons', title: 'Marcus Reed' },
  { key: 'case:c1', kind: 'case', id: 'c1', title: 'CID-26-0140', section: 'tasks', dirty: true },
  { key: 'case:c2', kind: 'case', id: 'c2', title: 'CID-26-0152' },
  { key: 'tool:vehicles', kind: 'tool', id: 'vehicles', toolId: 'vehicles', title: 'Vehicles' },
]

function Harness({ initial, active }: { initial: WorkspaceTab[]; active: string | null }) {
  const [tabs, setTabs] = useState(initial)
  const [activeKey, setActiveKey] = useState<string | null>(active)
  const close = (keys: string[]) => {
    setTabs((t) => t.filter((x) => !keys.includes(x.key)))
    setActiveKey((k) => (k && keys.includes(k) ? null : k))
  }
  return (
    <div className="min-h-64 px-4 pt-2">
      <WorkspaceTabBar
        tabs={tabs}
        activeKey={activeKey}
        onActivate={setActiveKey}
        onClose={(k) => close([k])}
        onCloseOthers={(k) => close(tabs.filter((t) => t.key !== k).map((t) => t.key))}
        onCloseAll={() => close(tabs.map((t) => t.key))}
        onReorder={(from, to) => setTabs((t) => { const n = [...t]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n })}
        onDirectory={() => setActiveKey(null)}
      />
      <p className="text-sm text-slate-400">
        {activeKey ? `Active: ${activeKey}` : 'Directory'} · {tabs.length} open
      </p>
    </div>
  )
}

const meta = {
  title: 'Workspace/WorkspaceTabBar',
  component: WorkspaceTabBar,
  parameters: { layout: 'fullscreen' },
  // Defaults for the Controls panel; the stories below render through the
  // stateful harness so the strip actually responds.
  args: {
    tabs: TABS, activeKey: 'case:c1',
    onActivate: fn(), onClose: fn(), onCloseOthers: fn(), onCloseAll: fn(), onReorder: fn(), onDirectory: fn(),
  },
} satisfies Meta<typeof WorkspaceTabBar>

export default meta
type Story = StoryObj<typeof meta>

export const Mixed: Story = {
  render: () => <Harness initial={TABS} active="case:c1" />,
}

export const DirectoryActive: Story = {
  render: () => <Harness initial={TABS} active={null} />,
}

export const Empty: Story = {
  render: () => <Harness initial={[]} active={null} />,
}

/** Eight case tabs — the cap. The ninth open is refused by the provider
 *  (CaseCapPrompt); the strip itself just scrolls. */
export const AtTheCaseCap: Story = {
  render: () => (
    <Harness
      initial={Array.from({ length: 8 }, (_, i) => ({
        key: `case:c${i}`, kind: 'case' as const, id: `c${i}`, title: `CID-26-01${40 + i}`,
      }))}
      active="case:c3"
    />
  ),
}
