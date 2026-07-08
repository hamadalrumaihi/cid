'use client'

/** Toast stack — visual port of vanilla core.js toast()/undoToast() markup
 *  (colors, icons, position, popIn entrance). Sits above the mobile bottom
 *  bar (bottom-20) and at bottom-6 on desktop, same as #toast-root. */
import { useToastStore, type ToastType } from '@/lib/toast'

const COLORS: Record<ToastType, string> = {
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
}
const ICONS: Record<ToastType, string> = { info: 'ℹ️', success: '✅', warn: '⚠️', danger: '🚨' }

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    // z-60: above the modal backdrop (z-50), below confirm dialogs (z-70) —
    // vanilla got this ordering from #toast-root sitting after #modal-root.
    <div className="fixed bottom-20 right-4 z-[60] flex flex-col gap-3 sm:bottom-6 sm:right-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`modal-card flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-glow backdrop-blur-xl ${COLORS[t.type]}`}
          role="status"
        >
          <span aria-hidden="true">{t.onUndo ? '↩️' : ICONS[t.type]}</span>
          <span>{t.message}</span>
          {t.onUndo && (
            <button
              className="ml-1 rounded-md border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20"
              onClick={() => {
                dismiss(t.id)
                try { t.onUndo?.() } catch { /* undo handler owns its errors */ }
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
