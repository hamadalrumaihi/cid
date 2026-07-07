import { redirect } from 'next/navigation'
import { PAGE_META } from '@/lib/nav'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'

/** One route per leaf tab. Placeholder views are replaced slice-by-slice as
 *  each vanilla view is ported (see docs/REACT-PARITY.md for the order). */

export function generateStaticParams() {
  return Object.keys(PAGE_META).map((tab) => ({ tab }))
}

export default async function TabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  // Vanilla navigate() fallbacks (core.js:909-915): the legacy 'reports' leaf
  // folded into the case detail → cases; anything unknown → command.
  if (tab === 'reports') redirect('/cases')
  if (!(tab in PAGE_META)) redirect('/command')
  return <ViewPlaceholder tab={tab} />
}
