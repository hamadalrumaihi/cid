'use client'

/** useAction — the guard around every mutating click. Save/approve/delete
 *  handlers across the views all need the same three things: no double-fire
 *  while the request is in flight, errors humanized into a danger toast
 *  instead of an unhandled rejection, and the busy flag always cleared.
 *  Views keep their own optimistic updates and success toasts inside `fn`. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from './toast'

export interface Action<A extends unknown[]> {
  /** Guarded runner — a no-op while a previous run is still in flight. */
  run: (...args: A) => Promise<void>
  busy: boolean
}

/** The guard itself, split from the hook so it's unit-testable in the node
 *  vitest environment (no renderer needed). `busyRef` is a ref, not state,
 *  so a second click in the same tick — before React re-renders — is caught. */
export async function runGuarded<A extends unknown[]>(
  busyRef: { current: boolean },
  setBusy: (b: boolean) => void,
  fn: (...args: A) => Promise<unknown> | unknown,
  ...args: A
): Promise<void> {
  if (busyRef.current) return
  busyRef.current = true
  setBusy(true)
  try {
    await fn(...args)
  } catch (e) {
    // toast() routes through humanizeError, so DB internals never surface.
    toast(e instanceof Error ? e.message : e, 'danger')
  } finally {
    busyRef.current = false
    setBusy(false)
  }
}

export function useAction<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown> | unknown,
): Action<A> {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  // Keep `fn` current without making `run` change identity every render
  // (callers pass an inline closure) — same idiom as useRegistry's loadRef.
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })

  const run = useCallback(
    (...args: A) => runGuarded(busyRef, setBusy, (...a: A) => fnRef.current(...a), ...args),
    [],
  )
  return { run, busy }
}
