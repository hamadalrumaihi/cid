'use client'

/** Toast + undo-toast system — ported from vanilla core.js (toast/undoToast/
 *  humanizeError). Imperative `toast()` API so data-layer callers can fire
 *  toasts without threading React context; <Toaster/> renders the stack. */
import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warn' | 'danger'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  /** Present on undo-able toasts: clicking Undo runs it, then dismisses. */
  onUndo?: () => void
}

/** Map raw Postgres/PostgREST error text to human copy so DB internals never
 *  surface in a toast (vanilla core.js humanizeError, audit M6). Unknown
 *  messages pass through unchanged. */
export function humanizeError(message: unknown): string {
  const s = String(message ?? '')
  if (/permission denied|row-level security|not authorized|violates .*(policy|row-level)/i.test(s)) return 'You don’t have permission to do that.'
  if (/duplicate key|already exists|23505/i.test(s)) return 'That already exists — use a unique value.'
  if (/foreign key|23503|still referenced/i.test(s)) return 'That’s still linked to other records and can’t be removed yet.'
  if (/\bJWT\b|not authenticated|invalid (token|claim)|token .*expired/i.test(s)) return 'Your session expired — please sign in again.'
  if (/could not find .*column|column .* does not exist|schema cache|PGRST\d+/i.test(s)) return 'Something didn’t save correctly — please retry.'
  if (/fetch|network|failed to load|connection/i.test(s)) return 'Connection problem — check your network and retry.'
  return s
}

interface ToastState {
  toasts: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>, ttlMs: number) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push(t, ttlMs) {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ttlMs)
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
  },
}))

const TOAST_MS = 3400 // vanilla core.js:463
const UNDO_MS = 6000  // vanilla core.js:468

export function toast(message: unknown, type: ToastType = 'info'): void {
  useToastStore.getState().push({ message: humanizeError(message), type }, TOAST_MS)
}

/** Undo-able toast: shows an "Undo" button for `ms` (default 6s). */
export function undoToast(message: string, onUndo: () => void, ms: number = UNDO_MS): void {
  useToastStore.getState().push({ message, type: 'warn', onUndo }, ms)
}
