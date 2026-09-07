/** Unified workspace provider (P3-01 / P3-02 / P3-07) through MSW.
 *
 *  Proven here on the REAL db.ts / supabase-js chain:
 *    · restore from `user_prefs.workspace`: a case the viewer can read comes
 *      back with its case number and remembered section; a case the viewer
 *      cannot see (no row under RLS) is CLOSED SILENTLY — no title, no
 *      number, and it is gone from the persisted mirror too;
 *    · the 8-case cap: the ninth distinct case is refused, the prompt lists
 *      the open cases, picking one closes it and opens the new case;
 *    · URL mirror: the active case tab is written as `?case=…&tab=…` and a
 *      section change follows (native replaceState on /workspace).
 *
 *  next/navigation and lib/auth are stubbed: the harness has no App Router
 *  and (by design) no AuthProvider; the provider reads only
 *  `{ state, session, profile }` from useAuth. */
import { act, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { seedRows } from '@/mocks/store'
import { emptyCase, roleSession } from '@/mocks/scenarios'
import { supabase } from '@/lib/supabase'
import { WORKSPACE_PREF_KEY, mirrorKey } from '@/lib/workspace/storage'
import { caseKey } from '@/lib/workspace/model'
import { WorkspaceProvider } from '@/components/workspace/WorkspaceProvider'
import { useWorkspace, type Workspace } from '@/components/workspace/WorkspaceContext'
import { render } from './render'

const routerCalls: string[] = []
vi.mock('next/navigation', () => {
  const params = { qs: '', sp: new URLSearchParams('') }
  return {
    useRouter: () => ({
      replace: (href: string) => { routerCalls.push(href); window.history.replaceState(null, '', href) },
      push: (href: string) => { routerCalls.push(href) },
    }),
    // Memoised per query string so the intake effect sees a stable object.
    useSearchParams: () => {
      const qs = window.location.search.replace(/^\?/, '')
      if (qs !== params.qs) { params.qs = qs; params.sp = new URLSearchParams(qs) }
      return params.sp
    },
    usePathname: () => window.location.pathname,
  }
})

const auth = { uid: '', active: true }
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    state: 'in',
    session: { user: { id: auth.uid } },
    profile: { id: auth.uid, active: auth.active, display_name: 'Mock detective', role: 'detective' },
    canEdit: true, canDelete: false, isCommand: false, isOwner: false,
  }),
}))

/** Exposes the provider API to the test and paints the tabs into the DOM. */
let api: Workspace | null = null
function Probe() {
  const ws = useWorkspace()
  useEffect(() => { api = ws })
  if (!ws) return null
  return (
    <ul data-testid="tabs" data-restored={ws.restored ? '1' : '0'} data-active={ws.activeKey ?? ''}>
      {ws.tabs.map((t) => <li key={t.key} data-key={t.key} data-section={t.section ?? ''}>{t.title}</li>)}
    </ul>
  )
}

const tabsEl = () => document.querySelector('[data-testid="tabs"]') as HTMLElement
const tabKeys = () => Array.from(document.querySelectorAll('[data-testid="tabs"] li')).map((li) => li.getAttribute('data-key'))

async function signIn() {
  const { credentials, profile } = roleSession('detective')
  auth.uid = profile.id
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
  sessionStorage.clear()
  routerCalls.length = 0
  window.history.replaceState(null, '', '/workspace')
  window.scrollTo = () => {}
}

const mount = () => render(<WorkspaceProvider><Probe /></WorkspaceProvider>)
/** Drive the provider API inside act() (the harness only wraps DOM events). */
const call = async <T,>(fn: () => T): Promise<T> => { let out!: T; await act(async () => { out = fn() }); return out }

describe('WorkspaceProvider — restore through RLS', () => {
  it('re-resolves a readable case (number + section) and closes an invisible one silently', async () => {
    await signIn()
    const { caseRecord } = emptyCase({ case_number: 'CID-26-0300', title: 'Del Perro Boosting Crew' })
    const ghost = '00000000-0000-4000-8000-00000000dead'
    seedRows('user_prefs', [{
      user_id: auth.uid, key: WORKSPACE_PREF_KEY, updated_at: new Date().toISOString(),
      value: {
        tabs: [
          { kind: 'tool', id: 'persons' },
          { kind: 'case', id: caseRecord.id, section: 'tasks' },
          { kind: 'case', id: ghost, section: 'reports' },
        ],
        active: caseKey(ghost),
      },
    }])

    const view = await mount()
    try {
      await view.settle(300)
      expect(tabsEl().dataset.restored).toBe('1')
      expect(tabKeys()).toEqual(['tool:persons', caseKey(caseRecord.id)])
      const kept = document.querySelector(`[data-key="${caseKey(caseRecord.id)}"]`)!
      expect(kept.textContent).toBe('CID-26-0300')
      expect(kept.getAttribute('data-section')).toBe('tasks')
      // The invisible case left no trace: not in the DOM, not in the mirror.
      expect(document.body.textContent).not.toContain(ghost)
      const mirror = sessionStorage.getItem(mirrorKey(auth.uid)) ?? ''
      expect(mirror).not.toContain(ghost)
      expect(mirror).toContain(caseRecord.id)
      expect(mirror).not.toContain('CID-26-0300') // ids only — never titles
      // The active key pointed at the pruned tab → the nearest surviving
      // neighbour takes over (model closeTabs), and the URL mirrors it.
      expect(tabsEl().dataset.active).toBe(caseKey(caseRecord.id))
      expect(window.location.search).toBe(`?case=${caseRecord.id}&tab=tasks`)
    } finally {
      await view.unmount()
    }
  })
})

describe('WorkspaceProvider — the 8-case cap', () => {
  it('refuses the ninth case, prompts, and opens it once one is closed', async () => {
    await signIn()
    const cases = Array.from({ length: 9 }, (_, i) => emptyCase({ case_number: `CID-26-04${String(i).padStart(2, '0')}` }).caseRecord)

    const view = await mount()
    try {
      await view.settle(50)
      for (const c of cases.slice(0, 8)) {
        expect(await call(() => api!.openCase(c.id, 'overview', { title: c.case_number }))).toBe(true)
      }
      await view.settle(50)
      expect(tabKeys()).toHaveLength(8)

      expect(await call(() => api!.openCase(cases[8].id, 'tasks', { title: cases[8].case_number }))).toBe(false)
      await view.settle(50)
      expect(tabKeys()).toHaveLength(8)
      expect(document.body.textContent).toContain('Too many open cases')

      const pick = document.querySelector(`button[aria-label="Close ${cases[2].case_number} and open the new case"]`)!
      expect(pick).not.toBeNull()
      await view.fire(pick, new MouseEvent('click', { bubbles: true }))
      await view.settle(50)
      expect(document.body.textContent).not.toContain('Too many open cases')
      expect(tabKeys()).toHaveLength(8)
      expect(tabKeys()).not.toContain(caseKey(cases[2].id))
      expect(tabKeys()).toContain(caseKey(cases[8].id))
      expect(tabsEl().dataset.active).toBe(caseKey(cases[8].id))
    } finally {
      await view.unmount()
    }
  })
})

describe('WorkspaceProvider — URL mirror', () => {
  it('writes ?case=&tab= for the active case, follows section changes and clears on the directory', async () => {
    await signIn()
    const { caseRecord } = emptyCase({ case_number: 'CID-26-0500' })

    const view = await mount()
    try {
      await view.settle(50)
      await call(() => api!.openCase(caseRecord.id, 'legal', { title: 'CID-26-0500' }))
      await view.settle(50)
      expect(window.location.pathname).toBe('/workspace')
      expect(window.location.search).toBe(`?case=${caseRecord.id}&tab=legal`)

      await call(() => api!.setCaseSection(caseRecord.id, 'tasks'))
      await view.settle(50)
      expect(window.location.search).toBe(`?case=${caseRecord.id}&tab=tasks`)
      expect(document.querySelector(`[data-key="${caseKey(caseRecord.id)}"]`)!.getAttribute('data-section')).toBe('tasks')

      await call(() => api!.openTool('gangs'))
      await view.settle(50)
      expect(window.location.search).toBe('?tool=gangs')

      await call(() => api!.backToDirectory())
      await view.settle(50)
      expect(window.location.search).toBe('')
      // Every write stayed on the same route (native replaceState) — no router hop.
      expect(routerCalls).toEqual([])
    } finally {
      await view.unmount()
    }
  })
})
