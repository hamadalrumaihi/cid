import { Suspense } from 'react'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { GuidePage } from '@/components/guides/GuidePage'

/** /guides/<slug> — one guide, at its own permanent address.
 *
 *  Deliberately NO generateStaticParams: which guides exist is data (the
 *  public.guides library), not a build-time constant, so a guide added after
 *  a deploy resolves without one. The page itself renders client-side behind
 *  the auth gate like every other portal screen, and RLS decides what the
 *  slug resolves to — a draft the reader may not see is indistinguishable
 *  from a slug that names nothing. */
export default async function GuideSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <Suspense fallback={<ViewPlaceholder tab="guides" />}>
      <GuidePage slug={slug} />
    </Suspense>
  )
}
