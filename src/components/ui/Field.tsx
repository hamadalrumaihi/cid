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

export const inputCls =
  'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none transition focus:border-badge-500'
export const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

export function Input({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${inputCls} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputCls} ${className}`} {...rest} />
}

export interface FieldProps {
  label: string
  /** Optional helper text under the control. */
  hint?: string
  required?: boolean
  className?: string
  /** Receives the generated id so the control is programmatically labelled. */
  children: (id: string) => React.ReactNode
}

/** Wraps a label + control with a shared generated id. Usage:
 *  <Field label="Name">{(id) => <Input id={id} … />}</Field> */
export function Field({ label, hint, required, className = '', children }: FieldProps) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-rose-300" aria-hidden>*</span>}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
