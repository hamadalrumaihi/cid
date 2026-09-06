'use client'

/** A case rendered as a workspace tab (plan §5.5 / P3-02). Thin adapter
 *  over CaseDetail's embedded mode: the section comes from provider state
 *  (`section` / `onSectionChange` — the provider mirrors it to the URL),
 *  Back / archive / delete close the tab, and the missing-row surfaces are
 *  the P3-07 states (MissingCaseState) instead of the bare "not found" line.
 *  Record params (`?report=`, `?task=`, `?evidence=`) stay in the workspace
 *  URL and reach the sections exactly as before. */
import { CaseDetail } from './CaseDetail'
import { MissingCaseState } from './states/MissingCaseState'

export interface CaseWorkspaceTabProps {
  caseId: string
  section: string | null
  onSectionChange: (section: string) => void
  onClose: () => void
}

const noop = () => {}

export function CaseWorkspaceTab({ caseId, section, onSectionChange, onClose }: CaseWorkspaceTabProps) {
  return (
    <CaseDetail
      id={caseId}
      embedded
      section={section}
      onSectionChange={onSectionChange}
      onBack={onClose}
      onChanged={noop}
      whenMissing={(info) => <MissingCaseState caseId={caseId} {...info} />}
    />
  )
}
