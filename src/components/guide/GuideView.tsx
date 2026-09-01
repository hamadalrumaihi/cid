'use client'

/** User Guide — visual-first orientation (Reference → User Guide). Instead of
 *  a wall of text, the guide shows the portal: the access fork, a live map of
 *  the nav (data-driven from NAV_CATEGORIES so it can't go stale), the REAL
 *  case tab rail (from caseTabs.ts — the old hard-coded mock advertised
 *  "Evidence" and "Files" tabs long after they were renamed), both legal
 *  lanes, SIB orientation, and the unified Intelligence intake. The full
 *  written manual (docs/USER-GUIDE.md) stays available in a collapsible at
 *  the end. Static content, no fetches. */
import { NAV_CATEGORIES, TAB_LABEL } from '@/lib/nav'
import { statusTint } from '@/lib/tint'
import { fieldStatusLabel } from '@/lib/fieldSubmissions'
import { renderMarkdown } from '@/lib/markdown'
import { AccessBadge } from '@/components/ui/AccessBadge'
import { CASE_TAB_GROUPS, CASE_TAB_LABELS } from '@/components/cases/caseTabs'
import {
  AlertIcon, ArchiveIcon, BellIcon, CalendarIcon, CategoryIcon, CheckIcon, ClockIcon,
  DocumentIcon, EyeIcon, IndicatorIcon, LockIcon, MapIcon, NetworkIcon, PersonIcon,
  RadioIcon, ReportIcon, ScaleIcon, SearchIcon, StarIcon, UndoIcon,
} from '@/components/shell/icons'
import { USER_GUIDE_MD } from './guideContent'

/* ---- tiny building blocks ------------------------------------------------ */

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-white/20 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-200 shadow-[0_1px_0_rgba(255,255,255,0.12)]">{children}</kbd>
}

function Section({ id, title, blurb, children }: { id: string; title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`g-${id}`} className="rounded-lg border border-white/5 bg-ink-900/60 p-5 sm:p-6">
      <h3 id={`g-${id}`} className="text-lg font-semibold text-white">{title}</h3>
      {blurb && <p className="mt-0.5 text-xs text-slate-400">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Arrow() {
  return <span aria-hidden className="mx-1 flex-shrink-0 text-slate-600">→</span>
}

/** One step chip in a lane diagram. */
function Step({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'accent' }) {
  const cls = tone === 'good'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
    : tone === 'accent'
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-200'
      : 'border-white/10 bg-white/5 text-slate-200'
  return <span className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${cls}`}>{children}</span>
}

const CAT_TINT: Record<string, string> = {
  command:   'border-blue-400/25 bg-blue-500/[0.07]',
  cases:     'border-amber-400/25 bg-amber-500/[0.07]',
  intel:     'border-white/10 bg-white/[0.04]',
  reference: 'border-emerald-400/25 bg-emerald-500/[0.07]',
  oversight: 'border-white/10 bg-white/[0.04]',
}
const CAT_TEXT: Record<string, string> = {
  command: 'text-blue-300', cases: 'text-amber-300', intel: 'text-slate-200',
  reference: 'text-emerald-300', oversight: 'text-slate-200',
}

/** Owner-level pages must not read as ordinary member features on the map. */
const OWNER_ONLY_TABS = new Set(['devdocs', 'audit'])

/* ---- mini illustrations (pure SVG/CSS, decorative) ----------------------- */

function MiniGraph() {
  const orbit = [[60, 12], [104, 34], [104, 66], [60, 88], [16, 66], [16, 34]] as const
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      {orbit.map(([x, y], i) => <line key={i} x1={60} y1={50} x2={x} y2={y} stroke="#334155" strokeWidth={1} />)}
      <circle cx={60} cy={50} r={9} fill="#3b82f6" />
      {orbit.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5.5} fill={['#f59e0b', '#fb7185', '#059669', '#64748b', '#8b5cf6', '#eab308'][i]} />)}
    </svg>
  )
}

function MiniBars() {
  const pairs = [[16, 9], [24, 14], [19, 17], [30, 21], [26, 24], [34, 28]]
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      <line x1={6} y1={86} x2={114} y2={86} stroke="#1b2940" strokeWidth={1.5} />
      {pairs.map(([a, b], i) => (
        <g key={i}>
          <rect x={10 + i * 18} y={86 - a * 2} width={6} height={a * 2} rx={2} fill="#3b82f6" />
          <rect x={18 + i * 18} y={86 - b * 2} width={6} height={b * 2} rx={2} fill="#059669" />
        </g>
      ))}
    </svg>
  )
}

function MiniBand() {
  const lanes = [
    { y: 22, c: '#059669', xs: [22, 38, 71, 92] },
    { y: 50, c: '#64748b', xs: [30, 58, 100] },
    { y: 78, c: '#3b82f6', xs: [16, 48, 64, 84, 104] },
  ]
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      {lanes.map((l) => (
        <g key={l.y}>
          <line x1={8} y1={l.y} x2={112} y2={l.y} stroke="#1b2940" strokeWidth={1} strokeDasharray="2 4" />
          {l.xs.map((x) => <circle key={x} cx={x} cy={l.y} r={4.5} fill={l.c} stroke="#070b14" strokeWidth={1.2} />)}
        </g>
      ))}
    </svg>
  )
}

function MiniMap() {
  const dots = [[38, 68, 9, '#fb7185'], [62, 40, 6, '#f59e0b'], [80, 62, 4.5, '#f59e0b'], [50, 26, 4, '#3b82f6']] as const
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      <path d="M20 88 Q8 60 22 40 Q30 18 56 12 Q86 8 100 30 Q114 54 98 76 Q80 94 50 92 Z" fill="#0d1526" stroke="#1e293b" strokeWidth={1.5} />
      <path d="M30 70 Q50 55 90 60" fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
      {dots.map(([x, y, r, c], i) => <circle key={i} cx={x} cy={y} r={r} fill={c} opacity={0.85} />)}
    </svg>
  )
}

function MiniDoc() {
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      <rect x={34} y={8} width={52} height={84} rx={3} fill="#f8fafc" />
      <rect x={34} y={8} width={52} height={10} rx={3} fill="#1e2a4a" />
      <rect x={40} y={24} width={40} height={4} rx={1} fill="#b91c1c" />
      {[34, 42, 50, 58, 66].map((y) => <rect key={y} x={40} y={y} width={y % 3 === 0 ? 40 : 32} height={2.5} rx={1} fill="#cbd5e1" />)}
      <rect x={40} y={78} width={18} height={2.5} rx={1} fill="#64748b" />
    </svg>
  )
}

function MiniCalendar() {
  return (
    <div aria-hidden className="grid h-24 grid-cols-7 content-center gap-1 px-2">
      {Array.from({ length: 21 }, (_, i) => (
        <div
          key={i}
          className={`aspect-square rounded-[4px] border text-center ${
            i === 9 ? 'border-rose-500/40 bg-rose-500/20'
            : i === 13 || i === 4 ? 'border-badge-500/40 bg-badge-500/20'
            : 'border-white/5 bg-white/[0.03]'
          }`}
        />
      ))}
    </div>
  )
}

function MiniPalette() {
  return (
    <div aria-hidden className="flex h-24 flex-col justify-center gap-1.5 px-2">
      <div className="flex items-center gap-1.5 rounded-md border border-white/15 bg-ink-950 px-2 py-1.5">
        <SearchIcon className="h-3 w-3 text-slate-500" />
        <span className="text-[10px] text-slate-500">new case…</span>
      </div>
      <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">+ New case</div>
      <div className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-300"><DocumentIcon size={10} /> SCB-5000041 — Vespucci ring</div>
      <div className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-300"><PersonIcon size={10} /> D. Moretti “Silver”</div>
    </div>
  )
}

function MiniAlert() {
  return (
    <div aria-hidden className="flex h-24 flex-col justify-center gap-1.5 px-2">
      <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
        <p className="flex items-center gap-1 text-[10px] font-bold text-white"><AlertIcon size={11} className="text-amber-300" /> (555) 201-3344</p>
        <p className="text-[10px] text-slate-400">in <span className="font-mono text-blue-300">SCB-5000041</span> · <span className="font-mono text-blue-300">SCB-5000038</span></p>
      </div>
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
        <p className="flex items-center gap-1 text-[10px] font-bold text-slate-300"><IndicatorIcon size={11} /> SN-77812</p>
        <p className="flex items-center gap-1 text-[10px] text-slate-500">in <LockIcon size={10} /> restricted case</p>
      </div>
    </div>
  )
}

function MiniDesk() {
  return (
    <div aria-hidden className="flex h-24 flex-col justify-center gap-1.5 px-2">
      {[
        [<CheckIcon key="i" size={11} />, 'Sign-off waiting on you', 'text-amber-300'],
        [<ClockIcon key="i" size={11} />, 'Follow-up due today', 'text-rose-300'],
        [<span key="i" className="text-[10px] font-semibold">@</span>, 'Mentioned in case chat', 'text-blue-300'],
        [<StarIcon key="i" size={11} />, 'Followed case updated', 'text-emerald-300'],
      ].map(([i, t, c]) => (
        <div key={t as string} className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1">
          <span className={`flex ${c}`}>{i}</span>
          <span className="truncate text-[10px] text-slate-300">{t}</span>
        </div>
      ))}
    </div>
  )
}

/* ---- the guide ----------------------------------------------------------- */

const FEATURES: { icon: React.ReactNode; title: string; where: React.ReactNode; caption: React.ReactNode; art: React.ReactNode }[] = [
  {
    icon: <NetworkIcon size={15} />, title: 'Investigation graph', where: 'Case → Graph',
    caption: <>The case as a link chart. Drag to arrange (kept per case), link intel without leaving it, click a person for their other cases.</>,
    art: <MiniGraph />,
  },
  {
    icon: <ReportIcon size={15} />, title: 'Division analytics', where: 'Command → Analytics',
    caption: <>Opened vs closed by week, clearance rate, caseload per detective. Hover any bar for numbers.</>,
    art: <MiniBars />,
  },
  {
    icon: <IndicatorIcon size={15} />, title: 'Indicators', where: 'Intelligence → Indicators',
    caption: <>Log burner phones, serials, aliases. The same value on two cases raises a deconfliction alert.</>,
    art: <MiniAlert />,
  },
  {
    icon: <ClockIcon size={15} />, title: 'Case chronology', where: 'Case → Timeline',
    caption: <>Every event on a zoomable band — scroll to zoom, drag to pan, hover a dot.</>,
    art: <MiniBand />,
  },
  {
    icon: <SearchIcon className="h-[15px] w-[15px]" />, title: 'Command palette', where: <><Kbd>Ctrl</Kbd> <Kbd>K</Kbd> anywhere</>,
    caption: <>Search everything — cases, plates, people, penal codes — or type <b>new case</b>, <b>loa</b>, <b>go to heatmap</b>.</>,
    art: <MiniPalette />,
  },
  {
    icon: <MapIcon size={15} />, title: 'Commander heatmap', where: 'Command → Heatmap',
    caption: <>Turf, raids and case concentration by area. Click a dot to drill in; zoom like a map.</>,
    art: <MiniMap />,
  },
  {
    icon: <ScaleIcon size={15} />, title: 'Court packet', where: 'Case → Case packet',
    caption: <>One click: the full case as a letterheaded, paginated <b>PDF</b> (or DOCX / Markdown), ready for court.</>,
    art: <MiniDoc />,
  },
  {
    icon: <CalendarIcon size={15} />, title: 'Division calendar', where: 'Oversight → Calendar',
    caption: <>Follow-ups, task deadlines and report weeks in one month view. Red day = overdue.</>,
    art: <MiniCalendar />,
  },
  {
    icon: <BellIcon />, title: 'My Dashboard', where: 'Command → My Dashboard',
    caption: <>Everything waiting on <b>you</b>: sign-offs, returned cases, mentions, due follow-ups. Start every shift here.</>,
    art: <MiniDesk />,
  },
]

const FIXES: [React.ReactNode, string, string][] = [
  [<ClockIcon key="i" size={16} />, '“Signed in but not yet approved”', 'Normal for new accounts — ask Command to approve you, then reload.'],
  [<EyeIcon key="i" size={16} />, 'A colleague’s case is invisible to you', 'Other bureau. You only see cases you’re authorized for — ask the case lead.'],
  [<LockIcon key="i" size={16} />, 'An SIB record shows “not found”', 'You are outside its classification or compartment. If your work needs it, ask SIB command through your chain.'],
  [<AlertIcon key="i" size={16} />, 'Save failed / Delete failed toast', 'The change wasn’t allowed (usually permissions). The toast says why.'],
  [<SearchIcon key="i" className="h-4 w-4" />, 'Search finds nothing', 'Fewer letters, or a plate / case-number fragment. It tolerates typos.'],
  [<UndoIcon key="i" size={16} />, 'Deleted something by accident', 'Click Undo in the toast within a few seconds. Gone? Ask Command.'],
  [<ArchiveIcon key="i" size={16} />, 'A record you saw before is gone', 'Access can lawfully end (joint expiry, restriction). Ask your lead — don’t assume deletion.'],
  [<RadioIcon key="i" size={16} />, 'Changes not showing up', 'The portal is live; an offline banner appears if your connection drops — reload.'],
]

/** The intake status chain, labelled by the real author-facing vocabulary. */
const INTAKE_CHAIN = ['draft', 'new', 'reviewing', 'reviewed'] as const

export function GuideView() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* hero */}
      <div className="rounded-lg border border-white/5 bg-ink-900/60 p-5 sm:p-6">
        <p className="mb-1 text-xs font-medium text-slate-500">New member orientation</p>
        <h1 className="text-xl font-semibold text-white">Welcome to the CID Portal</h1>
        <p className="mt-1 text-sm text-slate-400">
          A live, shared investigation workspace — when a colleague updates a record, everyone sees it in seconds.
          What you can see and change follows your <b className="text-slate-200">active membership, department, rank, assignment and compartment</b> — enforced by the server, not by hidden buttons.
        </p>
      </div>

      {/* sign in + the access fork */}
      <Section id="in" title="Getting in" blurb="Sign in, then tell the portal what you need access for.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-hidden>
          <div className="pointer-events-none rounded-lg border border-white/10 bg-[#5865F2]/20 px-3 py-2.5 text-center text-sm font-bold text-white">Continue with Discord</div>
          <div className="pointer-events-none rounded-lg border border-white/10 bg-white/10 px-3 py-2.5 text-center text-sm font-bold text-white">Continue with Google</div>
          <div className="pointer-events-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-center text-sm font-bold text-slate-300">Email link</div>
        </div>
        <p className="mt-4 mb-2 text-[13px] font-semibold text-white">Two doors — pick the one that matches your job</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-blue-400/20 bg-blue-500/[0.06] p-3">
            <p className="text-sm font-semibold text-white">Join CID</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              An application for investigative access: name, badge, permanent department, requested role, reason.
              <b className="text-slate-200"> Command reviews it</b> — you stay locked out until approved. Requesting a role grants nothing.
            </p>
          </div>
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
            <p className="text-sm font-semibold text-white">Submit Intelligence</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              For SAHP, BCSO and LSPD personnel — send information, evidence and patrol intelligence.
              <b className="text-slate-200"> Available straight away</b>, submission-only: no cases, no registries.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">SIB is never applied for here — the unit selects its members from inside the division.</p>
        <p className="mt-4 mb-2 text-[13px] font-semibold text-white">Then, in your first five minutes</p>
        <div className="flex flex-wrap items-center gap-y-2 text-xs">
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">1 · <b>My Profile</b> → name, badge, avatar, appearance</span>
          <Arrow />
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">2 · <b>Set LOA</b> before leave — routing skips you</span>
          <Arrow />
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">3 · Open <b>My Dashboard</b> — your to-do view</span>
        </div>
      </Section>

      {/* nav map */}
      <Section id="map" title="The map" blurb="5 categories in the sidebar (bottom bar on your phone). Click one, then switch screens in the sub-tab strip.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {NAV_CATEGORIES.map((c) => (
            <div key={c.id} className={`rounded-lg border p-3 ${CAT_TINT[c.id] ?? 'border-white/10 bg-white/[0.03]'} ${c.id === 'intel' ? 'sm:col-span-2' : ''}`}>
              <p className={`flex items-center gap-2 text-sm font-semibold ${CAT_TEXT[c.id] ?? 'text-slate-200'}`}>
                <CategoryIcon cat={c.id} size={16} /> {c.label}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {/* The guide orients MEMBERS — owner-only tabs (Developer
                    Handbook, Audit Log) don't belong on their map. */}
                {c.tabs.filter((t) => !OWNER_ONLY_TABS.has(t)).map((t) => (
                  <span key={t} className="rounded bg-ink-950/60 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">{TAB_LABEL[t] ?? t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* SIB workspace note */}
        <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-violet-300"><LockIcon size={15} /> Special Investigations Bureau</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            A <b className="text-slate-200">separate workspace and authority</b>, not a CID category. SIB members get a
            <b className="text-slate-200"> Unit</b> section first, then CID&apos;s entire navigation tab for tab — the same screens over
            one shared master dataset, scoped by what SIB standing may see. CID members see nothing of it.
          </p>
        </div>

        {/* header mock */}
        <div className="mt-4 rounded-lg border border-white/10 bg-ink-950/60 p-3">
          <div className="flex items-center gap-2" aria-hidden>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/15 bg-ink-900 px-2.5 py-1.5">
              <SearchIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
              <span className="truncate text-xs text-slate-500">Search everything…</span>
              <span className="ml-auto flex flex-shrink-0 gap-1"><Kbd>/</Kbd><Kbd>⌘K</Kbd></span>
            </div>
            <span className="relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-slate-300">
              <BellIcon />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <span className="hidden flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-bold text-slate-300 sm:block">Set LOA</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The top bar, everywhere: press <Kbd>/</Kbd> to search, <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> for the palette, the bell for mentions &amp; sign-off pings, <b>Set LOA</b> before leave so routing skips you.
          </p>
        </div>
      </Section>

      {/* case lifecycle */}
      <Section id="case" title="Life of a case" blurb="Drag the card between board columns — or open it and change Status.">
        <div className="flex flex-wrap items-center gap-y-2" aria-label="Case status flow">
          <span className="rounded-md border border-white/10 bg-badge-500/20 px-2.5 py-1.5 text-xs font-semibold text-white">+ New Case</span>
          <Arrow />
          {/* statusTint is the same map the board + command pills use, so this
              legend can no longer drift from what the app actually shows. */}
          <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${statusTint('open')}`}>open</span>
          <Arrow />
          <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${statusTint('active')}`}>active</span>
          <Arrow />
          <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${statusTint('cold')}`}>cold</span>
          <Arrow />
          <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${statusTint('closed')}`}>closed</span>
        </div>

        <p className="mt-4 mb-1.5 text-[13px] font-semibold text-white">Inside a case — the real tab rail, in its three areas</p>
        <div className="space-y-2" aria-hidden>
          {/* Rendered from caseTabs.ts — the same definition CaseDetail routes
              with, so the guide can never advertise a tab that isn't there. */}
          {CASE_TAB_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 w-full text-xs font-medium text-slate-500 sm:w-44">{g.label}</span>
              {g.tabs.map((t) => (
                <span key={t} className="rounded bg-white/5 px-2 py-1 text-[11px] font-bold text-slate-300">{CASE_TAB_LABELS[t]}</span>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">RICO appears once enterprise tracking is enabled from the Brief. Every tab is deep-linkable.</p>

        <p className="mt-4 mb-1.5 text-[13px] font-semibold text-white">Done investigating? Submit on the Sign-off tab — it routes itself, and skips anyone on LOA</p>
        <div className="flex flex-wrap items-center gap-y-2 text-xs">
          <Step>Bureau lead</Step>
          <Arrow />
          <Step>Deputy director</Step>
          <Arrow />
          <Step>Director</Step>
          <Arrow />
          <Step tone="good">Signed off</Step>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">You get a notification at every step; returned cases land in <b>My Dashboard</b>. Nobody signs off their own submission.</p>
      </Section>

      {/* legal lanes */}
      <Section id="legal" title="Legal requests — two lanes" blurb="Reviewers only ever receive the packet you selected — never the rest of the case.">
        <p className="mb-1.5 text-[13px] font-semibold text-white">CID</p>
        <div className="flex flex-wrap items-center gap-y-2 text-xs">
          <Step>Investigator draft + packet</Step>
          <Arrow />
          <Step>CID command review</Step>
          <Arrow />
          <Step>Prosecutor queue</Step>
          <Arrow />
          <Step>Prosecutorial review</Step>
          <Arrow />
          <Step>Judicial review</Step>
          <Arrow />
          <Step tone="good">Issue → execute / serve → close</Step>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          The responsible bureau&apos;s <b>Bureau Lead</b> reviews — and a <b>Deputy Director, the Director or the owner</b> can always act
          immediately, from any bureau (on a JTF case, any Bureau Lead). The record names who reviewed and the rank they held at the time.
          A return reopens your draft; a non-material fix after a Judge/prosecutor return goes straight back to the prosecutor queue.
        </p>
        <p className="mt-4 mb-1.5 text-[13px] font-semibold text-white">SIB</p>
        <div className="flex flex-wrap items-center gap-y-2 text-xs">
          <Step>Special Agent draft</Step>
          <Arrow />
          <Step>X-1 review</Step>
          <Arrow />
          <Step>Attorney General</Step>
          <Arrow />
          <Step>Judge</Step>
          <Arrow />
          <Step tone="good">Issue</Step>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          SIB legal work never routes through CID command or the bureau prosecutor queue, and notifications stay inside the unit.
          Nobody — X-1 included — reviews their own request.
        </p>
      </Section>

      {/* intelligence intake */}
      <Section id="intake" title="Intelligence intake" blurb="Everything that comes into CID as information — one queue, whoever sent it.">
        <div className="flex flex-wrap items-center gap-y-2 text-xs" aria-label="Submission lifecycle">
          {INTAKE_CHAIN.map((s, i) => (
            <span key={s} className="flex items-center">
              {i > 0 && <Arrow />}
              <Step tone={s === 'reviewed' ? 'good' : 'neutral'}>{fieldStatusLabel(s)}</Step>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          A submission is <b>information</b> — it never becomes a case, a registry record or a verified fact by itself. A reviewer verifies
          each claim, matches it to existing records, and decides: open a case, link a case, log an observation, register a source,
          archive with a reason — or refer it to SIB. If a reviewer has a question, the report shows <b>“{fieldStatusLabel('needs_info')}”</b> and opens a thread with you.
        </p>
      </Section>

      {/* SIB visibility */}
      <Section id="siu" title="SIB visibility, in plain terms" blurb="Shared registries are one dataset — SIB can take a record out of CID's view, and give it back.">
        <div className="flex flex-wrap gap-1.5" aria-hidden>
          <AccessBadge kind="sib" value="siu_only" />
          <AccessBadge kind="sib" value="partial" label="Sections restricted" />
          <AccessBadge kind="sib" value="revealed" />
          <AccessBadge kind="sib" value="unclassified" />
        </div>
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-400">
          <li><b className="text-slate-200">Restrict to SIB</b> hides a whole record, or only its sensitive sections, from CID — with a written reason CID never sees.</li>
          <li><b className="text-slate-200">Reveal</b> lifts a restriction for everyone, one case, or one officer; released items carry a handling level.</li>
          <li>To a CID viewer a restricted record is an ordinary <b className="text-slate-200">not found</b> — nothing hints that anything was withheld.</li>
          <li>Restricting and revealing belong to SIB agents, the Director and the owner. Compartmented investigations are allow-list only — rank exempts no one.</li>
        </ul>
      </Section>

      {/* feature gallery */}
      <Section id="tools" title="The toolkit" blurb="What each screen gives you — click around, everything links back to its case.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="overflow-hidden rounded-lg border border-white/10 bg-ink-950/50">
              <div className="border-b border-white/5 bg-white/[0.02]">{f.art}</div>
              <div className="p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><span aria-hidden className="text-slate-400">{f.icon}</span> {f.title}</p>
                <p className="text-xs font-medium text-slate-500">{f.where}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* troubleshooting */}
      <Section id="fix" title="When something looks wrong" blurb="The things members actually hit.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FIXES.map(([icon, symptom, fix]) => (
            <div key={symptom} className="flex gap-2.5 rounded-lg border border-white/10 bg-ink-950/50 p-3">
              <span aria-hidden className="mt-0.5 flex-shrink-0 text-slate-400">{icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-200">{symptom}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{fix}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* full manual + feedback */}
      <div className="rounded-lg border border-white/5 bg-ink-900/60 p-5 sm:p-6">
        <details>
          <summary className="cursor-pointer select-none text-sm font-bold text-slate-300 transition hover:text-white">
            Prefer text? Read the full written guide
          </summary>
          <div className="mt-4 border-t border-white/5 pt-4">{renderMarkdown(USER_GUIDE_MD)}</div>
        </details>
        <p className="mt-4 text-xs text-slate-500">
          Questions or ideas? <b className="text-slate-300">Feedback</b> (sidebar) goes straight to the portal owner — you can watch its status as it&apos;s triaged.
        </p>
      </div>
    </div>
  )
}
