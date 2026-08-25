'use client'

/** Manage Officer modal. Since v1.16 the administrative actions are separated:
 *  "Save profile details" writes only display fields (name/badge/LOA);
 *  role changes go through the audited change_member_role RPC (reason
 *  required, authority matrix enforced server-side); department moves go
 *  through the transfer workflow (request_transfer — cross-bureau needs
 *  source+target approval unless higher command completes it); activation is
 *  the narrowed assign_member; danger zone: deny/restore login and permanent
 *  removal. A changed dropdown never silently changes anything — every
 *  privileged action shows a summary and needs an explicit confirm, and the
 *  database freezes profiles.role/division/active against direct writes.
 *  DD+/Owner additionally get direct DOJ assignment (justice_appoint) —
 *  immediate, no approval chain; an active member is transferred inline. */
import { useState } from 'react'
import { rpc, updateNoSelect } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { PermanentDelete } from '@/components/owner/PermanentDelete'
import type { RosterProfile } from '@/lib/profiles'
import {
  BUREAUS, PERMANENT_BUREAUS, ROLE_LABEL, bureauLabel, bureauShort, canRemoveMember, canTransfer,
  getAssignableRoles, isCommandRole, roleLabel, type RoleParty,
} from '@/lib/roles'
import { justiceRoleLabel } from '@/lib/justice'
import { toast } from '@/lib/toast'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'

type Bureau = keyof typeof BUREAUS & string

interface AssignModalProps {
  p: RosterProfile
  email: string
  onClose: () => void
  /** Refetch the roster (and admin panel) after any change. */
  onChanged: () => void
}

export function AssignModal({ p, email, onClose, onChanged }: AssignModalProps) {
  const { profile: me, isOwner } = useAuth()
  const actor: RoleParty = { ...(me ?? {}), is_owner: isOwner || me?.is_owner }
  const [name, setName] = useState(p.display_name || '')
  const [badge, setBadge] = useState(p.badge_number || '')
  const [loa, setLoa] = useState(!!p.loa)
  // Which privileged action panel is open (never more than one).
  const [panel, setPanel] = useState<'role' | 'transfer' | 'org' | 'doj' | null>(null)
  const [newRole, setNewRole] = useState('')
  const [toBureau, setToBureau] = useState<Bureau | ''>('')
  const [justiceRole, setJusticeRole] = useState('')
  const [dojRole, setDojRole] = useState('')
  // Prosecutors belong to ONE home bureau queue (Major Crimes / Street
  // Crimes) — required by justice_appoint for role=prosecutor, forbidden for
  // judge/AG.
  const [dojBureau, setDojBureau] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const roleOptions = getAssignableRoles(actor, p)
  const transferDestinations = (Object.keys(BUREAUS) as Bureau[])
    .filter((b) => canTransfer(actor, p, p.division ?? '', b))
  // Direct DOJ assignment (justice_appoint): DD+/Owner. A pure AG can only
  // appoint non-CID accounts and has no CID roster access, so this modal
  // never renders for them. Self-appointment is Owner-only server-side.
  const dojAuthority = actor.is_owner
    || (!!me?.active && (me.role === 'deputy_director' || me.role === 'director'))
  const showDoj = dojAuthority && (actor.is_owner || me?.id !== p.id)

  const openPanel = (which: 'role' | 'transfer' | 'org' | 'doj') => {
    setPanel(panel === which ? null : which)
    setNewRole('')
    setToBureau('')
    setJusticeRole('')
    setDojRole('')
    setDojBureau('')
    setReason('')
  }

  // Owner-only: fix an account approved into the wrong organization. The
  // server deactivates the CID membership, preserves all history, and files a
  // pending justice membership request through the NORMAL approval matrix —
  // nothing is granted until an authorized reviewer approves it.
  const orgCorrect = async () => {
    if (!justiceRole || !reason.trim()) { toast('Pick the destination role and give a reason.', 'warn'); return }
    const agency = justiceRole === 'judge' ? 'the Judiciary' : 'the DOJ'
    const ok = await uiConfirm(
      `Move ${p.display_name} out of CID to ${agency} as ${justiceRoleLabel(justiceRole)}?\n\nTheir CID membership is deactivated (all history preserved) and a pending ${justiceRoleLabel(justiceRole)} membership request is created. It still needs approval through the normal justice approval matrix — no access is granted until then.\n\nReason: ${reason.trim()}`,
      { title: 'Organization correction', confirmText: 'Move out of CID', danger: true },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('correct_membership_organization', {
      p_target: p.id,
      p_direction: justiceRole === 'judge' ? 'cid_to_judiciary' : 'cid_to_doj',
      p_reason: reason.trim(),
      p_requested_justice_role: justiceRole === 'judge' ? undefined : justiceRole,
    })
    setBusy(false)
    if (res.error) { toast(`Correction failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} moved out of CID — justice membership request pending approval`, 'warn')
    onChanged(); onClose()
  }

  // Direct, immediate DOJ/judiciary assignment — no approval chain. An active
  // member is transferred inline server-side (CID membership ends, assignments
  // end, settled member_transfers row, justice membership activates). The
  // server enforces the full authority/eligibility matrix; its refusals
  // surface verbatim.
  const assignDoj = async () => {
    if (!dojRole) { toast('Pick the DOJ role.', 'warn'); return }
    if (dojRole === 'prosecutor' && !dojBureau) { toast('Pick the prosecutor’s home bureau (Major Crimes or Street Crimes).', 'warn'); return }
    const ok = await uiConfirm(
      p.active
        ? `This ends ${p.display_name}'s CID membership immediately and activates their DOJ access. Cases they lead keep them as lead until handed over. Continue?`
        : `Appoint ${p.display_name} as ${justiceRoleLabel(dojRole)}? Their DOJ access activates immediately.`,
      { title: 'Assign to DOJ', confirmText: 'Assign — effective immediately', danger: p.active },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('justice_appoint', {
      p_user: p.id, p_role: dojRole,
      ...(reason.trim() ? { p_reason: reason.trim() } : {}),
      // Home bureau rides ONLY on prosecutor appointments (server-enforced).
      ...(dojRole === 'prosecutor' ? { p_bureau: dojBureau as never } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`${p.display_name} appointed ${justiceRoleLabel(dojRole)} — effective immediately`, 'success')
    onChanged(); onClose()
  }

  const saveProfile = async () => {
    const nm = name.trim(), bd = badge.trim()
    const changes: Record<string, unknown> = {}
    if (nm !== (p.display_name || '')) changes.display_name = nm || p.display_name
    if (bd !== (p.badge_number || '')) changes.badge_number = bd || null
    if (loa !== !!p.loa) { changes.loa = loa; changes.loa_since = loa ? new Date().toISOString() : null }
    if (!Object.keys(changes).length) { toast('No profile changes to save.', 'info'); return }
    setBusy(true)
    const res = await updateNoSelect('profiles', p.id, changes)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Profile details saved', 'success')
    onChanged()
  }

  const changeRole = async () => {
    if (!newRole || !reason.trim()) { toast('Pick the new role and give a reason.', 'warn'); return }
    const ok = await uiConfirm(
      `${p.display_name}: ${roleLabel(p.role)} · ${bureauShort(p.division)} → ${roleLabel(newRole)} · ${bureauShort(p.division)}\n\nReason: ${reason.trim()}\n\nThe change is recorded in the role history and the officer is notified.`,
      { title: 'Confirm role change', confirmText: 'Change role' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('change_member_role', { p_target: p.id, p_new_role: newRole as never, p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(`Role change failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} is now ${roleLabel(newRole)}`, 'success')
    onChanged(); onClose()
  }

  const requestTransfer = async () => {
    if (!toBureau || !reason.trim()) { toast('Pick the destination and give a reason.', 'warn'); return }
    const ok = await uiConfirm(
      `${p.display_name}: ${roleLabel(p.role)} · ${bureauShort(p.division)} → ${roleLabel(p.role)} · ${bureauShort(toBureau)}\n\nReason: ${reason.trim()}\n\nThe transfer applies immediately. The officer and both departments are notified, and the move is recorded in the role history.`,
      { title: 'Confirm transfer', confirmText: 'Transfer' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('request_transfer', { p_target: p.id, p_to_bureau: toBureau as never, p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(`Transfer failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} transferred to ${bureauLabel(toBureau)}`, 'success')
    onChanged(); onClose()
  }

  const setActive = async (next: boolean) => {
    const ok = await uiConfirm(
      next
        ? `Activate ${p.display_name}? They keep their saved role (${roleLabel(p.role)}) and department (${bureauLabel(p.division)}).`
        : `Deactivate ${p.display_name}? They lose portal access until reactivated; role and department are kept.`,
      { confirmText: next ? 'Activate' : 'Deactivate', danger: !next },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('assign_member', { target: p.id, set_active: next })
    setBusy(false)
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    toast(next ? `${p.display_name} activated` : `${p.display_name} deactivated`, next ? 'success' : 'warn')
    onChanged(); onClose()
  }

  // Command/Owner may deny a person portal access (app-level block) or restore
  // it. Bureau-lead scoping is enforced server-side by deny_member_login().
  const canDenyThis = !!me && (actor.is_owner || (isCommandRole(me.role) && !p.is_owner && me.id !== p.id))

  const denyLogin = async () => {
    if (me && me.id === p.id) { toast('You cannot deny your own login.', 'warn'); return }
    const reasonTxt = await uiPrompt(
      `Deny ${p.display_name || 'this member'} access to the CID Portal?\n\nWhat this does: they can still sign in but land on an "Access denied" screen showing your reason, and cannot submit a membership request.\n\nWhat this does NOT do: their account, cases, reports and history are untouched — this only blocks the door. Fully reversible with "Restore login access".\n\n(To erase the account instead — clear their email, unassign cases, hide them from the roster — use "Permanently remove from CID" below.)`,
      { title: 'Deny login access', placeholder: 'Reason shown to the member (optional)', confirmText: 'Deny access' },
    )
    if (reasonTxt === null) return
    setBusy(true)
    const res = await rpc('deny_member_login', { p_target: p.id, p_reason: reasonTxt })
    setBusy(false)
    if (res.error) { toast(`Deny failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} denied access`, 'warn')
    onChanged(); onClose()
  }

  const restoreLogin = async () => {
    const ok = await uiConfirm(
      `Restore ${p.display_name || 'this member'}'s access?\n\nThey return to inactive and can submit a membership request again (Command still approves before they are active).`,
      { confirmText: 'Restore access' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('restore_member_login', { p_target: p.id })
    setBusy(false)
    if (res.error) { toast(`Restore failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} access restored`, 'success')
    onChanged(); onClose()
  }

  const removePermanently = async () => {
    if (me && me.id === p.id) { toast('You cannot remove yourself.', 'warn'); return }
    const ok = await uiConfirm(
      `Permanently remove ${p.display_name || 'this member'} from CID?\n\nWhat this does: revokes access immediately, clears their sign-in email, unassigns their cases and hides them from the roster.\n\nWhat is kept: cases, reports and audit history they authored stay intact. Only a director can restore them, and they return inactive pending re-approval.\n\nThis is heavier than "Deny login access" (which just blocks the door and is instantly reversible).`,
      { confirmText: 'Remove permanently', danger: true },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('admin_remove_member', { p_target: p.id, ...(reason.trim() ? { p_reason: reason.trim() } : {}) })
    setBusy(false)
    if (res.error) { toast(`Remove failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} permanently removed`, 'warn')
    onChanged(); onClose()
  }

  const dirty = () =>
    name.trim() !== (p.display_name || '') || badge.trim() !== (p.badge_number || '') ||
    loa !== !!p.loa || !!reason.trim()

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="Manage Officer" onClose={onClose} />
        <p className="mb-3 text-[11px] text-slate-500">{email}</p>

        {/* Current authoritative assignment — read-only; changes go through the
            audited actions below, never a silent dropdown save. */}
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-white/10 bg-ink-950/50 p-3 text-xs">
          <p className="text-slate-400">Current Role <span className="block text-sm text-slate-100">{roleLabel(p.role)}</span></p>
          <p className="text-slate-400">Current Department <span className="block text-sm text-slate-100">{p.division ? `${bureauShort(p.division)} — ${bureauLabel(p.division)}` : 'Unassigned (pending approval)'}</span></p>
          <p className="text-slate-400">Active <span className="block text-sm text-slate-100">{p.active ? 'Yes' : 'No'}</span></p>
          <p className="text-slate-400">On LOA <span className="block text-sm text-slate-100">{p.loa ? 'Yes' : 'No'}</span></p>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Display Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Badge #</label>
            <input value={badge} onChange={(e) => setBadge(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={loa} onChange={(e) => setLoa(e.target.checked)} className="accent-amber-500" /> On LOA (Leave of Absence) — informational; auto-routes sign-offs around this officer
        </label>
        <Button className="mt-3 w-full" disabled={busy} onClick={() => void saveProfile()}>Save profile details</Button>

        <div className="mt-4 border-t border-white/5 pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">Administrative actions</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!roleOptions.length} onClick={() => openPanel('role')}
              title={roleOptions.length ? undefined : 'No role you can grant for this member (authority matrix)'}>
              Change role
            </Button>
            <Button size="sm" disabled={!transferDestinations.length} onClick={() => openPanel('transfer')}
              title={transferDestinations.length ? undefined : 'You cannot initiate a transfer for this member'}>
              Transfer department
            </Button>
            <Button size="sm" variant={p.active ? 'danger' : 'primary'} disabled={busy} onClick={() => void setActive(!p.active)}>
              {p.active ? 'Deactivate' : 'Activate'}
            </Button>
            {actor.is_owner && p.active && me?.id !== p.id && (
              <Button size="sm" onClick={() => openPanel('org')}>Move to DOJ / Judiciary…</Button>
            )}
            {showDoj && (
              <Button size="sm" onClick={() => openPanel('doj')}>Assign to DOJ…</Button>
            )}
          </div>

          {panel === 'role' && (
            <div className="mt-3 space-y-3 rounded-xl border border-badge-400/20 bg-ink-950/50 p-3">
              <Field label="New role" required hint="Options are limited to roles you may grant.">
                {(id) => (
                  <Select id={id} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    <option value="">Select…</option>
                    {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                )}
              </Field>
              {newRole && (
                <p className="text-xs text-slate-300">
                  {roleLabel(p.role)} · {bureauShort(p.division)} → <b>{roleLabel(newRole)} · {bureauShort(p.division)}</b>
                </p>
              )}
              <Field label="Reason" required>
                {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the role history and shown to the officer" />}
              </Field>
              <Button variant="primary" className="w-full" disabled={busy || !newRole || !reason.trim()} onClick={() => void changeRole()}>
                Change role
              </Button>
            </div>
          )}

          {panel === 'org' && (
            <div className="mt-3 space-y-3 rounded-xl border border-amber-400/20 bg-ink-950/50 p-3">
              <p className="text-xs text-amber-200">
                Owner-only correction for an account approved into the wrong organization.
                This is not a bureau transfer: the CID membership is deactivated (all history
                preserved) and a pending justice membership request is filed — approval still
                goes through the normal DOJ/Judiciary matrix before any access is granted.
              </p>
              <Field label="Destination role" required>
                {(id) => (
                  <Select id={id} value={justiceRole} onChange={(e) => setJusticeRole(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="assistant_district_attorney">DOJ — Assistant District Attorney</option>
                    <option value="district_attorney">DOJ — District Attorney</option>
                    <option value="attorney_general">DOJ — Attorney General</option>
                    <option value="judge">Judiciary — Judge</option>
                  </Select>
                )}
              </Field>
              <Field label="Reason" required>
                {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder='e.g. "Approved into the wrong organization"' />}
              </Field>
              <Button variant="danger" className="w-full" disabled={busy || !justiceRole || !reason.trim()} onClick={() => void orgCorrect()}>
                Move out of CID
              </Button>
            </div>
          )}

          {panel === 'doj' && (
            <div className="mt-3 space-y-3 rounded-xl border border-amber-400/20 bg-ink-950/50 p-3">
              <p className="text-xs text-amber-200">
                Department of Justice — direct assignment, effective immediately (no approval chain).
                {p.active
                  ? ' Their CID membership ends the moment you confirm; open case assignments end, and cases they lead keep them as lead until each is handed over.'
                  : ' This account is not an active CID member — the appointment activates their DOJ access directly.'}
              </p>
              <Field label="DOJ role" required hint={actor.is_owner ? undefined : 'Attorney General appointments are Owner-only.'}>
                {(id) => (
                  <Select id={id} value={dojRole} onChange={(e) => { setDojRole(e.target.value); setDojBureau('') }}>
                    <option value="">Select…</option>
                    <option value="prosecutor">Prosecutor</option>
                    <option value="judge">Judge</option>
                    {actor.is_owner && <option value="attorney_general">Attorney General</option>}
                  </Select>
                )}
              </Field>
              {dojRole === 'prosecutor' && (
                <Field label="Home bureau" required hint="A prosecutor works exactly one bureau queue. The Attorney General can grant temporary cross-bureau coverage later.">
                  {(id) => (
                    <Select id={id} value={dojBureau} onChange={(e) => setDojBureau(e.target.value)}>
                      <option value="">Select…</option>
                      {PERMANENT_BUREAUS.map((b) => <option key={b} value={b}>{bureauShort(b)} — {bureauLabel(b)}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              <Field label="Reason" hint="Optional — recorded on the transfer and in the audit log.">
                {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />}
              </Field>
              <Button variant={p.active ? 'danger' : 'primary'} className="w-full" disabled={busy || !dojRole || (dojRole === 'prosecutor' && !dojBureau)} onClick={() => void assignDoj()}>
                Assign to DOJ — effective immediately
              </Button>
            </div>
          )}

          {panel === 'transfer' && (
            <div className="mt-3 space-y-3 rounded-xl border border-badge-400/20 bg-ink-950/50 p-3">
              <Field label="Destination department" required hint="Transfers apply immediately. SIB is never a destination — its membership moves only through the SIB appointment workflow.">
                {(id) => (
                  <Select id={id} value={toBureau} onChange={(e) => setToBureau(e.target.value as Bureau)}>
                    <option value="">Select…</option>
                    {transferDestinations.map((b) => <option key={b} value={b}>{bureauShort(b)} — {bureauLabel(b)}</option>)}
                  </Select>
                )}
              </Field>
              {toBureau && (
                <p className="text-xs text-slate-300">
                  {roleLabel(p.role)} · {bureauShort(p.division)} → <b>{roleLabel(p.role)} · {bureauShort(toBureau)}</b>
                </p>
              )}
              <Field label="Reason" required>
                {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the transfer and shown to the officer" />}
              </Field>
              <Button variant="primary" className="w-full" disabled={busy || !toBureau || !reason.trim()} onClick={() => void requestTransfer()}>
                Request transfer
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-white/5 pt-3">
          <p className="mb-1 text-[11px] uppercase tracking-wider text-rose-300/70">Danger zone</p>
          <p className="mb-2 text-[10px] text-slate-500">Three different actions, in order of severity: <b className="text-slate-400">Deny login</b> blocks the door but keeps the account; <b className="text-slate-400">Remove from portal</b> revokes access and keeps every record, and can be undone; <b className="text-slate-400">Permanently delete</b> (Owner only) erases the account itself.</p>
          {canDenyThis && (p.login_denied ? (
            <div className="mb-2">
              <button onClick={() => void restoreLogin()} disabled={busy} className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 py-2.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-60">
                Restore login access
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500">This member is currently <b className="text-rose-300">denied access</b>. Restoring returns them to inactive so they can request access again.</p>
            </div>
          ) : (
            <div className="mb-2">
              <button onClick={() => void denyLogin()} disabled={busy} className="w-full rounded-lg border border-rose-500/30 bg-rose-500/5 py-2.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-60">
                Deny login access
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500">Blocks the portal with an “Access denied” screen (reason shown) and stops them submitting a membership request. Reversible.</p>
            </div>
          ))}
          {canRemoveMember(actor, p) && (
            <>
              {/* Renamed from "Permanently remove": it is the SOFT removal, and
                  sitting next to a genuinely permanent delete, the old label
                  was the more dangerous of the two words. */}
              <button onClick={() => void removePermanently()} disabled={busy} className="w-full rounded-lg border border-rose-500/30 bg-rose-500/5 py-2.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-60">
                Remove from portal
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500">
                Blocks all access, clears their sign-in email, unassigns their cases and hides them from the roster. Cases, reports and audit history they authored are kept. A director can restore them (they return inactive, pending re-approval).
              </p>
            </>
          )}

          {/* The Owner's control, and only the Owner's -- rendered here so the
              one person who can do it does not have to go looking for it in a
              different part of the app. It is the same armed flow used by the
              Owner console and the Field Intelligence roster: one deletion
              system, and the RPC refuses everybody else whatever renders. */}
          {isOwner && (
            <div className="mt-3 border-t border-rose-500/20 pt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-rose-300/70">
                Owner only
              </p>
              <PermanentDelete
                key={p.id}
                targetId={p.id}
                targetName={p.display_name}
                onDeleted={() => { onClose(); onChanged() }}
              />
              <p className="mt-1.5 text-[10px] text-slate-500">
                Erases the account and its sign-in identity forever. Cases, reports, evidence
                and Field Intelligence submissions stay, repointed to the shared
                &ldquo;Deleted Member&rdquo; record. Removing from the portal is reversible and
                remains the recommended action.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
