'use client'

/** Gang dossier — Accounts and Narcotics sections. Both were schema-supported
 *  (account_links subject_kind='gang'; narcotic_gangs) but had no gang-side
 *  UI: the ties existed, invisible from the dossier. Each panel self-loads its
 *  own slice (bounded, RLS-scoped) and subscribes to its own realtime table so
 *  edits made from the Account Registry / Narcotics dossier appear live. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ilikeAny, insert, list, remove, update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uiConfirm } from '@/components/ui/dialog'
import { LinkEditPopover, LinkStatusBadge } from '@/components/shared/LinkEditPopover'
import { RecordPeekButton } from '@/components/shared/RecordPeekButton'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { useToolNav } from '@/components/tools/useToolNav'
import { humanize } from './gangIntel'

// ── Accounts (account_links subject_kind='gang') ─────────────────────────────

type AccountLinkRow = Tables<'account_links'>
interface AccountLite { id: string; platform: string; handle: string; display_name: string | null; lifecycle: string }

/** Ownership-confidence rungs — 'confirmed' is command-only (mirrors the
 *  account_link_guard_confirm trigger; the AccountsView rule). */
const OWNERSHIP_CONFIDENCE = ['suspected', 'probable', 'confirmed'] as const
const confidenceOptions = (isCommand: boolean, current?: string): readonly string[] =>
  OWNERSHIP_CONFIDENCE.filter((c) => c !== 'confirmed' || isCommand || current === 'confirmed')

export function GangAccountsPanel({ gangId, canEdit }: { gangId: string; canEdit: boolean }) {
  const nav = useToolNav()
  const { isCommand } = useAuth()
  const [links, setLinks] = useState<AccountLinkRow[] | null>(null)
  const [accounts, setAccounts] = useState<Map<string, AccountLite>>(new Map())
  const [picked, setPicked] = useState<PickedRecord | null>(null)
  const [conf, setConf] = useState<string>('suspected')
  const vLinks = useTableVersion('account_links') + useTableVersion('accounts')

  const load = useCallback(async () => {
    const rows = await list('account_links', { eq: { subject_kind: 'gang', subject_id: gangId }, order: 'created_at', ascending: false })
      .catch(() => [] as AccountLinkRow[])
    setLinks(rows)
    const ids = [...new Set(rows.map((l) => l.account_id))]
    const accs = ids.length
      ? await list('accounts', { select: 'id,platform,handle,display_name,lifecycle', in: { id: ids } })
          .then((r) => r as unknown as AccountLite[]).catch(() => [] as AccountLite[])
      : []
    setAccounts(new Map(accs.map((a) => [a.id, a])))
  }, [gangId])
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, vLinks])

  const linked = useMemo(() => new Set((links ?? []).map((l) => l.account_id)), [links])
  const searchAccounts = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const or = ilikeAny(['handle', 'display_name', 'platform'], q)
    const rows = await list('accounts', { select: 'id,platform,handle,display_name,lifecycle', order: 'updated_at', ascending: false, limit: 20, ...(or ? { or } : {}) })
      .then((r) => r as unknown as AccountLite[]).catch(() => [] as AccountLite[])
    return rows
      .filter((a) => a.lifecycle !== 'merged' && !linked.has(a.id))
      .map((a) => ({ id: a.id, label: `@${a.handle}`, sublabel: [a.platform, a.display_name].filter(Boolean).join(' · ') }))
  }, [linked])

  const addLink = async () => {
    if (!picked) return
    const res = await insert('account_links', {
      account_id: picked.id, subject_kind: 'gang', subject_id: gangId,
      ownership_confidence: conf, source: 'manual',
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Account linked', 'success')
    setPicked(null); setConf('suspected')
    void load()
  }
  const setConfidence = async (link: AccountLinkRow, confidence: string) => {
    const res = await update('account_links', link.id, { ownership_confidence: confidence })
    // Confirm is command-gated server-side — surface the DB message cleanly.
    if (res.error) { toast(res.error.message, 'danger'); return }
    void load()
  }
  const unlink = async (link: AccountLinkRow) => {
    const a = accounts.get(link.account_id)
    if (!(await uiConfirm(`Unlink ${a ? `@${a.handle}` : 'this account'} from the gang? The account record itself is kept.`, { confirmText: 'Unlink' }))) return
    const res = await remove('account_links', link.id)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Account unlinked', 'success')
    void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Linked accounts</h3><Badge>{links?.length ?? 0}</Badge></div>
      {links === null ? (
        <p className="text-sm text-slate-400">Loading linked accounts…</p>
      ) : !links.length ? (
        <EmptyState title="No linked accounts" hint={canEdit ? 'Link a social/online account below, or from the Account Registry.' : 'Accounts tied to this gang in the Account Registry appear here.'} />
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const a = accounts.get(l.account_id)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {a ? (
                    <>
                      <Badge>{a.platform}</Badge>
                      <button onClick={() => nav.openHref('/accounts')} className="text-sm font-semibold text-white hover:text-blue-200" title="Open the Account Registry">@{a.handle}</button>
                      {a.display_name && <span className="text-xs text-slate-400">{a.display_name}</span>}
                    </>
                  ) : (
                    /* RLS returned nothing for this id — restricted stub. */
                    <span className="text-sm text-slate-400">Linked account — access restricted.</span>
                  )}
                  <RecordPeekButton type="account" id={l.account_id} label={a ? `@${a.handle}` : 'Account'} />
                  {canEdit ? (
                    <select value={l.ownership_confidence} onChange={(e) => void setConfidence(l, e.target.value)} aria-label="Ownership confidence" className="rounded border border-white/10 bg-ink-950 px-1.5 py-0.5 text-xs text-white">
                      {confidenceOptions(isCommand, l.ownership_confidence).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <StatusBadge domain="accountOwnership" value={l.ownership_confidence} />
                  )}
                </div>
                {canEdit && <button onClick={() => void unlink(l)} className="flex-shrink-0 text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>}
              </Card>
            )
          })}
        </div>
      )}
      {canEdit && (
        <Card pad="sm" className="space-y-2">
          <RecordSearchPicker
            label="Link an account"
            placeholder="Search handle, display name, platform…"
            value={picked}
            onChange={setPicked}
            search={searchAccounts}
            emptyState={
              <span>
                No matching account. Create it in the{' '}
                <button type="button" onClick={() => nav.openHref('/accounts')} className="font-semibold text-blue-300 underline hover:text-blue-200">Account Registry</button>{' '}
                first.
              </span>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Ownership confidence" className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1.5 text-sm text-white">
              {confidenceOptions(isCommand).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button disabled={!picked} onClick={() => void addLink()}>Link account</Button>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Narcotics (narcotic_gangs) ───────────────────────────────────────────────

type NarcoticGangRow = Tables<'narcotic_gangs'>
interface NarcoticLite { id: string; name: string; category: string | null; status: string }

/** narcotic_gangs.role CHECK vocabulary (20260803010000_narcotics_intelligence). */
const NARC_GANG_ROLES = [
  'trafficking', 'production', 'distribution', 'sale', 'association',
  'possible_mention', 'historical_association',
] as const

export function GangNarcoticsPanel({ gangId, canEdit }: { gangId: string; canEdit: boolean }) {
  const nav = useToolNav()
  const { profile, isCommand } = useAuth()
  const [rows, setRows] = useState<NarcoticGangRow[] | null>(null)
  const [narcotics, setNarcotics] = useState<Map<string, NarcoticLite>>(new Map())
  const [picked, setPicked] = useState<PickedRecord | null>(null)
  const [role, setRole] = useState<string>('association')
  const [editLink, setEditLink] = useState<NarcoticGangRow | null>(null)
  const v = useTableVersion('narcotic_gangs')

  const load = useCallback(async () => {
    const links = await list('narcotic_gangs', { eq: { gang_id: gangId }, order: 'created_at', ascending: false })
      .catch(() => [] as NarcoticGangRow[])
    setRows(links)
    const ids = [...new Set(links.map((l) => l.narcotic_id))]
    const drugs = ids.length
      ? await list('narcotics', { select: 'id,name,category,status', in: { id: ids } })
          .then((r) => r as unknown as NarcoticLite[]).catch(() => [] as NarcoticLite[])
      : []
    setNarcotics(new Map(drugs.map((d) => [d.id, d])))
  }, [gangId])
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, v])

  const searchNarcotics = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const or = ilikeAny(['name'], q)
    const drugs = await list('narcotics', { select: 'id,name,category,status', order: 'name', limit: 20, ...(or ? { or } : {}) })
      .then((r) => r as unknown as NarcoticLite[]).catch(() => [] as NarcoticLite[])
    return drugs
      .filter((d) => d.status !== 'merged')
      .map((d) => ({ id: d.id, label: d.name, ...(d.category ? { sublabel: humanize(d.category) } : {}) }))
  }, [])

  const addLink = async () => {
    if (!picked) return
    const res = await insert('narcotic_gangs', { narcotic_id: picked.id, gang_id: gangId, role })
    if (res.error) {
      toast(res.error.code === '23505' ? 'This gang already has that role for that narcotic.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Narcotic linked', 'success')
    setPicked(null)
    void load()
  }
  const unlink = async (l: NarcoticGangRow) => {
    if (!(await uiConfirm('Remove this narcotic link? If the involvement simply ended, prefer editing the link and marking it Historical.', { confirmText: 'Unlink' }))) return
    const res = await remove('narcotic_gangs', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Narcotic unlinked', 'success')
    void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Narcotics involvement</h3><Badge>{rows?.length ?? 0}</Badge></div>
      {rows === null ? (
        <p className="text-sm text-slate-400">Loading narcotics links…</p>
      ) : !rows.length ? (
        <EmptyState title="No narcotics links" hint={canEdit ? 'Link a narcotic below to record trafficking / production / distribution ties.' : 'Ties recorded in the Narcotics registry appear here.'} />
      ) : (
        <div className="space-y-2">
          {rows.map((l) => {
            const d = narcotics.get(l.narcotic_id)
            const mayManage = isCommand || (!!l.created_by && l.created_by === profile?.id)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d ? (
                      <button onClick={() => nav.openRecord('narcotics', l.narcotic_id, d.name)} className="text-sm font-semibold text-white hover:text-blue-200">{d.name}</button>
                    ) : (
                      <span className="text-sm text-slate-400">Linked narcotic — access restricted.</span>
                    )}
                    <RecordPeekButton type="narcotic" id={l.narcotic_id} label={d?.name || 'Narcotic'} />
                    <Badge tone="accent">{humanize(l.role)}</Badge>
                    <LinkStatusBadge status={l.link_status} />
                    <StatusBadge domain="confidence" value={l.confidence ?? 'unverified'} />
                    {l.provenance && <StatusBadge domain="provenance" value={l.provenance} />}
                  </div>
                  {l.notes && <p className="mt-0.5 text-xs text-slate-400">{l.notes}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {canEdit && mayManage && (
                    <button onClick={() => setEditLink(l)} className="text-[11px] font-semibold text-blue-300 hover:text-blue-200" title="Edit role, confidence, status, or note">Edit</button>
                  )}
                  {mayManage && (
                    <button onClick={() => void unlink(l)} className="text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {canEdit && (
        <Card pad="sm" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <RecordSearchPicker
              label="Link a narcotic"
              placeholder="Search narcotics…"
              value={picked}
              onChange={setPicked}
              search={searchNarcotics}
            />
            <Field label="Role">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                  {NARC_GANG_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Button disabled={!picked} onClick={() => void addLink()}>Link narcotic</Button>
        </Card>
      )}
      {editLink && (
        <LinkEditPopover
          title="Edit narcotic link"
          table="narcotic_gangs"
          id={editLink.id}
          role={editLink.role}
          roleOptions={NARC_GANG_ROLES}
          roleLabel={humanize}
          roleRequired
          status={editLink.link_status}
          confidence={editLink.confidence}
          note={editLink.notes}
          noteColumn="notes"
          onClose={() => setEditLink(null)}
          onSaved={() => { setEditLink(null); void load() }}
        />
      )}
    </div>
  )
}
