'use client'

/** The Owner Console's panel surface — `Card pad="md"` + a SectionHeader,
 *  the shape every section body in OwnerView uses. Shared by the System
 *  Health panels so they line up with the rest of the console. */
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'

export function OwnerPanel({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card pad="md">
      <SectionHeader title={title} subtitle={sub} actions={actions} />
      <div className="mt-3">{children}</div>
    </Card>
  )
}
