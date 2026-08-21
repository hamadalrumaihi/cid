'use client'

/** Penal Code — the published statute book, browsable.
 *
 *  Was a flat searchable list of 359 offenses: fine if you already knew the
 *  code you wanted, close to useless for "what covers this". PenalWorkspace
 *  groups them by the title of the code they sit under, filters on the things
 *  an investigator actually narrows by, and compares offenses side by side.
 *
 *  Everything it shows comes from fields penal_current_charges() already
 *  returned and the client catalog was discarding -- no new tables, no new
 *  columns, nothing authored. The admin panel below is unchanged and still
 *  renders nothing unless the server says the viewer administers the code. */
import { PenalWorkspace } from './PenalWorkspace'
import { PenalAdminPanel } from './PenalAdminPanel'

export function PenalView() {
  return (
    <div>
      <PenalWorkspace />
      <PenalAdminPanel />
    </div>
  )
}
