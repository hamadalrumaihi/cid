'use client'

/** What a case tab shows when CaseDetail's fetch yields no row (P3-07):
 *   - the fetch THREW → ErrorNotice with retry (network / transient);
 *   - the row exists only with includeDeleted → DeletedCaseNotice;
 *   - the row loaded once and vanished → "access ended" (joint expiry, RLS
 *     change) — CaseDetail's existing distinction, kept verbatim;
 *   - otherwise, for an active CID member → AccessRequestPanel (see its
 *     header for why no server probe decides "ordinary"); for everyone else
 *     (SIB, oversight, inactive) the plain "Case not found." line.
 *  Never renders a case number it did not read itself. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useSiu } from '@/lib/permissions'
import { ErrorNotice, Notice } from '@/components/ui/Notice'
import { AccessRequestPanel } from './AccessRequestPanel'
import { DeletedCaseNotice } from './DeletedCaseNotice'

export interface CaseMissingInfo {
  /** The id loaded at least once this visit (then vanished on refetch). */
  everLoaded: boolean
  /** The fetch threw (not an empty result). */
  error: unknown
  retry: () => void
}

type Probe = { state: 'probing' } | { state: 'deleted'; caseNumber: string | null } | { state: 'absent' }

export function MissingCaseState({ caseId, everLoaded, error, retry }: CaseMissingInfo & { caseId: string }) {
  const { profile } = useAuth()
  const siu = useSiu()
  const [probe, setProbe] = useState<Probe>({ state: 'probing' })

  // Trash probe — an ordinary member gets [] here too (RLS), so the only
  // information this can reveal is to someone allowed to see the Trash.
  useEffect(() => {
    if (error) return
    let live = true
    queueMicrotask(() => {
      void list('cases', { select: 'id,case_number,deleted_at', eq: { id: caseId }, includeDeleted: true, limit: 1 })
        .then((rows) => {
          if (!live) return
          const row = rows[0]
          setProbe(row?.deleted_at ? { state: 'deleted', caseNumber: row.case_number ?? null } : { state: 'absent' })
        })
        .catch(() => { if (live) setProbe({ state: 'absent' }) })
    })
    return () => { live = false }
  }, [caseId, error])

  if (error) return <ErrorNotice message={error} onRetry={retry} />
  if (probe.state === 'probing') return <Notice text="Checking this case…" />
  if (probe.state === 'deleted') return <DeletedCaseNotice caseId={caseId} caseNumber={probe.caseNumber} onRestored={retry} />
  if (everLoaded) return <Notice text="This case is no longer available to you — your access may have ended." />
  const cidMember = !!profile?.active && !siu.inSiu
  return cidMember ? <AccessRequestPanel caseId={caseId} /> : <Notice text="Case not found." />
}
