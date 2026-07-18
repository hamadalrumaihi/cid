'use client'

/** Add / future-sale entry form for the restricted Street-Value Observations
 *  section. A self-contained modal that LIVE-derives totals, $/unit
 *  and converted weight through the pure model (narcoticsSales) as the analyst
 *  types, surfaces validateObservationDraft messages (blocking vs. warning),
 *  and submits via the definer RPC. Original recorded units are preserved —
 *  weight is never pre-converted; weight_is_derived is set only when the entered
 *  unit isn't grams. The server (RLS + the RPC) stays the authority. */
import { useMemo, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import {
  saleMetrics, validateObservationDraft, isBlockingError,
  formatMoney, formatProceeds, formatInt,
} from './narcoticsSales'

const PRODUCT_STATES = [
  ['wet', 'Wet'], ['dried', 'Dried'], ['bagged', 'Bagged'], ['unknown', 'Unknown state'],
] as const
const PAYMENT_TYPES = [
  ['dirty_money', 'Dirty money'], ['cash', 'Cash'], ['bank', 'Bank'], ['unknown', 'Unknown'],
] as const
const DATE_PRECISIONS = [
  ['exact', 'Exact'], ['day', 'Approx. day'], ['relative', 'Relative'], ['unknown', 'Unverified'],
] as const
const WEIGHT_UNITS = ['g', 'kg', 'lb', 'oz'] as const

interface StackDraft { units: string; value: string; unit: string }

const emptyStack = (): StackDraft => ({ units: '', value: '', unit: 'g' })

const toNum = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function SalesObservationForm({
  open, seriesId, defaultPaymentType = 'dirty_money', onClose, onSaved,
}: {
  open: boolean
  seriesId: string
  defaultPaymentType?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [productState, setProductState] = useState('dried')
  const [tier, setTier] = useState('')
  const [observedAt, setObservedAt] = useState('')
  const [precision, setPrecision] = useState('day')
  const [paymentType, setPaymentType] = useState(defaultPaymentType)
  const [payment, setPayment] = useState('')
  const [units, setUnits] = useState('')
  const [weightValue, setWeightValue] = useState('')
  const [weightUnit, setWeightUnit] = useState<string>('g')
  const [stacks, setStacks] = useState<StackDraft[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const paymentNum = toNum(payment)
  const unitsNum = toNum(units)
  const weightNum = toNum(weightValue)

  const stackInputs = useMemo(
    () => stacks
      .filter((s) => s.units.trim() || s.value.trim())
      .map((s) => ({
        units: toNum(s.units) ?? 0,
        recorded_weight_value: toNum(s.value),
        recorded_weight_unit: s.unit || null,
      })),
    [stacks],
  )

  const preview = useMemo(
    () => saleMetrics({
      payment_amount: paymentNum ?? 0,
      total_units: unitsNum ?? 0,
      recorded_weight_value: weightNum,
      recorded_weight_unit: weightUnit || null,
      weight_is_derived: weightUnit !== 'g',
    }),
    [paymentNum, unitsNum, weightNum, weightUnit],
  )

  const problems = useMemo(
    () => validateObservationDraft(
      {
        total_units: unitsNum,
        payment_amount: paymentNum,
        recorded_weight_value: weightNum,
        recorded_weight_unit: weightUnit || null,
        product_state: productState,
        quality_tier: tier,
      },
      stackInputs,
    ),
    [unitsNum, paymentNum, weightNum, weightUnit, productState, tier, stackInputs],
  )

  const blocking = problems.some(isBlockingError)
  const dirty = () => Boolean(payment || units || tier || weightValue || notes || stacks.length)

  const submit = async () => {
    if (blocking || busy) return
    setBusy(true)
    const p_observation = {
      product_state: productState,
      quality_tier: tier.trim() || null,
      observed_at: observedAt || null,
      observed_date_precision: precision,
      payment_type: paymentType,
      payment_amount: paymentNum ?? 0,
      total_units: unitsNum ?? 0,
      recorded_weight_value: weightNum,
      recorded_weight_unit: weightNum != null ? (weightUnit || null) : null,
      weight_is_derived: weightNum != null && weightUnit !== 'g',
      analyst_note: notes.trim() || null,
    }
    const p_stacks = stackInputs.map((s, i) => ({
      stack_number: i + 1,
      units: s.units,
      recorded_weight_value: s.recorded_weight_value,
      recorded_weight_unit: s.recorded_weight_value != null ? (s.recorded_weight_unit || null) : null,
      weight_is_derived: s.recorded_weight_value != null && (s.recorded_weight_unit ?? 'g') !== 'g',
    }))
    const res = await rpc('add_narcotic_sale_observation', {
      p_series: seriesId,
      p_observation,
      p_stacks,
    })
    setBusy(false)
    if (res.error) { toast(`Couldn’t record the sale: ${res.error.message}`, 'danger'); return }
    toast('Observation recorded', 'success')
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} wide dirty={dirty}>
      <ModalHeader title="Record a sale" onClose={onClose} />
      <p className="-mt-2 mb-4 text-[11px] text-amber-300/90">
        Restricted — investigator-conducted controlled sale. Enter weights in their original unit; conversions are derived.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Product state">{(id) => (
          <Select id={id} value={productState} onChange={(e) => setProductState(e.target.value)}>
            {PRODUCT_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}</Field>
        <Field label="Quality tier" hint="Free text, e.g. Mids / Fire">{(id) => (
          <Input id={id} value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Mids" />
        )}</Field>

        <Field label="Observed date">{(id) => (
          <Input id={id} type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
        )}</Field>
        <Field label="Date precision">{(id) => (
          <Select id={id} value={precision} onChange={(e) => setPrecision(e.target.value)}>
            {DATE_PRECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}</Field>

        <Field label="Payment type">{(id) => (
          <Select id={id} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            {PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}</Field>
        <Field label="Payment amount" required>{(id) => (
          <Input id={id} inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="0" />
        )}</Field>

        <Field label="Total units" required>{(id) => (
          <Input id={id} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
        )}</Field>
        <div className="grid grid-cols-[1fr,auto] gap-2">
          <Field label="Recorded weight">{(id) => (
            <Input id={id} inputMode="decimal" value={weightValue} onChange={(e) => setWeightValue(e.target.value)} placeholder="0" />
          )}</Field>
          <Field label="Unit">{(id) => (
            <Select id={id} value={weightUnit} onChange={(e) => setWeightUnit(e.target.value)}>
              {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          )}</Field>
        </div>
      </div>

      {/* Stacks (repeatable) */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">Stacks (optional)</span>
          <Button variant="ghost" size="sm" onClick={() => setStacks((s) => [...s, emptyStack()])}>+ Add stack</Button>
        </div>
        {stacks.length === 0 ? (
          <p className="text-[11px] text-slate-500">Break the sale into stacks if it was bundled — totals reconcile against the recorded units above.</p>
        ) : (
          <div className="space-y-2">
            {stacks.map((s, i) => (
              <div key={i} className="grid grid-cols-[auto,1fr,1fr,auto,auto] items-end gap-2">
                <span className="pb-2 text-[11px] font-semibold text-slate-500">#{i + 1}</span>
                <Field label="Units">{(id) => (
                  <Input id={id} inputMode="numeric" value={s.units}
                    onChange={(e) => setStacks((arr) => arr.map((x, j) => j === i ? { ...x, units: e.target.value } : x))} />
                )}</Field>
                <Field label="Weight">{(id) => (
                  <Input id={id} inputMode="decimal" value={s.value}
                    onChange={(e) => setStacks((arr) => arr.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                )}</Field>
                <Field label="Unit">{(id) => (
                  <Select id={id} value={s.unit}
                    onChange={(e) => setStacks((arr) => arr.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}>
                    {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                )}</Field>
                <button
                  type="button"
                  aria-label={`Remove stack ${i + 1}`}
                  onClick={() => setStacks((arr) => arr.filter((_, j) => j !== i))}
                  className="mb-0.5 grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
                >&times;</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Field label="Analyst note" className="mt-4">{(id) => (
        <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, methodology, caveats…" />
      )}</Field>

      {/* Live-derived preview */}
      <div className="mt-4 rounded-xl border border-white/10 bg-ink-900/60 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Live preview (derived)</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <PreviewStat label="Proceeds" value={paymentNum != null ? formatProceeds(paymentNum) : '—'} />
          <PreviewStat label="Units" value={unitsNum != null ? formatInt(unitsNum) : '—'} strong />
          <PreviewStat label="$ / unit" value={preview.paymentPerUnit != null ? formatMoney(preview.paymentPerUnit) : '—'} strong />
          <PreviewStat label="Weight → grams" value={preview.grams != null ? `${formatInt(preview.grams)} g` : '—'} />
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1">
          {problems.map((p, i) => (
            <li key={i} className={`text-xs ${isBlockingError(p) ? 'text-rose-300' : 'text-amber-300'}`}>
              {isBlockingError(p) ? '• ' : ''}{p}
            </li>
          ))}
        </ul>
      )}

      <Notice className="mt-3 !p-3 !text-left" text="Confidence reflects sample size only — never a real-world market value or forecast." />

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={blocking} loading={busy} onClick={() => void submit()}>Record observation</Button>
      </div>
    </Modal>
  )
}

function PreviewStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`tabular-nums ${strong ? 'font-bold text-white' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}
