'use client'

/** Themed replacements for native confirm/prompt — port of vanilla uiDialog/
 *  uiConfirm/uiPrompt (core.js:1090-1126). Promise-based; rendered as a
 *  top-layer overlay (z-70, above the modal at z-50) so they stack over an
 *  open modal without disturbing it. */
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

interface DialogOptions {
  title?: string
  message?: string
  input?: { placeholder?: string; value?: string }
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface PendingDialog extends DialogOptions {
  id: number
  resolve: (v: boolean | string | null) => void
}

interface DialogState {
  current: PendingDialog | null
  open: (d: Omit<PendingDialog, 'id'>) => void
  finish: (v: boolean | string | null) => void
}

let dlgId = 1
const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  open(d) { set({ current: { ...d, id: dlgId++ } }) },
  finish(v) {
    const c = get().current
    set({ current: null })
    c?.resolve(v)
  },
}))

/** uiConfirm → Promise<boolean>. Danger styling by default (destructive). */
export function uiConfirm(message: string, opts: Omit<DialogOptions, 'message' | 'input'> = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({
      message,
      title: opts.title || 'Please confirm',
      confirmText: opts.confirmText || 'Confirm',
      cancelText: opts.cancelText,
      danger: opts.danger !== false,
      resolve: (v) => resolve(v === true),
    })
  })
}

/** uiPrompt → Promise<string | null> (matches native prompt semantics). */
export function uiPrompt(message: string, opts: { title?: string; placeholder?: string; value?: string; confirmText?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({
      message,
      title: opts.title || '',
      input: { placeholder: opts.placeholder || '', value: opts.value || '' },
      confirmText: opts.confirmText || 'OK',
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    })
  })
}

/** Mounted fresh per dialog (key = dialog id), so input state initializes on
 *  mount instead of being pushed in via an effect. */
function DialogCard({ dialog, finish }: { dialog: PendingDialog; finish: (v: boolean | string | null) => void }) {
  const [val, setVal] = useState(dialog.input?.value || '')
  const okRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const isPrompt = !!dialog.input
  const cancelVal = isPrompt ? null : false

  useEffect(() => {
    const t = setTimeout(() => (isPrompt ? inputRef.current : okRef.current)?.focus(), 30)
    // Capture-phase so this dialog's keys win over the underlying modal's
    // Escape handler. Enter on the focused Cancel button cancels rather than
    // confirming a destructive action (vanilla core.js:1108-1116).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        finish(cancelVal)
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation()
        if (document.activeElement === cancelRef.current) finish(cancelVal)
        else finish(isPrompt ? (inputRef.current?.value.trim() ?? '') : true)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey, true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const okCls = dialog.danger
    ? 'bg-rose-600 hover:bg-rose-500'
    : 'bg-gradient-to-r from-badge-500 to-blue-700 hover:brightness-110'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) finish(cancelVal) }}
    >
      <div className="w-full max-w-[26rem] rounded-2xl border border-white/10 bg-ink-850 p-6 shadow-glow" role="dialog" aria-modal="true">
        {dialog.title && <h3 className="text-base font-bold text-white">{dialog.title}</h3>}
        {dialog.message && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{dialog.message}</p>}
        {isPrompt && (
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={dialog.input?.placeholder}
            className="mt-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={() => finish(cancelVal)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            {dialog.cancelText || 'Cancel'}
          </button>
          <button
            ref={okRef}
            onClick={() => finish(isPrompt ? val.trim() : true)}
            className={`rounded-lg ${okCls} px-4 py-2 text-sm font-semibold text-white shadow-glow transition`}
          >
            {dialog.confirmText || (isPrompt ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  const finish = useDialogStore((s) => s.finish)
  if (!current) return null
  return <DialogCard key={current.id} dialog={current} finish={finish} />
}
