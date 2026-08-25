'use client'

/** Form field primitives. Two problems this solves at once:
 *  1. The exact `inputCls` / `labelCls` strings were copy-pasted as local
 *     consts in 8+ files — exported here so they're declared once.
 *  2. ~25 form files render <label> as styled text with no htmlFor, so screen
 *     readers announce the input with no name (WCAG 1.3.1/4.1.2). <Field>
 *     wires htmlFor/id automatically via useId.
 *
 *  Input/Select/Textarea are thin styled elements that forward every prop and
 *  accept a given id, so behaviour is unchanged. */
import { useId } from 'react'

// min-h-11 floors every control at 44px (touch target); text-base below sm
// keeps iOS from auto-zooming <16px inputs (incl. all date inputs), while
// desktop keeps the denser text-sm.
export const inputCls =
  'min-h-11 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-base text-white outline-none transition focus:border-badge-500 sm:text-sm'
export const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

/** Rose border for a control whose Field carries an error. */
const invalidCls = 'border-rose-500/60 focus:border-rose-400'

interface InvalidProp {
  /** Marks the control invalid: sets aria-invalid and a rose border. Pair it
   *  with <Field error=…> and aria-describedby={fieldErrorId(id)}. */
  invalid?: boolean
}

export function Input({ className = '', invalid, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & InvalidProp) {
  return <input aria-invalid={invalid || undefined} className={`${inputCls} ${invalid ? invalidCls : ''} ${className}`} {...rest} />
}

export function Select({ className = '', invalid, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & InvalidProp) {
  return (
    <select aria-invalid={invalid || undefined} className={`${inputCls} ${invalid ? invalidCls : ''} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', invalid, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & InvalidProp) {
  return <textarea aria-invalid={invalid || undefined} className={`${inputCls} ${invalid ? invalidCls : ''} ${className}`} {...rest} />
}

/** The id of the error line <Field error=…> renders — pass it to the control
 *  as aria-describedby so screen readers announce the error with the field. */
export const fieldErrorId = (id: string): string => `${id}-error`

export interface FieldProps {
  label: string
  /** Optional helper text under the control. */
  hint?: string
  /** Validation error — rendered in rose under the control with id
   *  `fieldErrorId(id)`. NOTE: because `children` is a render prop, Field
   *  cannot reach the control itself; callers pass `invalid` and
   *  `aria-describedby={fieldErrorId(id)}` to the control themselves. */
  error?: string
  /** Decorative asterisk only — the render prop means Field cannot set
   *  `required` on the child; pass it to the control yourself if needed. */
  required?: boolean
  className?: string
  /** Receives the generated id so the control is programmatically labelled. */
  children: (id: string) => React.ReactNode
}

/** Wraps a label + control with a shared generated id. Usage:
 *  <Field label="Name" error={err}>
 *    {(id) => <Input id={id} invalid={!!err} aria-describedby={err ? fieldErrorId(id) : undefined} … />}
 *  </Field> */
export function Field({ label, hint, error, required, className = '', children }: FieldProps) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-rose-300" aria-hidden>*</span>}
      </label>
      {children(id)}
      {error && <p id={fieldErrorId(id)} className="mt-1 text-xs font-semibold text-rose-300">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
