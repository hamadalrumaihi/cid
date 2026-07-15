'use client'

/** The one button. Before this, ~240 buttons across 47 files hand-rolled the
 *  same four class strings (primary gradient / outline / danger / ghost) with
 *  per-site padding and an inconsistent rose shade. This centralises the
 *  variants so a restyle is one edit and the danger shade never drifts again.
 *
 *  Behaviour is a plain <button> — same DOM, same events — so swapping a
 *  hand-rolled button for <Button> never changes what it does. Two opt-ins:
 *  `loading` (disabled + inline spinner, children stay rendered so the width
 *  doesn't collapse) and `onAction` (an async handler routed through
 *  useAction, so busy-guarding + error toasts come for free). */
import { forwardRef } from 'react'
import { useAction } from '@/lib/useAction'

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'warn' | 'ghost'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Externally-driven busy state: disables and shows the inline spinner. */
  loading?: boolean
  /** Async click handler with built-in busy-guarding (useAction): no
   *  double-fire, errors → danger toast, spinner while pending. Takes
   *  precedence over `onClick` when both are provided. */
  onAction?: () => Promise<unknown> | unknown
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

const VARIANTS: Record<Variant, string> = {
  // Accent gradient — the primary call to action. shadow-glow + brightness on
  // hover is the established primary treatment.
  primary: 'bg-gradient-to-r from-badge-500 to-blue-700 text-white shadow-glow hover:brightness-110',
  // Outline chip — the default for secondary actions.
  secondary: 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
  // Destructive — one canonical rose shade (was rose-500 / rose-600 split).
  danger: 'bg-rose-600 text-white shadow-glow hover:bg-rose-500',
  // Confirming/positive — Finalize, Approve, Complete. Mirrors danger's
  // structure so the semantic solids read as one family.
  success: 'bg-emerald-600 text-white shadow-glow hover:bg-emerald-500',
  // Cautionary — Reopen, Escalate, Submit-for-review. Amber counterpart of
  // success; NOT for destructive actions (that's danger).
  warn: 'bg-amber-600 text-white shadow-glow hover:bg-amber-500',
  // Bare — no chrome until hover; for low-emphasis inline actions.
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
}

// useAction must be called unconditionally (hook rules), so buttons without
// an onAction run this placeholder — its busy flag is simply never read.
const NO_ACTION = () => {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type, loading, onAction, onClick, disabled, children, ...rest },
  ref,
) {
  const action = useAction(onAction ?? NO_ACTION)
  const busy = Boolean(loading) || (onAction ? action.busy : false)
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onAction ? () => { void action.run() } : onClick}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy && <span aria-hidden className="btn-spinner" />}
      {children}
    </button>
  )
})
