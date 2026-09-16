'use client'

/** Optional procedure acknowledgement.
 *
 *  A guide opts in by slug (ACKNOWLEDGEMENT_GUIDES). Nothing else changes for
 *  any other guide: the Guide Library does not gain a compliance surface, no
 *  guide starts demanding a signature, and reading progress stays what it was
 *  — the reader's own record of where they got to.
 *
 *  What an acknowledgement records is exactly the four things asked for: the
 *  user, the policy, the policy VERSION (the guide's current revision number,
 *  so a later revision is a separate acknowledgement rather than a silently
 *  reused one) and the date. `guide_acknowledge` is append-only: there is no
 *  update and no delete policy, so an acknowledgement cannot be withdrawn or
 *  edited after the fact.
 *
 *  It is not a gate. The guide is fully readable whether or not it has been
 *  acknowledged — the procedure requires reading and compliance, and does not
 *  make acknowledgement a precondition of either. */
import { useCallback, useEffect, useState } from 'react'
import { list, rpc } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Tables } from '@/lib/database.types'
import { Button } from '@/components/ui/Button'
import { SLAB } from './guideSurfaces'

/** Guides that offer the acknowledgement. Deliberately a short opt-in list
 *  rather than a flag every guide carries. */
export const ACKNOWLEDGEMENT_GUIDES: ReadonlySet<string> = new Set(['undercover-procedure'])

export const guideOffersAcknowledgement = (slug: string): boolean => ACKNOWLEDGEMENT_GUIDES.has(slug)

type AckRow = Tables<'guide_acknowledgements'>

export function GuideAcknowledgement({ guideId, guideTitle }: { guideId: string; guideTitle: string }) {
  const [rows, setRows] = useState<AckRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // The SELECT policy admits the member's own rows only, so this is already
    // "mine" without asking for a user filter.
    const data = await list('guide_acknowledgements', {
      eq: { guide_id: guideId }, order: 'acknowledged_at', ascending: false,
    }).catch(() => [] as AckRow[])
    setRows(data)
  }, [guideId])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const latest = rows?.[0] ?? null

  const acknowledge = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const res = await rpc('guide_acknowledge', { p_guide: guideId })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Acknowledgement recorded.', 'success')
    void load()
  }, [busy, guideId, load])

  return (
    <section className={`${SLAB} flex flex-col gap-2 px-4 py-3`} aria-label="Procedure acknowledgement">
      <h2 className="text-[13px] font-semibold text-white">Acknowledgement</h2>
      {latest ? (
        <p className="text-sm text-slate-300">
          You acknowledged this procedure on {fmtDate(latest.acknowledged_at)} (version {latest.revision_no}).
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          Optional. Recording an acknowledgement notes that you have read {guideTitle} at its current version.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={latest ? 'ghost' : 'primary'}
          size="sm"
          className="min-h-[44px] sm:min-h-0"
          disabled={busy}
          loading={busy}
          onClick={() => void acknowledge()}
        >
          {latest ? 'Acknowledge the current version' : 'I have read this procedure'}
        </Button>
        <span className="text-[11px] text-slate-500">
          Records your name, the procedure, its version and the date. It cannot be edited or removed afterwards.
        </span>
      </div>
      {rows && rows.length > 1 && (
        <ul className="mt-1 space-y-0.5">
          {rows.slice(1).map((r) => (
            <li key={r.id} className="text-[11px] text-slate-500">
              Version {r.revision_no} · {fmtDate(r.acknowledged_at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
