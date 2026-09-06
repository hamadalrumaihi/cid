/** Shared entity UI (P2-07) through MSW. The RPC answers are pinned with
 *  rpcResult() — the entity RPCs are server-authoritative and the mock never
 *  re-implements them — while the table reads (entity_merges, suggestions,
 *  the reconcile queue, persons) go through the generic PostgREST handler
 *  over seeded rows. Components that read usePermissions/useAuth in the app
 *  are exercised through their *Panel variants, which take the cosmetic gate
 *  as a prop (there is no AuthProvider in this harness by design). */
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ComparePanel, DuplicatePanel, EntityCreateSheet, EntityPicker, MergeDialog, MergeDialogPanel, MergeHistory,
  MergeHistoryPanel, ObservationForm, SuggestedUpdates, SuggestedUpdatesPanel, mayMerge,
} from '@/components/entity'
import { SiuReconcilePanel, SiuReconcileSection } from '@/components/siu/SiuReconcile'
import { SUGGEST_DEBOUNCE_MS, type DuplicateRow, type MergeManifest } from '@/lib/entity'
import { NO_ACCESS } from '@/lib/permissions'
import { personRow, rpcResult } from '@/mocks/scenarios'
import { seedRows } from '@/mocks/store'
import { render, type Rendered } from './render'

const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text)
}
const buttonWith = (view: Rendered, text: string): HTMLButtonElement => {
  const el = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text))
  expect(el, `button "${text}"`).toBeDefined()
  void view
  return el!
}
const click = (view: Rendered, el: Element) => view.fire(el, new MouseEvent('click', { bubbles: true }))

afterEach(() => { vi.useRealTimers() })

describe('EntityPicker', () => {
  it('debounces the entity_suggest call and renders hits with the exact pill', async () => {
    rpcResult('entity_suggest', [
      { id: 'p1', kind: 'person', label: 'Marcus Reyes', sublabel: '555-0142', score: 1, exact: true },
      { id: 'p2', kind: 'person', label: 'Marco Reyes-Ortiz', sublabel: '', score: 0.6, exact: false },
    ])
    let picked: { id: string } | null = null
    const view = await render(<EntityPicker kind="person" label="Subject" value={null} onChange={(v) => { picked = v }} />)
    try {
      const input = view.container.querySelector('input') as HTMLInputElement
      await view.fire(input, new FocusEvent('focusin', { bubbles: true }))
      // Below minChars (2): the RPC is never called, a hint renders instead.
      setNativeValue(input, 'm')
      await view.fire(input, new Event('input', { bubbles: true }))
      expect(view.container.textContent).toContain('Type at least 2 characters')

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      setNativeValue(input, 'ma')
      await view.fire(input, new Event('input', { bubbles: true }))
      // Nothing yet — the search is debounced.
      expect(view.container.querySelectorAll('[role="option"]').length).toBe(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS) })
      vi.useRealTimers()
      await view.settle(50)

      const options = [...view.container.querySelectorAll('[role="option"]')]
      expect(options.length).toBe(2)
      expect(options[0].textContent).toContain('Marcus Reyes')
      expect(options[0].textContent).toContain('exact')
      expect(options[1].textContent).not.toContain('exact')

      await click(view, options[0])
      expect(picked).not.toBeNull()
      expect(picked!.id).toBe('p1')
    } finally {
      await view.unmount()
    }
  })

  it('leaves excluded ids out of the answer', async () => {
    rpcResult('entity_suggest', [
      { id: 'p1', kind: 'person', label: 'Marcus Reyes', sublabel: '', score: 1, exact: true },
      { id: 'p2', kind: 'person', label: 'Marco Reyes', sublabel: '', score: 0.6, exact: false },
    ])
    const view = await render(
      <EntityPicker kind="person" label="Subject" value={null} onChange={() => {}} exclude={new Set(['p1'])} />,
    )
    try {
      const input = view.container.querySelector('input') as HTMLInputElement
      await view.fire(input, new FocusEvent('focusin', { bubbles: true }))
      setNativeValue(input, 'reyes')
      await view.fire(input, new Event('input', { bubbles: true }))
      await view.settle(SUGGEST_DEBOUNCE_MS + 100)
      const options = [...view.container.querySelectorAll('[role="option"]')]
      expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Marco Reyes')])
    } finally {
      await view.unmount()
    }
  })
})

describe('DuplicatePanel', () => {
  const rows: DuplicateRow[] = [
    { id: 'a', label: 'Marcus Reyes', sublabel: '555-0142', signal: 'phone', strength: 'strong', score: 1 },
    { id: 'b', label: '48KLM921', sublabel: null, signal: 'plate', strength: 'strong', score: 1 },
    { id: 'c', label: 'Marco Reyes', sublabel: null, signal: 'name~', strength: 'soft', score: 0.6 },
  ]

  it('renders strong matches as a warning with readable signals and soft matches quietly', async () => {
    const used: string[] = []
    const view = await render(<DuplicatePanel rows={rows} onUseExisting={(r) => used.push(r.id)} onCompare={() => {}} />)
    try {
      const text = view.container.textContent ?? ''
      expect(text).toContain('2 records look like this one')
      expect(text).toContain('same phone')
      expect(text).toContain('same plate')
      expect(text).toContain('Similar records')
      expect(text).toContain('similar name')
      const status = view.container.querySelector('[role="status"]')
      expect(status?.textContent).toContain('Marcus Reyes')
      expect(status?.textContent).not.toContain('Marco Reyes')

      const useButtons = [...view.container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Use existing')
      expect(useButtons.length).toBe(3)
      await click(view, useButtons[0])
      expect(used).toEqual(['a'])
      expect([...view.container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Merge')).toBe(false)
    } finally {
      await view.unmount()
    }
  })

  it('renders nothing for an empty answer', async () => {
    const view = await render(<DuplicatePanel rows={[]} onUseExisting={() => {}} />)
    try { expect(view.container.textContent).toBe('') } finally { await view.unmount() }
  })
})

const MANIFEST: MergeManifest = {
  survivor: { id: 's', label: 'Marcus Reyes' },
  victims: [{
    id: 'v1', label: 'Marcus Reyes (MDT import)',
    repointed: { 'case_intel_links.ref_id': 4, 'media.person_id': 0 }, repointed_ids: {},
    dropped: [{ table: 'person_vehicles', why: 'duplicate_link', row: {} }],
    scalar_fill: { dob: { from: null, to: '1990-07-14' } }, notes_from: null, tombstone: 'lifecycle',
  }],
  added_aliases: ['Rey'],
}

describe('MergeDialog', () => {
  it('renders the preview manifest and the refusal on {ok:false}', async () => {
    rpcResult('entity_merge_preview', { ok: true, kind: 'person', manifest: MANIFEST } as never)
    rpcResult('entity_merge', { ok: false, code: 'held', hold_cases: ['CID-26-0140'] })
    let merged = false
    const view = await render(
      <MergeDialogPanel kind="person" open canMerge survivor={{ id: 's', label: 'Marcus Reyes' }}
        victims={[{ id: 'v1', label: 'Marcus Reyes (MDT import)' }]} onClose={() => {}} onMerged={() => { merged = true }} />,
    )
    try {
      await view.settle(50)
      const dialog = document.querySelector('[role="dialog"]')!
      const text = dialog.textContent ?? ''
      expect(text).toContain('Marcus Reyes (MDT import)')
      expect(text).toContain('Case intel links: 4')
      expect(text).not.toContain('Media: 0')
      expect(text).toContain('Person vehicles — duplicate link')
      expect(text).toContain('1990-07-14')
      expect(text).toContain('Rey')
      expect(text).toContain('marked merged (lifecycle)')

      const reason = dialog.querySelector('textarea') as HTMLTextAreaElement
      setNativeValue(reason, 'Same subject, confirmed by DOB.')
      await view.fire(reason, new Event('input', { bubbles: true }))
      await click(view, buttonWith(view, 'Merge 1 record'))
      await view.settle(50)
      expect(dialog.textContent).toContain('A linked case is under an active legal hold.')
      expect(merged).toBe(false)
    } finally {
      await view.unmount()
    }
  })

  it('hides the Merge button without the cosmetic gate', async () => {
    rpcResult('entity_merge_preview', { ok: true, kind: 'person', manifest: MANIFEST } as never)
    const view = await render(
      <MergeDialogPanel kind="person" open canMerge={false} survivor={{ id: 's', label: 'Marcus Reyes' }}
        victims={[{ id: 'v1', label: 'Victim' }]} onClose={() => {}} onMerged={() => {}} />,
    )
    try {
      await view.settle(50)
      const text = document.querySelector('[role="dialog"]')?.textContent ?? ''
      expect(text).toContain('Merging is restricted to command')
      expect([...document.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Merge 1'))).toBe(false)
    } finally {
      await view.unmount()
    }
  })

  it('gates on owner/command or SIB command standing', () => {
    expect(mayMerge(NO_ACCESS)).toBe(false)
    expect(mayMerge({ ...NO_ACCESS, access_class: 'command' })).toBe(true)
    expect(mayMerge({ ...NO_ACCESS, access_class: 'member', sib_standing: 'special_agent_in_charge' })).toBe(true)
    expect(typeof MergeDialog).toBe('function')
  })
})

describe('MergeHistory', () => {
  it('lists ledger rows with victim labels from the manifest and offers Unmerge inside the window', async () => {
    seedRows('entity_merges', [{
      id: 'm1', kind: 'person', survivor_id: 's', victim_ids: ['v1'], manifest: MANIFEST as never, victim_snapshots: [],
      actor_id: null, reason: 'MDT duplicate', created_at: new Date().toISOString(),
      reversed_at: null, reversed_by: null, reverse_reason: null,
    }, {
      id: 'm0', kind: 'person', survivor_id: 's', victim_ids: ['old'], manifest: {}, victim_snapshots: [],
      actor_id: null, reason: 'older', created_at: '2020-01-01T00:00:00.000Z',
      reversed_at: '2020-01-02T00:00:00.000Z', reversed_by: null, reverse_reason: 'wrong Reyes',
    }])
    const view = await render(<MergeHistoryPanel kind="person" recordId="s" canUnmerge />)
    try {
      await view.settle(50)
      const text = view.container.textContent ?? ''
      expect(text).toContain('Marcus Reyes (MDT import)')
      expect(text).toContain('MDT duplicate')
      expect(text).toContain('Reversed')
      expect(text).toContain('wrong Reyes')
      const unmerge = [...view.container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Unmerge')
      expect(unmerge.length).toBe(1)
      expect(typeof MergeHistory).toBe('function')
    } finally {
      await view.unmount()
    }
  })
})

describe('SuggestedUpdates', () => {
  it('shows pending proposals against the current value and the decision controls for SrDet+', async () => {
    const person = personRow({ name: 'Marcus Reyes', phone: '555-0100' })
    seedRows('persons', [person])
    seedRows('entity_update_suggestions', [{
      id: 'u1', kind: 'person', ref_id: person.id, field: 'phone', proposed_value: '555-0142', current_value: '555-0100',
      reason: 'New number from the stop on 4 Aug', proposed_by: 'det-1', status: 'pending', created_at: new Date().toISOString(),
      decided_at: null, decided_by: null, decision_note: null, source_observation_id: null,
    }])
    const view = await render(<SuggestedUpdatesPanel kind="person" recordId={person.id} canDecide viewerId="det-1" />)
    try {
      await view.settle(50)
      const text = view.container.textContent ?? ''
      expect(text).toContain('Phone')
      expect(text).toContain('555-0100')
      expect(text).toContain('555-0142')
      expect(text).toContain('New number from the stop on 4 Aug')
      const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent?.trim())
      expect(labels).toEqual(expect.arrayContaining(['Accept', 'Decline', 'Withdraw']))
      // The suggest form shows the record's current value for the selected field.
      const current = view.container.querySelector('input[readonly]') as HTMLInputElement
      expect(current.value).toBe('Marcus Reyes') // first editable field: name
      expect(typeof SuggestedUpdates).toBe('function')
      expect(typeof ObservationForm).toBe('function')
    } finally {
      await view.unmount()
    }
  })
})

describe('ComparePanel', () => {
  it('highlights the fields that differ', async () => {
    const person = personRow({ name: 'Marcus Reyes', phone: '555-0100', alias: 'Rey' })
    seedRows('persons', [person])
    const view = await render(
      <ComparePanel kind="person" recordId={person.id} draft={{ name: 'marcus reyes', phone: '555-0142' }} onUseExisting={() => {}} onBack={() => {}} />,
    )
    try {
      await view.settle(50)
      const rows = [...view.container.querySelectorAll('tbody tr')]
      const byLabel = (l: string) => rows.find((r) => r.querySelector('th')?.textContent === l)!
      expect(byLabel('Name').className).toBe('')          // case-insensitive equal
      expect(byLabel('Phone').className).toContain('amber')
      expect(byLabel('Alias').className).toContain('amber') // draft empty, record has one
    } finally {
      await view.unmount()
    }
  })
})

describe('EntityCreateSheet', () => {
  it('flips to Use existing when the duplicate check finds a strong match', async () => {
    rpcResult('entity_duplicates', [
      { id: 'a', label: 'Marcus Reyes', sublabel: '555-0142', signal: 'phone', strength: 'strong', score: 1 },
    ])
    let used: string | null = null
    const view = await render(
      <EntityCreateSheet kind="person" open initial={{ name: 'Marcus Reyes' }} onClose={() => {}} onCreated={() => {}}
        onUseExisting={(h) => { used = h.id }} />,
    )
    try {
      await view.settle(500) // 400 ms duplicate debounce + round-trip
      const dialog = document.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain('This record may already exist')
      expect(dialog.textContent).toContain('same phone')
      await click(view, buttonWith(view, 'Use existing record'))
      expect(used).toBe('a')
    } finally {
      await view.unmount()
    }
  })
})

describe('SiuReconcilePanel', () => {
  it('splits open and resolved rows and shows Merge only for SIB command', async () => {
    seedRows('siu_reconcile_queue', [{
      id: 'q1', kind: 'vehicle', signal: 'plate', cid_record_id: 'c1', hidden_record_id: 'h1',
      cid_label: '48KLM921 · black Sultan', hidden_label: '48KLM921 · SIB target', created_at: new Date().toISOString(),
      note: null, resolution: null, resolved_at: null, resolved_by: null,
    }, {
      id: 'q0', kind: 'person', signal: 'phone', cid_record_id: 'c0', hidden_record_id: 'h0',
      cid_label: 'Marcus Reyes', hidden_label: 'M. Reyes', created_at: '2026-06-01T00:00:00.000Z',
      note: 'coincidence', resolution: 'dismiss', resolved_at: '2026-06-02T00:00:00.000Z', resolved_by: null,
    }])
    const view = await render(<SiuReconcilePanel canMerge={false} />)
    try {
      await view.settle(50)
      const text = view.container.textContent ?? ''
      expect(text).toContain('same plate')
      expect(text).toContain('48KLM921 · SIB target')
      expect(text).toContain('Resolved (1)')
      expect(text).toContain('Dismissed')
      const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent?.trim())
      expect(labels).toEqual(expect.arrayContaining(['Link', 'Dismiss']))
      expect(labels).not.toContain('Merge into compartment')
      expect(typeof SiuReconcileSection).toBe('function')
    } finally {
      await view.unmount()
    }
  })
})
