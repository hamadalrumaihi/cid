'use client'

/** User Guide — visual-first orientation (Reference → User Guide). Instead of
 *  a wall of text, the guide shows the portal: mock sign-in buttons, a live
 *  map of the nav (data-driven from NAV_CATEGORIES so it can't go stale),
 *  a case-lifecycle flow, and an illustrated feature gallery drawn with the
 *  app's own design language. The full written manual (docs/USER-GUIDE.md)
 *  stays available in a collapsible at the end. Static content, no fetches. */
import { NAV_CATEGORIES, TAB_LABEL } from '@/lib/nav'
import { renderMarkdown } from '@/lib/markdown'
import { CategoryIcon, BellIcon, SearchIcon } from '@/components/shell/icons'
import { USER_GUIDE_MD } from './guideContent'

/* ---- tiny building blocks ------------------------------------------------ */

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-white/20 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-200 shadow-[0_1px_0_rgba(255,255,255,0.12)]">{children}</kbd>
}

function Section({ id, title, blurb, children }: { id: string; title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`g-${id}`} className="rounded-2xl border border-white/5 bg-ink-900/60 p-5 sm:p-6">
      <h3 id={`g-${id}`} className="text-lg font-black text-white">{title}</h3>
      {blurb && <p className="mt-0.5 text-xs text-slate-400">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Arrow() {
  return <span aria-hidden className="mx-1 flex-shrink-0 text-slate-600">→</span>
}

const CAT_TINT: Record<string, string> = {
  command:   'border-blue-400/25 bg-blue-500/[0.07]',
  cases:     'border-amber-400/25 bg-amber-500/[0.07]',
  intel:     'border-violet-400/25 bg-violet-500/[0.07]',
  reference: 'border-emerald-400/25 bg-emerald-500/[0.07]',
  oversight: 'border-cyan-400/25 bg-cyan-500/[0.07]',
}
const CAT_TEXT: Record<string, string> = {
  command: 'text-blue-300', cases: 'text-amber-300', intel: 'text-violet-300',
  reference: 'text-emerald-300', oversight: 'text-cyan-300',
}

/* ---- mini illustrations (pure SVG/CSS, decorative) ----------------------- */

function MiniGraph() {
  const orbit = [[60, 12], [104, 34], [104, 66], [60, 88], [16, 66], [16, 34]] as const
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-full" aria-hidden>
      {orbit.map(([x, y], i) => <line key={i} x1={60} y1={50} x2={x} y2={y} stroke="#334155" strokeWidth={1} />)}
      <circle cx={60} cy={50} r={9} fill="#3b82f6" />
      {orbit.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5.5} fill={['#f59e0b', '#fb7185', '#059669', '#22d3ee', '#8b5cf6', '#eab308'][i]} />)}
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
    { y: 50, c: '#8b5cf6', xs: [30, 58, 100] },
    { y: 78, c: '#22d3ee', xs: [16, 48, 64, 84, 104] },
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
  const dots = [[38, 68, 9, '#fb7185'], [62, 40, 6, '#f59e0b'], [80, 62, 4.5, '#f59e0b'], [50, 26, 4, '#22d3ee']] as const
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
      <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-ink-950 px-2 py-1.5">
        <SearchIcon className="h-3 w-3 text-slate-500" />
        <span className="text-[10px] text-slate-500">new case…</span>
      </div>
      <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">＋ New case</div>
      <div className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-300">📂 SAB-9000041 — Vespucci ring</div>
      <div className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-300">👤 D. Moretti “Silver”</div>
    </div>
  )
}

function MiniAlert() {
  return (
    <div aria-hidden className="flex h-24 flex-col justify-center gap-1.5 px-2">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
        <p className="text-[10px] font-bold text-white">⚡ 📞 (555) 201-3344</p>
        <p className="text-[9px] text-slate-400">in <span className="font-mono text-blue-300">SAB-9000041</span> · <span className="font-mono text-blue-300">SAB-9000038</span></p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
        <p className="text-[10px] font-bold text-slate-300">🔩 SN-77812</p>
        <p className="text-[9px] text-slate-500">in 🔒 restricted case</p>
      </div>
    </div>
  )
}

function MiniDesk() {
  return (
    <div aria-hidden className="flex h-24 flex-col justify-center gap-1.5 px-2">
      {[
        ['✍️', 'Sign-off waiting on you', 'text-amber-300'],
        ['⏰', 'Follow-up due today', 'text-rose-300'],
        ['@', 'Mentioned in case chat', 'text-blue-300'],
        ['☆', 'Followed case updated', 'text-emerald-300'],
      ].map(([i, t, c]) => (
        <div key={t} className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1">
          <span className={`text-[10px] font-black ${c}`}>{i}</span>
          <span className="truncate text-[10px] text-slate-300">{t}</span>
        </div>
      ))}
    </div>
  )
}

function MiniFollow() {
  return (
    <div aria-hidden className="flex h-24 flex-col items-center justify-center gap-2 px-2">
      <button tabIndex={-1} className="pointer-events-none rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-amber-300">☆ Follow</button>
      <div className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1">
        <span className="text-[10px] text-slate-300">🚗 8XR-2231</span>
        <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] font-black uppercase text-amber-300">updated</span>
      </div>
    </div>
  )
}

/* ---- the guide ----------------------------------------------------------- */

const FEATURES: { icon: string; title: string; where: React.ReactNode; caption: React.ReactNode; art: React.ReactNode }[] = [
  {
    icon: '🕸', title: 'Investigation graph', where: 'Case → Graph',
    caption: <>The case as a link chart. Drag to arrange (kept per case), <b>🔗 Link intel</b> without leaving it, click a person for their other cases.</>,
    art: <MiniGraph />,
  },
  {
    icon: '📊', title: 'Division analytics', where: 'Command → Analytics',
    caption: <>Opened vs closed by week, clearance rate, caseload per detective. Hover any bar for numbers.</>,
    art: <MiniBars />,
  },
  {
    icon: '🧷', title: 'Indicators', where: 'Intelligence → Indicators',
    caption: <>Log burner phones, serials, aliases. The same value on two cases raises a ⚡ deconfliction alert.</>,
    art: <MiniAlert />,
  },
  {
    icon: '⏱', title: 'Case chronology', where: 'Case → Timeline',
    caption: <>Every event on a zoomable band — scroll to zoom, drag to pan, hover a dot.</>,
    art: <MiniBand />,
  },
  {
    icon: '⌘', title: 'Command palette', where: <><Kbd>Ctrl</Kbd> <Kbd>K</Kbd> anywhere</>,
    caption: <>Search everything — cases, plates, people, penal codes — or type <b>new case</b>, <b>loa</b>, <b>go to heatmap</b>.</>,
    art: <MiniPalette />,
  },
  {
    icon: '🗺', title: 'Commander heatmap', where: 'Command → Heatmap',
    caption: <>Turf, raids and case concentration by area. Click a dot to drill in; zoom like a map.</>,
    art: <MiniMap />,
  },
  {
    icon: '⚖️', title: 'Court packet', where: 'Case → Case packet',
    caption: <>One click: the full case as a letterheaded, paginated <b>PDF</b> (or DOCX / Markdown), ready for court.</>,
    art: <MiniDoc />,
  },
  {
    icon: '🗓', title: 'Division calendar', where: 'Oversight → Calendar',
    caption: <>Follow-ups 📌, task deadlines ☑️ and report weeks 📝 in one month view. Red day = overdue.</>,
    art: <MiniCalendar />,
  },
  {
    icon: '🖥', title: 'My Desk', where: 'Oversight → My Desk',
    caption: <>Everything waiting on <b>you</b>: sign-offs, returned cases, mentions, due follow-ups. Start every shift here.</>,
    art: <MiniDesk />,
  },
  {
    icon: '☆', title: 'Follow anything', where: 'Cases · Persons · Vehicles',
    caption: <>Follow a record and My Desk flags it with an <b>updated</b> chip whenever it changes.</>,
    art: <MiniFollow />,
  },
]

const FIXES: [string, string, string][] = [
  ['🕐', '“Signed in but not yet approved”', 'Normal for new accounts — ask Command to approve you, then reload.'],
  ['🙈', 'A colleague’s case is invisible to you', 'Other bureau. Access is enforced server-side — ask the case lead.'],
  ['⚠️', 'Save failed / Delete failed toast', 'The server refused the write (usually permissions). The toast says why.'],
  ['🔍', 'Search finds nothing', 'Fewer letters, or a plate / case-number fragment. It tolerates typos.'],
  ['↩️', 'Deleted something by accident', 'Click Undo in the toast within a few seconds. Gone? Ask Command.'],
  ['📴', 'Changes not showing up', 'The portal is live; an offline banner appears if your connection drops — reload.'],
]

export function GuideView() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* hero */}
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-5 sm:p-6">
        <p className="t-readout mb-3 inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-blue-200">
          <span className="t-dot t-dot-cyan" /> New member orientation
        </p>
        <h2 className="text-xl font-black text-white">Welcome to the CID Portal</h2>
        <p className="mt-1 text-sm text-slate-400">
          A live, shared investigation workspace — when a detective updates a case, everyone sees it in seconds.
          What you can see and change follows your <b className="text-slate-200">role and bureau</b>, enforced by the server.
        </p>
      </div>

      {/* sign in */}
      <Section id="in" title="Three ways in" blurb="Pick one on the Secure Access screen — most members use Discord.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-hidden>
          <div className="pointer-events-none rounded-xl border border-white/10 bg-[#5865F2]/20 px-3 py-2.5 text-center text-sm font-bold text-white">Continue with Discord</div>
          <div className="pointer-events-none rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 text-center text-sm font-bold text-white">Continue with Google</div>
          <div className="pointer-events-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center text-sm font-bold text-slate-300">✉ Email link</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-200">First time? You’ll be <b>“not yet approved”</b> until Command activates you — ping your supervisor, then reload.</span>
        </div>
        <p className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Then, in your first five minutes</p>
        <div className="flex flex-wrap items-center text-xs">
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">1 · <b>Name card</b> (sidebar) → badge &amp; display name</span>
          <Arrow />
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">2 · <b>Appearance</b> → accent &amp; density</span>
          <Arrow />
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-slate-200">3 · Open <b>My Desk</b> — your to-do view</span>
        </div>
      </Section>

      {/* nav map */}
      <Section id="map" title="The map" blurb="5 divisions in the sidebar (bottom bar on your phone). Click one, then switch screens in the sub-tab strip.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {NAV_CATEGORIES.map((c) => (
            <div key={c.id} className={`rounded-xl border p-3 ${CAT_TINT[c.id] ?? 'border-white/10 bg-white/[0.03]'} ${c.id === 'intel' ? 'sm:col-span-2' : ''}`}>
              <p className={`flex items-center gap-2 text-sm font-black ${CAT_TEXT[c.id] ?? 'text-slate-200'}`}>
                <CategoryIcon cat={c.id} size={16} /> {c.label}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.tabs.map((t) => (
                  <span key={t} className="rounded-md bg-ink-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">{TAB_LABEL[t] ?? t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* header mock */}
        <div className="mt-4 rounded-xl border border-white/10 bg-ink-950/60 p-3">
          <div className="flex items-center gap-2" aria-hidden>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/15 bg-ink-900 px-2.5 py-1.5">
              <SearchIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
              <span className="truncate text-xs text-slate-500">Search everything…</span>
              <span className="ml-auto flex flex-shrink-0 gap-1"><Kbd>/</Kbd><Kbd>⌘K</Kbd></span>
            </div>
            <span className="relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300">
              <BellIcon />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <span className="hidden flex-shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-bold text-slate-300 sm:block">Set LOA</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The top bar, everywhere: press <Kbd>/</Kbd> to search, <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> for the palette, 🔔 for mentions &amp; sign-off pings, <b>Set LOA</b> before leave so routing skips you.
          </p>
        </div>
      </Section>

      {/* case lifecycle */}
      <Section id="case" title="Life of a case" blurb="Drag the card between board columns — or open it and change Status.">
        <div className="flex flex-wrap items-center gap-y-2" aria-label="Case status flow">
          <span className="rounded-lg border border-white/10 bg-gradient-to-r from-badge-500/30 to-blue-700/30 px-2.5 py-1.5 text-xs font-black text-white">＋ New Case</span>
          <Arrow />
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold uppercase text-amber-300">open</span>
          <Arrow />
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold uppercase text-emerald-300">active</span>
          <Arrow />
          <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-bold uppercase text-blue-300">cold</span>
          <Arrow />
          <span className="rounded-full bg-slate-500/20 px-2.5 py-1 text-xs font-bold uppercase text-slate-300">closed</span>
        </div>

        <p className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Inside a case — the tab rail</p>
        <div className="flex flex-wrap gap-1" aria-hidden>
          {['Overview', 'Graph', 'Evidence', 'Reports', 'Tasks', 'Charges', 'Chat', 'Timeline', 'Files', 'Intel', 'RICO', 'Sign-off'].map((t, i) => (
            <span key={t} className={`rounded-md px-2 py-1 text-[10px] font-bold ${i === 0 ? 'bg-badge-500/20 text-white' : 'bg-white/5 text-slate-400'}`}>{t}</span>
          ))}
        </div>

        <p className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Done investigating? Submit on the Sign-off tab — it routes itself</p>
        <div className="flex flex-wrap items-center gap-y-2 text-xs">
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-bold text-slate-200">🕵️ Bureau lead</span>
          <Arrow />
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-bold text-slate-200">🎖️ Deputy director</span>
          <Arrow />
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-bold text-slate-200">⭐ Director</span>
          <Arrow />
          <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 font-bold text-emerald-300">✓ Signed off</span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">You get a notification at every step; returned cases land in <b>My Desk</b>.</p>
      </Section>

      {/* feature gallery */}
      <Section id="tools" title="The toolkit" blurb="What each screen gives you — click around, everything links back to its case.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="overflow-hidden rounded-xl border border-white/10 bg-ink-950/50">
              <div className="border-b border-white/5 bg-white/[0.02]">{f.art}</div>
              <div className="p-3">
                <p className="text-sm font-black text-white"><span aria-hidden>{f.icon}</span> {f.title}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-badge-500">{f.where}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* troubleshooting */}
      <Section id="fix" title="When something looks wrong" blurb="The six things new members actually hit.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FIXES.map(([icon, symptom, fix]) => (
            <div key={symptom} className="flex gap-2.5 rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <span aria-hidden className="text-lg leading-none">{icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-200">{symptom}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{fix}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* full manual + feedback */}
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-5 sm:p-6">
        <details>
          <summary className="cursor-pointer select-none text-sm font-bold text-slate-300 transition hover:text-white">
            📖 Prefer text? Read the full written guide
          </summary>
          <div className="mt-4 border-t border-white/5 pt-4">{renderMarkdown(USER_GUIDE_MD)}</div>
        </details>
        <p className="mt-4 text-xs text-slate-500">
          Questions or ideas? <b className="text-slate-300">Feedback</b> (sidebar) goes straight to the portal owner — you can watch its status as it’s triaged.
        </p>
      </div>
    </div>
  )
}
