'use client'

/** Workspace record tab for one gang — the thin host GangDossier needs to
 *  render from just an `{ id, onBack }` contract (the toolRegistry shape).
 *  Loads the row plus the same projections GangsView feeds the dossier (case
 *  options for attach/member modals, the full gang list for IntelProfile's
 *  rollup cache) and owns the edit/delete/profile orchestration the registry
 *  screen normally provides. All reads stay RLS-scoped exactly as before. */
import { useCallback, useEffect, useState } from 'react'
import { deleteWithUndo, list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { uiConfirm } from '@/components/ui/dialog'
import { Notice, ErrorNotice } from '@/components/ui/Notice'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { GangDossier } from './GangDossier'
import { GangModal } from './gangModals'
import { GANG_DELETE_CHILDREN, GANG_NULL_REFS, type CaseOption, type GangRow } from './gangShared'

export function GangRecordTab({ id, onBack }: { id: string; onBack: () => void }) {
  const { state, canEdit, canDelete } = useAuth()
  const [gang, setGang] = useState<GangRow | null>(null)
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const vGangs = useTableVersion('gangs')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setErr(null)
    try {
      // Primary lookup stays unwrapped (real error message, not "not found");
      // the aux lists degrade to [] like the registry's options.
      const [g, all, c] = await Promise.all([
        withRetry(() => list('gangs', { eq: { id } })),
        list('gangs', { order: 'name', ascending: true }).catch(() => [] as GangRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((rows) => rows as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
      ])
      if (!g[0]) throw new Error('Gang not found — it may have been deleted or restricted.')
      setGang(g[0])
      setGangs(all)
      setCaseOptions(c)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state, id])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vGangs])

  const deleteGang = async (g: GangRow) => {
    if (!(await uiConfirm(`Delete gang "${g.name}"? This removes its members, ranks, turf, and place links.`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('gangs', g, {
      label: `Gang "${g.name}"`, noConfirm: true, after: onBack,
      children: GANG_DELETE_CHILDREN, setNullRefs: GANG_NULL_REFS,
    })
  }

  if (state !== 'in') return <Notice text="Live gang records require sign-in." />
  if (err) return <ErrorNotice message={err} onRetry={() => void refresh()} />
  if (loading || !gang) return <ViewPlaceholder tab="gangs" />

  return (
    <GangDossier
      gang={gang}
      caseOptions={caseOptions}
      canEdit={canEdit}
      canDelete={canDelete}
      onBack={onBack}
      onRefresh={refresh}
      onEdit={() => setEditing(true)}
      onDelete={() => void deleteGang(gang)}
      onProfile={() => setProfile({ type: 'gang', id: gang.id })}
    >
      {editing && <GangModal record={gang} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refresh() }} />}
      {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
    </GangDossier>
  )
}
