import { Suspense } from 'react'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { MobileCaseView } from '@/components/mobile/MobileCaseView'

/** Phone-first case screen (plan §5.5 / §8.2, P8-01): `/m/cases/<id>?s=<section>`.
 *  A dynamic segment with NO generateStaticParams — the id is runtime data
 *  the client view reads through useParams(), so nothing is prerendered per
 *  case and the page needs no server data access (RLS decides what the
 *  client may read, exactly as on the workspace). The (app) layout still
 *  wraps this in the auth gate + AppShell; the shell renders its minimal
 *  chrome for `/m/` paths. */
export default function MobileCasePage() {
  return (
    <Suspense fallback={<ViewPlaceholder tab="cases" />}>
      <MobileCaseView />
    </Suspense>
  )
}
