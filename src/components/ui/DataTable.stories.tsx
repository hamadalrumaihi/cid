import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Tables } from '@/lib/database.types'
import { caseRow } from '@/mocks/fixtures/rows'
import { priorityTint, statusTint } from '@/lib/tint'
import { Badge } from './Badge'
import { DataTable, type DataColumn } from './DataTable'

/** Generic table engine: column sort, cross-column filter, pagination, CSV
 *  export (formula-injection-guarded — see csvCell.test.ts). Rows here come
 *  from the typed src/mocks fixture builders, so the story data matches the
 *  real `cases` schema — no production data, no Supabase. */
const meta = {
  title: 'UI/DataTable',
  component: DataTable,
} satisfies Meta<typeof DataTable>

export default meta
// All stories are render-only (DataTable is generic — concrete usage lives in
// each render), so the bare StoryObj shape applies.
type Story = StoryObj

type CaseRow = Tables<'cases'>

const CASES: CaseRow[] = [
  caseRow({ case_number: 'CID-26-0140', title: 'Vespucci Fencing Ring', status: 'active', priority: 'high', area: 'Vespucci' }),
  caseRow({ case_number: 'CID-26-0155', title: 'Del Perro Wire Fraud', status: 'active', priority: 'critical', area: 'Del Perro' }),
  caseRow({ case_number: 'CID-26-0101', title: 'Mirror Park Burglaries', status: 'open', priority: 'medium', area: 'Mirror Park' }),
  caseRow({ case_number: 'CID-25-0912', title: 'Cold Storage Burglary', status: 'closed', priority: 'low', area: 'La Mesa' }),
  caseRow({ case_number: 'CID-25-0730', title: 'Harmony Chop Shop', status: 'cold', priority: 'medium', area: 'Harmony' }),
]

const COLUMNS: DataColumn<CaseRow>[] = [
  { key: 'case_number', label: 'Case #', value: (r) => r.case_number },
  { key: 'title', label: 'Title', value: (r) => r.title ?? '—' },
  {
    key: 'status',
    label: 'Status',
    value: (r) => r.status,
    render: (r) => <Badge tint={statusTint(r.status)}>{r.status}</Badge>,
  },
  {
    key: 'priority',
    label: 'Priority',
    value: (r) => r.priority ?? '—',
    render: (r) => <Badge tint={priorityTint(r.priority)}>{r.priority ?? '—'}</Badge>,
  },
  { key: 'area', label: 'Area', value: (r) => r.area ?? '—' },
]

export const Default: Story = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      rows={CASES}
      rowKey={(r) => r.id}
      countLabel="cases"
      initialSort={{ key: 'case_number', dir: 'desc' }}
    />
  ),
}

/** csvName enables the ⬇ CSV button — exports the *filtered* rows. */
export const WithCsvExport: Story = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      rows={CASES}
      rowKey={(r) => r.id}
      countLabel="cases"
      csvName="cid-cases"
      filterPlaceholder="Filter cases…"
    />
  ),
}

export const Empty: Story = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      rows={[]}
      rowKey={(r) => r.id}
      countLabel="cases"
      emptyText="No cases match the current scope."
    />
  ),
}

/** 120 generated rows with pageSize 25 — exercises the pager and shows the
 *  count line ("120 cases · N matches" once you type in the filter). */
export const Paginated: Story = {
  render: () => {
    const areas = ['Vespucci', 'Del Perro', 'Mirror Park', 'La Mesa', 'Harmony', 'Paleto']
    const statuses = ['open', 'active', 'cold', 'closed'] as const
    const many = Array.from({ length: 120 }, (_, i) =>
      caseRow({
        case_number: `CID-26-${String(i + 1).padStart(4, '0')}`,
        title: `Registry entry ${i + 1}`,
        status: statuses[i % statuses.length],
        priority: i % 7 === 0 ? 'high' : 'medium',
        area: areas[i % areas.length],
      }),
    )
    return (
      <DataTable
        columns={COLUMNS}
        rows={many}
        rowKey={(r) => r.id}
        pageSize={25}
        countLabel="cases"
        filterPlaceholder="Filter cases…"
      />
    )
  },
}
