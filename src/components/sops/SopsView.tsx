'use client'

/** SOPs & Reference Library — route owner for /sops. This component holds the
 *  URL state and nothing else (CommandCenterView's `?s=` precedent):
 *   - `?view=` one of docModel VIEWS (falls back to the Store-persisted view)
 *   - `?doc=<id>` renders the reader instead of the shelf (deep-linkable —
 *     SearchPalette already targets /sops?doc=)
 *   - `?q=` seeds/carries server search
 *  Opening a document uses router.push so browser Back returns to the shelf;
 *  view/filter/query changes use router.replace so they don't pollute
 *  history. The shelf lives in LibraryShelf (+ useLibrary for data); the
 *  reader is lazy-loaded so the landing chunk never carries the document
 *  workflow surface. */
import dynamic from 'next/dynamic'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Store } from '@/lib/store'
import { Notice } from '@/components/ui/Notice'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { VIEWS, type LibraryView } from './docModel'
import type { SuggestChangeContext } from './docSuggestions'
import { LibraryShelf } from './LibraryShelf'

// Lazy reader (RichEditor pattern) — full document bodies, versions and the
// governance workflow only load once a document actually opens.
const DocReader = dynamic(() => import('./DocReader').then((m) => m.DocReader), {
  ssr: false,
  loading: () => <DetailSkeleton />,
})

// Lazy suggestion surfaces — the form (both entry points) and the review
// workspace stay out of the landing chunk until they're actually opened.
const SuggestionForm = dynamic(() => import('./SuggestionForm').then((m) => m.SuggestionForm), { ssr: false })
const SuggestionReview = dynamic(() => import('./SuggestionReview').then((m) => m.SuggestionReview), {
  ssr: false,
  loading: () => <DetailSkeleton />,
})

/** Local state for the suggestion form: a reader context, the general library
 *  entry, or closed. */
type SuggestState = { kind: 'reader'; ctx: SuggestChangeContext } | { kind: 'general' } | null

const isView = (s: string | null): s is LibraryView => !!s && (VIEWS as readonly string[]).includes(s)

export function SopsView() {
  const { state, profile, isCommand, isOwner } = useAuth()
  const sp = useSearchParams()
  const router = useRouter()
  const canReview = isCommand || isOwner
  const canSuggest = !!profile?.active
  const [suggest, setSuggest] = useState<SuggestState>(null)

  // Store-persisted view is only the default — an explicit ?view= always wins
  // (read once in an initializer; localStorage is off-limits during render).
  const [storedView] = useState<LibraryView>(() => {
    const s = Store.get<string>('sopsShelfView', 'library')
    return isView(s) ? s : 'library'
  })
  const urlView = sp.get('view')
  const view: LibraryView = isView(urlView) ? urlView : storedView
  const docId = sp.get('doc')
  const q = sp.get('q') ?? ''

  /** Patch the query string; null/'' deletes a key. push=true for navigation
   *  that Back should undo (opening a document); replace otherwise. */
  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    const params = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    const url = qs ? `/sops?${qs}` : '/sops'
    if (push) router.push(url)
    else router.replace(url)
  }, [sp, router])

  if (state !== 'in') return <Notice text="Sign in to read division SOPs and reference material." />

  const suggestModal = suggest && (
    <SuggestionForm
      context={suggest.kind === 'reader' ? suggest.ctx : null}
      onClose={() => setSuggest(null)}
    />
  )

  if (docId) {
    return (
      <>
        <DocReader
          docId={docId}
          onBack={() => setParams({ doc: null })}
          onOpenDoc={(id: string) => setParams({ doc: id }, true)}
          onSuggestChange={canSuggest ? (ctx) => setSuggest({ kind: 'reader', ctx }) : undefined}
        />
        {suggestModal}
      </>
    )
  }

  // Manager review workspace — reached via ?view=suggestions. `suggestions`
  // isn't a LibraryView, so it never collides with the shelf's tab state.
  if (urlView === 'suggestions' && canReview) {
    return (
      <>
        <SuggestionReview
          onBack={() => setParams({ view: null })}
          onOpenDoc={(id) => setParams({ doc: id, view: null }, true)}
          openId={sp.get('suggestion')}
        />
        {suggestModal}
      </>
    )
  }

  return (
    <>
      <LibraryShelf
        view={view}
        q={q}
        onView={(v) => setParams({ view: v })}
        onQuery={(next) => setParams({ q: next || null })}
        onOpenDoc={(id) => setParams({ doc: id }, true)}
        canSuggest={canSuggest}
        canReviewSuggestions={canReview}
        onSuggest={() => setSuggest({ kind: 'general' })}
        onReviewSuggestions={() => setParams({ view: 'suggestions' })}
      />
      {suggestModal}
    </>
  )
}
