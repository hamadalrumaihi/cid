'use client'

/** Redirect shim for the 14 legacy Intelligence routes (`/persons`, `/bolo`,
 *  …): every existing deep link, bookmark, notification link and case
 *  cross-link keeps working — the route now forwards into the Investigative
 *  Tools workspace instead of rendering the view directly.
 *
 *  Param mapping: tools with a workspace record tab (RECORD_TAB_TOOLS) get
 *  their record param translated (`/persons?person=X` →
 *  `/tools?tool=persons&record=X`); every other query param is carried over
 *  untouched so the views' own deep-link params (`?q=`, `?gang=`, `?focus=`,
 *  `?section=` …) still reach them inside the workspace. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RECORD_PARAM, hasRecordTabs, isToolTab } from '@/lib/toolsModel'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'

export function ToolTabRedirect({ tab }: { tab: string }) {
  const router = useRouter()

  useEffect(() => {
    if (!isToolTab(tab)) { router.replace('/tools'); return }
    const current = new URLSearchParams(window.location.search)
    const next = new URLSearchParams()
    next.set('tool', tab)
    const param = RECORD_PARAM[tab]
    if (param && hasRecordTabs(tab)) {
      const id = current.get(param)
      if (id) { next.set('record', id); current.delete(param) }
    }
    for (const [k, v] of current) if (k !== 'tool' && k !== 'record') next.append(k, v)
    router.replace(`/tools?${next.toString()}`)
  }, [router, tab])

  return <ViewPlaceholder tab={tab} />
}
