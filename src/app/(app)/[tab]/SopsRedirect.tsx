'use client'

/** `/sops` — the retired SOPs / Library address.
 *
 *  The division's SOPs, forms and reference documents live in the Guide
 *  Library now (20261112120000). The route stays routable because bookmarks,
 *  the search palette's old document hits, Jump-back recents and cross-links
 *  in other documents all pointed here, and a dead link is the one outcome
 *  the consolidation was supposed to prevent.
 *
 *  `?doc=<uuid>` is resolved rather than dropped: `guides.migrated_document_id`
 *  records which guide each document became, so an old deep link lands on the
 *  SAME document at its new address. The lookup runs through the ordinary
 *  RLS-filtered read, so a document the reader may not see resolves to nothing
 *  and they land on the library — never on an error that confirms it exists. */
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { list } from '@/lib/db'

export function SopsRedirect() {
  const router = useRouter()
  const sp = useSearchParams()

  useEffect(() => {
    const doc = sp.get('doc')
    let live = true
    void (async () => {
      if (!doc) { router.replace('/guides'); return }
      const rows = await list('guides', {
        select: 'slug', eq: { migrated_document_id: doc }, limit: 1,
      }).catch(() => [] as { slug: string }[])
      if (!live) return
      const slug = (rows as { slug: string }[])[0]?.slug
      router.replace(slug ? `/guides/${slug}` : '/guides')
    })()
    return () => { live = false }
  }, [router, sp])

  return <div className="view-in" aria-hidden />
}
