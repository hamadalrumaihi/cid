/** P2-08 loader migration — the shared entity layer end-to-end through MSW.
 *
 *  What is proven here, on the REAL db.ts / supabase-js chain:
 *    · entitySearch's registry arms: a blank query lists recent rows from the
 *      table (projected, bounded — the picker contract), a typed query goes
 *      to the `entity_suggest` RPC and is mapped through toHit;
 *    · the create-time duplicate hint (IndicatorModal ⇒ entity_duplicates)
 *      renders as a NOTICE and never disables Save;
 *    · CrossrefList (entity_crossref) groups server rows by case and opens
 *      each case; empty and populated states;
 *    · DuplicateMatchNotice: strong ⇒ warning with "Use existing", soft ⇒
 *      quieter notice without it.
 *
 *  The entity RPC mocks are another agent's (src/mocks/handlers/entity.ts);
 *  every RPC answer here is pinned with scenarios.rpcResult() so this spec is
 *  independent of that implementation. tests/msw/entity*.test.tsx is theirs. */
import { describe, expect, it, vi } from 'vitest'
import { CrossrefList } from '@/components/shared/CrossrefList'
import { DuplicateMatchNotice, duplicateMatches } from '@/components/shared/DuplicateMatches'
import { IndicatorModal } from '@/components/indicators/IndicatorsView'
import { searchCaseHits, searchPersonHits } from '@/lib/entitySearch'
import { emptyCase, populatedCase, rpcResult } from '@/mocks/scenarios'
import { render } from './render'

// next/link needs the App Router context; a plain anchor is all the list
// contract needs here (href + text).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}))

const setInput = (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setValue.call(input, value)
}

describe('entitySearch registry arms through MSW', () => {
  it("blank query lists recent cases from the table; a typed query is answered by entity_suggest", async () => {
    const { caseRecord } = populatedCase()
    emptyCase({ title: 'Paleto Score', case_number: 'CID-26-0200' })

    const recent = await searchCaseHits('')
    expect(recent.map((h) => h.label).sort()).toEqual(['CID-26-0140', 'CID-26-0200'])
    expect(recent.find((h) => h.id === caseRecord.id)).toMatchObject({ sublabel: 'Vespucci Fencing Ring', meta: { kind: 'case', exact: null } })

    rpcResult('entity_suggest', [
      { id: caseRecord.id, kind: 'case', label: 'CID-26-0140', sublabel: 'Vespucci Fencing Ring', score: 1, exact: true },
    ])
    const typed = await searchCaseHits('vespucci')
    expect(typed).toEqual([
      { id: caseRecord.id, label: 'CID-26-0140', sublabel: 'Vespucci Fencing Ring', meta: { kind: 'case', exact: '1' } },
    ])
  })

  it('persons: the RPC answer is the picker row (no hydration); exclude applies', async () => {
    rpcResult('entity_suggest', [
      { id: 'p-1', kind: 'person', label: 'Marcus Reed', sublabel: 'Reedy · active', score: 1, exact: true },
      { id: 'p-2', kind: 'person', label: 'Marcus Vale', sublabel: '', score: 0.4, exact: false },
    ])
    const hits = await searchPersonHits('marcus', { exclude: new Set(['p-2']) })
    expect(hits).toEqual([{ id: 'p-1', label: 'Marcus Reed', sublabel: 'Reedy · active', meta: { kind: 'person', exact: '1' } }])
  })
})

describe('IndicatorModal duplicate hint (entity_duplicates)', () => {
  it('shows "already logged" for a value known elsewhere and never disables Save', async () => {
    populatedCase()
    rpcResult('entity_duplicates', [
      { id: 'ind-9', label: '(555) 201-3344', sublabel: 'phone · CID-26-0140', signal: 'value', strength: 'strong', score: 1 },
    ])
    const view = await render(<IndicatorModal record={null} onClose={() => {}} onSaved={() => {}} />)
    try {
      const input = document.getElementById('indicator-value') as HTMLInputElement
      expect(input).not.toBeNull()
      setInput(input, '555-2013344')
      await view.fire(input, new Event('input', { bubbles: true }))
      await view.settle(600) // 400 ms debounce + mocked round-trip

      const text = document.body.textContent ?? ''
      expect(text).toContain('Already logged on another case')
      expect(text).toContain('CID-26-0140')
      // A deconfliction hit is the signal, not a block.
      const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Log indicator'))
      expect(save).toBeDefined()
      expect(save!.disabled).toBe(false)
    } finally {
      await view.unmount()
    }
  })
})

describe('CrossrefList (entity_crossref)', () => {
  it('groups rows by case, labels the via, and links each case', async () => {
    rpcResult('entity_crossref', [
      { case_id: 'c-1', case_number: 'MCB-4000101', title: 'Vespucci Fencing Ring', bureau: 'major_crimes', via: 'link', detail: 'getaway car', observed_at: '2026-07-01T12:00:00Z' },
      { case_id: 'c-1', case_number: 'MCB-4000101', title: 'Vespucci Fencing Ring', bureau: 'major_crimes', via: 'surveillance', detail: 'parked outside', observed_at: '2026-06-28T09:00:00Z' },
      { case_id: 'c-2', case_number: 'SCB-5000200', title: '', bureau: 'street_crimes', via: 'report', detail: 'cid_investigative_report', observed_at: '' },
    ])
    const view = await render(<CrossrefList kind="vehicle" id="v-1" />)
    try {
      await view.settle(100)
      const text = view.container.textContent ?? ''
      expect(text).toContain('MCB-4000101')
      expect(text).toContain('SCB-5000200')
      expect(text).toContain('intel link')
      expect(text).toContain('surveillance')
      expect(text).toContain('report')
      expect(text).toContain('getaway car')
      // One group per case — two hits under the first, one under the second.
      const links = [...view.container.querySelectorAll('a')]
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/cases?case=c-1', '/cases?case=c-2'])
    } finally {
      await view.unmount()
    }
  })

  it('renders the empty state when the server answers nothing', async () => {
    rpcResult('entity_crossref', [])
    const view = await render(<CrossrefList kind="indicator" id="i-1" emptyTitle="No cross-case matches" />)
    try {
      await view.settle(100)
      expect(view.container.textContent).toContain('No cross-case matches')
    } finally {
      await view.unmount()
    }
  })
})

describe('DuplicateMatchNotice', () => {
  it('strong ⇒ warning with Use existing; soft ⇒ notice without it', async () => {
    const strong = duplicateMatches('person', [
      { id: 'p-1', label: 'Marcus Reed', sublabel: null, signal: 'phone', strength: 'strong', score: 1 },
      { id: 'p-2', label: 'Marcus Reid', sublabel: null, signal: 'name~', strength: 'soft', score: 0.7 },
    ])
    expect(strong.map((m) => m.id)).toEqual(['p-1', 'p-2']) // strong first
    let used: string | null = null
    const view = await render(<DuplicateMatchNotice matches={strong} onUseExisting={(m) => { used = m.id }} />)
    try {
      const text = view.container.textContent ?? ''
      expect(text).toContain('Likely existing record')
      expect(text).toContain('same phone')
      const use = [...view.container.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use existing'))
      expect(use).toHaveLength(1) // only the strong match offers it
      await view.fire(use[0], new MouseEvent('click', { bubbles: true }))
      expect(used).toBe('p-1')
    } finally {
      await view.unmount()
    }

    const soft = duplicateMatches('gang', [{ id: 'g-1', label: 'Ballas', sublabel: null, signal: 'name~', strength: 'soft', score: 0.6 }])
    const view2 = await render(<DuplicateMatchNotice matches={soft} onUseExisting={() => {}} />)
    try {
      expect(view2.container.textContent).toContain('Similar records exist')
      expect(view2.container.textContent).not.toContain('Use existing')
    } finally {
      await view2.unmount()
    }
  })
})
