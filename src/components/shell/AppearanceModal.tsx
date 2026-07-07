'use client'

/** Appearance modal — port of vanilla openAppearanceModal/applyAppearance
 *  (core.js:952-977). Accent + density are per-device prefs stored in the
 *  SAME `cid-portal-v3` Store keys and applied to the SAME data attributes
 *  as the vanilla app (continuity hard rule #5). */
import { useState } from 'react'
import { Store } from '@/lib/store'
import { Modal, ModalHeader } from '@/components/ui/Modal'

const ACCENTS: Array<[string, string, string]> = [
  ['blue', 'Electric Blue', '#3b82f6'],
  ['amber', 'Amber', '#f59e0b'],
  ['emerald', 'Emerald', '#10b981'],
  ['rose', 'Rose', '#f43f5e'],
]
const DENSITIES: Array<[string, string]> = [
  ['comfortable', 'Comfortable'],
  ['compact', 'Compact'],
]

export function applyAppearance() {
  const acc = Store.get('accent', 'amber')
  const den = Store.get('density', 'comfortable')
  document.body.dataset.accent = acc
  document.documentElement.dataset.density = den
}

export function AppearanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Local mirror so the option grid re-renders on pick (vanilla re-opens the modal).
  const [acc, setAcc] = useState(() => Store.get('accent', 'amber'))
  const [den, setDen] = useState(() => Store.get('density', 'comfortable'))

  const pickAccent = (k: string) => { Store.set('accent', k); setAcc(k); applyAppearance() }
  const pickDensity = (k: string) => { Store.set('density', k); setDen(k); applyAppearance() }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="🎨 Appearance" onClose={onClose} />
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Accent</p>
        <div className="grid grid-cols-2 gap-2">
          {ACCENTS.map(([k, label, hex]) => (
            <button
              key={k}
              onClick={() => pickAccent(k)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                k === acc ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: hex }} />
              {label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Density</p>
        <div className="grid grid-cols-2 gap-2">
          {DENSITIES.map(([k, label]) => (
            <button
              key={k}
              onClick={() => pickDensity(k)}
              className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                k === den ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate-500">Saved on this device. Applies instantly.</p>
      </div>
    </Modal>
  )
}
