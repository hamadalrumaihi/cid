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
import { list } from '@/lib/db'
import { toast } from '@/lib/toast'
import { reindexLibrary } from '@/lib/docSections'
import { Store } from '@/lib/store'
import { Notice } from '@/components/ui/Notice'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { VIEWS, type LibraryView } from './docModel'
import type { SuggestChangeContext } from './docSuggestions'
import { AskLibrary } from './AskLibrary'
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

  // Indexes exactly the documents this viewer could open one at a time; the
  // server refuses anything else, so the sweep can never widen what they read.
  const reindexAll = async () => {
    const docs = await list('documents', { select: 'id', limit: 500 }).catch(() => [])
    if (!docs.length) { toast('No documents to index.', 'warn'); return }
    toast(`Rebuilding the index for ${docs.length} document${docs.length === 1 ? '' : 's'}...`, 'info')
    const r = await reindexLibrary(docs.map((d) => d.id))
    toast(
      `Indexed ${r.indexed} document${r.indexed === 1 ? '' : 's'} into ${r.sections} sections`
      + (r.refused ? `; ${r.refused} skipped (empty or not yours to index)` : '') + '.',
      r.indexed ? 'success' : 'warn',
    )
  }

  return (
    <div className="space-y-5">
      {/* Retrieval, not generation: real sections of real documents, cited and
          version-stamped, bounded by the asker's own RLS. Nothing is sent
          anywhere and nothing is written, so it cannot invent a rule. */}
      <AskLibrary onOpenSection={(id, anchor) => {
        setParams({ doc: id }, true)
        window.location.hash = anchor
      }} />
      <LibraryShelf
        view={view}
        q={q}
        onView={(v) => setParams({ view: v })}
        onQuery={(next) => setParams({ q: next || null })}
        onOpenDoc={(id, anchor) => {
          setParams({ doc: id }, true)
          // The hash is what DocReader already listens to for section jumps,
          // so a search hit lands on the paragraph rather than the title.
          if (anchor) window.location.hash = anchor
        }}
        canSuggest={canSuggest}
        canReviewSuggestions={canReview}
        onSuggest={() => setSuggest({ kind: 'general' })}
        onReviewSuggestions={() => setParams({ view: 'suggestions' })}
        canReindex={canReview}
        onReindex={() => void reindexAll()}
      />
      {suggestModal}
    </div>
  )
}
