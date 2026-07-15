'use client'

/** Lazy shell around the Tiptap markdown editor. The real editor lives in
 *  RichEditorInner.tsx and carries the whole @tiptap bundle — dynamic-importing
 *  it here (ssr off, CaseDetail's CaseGraphTab pattern) keeps that weight out
 *  of every route until an edit surface actually mounts. Same name, same
 *  props, same markdown-in/markdown-out contract — consumers are unchanged;
 *  the loading fallback matches the inner editor's own not-ready placeholder
 *  so the surface doesn't jump when the chunk lands. */
import dynamic from 'next/dynamic'

export const RichEditor = dynamic(() => import('./RichEditorInner').then((m) => m.RichEditorInner), {
  ssr: false,
  loading: () => <div className="rounded-xl border border-white/10 bg-ink-950 p-3 text-sm text-slate-500" style={{ minHeight: '18rem' }}>Loading editor…</div>,
})
