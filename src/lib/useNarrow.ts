'use client'

/** Narrow-viewport signal for the table→cards fallback, extracted from
 *  PersonsView. Via matchMedia + useSyncExternalStore, NOT CSS hiding: a
 *  css-hidden duplicate list still loads every image and doubles the DOM.
 *  The server snapshot is `false` (render the table shape on the server;
 *  the client corrects on hydration). */
import { useSyncExternalStore } from 'react'

const NARROW_MQ = '(max-width: 639px)' // below Tailwind `sm`

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_MQ)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const snapshot = (): boolean => window.matchMedia(NARROW_MQ).matches

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
