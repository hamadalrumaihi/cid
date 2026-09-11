'use client'

/** The Documents tab pill: live case packets + media rows that are documents
 *  or generated derivatives (lib/documents.countCaseDocuments). Case-scoped
 *  realtime on `case_packets` and `media` keeps it honest; `null` while the
 *  first read is in flight so the optional tab never folds into More… before
 *  its count is known (CaseDetail's NO_COUNT rule). */
import { useEffect, useState } from 'react'
import { countCaseDocuments } from '@/lib/documents'
import { useCaseTableVersion } from '@/lib/realtime'

export function useDocumentsCount(caseId: string): number | null {
  const [count, setCount] = useState<{ id: string; n: number } | null>(null)
  const vP = useCaseTableVersion('case_packets', caseId)
  const vM = useCaseTableVersion('media', caseId)
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      countCaseDocuments(caseId)
        .then((n) => { if (alive) setCount({ id: caseId, n }) })
        .catch(() => { /* the pill simply stays unknown; the tab reports the error */ })
    })
    return () => { alive = false }
  }, [caseId, vP, vM])
  return count && count.id === caseId ? count.n : null
}
