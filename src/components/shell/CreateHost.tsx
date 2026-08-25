'use client'

/** Universal "+ Create" — one context provider (mounted in AppShell) that any
 *  surface can ask to open a create modal: `useCreate().open('person')`. It
 *  reuses the EXACT modals the registry views export (CaseModal, PersonModal,
 *  VehicleModal, …) — same fields, same validation, same RLS-scoped writes —
 *  lazy-loaded so none of those view chunks ride in the shell bundle. The one
 *  remaining option list (cases, for IndicatorModal) loads on first need
 *  through the viewer's RLS and is cached for the session; every entity picker
 *  inside the modals runs the bounded entity-search registry instead of
 *  preloads. Pages keep their own specialized New buttons; this is an
 *  additional door, not a replacement. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { list } from '@/lib/db'
import type { OpViewer } from '@/lib/opsJoint'
import { useSiu } from '@/lib/useSiu'
import { KindIcon, PlusIcon } from '@/components/shell/icons'
import { useToolNav } from '@/components/tools/useToolNav'

/* ── Lazy modals — each pulls its view chunk only when first opened ──────── */
const CaseModal = dynamic(() => import('@/components/cases/CaseModal').then((m) => m.CaseModal), { ssr: false })
const PersonModal = dynamic(() => import('@/components/persons/PersonModal').then((m) => m.PersonModal), { ssr: false })
const VehicleModal = dynamic(() => import('@/components/vehicles/VehiclesView').then((m) => m.VehicleModal), { ssr: false })
const GangModal = dynamic(() => import('@/components/gangs/gangModals').then((m) => m.GangModal), { ssr: false })
const PlaceModal = dynamic(() => import('@/components/places/PlacesView').then((m) => m.PlaceModal), { ssr: false })
const AccountModal = dynamic(() => import('@/components/accounts/AccountsView').then((m) => m.AccountModal), { ssr: false })
const IndicatorModal = dynamic(() => import('@/components/indicators/IndicatorsView').then((m) => m.IndicatorModal), { ssr: false })
const OperationModal = dynamic(() => import('@/components/operations/OperationsView').then((m) => m.OperationModal), { ssr: false })
const NewInvestigationModal = dynamic(() => import('@/components/siu/SiuView').then((m) => m.NewInvestigationModal), { ssr: false })

export type CreateKind =
  | 'case' | 'person' | 'vehicle' | 'gang' | 'place' | 'account'
  | 'indicator' | 'operation' | 'siu'

/** Optional prefill context. `caseId` is accepted for forward-compat but the
 *  exported IndicatorModal has no prefill prop today, so it is not applied. */
export interface CreateCtx {
  caseId?: string
  caseNumber?: string
  personId?: string
  prefillName?: string
  /** Called with the new record's id/name after a successful create. When
   *  set, the host closes the modal and stays put instead of navigating to
   *  the new record — the caller chains the next step (e.g. auto-linking the
   *  person to a case). Person kind only today. */
  onCreated?: (id: string, name: string) => void
}

interface CreateApi {
  open: (kind: CreateKind, ctx?: CreateCtx) => void
}

const NOOP: CreateApi = { open: () => {} }
const Ctx = createContext<CreateApi>(NOOP)
export const useCreate = (): CreateApi => useContext(Ctx)

/* ── Session-cached option lists (RLS-scoped; ids/names only) ────────────── */
/** `title` normalized to '' — IndicatorModal's CaseOption declares it
 *  non-null; the empty string satisfies it. */
type CaseLite = { id: string; case_number: string; title: string }

interface Options {
  casesLite?: CaseLite[]
}

const NEEDS: Record<CreateKind, (keyof Options)[]> = {
  case: [],
  person: [],
  vehicle: [],
  gang: [],
  place: [],
  account: [],
  indicator: ['casesLite'],
  operation: [],
  siu: [],
}

async function loadOption(key: keyof Options): Promise<Options[keyof Options]> {
  switch (key) {
    case 'casesLite': {
      const rows = (await list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })) as unknown as { id: string; case_number: string; title: string | null }[]
      return rows.map((r) => ({ id: r.id, case_number: r.case_number, title: r.title ?? '' }))
    }
  }
}

export function CreateHost({ children }: { children: React.ReactNode }) {
  const { profile, canEdit, isCommand, isOwner } = useAuth()
  const siu = useSiu()
  const { openHref, openRecord } = useToolNav()
  const [active, setActive] = useState<{ kind: CreateKind; ctx: CreateCtx } | null>(null)
  const [options, setOptions] = useState<Options>({})
  const inflight = useRef(new Set<keyof Options>())

  const ensure = useCallback((key: keyof Options) => {
    if (inflight.current.has(key)) return
    inflight.current.add(key)
    void loadOption(key)
      .then((rows) => setOptions((o) => (key in o ? o : { ...o, [key]: rows })))
      // Transient failure → allow a retry on the next open instead of caching
      // an empty list as truth.
      .catch(() => { inflight.current.delete(key) })
  }, [])

  const open = useCallback((kind: CreateKind, ctx: CreateCtx = {}) => {
    // UX gate only — RLS/RPCs re-decide server-side, exactly as on the pages.
    if (kind === 'siu' ? !siu.isAgent : !canEdit) return
    for (const key of NEEDS[kind]) ensure(key)
    setActive({ kind, ctx })
  }, [canEdit, siu.isAgent, ensure])

  const close = useCallback(() => setActive(null), [])

  /** New persons/vehicles/gangs land on their record tab. The exported modals
   *  don't return the new id, so resolve the newest row the viewer can see
   *  (created a moment ago by them); if that read degrades, fall back to the
   *  tool's list, where the record sits on top. */
  const openNewest = useCallback((tool: 'persons' | 'vehicles' | 'gangs') => {
    setActive(null)
    void (async () => {
      try {
        const rows = (await list(tool, { select: 'id', order: 'created_at', ascending: false, limit: 1 })) as unknown as { id: string }[]
        if (rows[0]?.id) { openRecord(tool, rows[0].id); return }
      } catch { /* degrade to the list below */ }
      openHref(`/${tool}`)
    })()
  }, [openRecord, openHref])

  const ready = active ? NEEDS[active.kind].every((k) => options[k] !== undefined) : false
  const kind = active?.kind
  const createdCb = active?.ctx.onCreated
  const viewer: OpViewer = {
    userId: profile?.id ?? null,
    active: !!profile?.active,
    role: profile?.role ?? null,
    division: profile?.division ?? null,
    isCommand,
    isOwner,
  }

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {kind === 'case' && (
        <CaseModal open record={null} onClose={close} onSaved={(id) => { close(); if (id) openHref(caseLink(id)) }} />
      )}
      {kind === 'person' && (
        <PersonModal
          record={null}
          prefillName={active?.ctx.prefillName}
          onClose={close}
          onCreated={createdCb ? (row) => createdCb(row.id, row.name) : undefined}
          onSaved={createdCb ? close : () => openNewest('persons')}
        />
      )}
      {kind === 'vehicle' && (
        <VehicleModal record={null} onClose={close} onSaved={() => openNewest('vehicles')} />
      )}
      {kind === 'gang' && (
        <GangModal record={null} onClose={close} onSaved={() => openNewest('gangs')} />
      )}
      {kind === 'place' && (
        <PlaceModal record={null} onClose={close} onSaved={close} />
      )}
      {kind === 'account' && (
        <AccountModal onClose={close} onSaved={close} />
      )}
      {kind === 'indicator' && ready && (
        <IndicatorModal record={null} cases={options.casesLite!} onClose={close} onSaved={close} />
      )}
      {kind === 'operation' && (
        <OperationModal open record={null} viewer={viewer} onClose={close} onSaved={close} />
      )}
      {kind === 'siu' && siu.isAgent && (
        <NewInvestigationModal onClose={close} onCreated={close} />
      )}
    </Ctx.Provider>
  )
}

/* ── Header trigger — dropdown on desktop, bottom sheet below lg ─────────── */

const CREATE_ITEMS: { kind: CreateKind; label: string; icon: string }[] = [
  { kind: 'case', label: 'New case', icon: 'case' },
  { kind: 'person', label: 'New person', icon: 'person' },
  { kind: 'vehicle', label: 'New vehicle', icon: 'vehicle' },
  { kind: 'gang', label: 'New gang', icon: 'gang' },
  { kind: 'place', label: 'New place', icon: 'place' },
  { kind: 'account', label: 'New account', icon: 'account' },
  { kind: 'indicator', label: 'New indicator', icon: 'indicator' },
  { kind: 'operation', label: 'New operation', icon: 'operation' },
  { kind: 'siu', label: 'New SIB investigation', icon: 'case' },
]

export function CreateMenuButton() {
  const create = useCreate()
  const { canEdit } = useAuth()
  const siu = useSiu()
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Click-outside + Esc (the ActionMenu idiom).
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const items = CREATE_ITEMS.filter((it) => (it.kind === 'siu' ? siu.isAgent : canEdit))
  if (!items.length) return null

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Create record"
        title="Create record"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-ink-850 text-slate-200 transition hover:bg-white/10"
      >
        <PlusIcon size={18} />
      </button>
      {menuOpen && (
        <>
          {/* Mobile bottom-sheet backdrop; the desktop dropdown closes via
              the document click-outside listener instead. */}
          <div className="fixed inset-0 z-40 bg-ink-950/60 lg:hidden" onMouseDown={() => setMenuOpen(false)} />
          <div
            role="menu"
            aria-label="Create record"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-white/10 bg-ink-850 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50 lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-full lg:z-30 lg:mt-1 lg:w-60 lg:rounded-lg lg:border lg:p-1 lg:pb-1"
          >
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:pt-1">Create</p>
            {items.map((it) => (
              <button
                key={it.kind}
                role="menuitem"
                type="button"
                onClick={() => { setMenuOpen(false); create.open(it.kind) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/10 lg:py-2"
              >
                <span aria-hidden className="flex w-5 justify-center text-slate-400"><KindIcon kind={it.icon} /></span>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
