import { Suspense } from 'react'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { GuideLibraryView } from '@/components/guides/GuideLibraryView'

/** /guides — the Guide Library.
 *
 *  Guides get their own top-level destination rather than a tab inside Tools,
 *  the Handbook or Organizations. This is a real route segment sitting beside
 *  the dynamic `[tab]` route: a literal segment wins over a dynamic one, and
 *  `[tab]`'s generateStaticParams deliberately omits 'guides' so the two never
 *  prerender the same path. */
export default function GuidesPage() {
  return (
    <Suspense fallback={<ViewPlaceholder tab="guides" />}>
      <GuideLibraryView />
    </Suspense>
  )
}
