'use client'

/** Legal — the case's warrants & subpoenas, grouped exactly like the legal
 *  registry (dispositionFor: one canonical group per request per viewer,
 *  needs-your-action first). Rows come from the shell's ONE case-scoped
 *  workflow fetch (the same narrow LEGAL_LIST_COLS projection the registry
 *  uses) — this tab runs no query of its own.
 *
 *  Sealed safety: it renders ONLY the rows the viewer's own RLS-scoped query
 *  returned — no counts, placeholders or hints beyond that set, so a sealed
 *  request the viewer cannot read leaves no trace here. Creating and
 *  advancing requests stays in /legal and its definer RPCs. */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import type { LegalRequest } from '@/lib/justice'
import { dispositionFor, OP_GROUP_LABEL, type OpGroup } from '@/lib/legalWorkflow'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { LegalRequestCard } from '@/components/justice/LegalRequestCard'
import { buildLegalViewer, useMyProsecutorBureaus } from '@/components/justice/legalShared'

/** Registry triage order (LegalView) + the awareness lane last. */
const GROUP_ORDER: OpGroup[] = [
  'needs_action', 'returned_to_you', 'available_to_claim', 'assigned_to_you',
  'waiting_cid', 'waiting_doj', 'waiting_prosecution', 'waiting_judge',
  'issued_active', 'service_return_pending', 'completed', 'closed', 'awareness',
]

export function LegalTab({ rows }: { rows: LegalRequest[] | null }) {
  const auth = useAuth()
  const router = useRouter()
  const prosecutorBureaus = useMyProsecutorBureaus()
  const now = useNow()
  const viewer = useMemo(
    () => buildLegalViewer(auth, prosecutorBureaus),
    [auth, prosecutorBureaus],
  )

  const grouped = useMemo(() => {
    if (!rows) return []
    const buckets = new Map<OpGroup, LegalRequest[]>()
    for (const r of rows) {
      const g = dispositionFor(r, viewer, now).group
      buckets.set(g, [...(buckets.get(g) ?? []), r])
    }
    return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ group: g, items: buckets.get(g)! }))
  }, [rows, viewer, now])

  if (!rows) return <Notice text="Loading legal requests…" />
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="⚖️"
        title="No legal requests for this case"
        hint="Warrants and subpoenas filed against this case appear here. The wizard picks the case as its first step."
        action={{ label: 'File legal request', onClick: () => router.push('/legal') }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          {rows.length} request{rows.length === 1 ? '' : 's'} on this case. Filing and review stay in the Legal view.
        </p>
        <Button size="sm" onClick={() => router.push('/legal')}>Open Legal ↗</Button>
      </div>
      {grouped.map(({ group, items }) => (
        <section key={group} className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            {OP_GROUP_LABEL[group]}
            <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{items.length}</span>
          </h3>
          <div className="grid gap-2">
            {items.map((r) => (
              <LegalRequestCard
                key={r.id}
                request={r}
                viewer={viewer}
                now={now}
                showClassification
                onOpen={() => router.push(`/legal?request=${encodeURIComponent(r.id)}`)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
