'use client'

/** Toast stack — visual port of vanilla core.js toast()/undoToast() markup
 *  (colors, position, popIn entrance), with the status glyphs drawn from the
 *  shared icon set instead of emoji. Sits above the mobile bottom bar
 *  (bottom-20) and at bottom-6 on desktop, same as #toast-root. */
import { useToastStore, type ToastType } from '@/lib/toast'
import { AlertIcon, CheckIcon, InfoIcon, UndoIcon, XMarkIcon } from '@/components/shell/icons'

const COLORS: Record<ToastType, string> = {
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
}
const ICONS: Record<ToastType, (p: { size?: number }) => React.ReactElement> = {
  info: InfoIcon, success: CheckIcon, warn: AlertIcon, danger: XMarkIcon,
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    // z-60: above the modal backdrop (z-50), below confirm dialogs (z-70) —
    // vanilla got this ordering from #toast-root sitting after #modal-root.
    // Bottom offset clears the mobile BottomNav (+ home indicator) via the
    // shared --bottom-nav-h token; lg (not sm) is where the nav disappears.
    <div className="fixed bottom-[calc(var(--bottom-nav-h,0rem)+1rem+env(safe-area-inset-bottom,0px))] right-4 z-[60] flex flex-col gap-3 sm:right-6 lg:bottom-6" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.onUndo ? UndoIcon : ICONS[t.type]
        return (
          <div
            key={t.id}
            className={`modal-card flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl shadow-black/30 backdrop-blur-xl ${COLORS[t.type]}`}
            role="status"
          >
            <span aria-hidden="true" className="flex-shrink-0"><Icon size={16} /></span>
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
        )
      })}
    </div>
  )
}
