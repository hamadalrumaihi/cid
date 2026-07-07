'use client'

/** Modal primitive — port of the vanilla focus-trapped modal engine
 *  (core.js:980-1049): backdrop + centered card (or right slide-over), focus
 *  trap, Escape/backdrop close routed through a dirty-guard prompt, focus
 *  restore, body scroll lock, and mobile keyboard re-centering. */
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { uiConfirm } from './dialog'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Wider card (max-w-3xl) for dense forms. */
  wide?: boolean
  /** Right-anchored full-height slide-over (intel profiles etc.). */
  slide?: boolean
  /** false → backdrop click does not close (use the × button). */
  dismissible?: boolean
  /** "Is the open editor dirty?" — gates × / Esc / backdrop with a discard
   *  prompt (vanilla Guard, core.js:1038-1049). */
  dirty?: () => boolean
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, children, wide, slide, dismissible = true, dirty }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<Element | null>(null)

  const requestClose = useCallback(async () => {
    if (dirty?.()) {
      const ok = await uiConfirm('You have unsaved changes here. Leave without saving?', {
        title: 'Unsaved changes',
        confirmText: 'Discard changes',
        cancelText: 'Keep editing',
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, onClose])

  // Callers pass inline onClose/dirty props, so their identities change on
  // every parent re-render (which AuthProvider guarantees at least hourly via
  // TOKEN_REFRESHED). Route them through refs so the setup effect below can
  // depend on [open] alone — otherwise each re-render would tear down and
  // re-run it, yanking focus back to the first control mid-interaction.
  const requestCloseRef = useRef(requestClose)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    requestCloseRef.current = requestClose
    dirtyRef.current = dirty
  })

  // Focus management + scroll lock + beforeunload dirty prompt — runs once
  // per open/close transition only.
  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement
    document.body.classList.add('overflow-hidden')
    const card = cardRef.current
    const first = card?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? card)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); void requestCloseRef.current(); return }
      if (e.key !== 'Tab' || !card) return
      const f = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (!f.length) return
      const firstEl = f[0], lastEl = f[f.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current?.()) { e.preventDefault() } }
    // Phones: soft keyboard hides low fields in tall forms — re-center after it animates in.
    const onFocusIn = (e: FocusEvent) => {
      if (window.innerWidth >= 1024) return
      const t = e.target as HTMLElement | null
      if (!t?.closest('[data-modal-card]') || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* older browsers */ } }, 250)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.body.classList.remove('overflow-hidden')
      const lf = lastFocused.current
      if (lf instanceof HTMLElement && document.contains(lf)) lf.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex bg-ink-950/80 backdrop-blur-sm ${slide ? 'items-stretch justify-end' : 'items-center justify-center p-4'}`}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) void requestClose() }}
    >
      <div
        ref={cardRef}
        data-modal-card
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={
          slide
            ? 'modal-card relative ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/10 bg-ink-850 shadow-glow'
            : `modal-card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-850 shadow-glow`
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Standard modal header with a dirty-guarded close ×. */
export function ModalHeader({ title, onClose }: { title: React.ReactNode; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-xl font-bold text-white">{title}</h3>
      <button aria-label="Close" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">
        &times;
      </button>
    </div>
  )
}
