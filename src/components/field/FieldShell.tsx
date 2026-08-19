'use client'

/** The Field Intelligence workspace — the whole interface a SAHP, BCSO or LSPD
 *  officer sees.
 *
 *  ── Why this is a separate shell, not AppShell with things hidden ──────────
 *  A patrol officer is not a detective with fewer permissions; they have a
 *  different job. Rendering the CID sidebar with twenty locked tabs would tell
 *  them exactly what exists and that they may not have it, which is both a
 *  worse interface and a small disclosure in itself. So `children` — every CID
 *  route — is never rendered for this state at all.
 *
 *  That is a presentation decision. It is NOT what keeps them out of the case
 *  files: `private.is_active()` is false for a field officer, and every CID
 *  policy asks for it. The boundary was proven table by table against the live
 *  database in 20260910120000_field_officers.sql. Hiding a nav item has never
 *  been the security model here and is not one now.
 *
 *  ── What is deliberately missing ──────────────────────────────────────────
 *  Submitting intelligence. This phase ships the identity and the boundary
 *  only, so the landing page says so in plain words rather than offering a
 *  button that does nothing. Dead controls teach people the portal is broken.
 */
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const AGENCY_NAME: Record<string, string> = {
  SAHP: 'San Andreas Highway Patrol',
  BCSO: 'Blaine County Sheriff’s Office',
  LSPD: 'Los Santos Police Department',
}

/** Name, callsign, rank and agency, as one line. The callsign and rank come
 *  from the APPOINTMENT (command-set) rather than from profiles.badge_number,
 *  which the account holder can edit — attribution should not be self-declared. */
function identityLine(
  name: string | null | undefined,
  callsign: string | null,
  agency: string,
  rank: string | null,
): string {
  return [name || 'Officer', callsign, agency, rank].filter(Boolean).join(' · ')
}

export function FieldShell() {
  const { profile, field, signOut } = useAuth()
  // `field` is non-null whenever the gate settled to 'field'; the fallbacks
  // exist so a render during a refetch cannot throw.
  const agency = field?.agency ?? ''
  const agencyName = AGENCY_NAME[agency] ?? agency

  return (
    <main className="min-h-screen bg-ink-950 text-white">
      <header className="border-b border-white/10 bg-ink-900/60">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-base font-bold sm:text-lg">Field Intelligence</h1>
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-blue-300/70">
              {agencyName || 'Partner agency'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Reporting officer
          </h2>
          <p className="mt-1 text-base font-semibold text-white">
            {identityLine(profile?.display_name, field?.callsign ?? null, agency, field?.officer_rank ?? null)}
          </p>
          {field?.unit && <p className="text-sm text-slate-400">{field.unit}</p>}
          <p className="mt-3 text-xs text-slate-500">
            Your name, callsign and agency are attached to everything you submit, and are
            set by CID rather than typed in — so a report can always be traced back to
            the officer who actually made it.
          </p>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-white">
            Send information to CID&nbsp;/&nbsp;SIU
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            This is where you report what you have seen on patrol — people, vehicles,
            gangs and motorcycle clubs, criminal locations, seizures, and the evidence
            that backs it up. Investigators review it and decide what it means; you do
            not need to know which unit or case it belongs to.
          </p>
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/90">
            Submissions are not open yet. This release sets up your access; the
            submission form is next. Nothing you need to do in the meantime.
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            What you can see here
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Only your own reports. Field Intelligence accounts have no access to case
            files, investigative records or anyone else&rsquo;s submissions — that is
            enforced by the database, not by which buttons appear on this page.
          </p>
        </Card>
      </div>
    </main>
  )
}
