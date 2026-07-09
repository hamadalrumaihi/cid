'use client'

/** The one button. Before this, ~240 buttons across 47 files hand-rolled the
 *  same four class strings (primary gradient / outline / danger / ghost) with
 *  per-site padding and an inconsistent rose shade. This centralises the
 *  variants so a restyle is one edit and the danger shade never drifts again.
 *
 *  Behaviour is a plain <button> — same DOM, same events — so swapping a
 *  hand-rolled button for <Button> never changes what it does. */
import { forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
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
  // Bare — no chrome until hover; for low-emphasis inline actions.
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
})
