/** Proof: a real component works end-to-end through MSW.
 *
 *  RecordSearchPicker (src/components/shared/) was chosen deliberately: it is
 *  provider-light (no useAuth — src/components/ui + shared/ are auth-free by
 *  design; the caller supplies the RLS-scoped loader), yet it drives a REAL
 *  db.ts query the way its call sites do (list() + ilikeAny + limit). So the
 *  full chain under test is: React render → focus → debounce → list('cases')
 *  → supabase-js → fetch → MSW PostgREST handler → fixture rows → DOM.
 *  Data-bound view components (CasesView etc.) hang off useAuth/profile
 *  context and belong to the Phase 2 component-harness work. */
import { describe, expect, it } from 'vitest'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { ilikeAny, list } from '@/lib/db'
import { emptyCase, populatedCase } from '@/mocks/scenarios'
import { render } from './render'

/** The same loader shape the app's call sites build. */
const searchCases = async (q: string): Promise<PickedRecord[]> => {
  const or = ilikeAny(['title', 'case_number'], q)
  const rows = await list('cases', {
    ...(or ? { or } : {}),
    order: 'created_at',
    ascending: false,
    limit: 20,
  })
  return rows.map((r) => ({ id: r.id, label: r.title ?? r.case_number, sublabel: r.case_number }))
}

describe('RecordSearchPicker through MSW', () => {
  it('loads fixture cases on focus and commits a pick', async () => {
    const { caseRecord } = populatedCase()
    emptyCase({ title: 'Paleto Score', case_number: 'CID-26-0200' })

    let picked: PickedRecord | null = null
    const view = await render(
      <RecordSearchPicker
        label="Case"
        value={picked}
        onChange={(v) => { picked = v }}
        search={searchCases}
      />,
    )
    try {
      const input = view.container.querySelector('input')
      expect(input).not.toBeNull()

      // Focus opens the picker; the debounced empty query lists recent rows.
      await view.fire(input!, new FocusEvent('focusin', { bubbles: true }))
      await view.settle(400) // 250ms debounce + mocked round-trip

      const text = view.container.textContent ?? ''
      expect(text).toContain('Vespucci Fencing Ring')
      expect(text).toContain('Paleto Score')
      expect(text).toContain('2 matches') // aria-live result count

      const option = [...view.container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Vespucci Fencing Ring'))
      expect(option).toBeDefined()
      await view.fire(option!, new MouseEvent('click', { bubbles: true }))

      expect(picked).not.toBeNull()
      expect(picked!.id).toBe(caseRecord.id)
      expect(picked!.sublabel).toBe('CID-26-0140')
    } finally {
      await view.unmount()
    }
  })

  it('shows the empty state when the query matches nothing', async () => {
    populatedCase()
    const view = await render(
      <RecordSearchPicker label="Case" value={null} onChange={() => {}} search={searchCases} />,
    )
    try {
      const input = view.container.querySelector('input') as HTMLInputElement
      await view.fire(input, new FocusEvent('focusin', { bubbles: true }))
      await view.settle(400)
      expect(view.container.textContent).toContain('Vespucci Fencing Ring')

      // Type a non-matching query (native value setter so React's controlled
      // input sees the change without a testing-library dependency).
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, 'zzz-no-such-case')
      await view.fire(input, new Event('input', { bubbles: true }))
      await view.settle(400)
      expect(view.container.textContent).toContain('No matches — refine the search.')
    } finally {
      await view.unmount()
    }
  })
})
