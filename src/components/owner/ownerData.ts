/** Owner Console static data — the hand-maintained configuration the console
 *  still owns after the Phase-2C consolidation: the environment registry, the
 *  feedback-catalog vocabulary, and the manual-actions runbook. The former
 *  documentation walls (suggestions roadmap, route registry, realtime doc,
 *  workflow guide, learning paths) live in the Developer Handbook (/devdocs),
 *  and the permissions matrix moved to src/lib/permissionsMatrix.ts (rendered
 *  by Command Center → Permissions). Informational only; where something is
 *  inferred rather than verified, the text says so. */

/* ---- environment registry (names + purpose only — NEVER values) --------- */

export interface EnvVarDoc {
  name: string
  purpose: string
  required: boolean
  usedIn: string
  ifMissing: string
}

export const ENV_VARS: EnvVarDoc[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', purpose: 'Supabase project API URL', required: true, usedIn: 'src/lib/supabase.ts', ifMissing: 'App renders the setup gate — nothing works' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', purpose: 'Publishable client key (public by design; RLS is the boundary)', required: true, usedIn: 'src/lib/supabase.ts', ifMissing: 'Setup gate; auth failures if wrong' },
  { name: 'NEXT_PUBLIC_FIVEMANAGE_API_KEY', purpose: 'Media upload key (referrer-bound)', required: false, usedIn: 'src/lib/fivemanage.ts', ifMissing: 'Uploads disabled; views show a config banner + paste-URL fallback' },
  { name: 'NEXT_PUBLIC_FIVEMANAGE_BASE_URL', purpose: 'FiveManage API host', required: false, usedIn: 'src/lib/fivemanage.ts', ifMissing: 'Uploads fail' },
]

/* ---- feedback catalog vocabulary ----------------------------------------- */

export const FB_STATUSES = ['new', 'reviewed', 'triaged', 'planned', 'in_progress', 'waiting', 'resolved', 'duplicate', 'rejected', 'archived'] as const
export const FB_TYPES = ['bug', 'suggestion', 'feature_request', 'ux', 'performance', 'security', 'content', 'other'] as const
export const FB_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export const FB_STATUS_TINT: Record<string, string> = {
  new: 'bg-blue-500/15 text-blue-300', reviewed: 'bg-cyan-500/15 text-cyan-300',
  triaged: 'bg-violet-500/15 text-violet-300', planned: 'bg-indigo-500/15 text-indigo-300',
  in_progress: 'bg-amber-500/15 text-amber-300', waiting: 'bg-slate-500/20 text-slate-300',
  resolved: 'bg-emerald-500/15 text-emerald-300', duplicate: 'bg-slate-500/20 text-slate-400',
  rejected: 'bg-rose-500/15 text-rose-300', archived: 'bg-white/5 text-slate-500',
}
export const FB_PRIORITY_TINT: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-300', medium: 'bg-blue-500/15 text-blue-300',
  high: 'bg-amber-500/15 text-amber-300', critical: 'bg-rose-500/15 text-rose-300',
}
export const fbLabel = (s: string | null | undefined): string =>
  (s ?? '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/* ---- portal management: manual actions + recovery ------------------------ */

/** Hand-maintained checklist of actions that can only be done by a person with
 *  dashboard access — the app cannot verify these itself, so each entry is
 *  STATIC CONFIGURATION, not a live check. When one is completed, update it
 *  here (set done + a date) in the same PR that documents the action.
 *  Recorded 2026-07-18 (remediation close-out, OPERATIONS.md §8). */
export interface ManualAction {
  title: string
  detail: string
  where: string
  status: 'action_required' | 'not_configured' | 'recurring'
  /** Date completed, once done — flips the row green. */
  done?: string
}

export const MANUAL_ACTIONS: ManualAction[] = [
  {
    title: 'Deploy the updated discord-notify function',
    detail: 'The hardened version (DM text always comes from the verified notification row, never the request) is merged in the repo but the live function still runs the previous build.',
    where: 'Supabase dashboard → Edge Functions, or `supabase functions deploy discord-notify`',
    status: 'action_required',
  },
  {
    title: 'Move the FiveManage key to platform settings and rotate it',
    detail: 'NEXT_PUBLIC_FIVEMANAGE_API_KEY is committed in vercel.json and ci.yml. It is referrer-bound, but it belongs in Vercel/GitHub environment settings — move it, rotate the key, then delete the committed copies.',
    where: 'Vercel project settings + GitHub Actions secrets',
    status: 'action_required',
  },
  {
    title: 'Run and log a backup restore drill',
    detail: 'Backups run inside Supabase, but a backup is only proven when a restore has been rehearsed once. No drill has been logged yet.',
    where: 'Supabase dashboard → Database → Backups (restore to a branch/new project)',
    status: 'action_required',
  },
  {
    title: 'Set up an external uptime monitor',
    detail: 'Nothing outside the app currently notices if the site or database goes down while nobody is signed in.',
    where: 'Any uptime service pinging the production URL',
    status: 'not_configured',
  },
  {
    title: 'Rotate the rls-test fixture passwords quarterly',
    detail: 'The 16 test accounts are real sign-in-capable users. Rotation cadence starts from 2026-07 — next due 2026-10. Rotate in Supabase Auth, then update the CI secrets.',
    where: 'Supabase Auth + GitHub Actions secrets (see docs/OPERATIONS.md §8)',
    status: 'recurring',
  },
]

export const RECOVERY_NOTES = {
  backups: 'Backups are managed by Supabase and are not visible to this app — their status here is Unknown by design. Check the Supabase dashboard (Database → Backups) for the schedule and latest snapshot.',
  restore: 'App rollback is instant and independent of the database (Vercel → Instant Rollback; migrations are additive). Database recovery = Supabase restore — which is why the drill above matters.',
}
