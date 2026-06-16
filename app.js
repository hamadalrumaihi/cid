(function () {
    'use strict';

    /* ============================================================ 1. DATA MODELS ============================================================ */

    const ACTIVE_CASES = ['[LSB] Case-1000001', '[LSB] Case-1000007', '[BCB] Case-2000001', '[BCB] Case-2000004', '[SAB] Case-9000001'];

    const KPIS = [
      { label: 'Open Cases', value: 47, delta: '+6 this week', icon: '📂', accent: 'blue' },
      { label: 'Cold Cases', value: 18, delta: '2 wks inactive', icon: '🧊', accent: 'slate' },
      { label: 'Active CIs', value: 23, delta: 'Across 7 handlers', icon: '🕵️', accent: 'violet' },
      { label: 'Total Seizures', value: '$84.2M', delta: 'FY 2026 to date', icon: '💵', accent: 'emerald' },
    ];

    // Tickets — note ticket-2001 is misrouted (belongs to Blaine) to exercise the rename flow
    const TICKETS = [
      { id: 'ticket-10040', source: 'Discord Ticket', desc: 'Suspect trafficking Class 3 weapons near Legion Square', dept: 'LSPD' },
      { id: 'ticket-20089', source: 'Discord Ticket', desc: 'Meth lab operation discovered in Sandy Shores trailer', dept: 'BCSO' },
      { id: 'ticket-2001',  source: 'Discord Ticket', desc: 'Highway interdiction — trafficking corridor on Route 68 (mislabeled LS)', dept: 'SAHP' },
    ];

    const BUREAUS = {
      LSB: { name: 'Los Santos Bureau', prefix: 'LSB', dept: 'LSPD' },
      BCB: { name: 'Blaine County Bureau', prefix: 'BCB', dept: 'BCSO' },
      SAB: { name: 'State Bureau', prefix: 'SAB', dept: 'SAHP' },
    };
    const caseCounters = { LSB: 1000001, BCB: 2000001, SAB: 9000001 };
    // Map a reporting department to its bureau key / ticket rename prefix
    const DEPT_ROUTING = {
      LSPD: { bureau: 'LSB', rename: 'losangeles' },
      BCSO: { bureau: 'BCB', rename: 'blaine' },
      SAHP: { bureau: 'SAB', rename: 'state' },
    };

    const ACTIVITY = [
      { who: 'Det. Oliver Och', what: 'closed [LSB] Case-1000044 — Vinewood arson ring', when: '14m ago', dot: 'emerald' },
      { who: 'System', what: 'synced Google Drive folder for [BCB] Case-2000012', when: '38m ago', dot: 'blue' },
      { who: 'Sr. Det. Hale', what: 'registered Confidential Informant CI-0093 (handler 4/6)', when: '1h ago', dot: 'violet' },
      { who: 'Director', what: 'co-signed GPS tracker deployment on [SAB] Case-9000007', when: '2h ago', dot: 'amber' },
      { who: 'Narcotics', what: 'flagged Blue Meth price spike in Sandy Shores corridor', when: '4h ago', dot: 'rose' },
    ];

    const BUREAU_LOAD = [
      { name: 'Los Santos Bureau', pct: 72, color: 'bg-blue-500' },
      { name: 'Blaine County Bureau', pct: 48, color: 'bg-emerald-500' },
      { name: 'State Bureau', pct: 61, color: 'bg-violet-500' },
      { name: 'Joint Task Force', pct: 33, color: 'bg-amber-500' },
    ];

    // Raid compensation brackets (the "given" percentage), then sub-split
    const BRACKETS = [
      { min: 1000000,  max: 2499999,  pct: 60, label: '$1.00M – $2.49M' },
      { min: 2500000,  max: 7499999,  pct: 50, label: '$2.50M – $7.49M' },
      { min: 7500000,  max: 14999999, pct: 40, label: '$7.50M – $14.99M' },
      { min: 15000000, max: 24999999, pct: 30, label: '$15.0M – $24.99M' },
      { min: 25000000, max: Infinity, pct: 20, label: '$25.0M +' },
    ];
    const COMP_SPLIT = { 'Primary Detective': 0.5, 'Supporting Units': 0.3, 'Confidential Informants': 0.2 };

    /* ---- Narcotics registry ---- */
    // Narcotics are now Supabase-backed; DRUGS is a normalized read cache (see fetchDrugs).
    let DRUGS = [];

    /* ---- Weapon benches ---- */
    // Ballistics now Supabase-backed; caches populated by fetchBenches/fetchFootprints.
    let BENCHES_CACHE = [];
    let FOOTPRINTS = [];

    /* ---- Personnel ---- */
    const ROSTER = [
      { name: 'Oliver Och', role: 'Lead Detective', cs: '915', unit: 'MCB', init: 'OO', status: 'On Duty' },
      { name: 'Marcus Hale', role: 'Senior Detective', cs: '922', unit: 'Narcotics', init: 'MH', status: 'On Duty' },
      { name: 'Dana Reyes', role: 'Detective', cs: '930', unit: 'Ballistics', init: 'DR', status: 'Field' },
      { name: 'Aria Stone', role: 'Bureau Lead — State', cs: '901', unit: 'Command', init: 'AS', status: 'Off Duty' },
      { name: 'Derek Honce', role: 'Bureau Lead — Blaine', cs: '903', unit: 'Command', init: 'DH', status: 'On Duty' },
      { name: 'Lena Voss', role: 'Surveillance Det.', cs: '948', unit: 'Tech Ops', init: 'LV', status: 'Field' },
    ];
    const COMMENDATIONS = [
      { title: 'Distinguished Service Medal', who: 'Det. Oliver Och', icon: '🎖️', tint: 'amber', note: 'Dismantling the Vinewood arson ring.' },
      { title: 'Meritorious Surveillance Badge', who: 'Det. Lena Voss', icon: '🛰️', tint: 'blue', note: 'Sustained covert tracking on Case-9000007.' },
      { title: 'Task Force Command Citation', who: 'Lt. Aria Stone', icon: '🏅', tint: 'violet', note: 'Joint multi-bureau interdiction op.' },
    ];
    // Seeded here; hydrated from Store inside init() (Store is defined later, so it must not be referenced during data-model setup).
    const MEDIA = [
      { title: 'Dashcam — Legion Sq stop', type: 'image', src: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600', kind: 'Image URL', tags: { case:'[LSB] Case-1000001', gang:'', location:'', person:'' } },
      { title: 'Mugshot — Marcus "Tre" Bell', type: 'image', src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600', kind: 'Image URL', tags: { case:'[LSB] Case-1000007', gang:'Davis Ballas', location:'', person:'Marcus "Tre" Bell' } },
      { title: 'UC body-cam clip', type: 'video', src: '', kind: 'MP4 Video', tags: { case:'[BCB] Case-2000001', gang:'', location:'Sandy Shores', person:'' } },
      { title: 'Surveillance still (CDN)', type: 'fivemanage', src: 'fm_2f9a1c', kind: 'FiveManage Embed', tags: { case:'[SAB] Case-9000001', gang:'Vagos Cartel Cell', location:'', person:'' } },
    ];
    const saveMedia = () => Store.set('media', MEDIA);
    let mediaFilter = 'all';

    /* ---- M.O. detector dictionary + case profiles ---- */
    const MO_DICT = {
      names:    ['tre', 'marcus', 'dion', 'lena', 'omar', 'reyes', 'ghost', 'switch'],
      entry:    ['lockpick', 'lockpicked', 'thermite', 'breach', 'breached', 'crowbar', 'kicked', 'drilled', 'cut the lock'],
      vehicles: ['black cid suv', 'unmarked burrito', 'burrito', 'black suv', 'sandking', 'motorcycle', 'getaway sedan', 'unmarked'],
      weapons:  ['class 2 ap pistol', 'ap pistol', 'class 3', 'rifle', 'smg', 'switch', 'auto-sear', 'shotgun', '9mm', '5.56'],
    };
    const MO_CASES = [
      { id: '[BCB] Case-2000001', status: 'Cold', tags: ['lockpicked','unmarked burrito','class 2 ap pistol','tre','thermite'] },
      { id: '[LSB] Case-1000001', status: 'Open', tags: ['breached','black cid suv','rifle','marcus','crowbar'] },
      { id: '[SAB] Case-9000001', status: 'Open', tags: ['class 3','5.56','unmarked','ghost'] },
      { id: '[LSB] Case-1000007', status: 'Cold', tags: ['switch','9mm','auto-sear','dion','drilled'] },
    ];

    /* ---- Drive ---- */
    const DRIVE_FOLDERS = [
      { name: '**Joint Task Force Cases', modified: '16/03/2026', star: 2, accent: 'amber', files: [ {n:'JTF-Master-Index.sheet',t:'sheet'}, {n:'Operation Crosshair (active).doc',t:'doc'}, {n:'Inter-Agency MOU.pdf',t:'pdf'} ] },
      { name: '*Blaine County Bureau Cases', modified: '16/03/2026', star: 1, accent: 'emerald', files: [ {n:'[BCB] Case-2000001 — Sandy Shores Meth.doc',t:'doc'}, {n:'[BCB] Case-2000004 (COLD).doc',t:'doc'}, {n:'BCB Case Log.sheet',t:'sheet'} ] },
      { name: '*Los Santos Bureau Cases', modified: '16/03/2026', star: 1, accent: 'blue', files: [ {n:'[LSB] Case-1000001 — Legion Sq Trafficking.doc',t:'doc'}, {n:'[LSB] Case-1000044 — Vinewood Arson (CLOSED).doc',t:'doc'}, {n:'LSB Case Log.sheet',t:'sheet'} ] },
      { name: '*State Bureau Cases', modified: '16/03/2026', star: 1, accent: 'violet', files: [ {n:'[SAB] Case-9000001 — Corridor Interdiction.doc',t:'doc'}, {n:'[SAB] Case-9000007 — Tracker Auth.doc',t:'doc'}, {n:'SAB Case Log.sheet',t:'sheet'} ] },
      { name: 'Archives', modified: '16/03/2026', star: 0, accent: 'slate', files: [ {n:'Closed Cases 2025.zip',t:'zip'}, {n:'Retired CI Records.zip',t:'zip'} ] },
      { name: 'Case assignment Help??!?', modified: '17/03/2026', star: 0, accent: 'rose', files: [ {n:'HOW TO ASSIGN A CASE (read me).doc',t:'doc'}, {n:'Prefix cheat-sheet.sheet',t:'sheet'} ] },
      { name: 'Confidential Informant', modified: '18/03/2026', star: 0, accent: 'amber', special: 'ci', files: [ {n:'CI Risk Matrix (live).sheet',t:'matrix'}, {n:'Gang Fact Sheet (template).sheet',t:'gangsheet'} ] },
      { name: 'Dirty $- Tracker', modified: '19/03/2026', star: 0, accent: 'emerald', files: [ {n:'Seizure Ledger FY26.sheet',t:'sheet'}, {n:'Distribution Bracket Calc.sheet',t:'sheet'} ] },
      { name: 'Forms', modified: '16/03/2026', star: 0, accent: 'blue', files: [ {n:'Detective Incident Report (template).doc',t:'doc'}, {n:'UC Activity Log (template).doc',t:'doc'} ] },
      { name: 'Resources', modified: '16/03/2026', star: 0, accent: 'slate', files: [ {n:'Penal Code Quick Reference.pdf',t:'pdf'}, {n:'Radio Callsign Directory.sheet',t:'sheet'} ] },
      { name: 'SOP/Training', modified: '16/03/2026', star: 0, accent: 'violet', files: [ {n:'CID SOP v4.2.pdf',t:'pdf'}, {n:'New Detective Onboarding.doc',t:'doc'} ] },
    ];
    const GANG_SHEET = {
      cols: ['Name', 'Rank', 'Threat Level', 'CCW', 'VCH'],
      rows: [ ['Marcus "Tre" Bell','Shot Caller','High','Yes','7'], ['Dion Park','Lieutenant','High','Yes','5'], ['Lena Cruz','Enforcer','Medium','Yes','3'], ['Omar Reyes','Soldier','Low','No','1'] ],
    };
    // Confidential Informant risk matrix — alert flag when violent felonies >= 8
    const CI_MATRIX = [
      { id: 'CI-0093', handler: 'Sr. Det. Hale', exclusive: true, agreement: 'Active', felonies: 4 },
      { id: 'CI-0088', handler: 'Det. Och', exclusive: true, agreement: 'Active', felonies: 7 },
      { id: 'CI-0071', handler: 'Det. Reyes', exclusive: false, agreement: 'Pending', felonies: 9 },
      { id: 'CI-0066', handler: 'Det. Voss', exclusive: true, agreement: 'Expired', felonies: 2 },
    ];

    /* ============================================================ 2. UTILITIES ============================================================ */
    const $  = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const el = (tag, attrs = {}, html = '') => {
      const n = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') n.className = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
      if (html) n.innerHTML = html;
      return n;
    };
    const fmtUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

    function toast(message, type = 'info') {
      const colors = { info:'border-blue-500/30 bg-blue-500/10 text-blue-200', success:'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', warn:'border-amber-500/30 bg-amber-500/10 text-amber-200', danger:'border-rose-500/30 bg-rose-500/10 text-rose-200' };
      const icons = { info:'ℹ️', success:'✅', warn:'⚠️', danger:'🚨' };
      const t = el('div', { class: `flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-glow backdrop-blur-xl ${colors[type] || colors.info}` }, `<span>${icons[type] || icons.info}</span><span>${esc(message)}</span>`);
      t.style.animation = 'popIn .25s cubic-bezier(.16,.84,.44,1) both';
      $('#toast-root').appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 300); }, 3400);
    }

    const Store = {
      KEY: 'cid-portal-v3', OLD: 'cid-portal-v2', _d: null,
      _load() {
        if (this._d) return this._d;
        try {
          this._d = JSON.parse(localStorage.getItem(this.KEY));
          if (!this._d) { // one-time migration from v2
            const old = JSON.parse(localStorage.getItem(this.OLD) || 'null');
            this._d = old || {};
            if (old) localStorage.setItem(this.KEY, JSON.stringify(this._d));
          }
        } catch (e) { this._d = {}; }
        return this._d;
      },
      get(k, f = null) { const v = this._load()[k]; return v === undefined ? f : v; },
      set(k, v) { const d = this._load(); d[k] = v; try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {} },
    };

    /* ============================================================ 3. ROUTER / SHELL ============================================================ */
    const PAGE_META = {
      command:    { title: 'Central Command', sub: 'Case assignment & operational hub' },
      cases:      { title: 'Case Files', sub: 'Live case records, evidence & chain-of-custody' },
      persons:    { title: 'Persons', sub: 'Suspects & persons of interest (live)' },
      narcotics:  { title: 'Narcotics Intelligence', sub: 'Drug processing & market analytics' },
      ballistics: { title: 'Ballistics & Logistics', sub: 'Weapon benches & component tracing' },
      personnel:  { title: 'Personnel & Roster', sub: 'Commendations & media intake vault' },
      modus:      { title: 'M.O. Detector', sub: 'Tactical profiling & cross-reference' },
      gangs:      { title: 'Gangs & Turf', sub: 'Organizations, ranks, properties & territory' },
      places:     { title: 'Criminal Places', sub: 'Locations & production processes' },
      reports:    { title: 'Report Generation', sub: 'Template-driven reports & supplemental chains' },
      rico:       { title: 'RICO Builder', sub: 'Enterprise & predicate-act element tracker' },
      drive:      { title: 'CID General', sub: 'Shared investigative drive' },
      records:    { title: 'CID Records', sub: 'Live shared records (Supabase)' },
    };

    function navigate(tab) {
      if (!PAGE_META[tab]) tab = 'command';
      $$('.view').forEach((v) => v.classList.remove('active'));
      const view = $('#view-' + tab); if (view) view.classList.add('active');
      $$('.nav-link').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); on ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); });
      $$('.bnav-link').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      const m = PAGE_META[tab]; if (m) { $('#page-title').textContent = m.title; $('#page-subtitle').textContent = m.sub; }
      if (location.hash !== '#' + tab) { try { history.replaceState(null, '', '#' + tab); } catch (e) {} }
      Store.set('tab', tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      closeDrawer();
      if (tab === 'cases' && typeof onEnterCases === 'function') onEnterCases();
      if (tab === 'persons' && typeof onEnterPersons === 'function') onEnterPersons();
      if (tab === 'gangs' && typeof onEnterGangs === 'function') onEnterGangs();
      if (tab === 'narcotics' && typeof onEnterNarcotics === 'function') onEnterNarcotics();
      if (tab === 'places' && typeof onEnterPlaces === 'function') onEnterPlaces();
      if (tab === 'ballistics' && typeof onEnterBallistics === 'function') onEnterBallistics();
      if (tab === 'reports' && typeof renderReportChain === 'function') renderReportChain();
      if (tab === 'rico' && typeof renderRico === 'function') renderRico();
      if (tab === 'command' && typeof onEnterTrackers === 'function') onEnterTrackers();
    }
    $$('.nav-link, .bnav-link').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.tab)));

    function openDrawer() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.remove('hidden'); document.body.classList.add('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','true'); }
    function closeDrawer() { if (isDesktop()) return; $('#sidebar').classList.add('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
    function wireDrawer() {
      $('#menu-toggle').addEventListener('click', openDrawer);
      $('#menu-close').addEventListener('click', closeDrawer);
      $('#sidebar-backdrop').addEventListener('click', closeDrawer);
      window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
        if (e.matches) { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
        else { $('#sidebar').classList.add('-translate-x-full'); }
      });
    }
    function applyCollapse(c) {
      document.body.classList.toggle('nav-collapsed', c);
      const b = $('#collapse-toggle'); b.setAttribute('aria-pressed', String(c)); b.setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
      $('#collapse-icon').innerHTML = c ? '<path d="m9 18 6-6-6-6"/>' : '<path d="m15 18-6-6 6-6"/>';
      Store.set('collapsed', c);
    }
    function wireCollapse() { applyCollapse(Store.get('collapsed', false)); $('#collapse-toggle').addEventListener('click', () => applyCollapse(!document.body.classList.contains('nav-collapsed'))); }

    /* ============================================================ 4. MODAL ENGINE (focus-trapped) ============================================================ */
    let lastFocused = null;
    function openModal(node, { wide = false } = {}) {
      closeModal(); lastFocused = document.activeElement;
      const backdrop = el('div', { class: 'modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm' });
      const card = el('div', { class: `modal-card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-850 shadow-glow`, role:'dialog', 'aria-modal':'true', tabindex:'-1' });
      card.appendChild(node); backdrop.appendChild(card);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
      $('#modal-root').appendChild(backdrop); document.body.classList.add('overflow-hidden');
      document.addEventListener('keydown', modalKey);
      (focusable(card)[0] || card).focus();
    }
    function focusable(c) { return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', c).filter((n) => n.offsetParent !== null); }
    function modalKey(e) {
      if (e.key === 'Escape') return closeModal();
      if (e.key !== 'Tab') return;
      const card = $('.modal-card'); if (!card) return; const f = focusable(card); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function closeModal() {
      $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', modalKey);
      if ($('#sidebar').classList.contains('-translate-x-full') || isDesktop()) document.body.classList.remove('overflow-hidden');
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus(); lastFocused = null;
    }

    /* ============================================================ 5. CENTRAL COMMAND ============================================================ */
    function renderKPIs() {
      const accents = { blue:'from-blue-500/20 to-blue-700/5 text-blue-300 border-blue-500/20', slate:'from-slate-500/20 to-slate-700/5 text-slate-300 border-slate-500/20', violet:'from-violet-500/20 to-violet-700/5 text-violet-300 border-violet-500/20', emerald:'from-emerald-500/20 to-emerald-700/5 text-emerald-300 border-emerald-500/20' };
      const g = $('#kpi-grid'); g.innerHTML = '';
      KPIS.forEach((m) => g.appendChild(el('div', { class:`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${accents[m.accent]} p-5 transition hover:shadow-glow` },
        `<div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">${m.label}</p><p class="mt-2 text-3xl font-bold text-white">${m.value}</p><p class="mt-1 text-[11px] text-slate-400">${m.delta}</p></div><span class="text-2xl">${m.icon}</span></div>`)));
    }

    function renderTickets() {
      const tb = $('#ticket-tbody'); tb.innerHTML = '';
      TICKETS.forEach((t) => {
        const tr = el('tr', { class: 'transition hover:bg-white/5' });
        tr.innerHTML = `
          <td class="px-6 py-4"><span class="rounded-md bg-ink-800 px-2 py-1 font-mono text-xs text-blue-300">${esc(t.id)}</span></td>
          <td class="px-6 py-4"><span class="inline-flex items-center gap-1.5 text-slate-300"><span class="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>${esc(t.source)}</span></td>
          <td class="px-6 py-4 max-w-md text-slate-300">${esc(t.desc)}</td>
          <td class="px-6 py-4"><span class="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-200">${esc(t.dept)}</span></td>
          <td class="px-6 py-4 text-right"><button class="process-btn rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:brightness-110 active:scale-95">Process Ticket</button></td>`;
        tr.querySelector('.process-btn').addEventListener('click', () => openTicketWizard(t));
        tb.appendChild(tr);
      });
    }

    function renderActivity() {
      const dot = { emerald:'bg-emerald-400', blue:'bg-blue-400', violet:'bg-violet-400', amber:'bg-amber-400', rose:'bg-rose-400', slate:'bg-slate-400' };
      const f = $('#activity-feed'); f.innerHTML = '';
      ACTIVITY.forEach((a) => f.appendChild(el('li', { class:'flex gap-3' }, `<span class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dot[a.dot]||'bg-slate-400'}"></span><div class="flex-1"><p class="text-sm text-slate-200"><span class="font-semibold text-white">${esc(a.who)}</span> ${esc(a.what)}</p><p class="text-[11px] text-slate-500">${a.when}</p></div>`)));
    }
    function renderBureauLoad() {
      const w = $('#bureau-load'); w.innerHTML = '';
      BUREAU_LOAD.forEach((b) => w.appendChild(el('div', {}, `<div class="mb-1.5 flex justify-between text-xs"><span class="font-medium text-slate-300">${b.name}</span><span class="font-mono text-slate-400">${b.pct}%</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${b.color} transition-all duration-700" style="width:${b.pct}%"></div></div>`)));
    }

    /* ---- Ticket processing wizard ---- */
    function openTicketWizard(ticket) {
      const node = el('div', { class: 'p-6' });
      let routedDept = ticket.dept;
      let workingId = ticket.id;

      const step1 = () => {
        node.innerHTML = `
          <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 1 of 3</p><h3 class="text-xl font-bold text-white">Jurisdictional Routing</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
          <div class="mb-5 rounded-xl border border-white/10 bg-ink-900 p-4 text-sm"><p class="font-mono text-xs text-blue-300" id="wk-id">${esc(workingId)}</p><p class="mt-1 text-slate-200">${esc(ticket.desc)}</p><p class="mt-2 text-xs text-slate-400">Originally reported: <span class="font-semibold text-slate-200">${esc(ticket.dept)}</span></p></div>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Confirm correct jurisdiction</label>
          <div class="mb-4 grid grid-cols-3 gap-2" id="jur-pick">
            ${['LSPD','BCSO','SAHP'].map((d) => `<button data-dept="${d}" class="jur-btn rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${d===routedDept?'border-badge-500 bg-blue-500/10 text-white':'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}">${d}</button>`).join('')}
          </div>
          <div id="misroute" class="mb-4 hidden rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200"></div>
          <button id="to-step2" class="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Confirm Routing →</button>`;
        node.querySelector('.close-x').onclick = closeModal;
        node.querySelectorAll('.jur-btn').forEach((b) => b.addEventListener('click', () => {
          routedDept = b.dataset.dept;
          node.querySelectorAll('.jur-btn').forEach((x) => x.className = `jur-btn rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${x.dataset.dept===routedDept?'border-badge-500 bg-blue-500/10 text-white':'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`);
          const mis = node.querySelector('#misroute');
          if (routedDept !== ticket.dept) {
            const renamed = ticket.id.replace(/^ticket/i, DEPT_ROUTING[routedDept].rename);
            workingId = renamed; node.querySelector('#wk-id').textContent = renamed;
            mis.classList.remove('hidden');
            mis.innerHTML = `⚠️ Misrouted ticket detected. Auto-renaming <span class="font-mono">${esc(ticket.id)}</span> → <span class="font-mono font-bold">${esc(renamed)}</span> and tagging <b>${routedDept}</b>.`;
          } else { mis.classList.add('hidden'); workingId = ticket.id; node.querySelector('#wk-id').textContent = ticket.id; }
        }));
        node.querySelector('#to-step2').onclick = step2;
      };

      const step2 = () => {
        const key = DEPT_ROUTING[routedDept].bureau;
        node.innerHTML = `
          <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 2 of 3</p><h3 class="text-xl font-bold text-white">Case ID Generation</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
          <div class="mb-4 rounded-lg border border-white/10 bg-ink-900 p-3 text-xs text-slate-400">Source ticket: <span class="font-mono text-blue-300">${esc(workingId)}</span> · Jurisdiction: <span class="font-semibold text-slate-200">${routedDept}</span></div>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Bureau (auto-selected from jurisdiction)</label>
          <select id="bsel" class="mb-4 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
            ${Object.keys(BUREAUS).map((k) => `<option value="${k}" ${k===key?'selected':''}>${BUREAUS[k].name} — [${BUREAUS[k].prefix}] (${BUREAUS[k].dept})</option>`).join('')}
          </select>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Generated 7-digit Case ID</label>
          <div class="mb-5 flex items-center gap-2"><span id="cpre" class="rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-sm font-semibold text-blue-300"></span><input id="cnum" class="flex-1 rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="flex gap-3"><button id="back1" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">← Back</button><button id="gen" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white transition hover:brightness-110">Generate Case File →</button></div>`;
        const sel = node.querySelector('#bsel'), pre = node.querySelector('#cpre'), num = node.querySelector('#cnum');
        const sync = () => { const b = BUREAUS[sel.value]; pre.textContent = `[${b.prefix}] Case-`; num.value = String(caseCounters[sel.value]); };
        sync(); sel.onchange = sync;
        node.querySelector('.close-x').onclick = closeModal;
        node.querySelector('#back1').onclick = step1;
        node.querySelector('#gen').onclick = () => { const k = sel.value; const full = `[${BUREAUS[k].prefix}] Case-${num.value}`; caseCounters[k] = Number(num.value) + 1; Store.set('caseCounters', caseCounters); step3(full, k); };
      };

      const step3 = (caseId, key) => {
        const slug = caseId.replace(/[^a-z0-9]/gi,'-').toLowerCase();
        const drive = `https://drive.cid.sa.gov/${BUREAUS[key].prefix.toLowerCase()}/${slug}`;
        node.innerHTML = `
          <div class="p-2 text-center">
            <div class="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15"><svg class="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
            <h3 class="text-xl font-bold text-white">Case File Generated</h3>
            <p class="mt-1 font-mono text-sm text-blue-300">${esc(caseId)}</p>
            <div class="mt-5 space-y-3 text-left">
              <div class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 p-3"><span class="sync-spin h-4 w-4 rounded-full border-2 border-blue-400 border-t-transparent"></span><span class="text-sm text-slate-200">Discord channel <b class="text-white">#${esc(slug)}</b> provisioned</span></div>
              <div class="rounded-lg border border-white/5 bg-ink-900 p-3"><p class="text-xs text-slate-400">Simulated Google Drive folder</p><a href="#" onclick="return false" class="break-all font-mono text-xs text-blue-300 hover:underline">${esc(drive)}</a></div>
            </div>
            <button id="done" class="mt-6 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Done</button>
          </div>`;
        node.querySelectorAll('.sync-spin').forEach((s) => s.style.animation = 'spin 0.8s linear infinite');
        node.querySelector('#done').onclick = () => { closeModal(); toast(`${caseId} created · Discord + Drive synced`, 'success'); };
      };

      step1(); openModal(node);
    }

    /* ---- Tracker deployment logs (dual signature + countdown) ---- */
    // Trackers are Supabase-backed; PROFILES cache resolves signer names.
    let trackers = [];
    let PROFILES = [];
    const officerName = (id) => { if (!id) return null; const p = PROFILES.find((x) => x.id === id); if (p) return p.display_name; const me = DB() && DB().me; return (me && me.id === id) ? me.display_name : 'Officer'; };
    async function fetchProfiles() { if (!dbReady()) return; try { PROFILES = await DB().list('profiles', {}); } catch (e) {} }
    function fmtCountdown(ms) {
      if (ms <= 0) return 'EXPIRED';
      const h = Math.floor(ms/3.6e6), m = Math.floor((ms%3.6e6)/6e4), s = Math.floor((ms%6e4)/1000);
      return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
    async function notify(userId, type, payload) { if (!userId || !dbReady()) return; try { await DB().insert('notifications', { user_id: userId, type, payload }); } catch (e) {} }
    function onEnterTrackers() { if (dbReady()) fetchTrackers(); else renderTrackers(); }
    async function fetchTrackers() {
      if (!dbReady()) { renderTrackers(); return; }
      try { trackers = await DB().list('trackers', { order: 'created_at', ascending: false }); renderTrackers(); }
      catch (e) { const w = $('#tracker-list'); if (w) w.innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || e) + '</p>'; }
    }
    const _expiring = new Set();
    function renderTrackers() {
      const wrap = $('#tracker-list'); if (!wrap) return;
      const canSign = DB() && DB().canDelete();   // command/director sign + deploy
      const nb = $('#new-tracker'); if (nb) nb.classList.toggle('hidden', !canSign);
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view tracker authorizations.</p>'; return; }
      if (!trackers.length) { wrap.innerHTML = '<p class="text-sm text-slate-500">No tracker authorizations.' + (canSign ? ' Use “+ Authorize”.' : '') + '</p>'; return; }
      wrap.innerHTML = '';
      trackers.forEach((t) => {
        const expMs = t.expires_at ? new Date(t.expires_at).getTime() : 0;
        const remaining = expMs ? expMs - Date.now() : 0;
        const authorized = t.status === 'authorized' && t.director_sig && t.deputy_sig;
        const expired = t.status === 'expired' || (authorized && remaining <= 0);
        const me = DB().me;
        const card = el('div', { class: 'rounded-xl border border-white/10 bg-ink-900 p-4' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div><p class="font-mono text-xs text-blue-300">${escapeHTML(t.tracker_code)}</p><p class="mt-0.5 text-sm font-semibold text-white">${escapeHTML(t.target)}</p><p class="text-[11px] text-slate-400">${escapeHTML(caseNumById(t.case_id) || '—')}</p></div>
            <div class="text-right"><p class="text-[10px] uppercase tracking-wider text-slate-400">${authorized ? 'Remaining' : 'Status'}</p>${authorized ? `<p class="cd font-mono text-sm font-bold ${remaining > 0 ? 'text-emerald-300' : 'text-rose-300'}" data-id="${t.id}" data-end="${expMs}">${fmtCountdown(remaining)}</p>` : `<p class="text-sm font-bold text-amber-300">${expired ? 'EXPIRED' : 'Pending'}</p>`}</div>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span class="rounded-md px-2 py-1 ${t.director_sig ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-slate-400'}">${t.director_sig ? '✓ ' + escapeHTML(officerName(t.director_sig)) : 'Director ✗'}</span>
            <span class="rounded-md px-2 py-1 ${t.deputy_sig ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-slate-400'}">${t.deputy_sig ? '✓ ' + escapeHTML(officerName(t.deputy_sig)) : 'Deputy ✗'}</span>
            <span class="ml-auto rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${expired ? 'bg-rose-500/10 text-rose-300' : authorized ? 'bg-blue-500/10 text-blue-300' : 'bg-amber-500/10 text-amber-300'}">${expired ? 'Expired' : authorized ? 'Authorized' : 'Pending dual-sign'}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${(!authorized && !expired && canSign) ? '<button class="tk-cosign flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition hover:bg-white/10">Co-sign as Deputy</button>' : ''}
            ${canSign ? '<button class="tk-del rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">✕</button>' : ''}
          </div>`;
        const co = card.querySelector('.tk-cosign');
        if (co) co.addEventListener('click', async () => {
          if (me && t.director_sig === me.id) { toast('A second command officer must co-sign (no single-person approval).', 'warn'); return; }
          const expires = new Date(Date.now() + (t.duration_hours || 24) * 3.6e6).toISOString();
          const res = await DB().update('trackers', t.id, { deputy_sig: me.id, status: 'authorized', authorized_at: new Date().toISOString(), expires_at: expires });
          if (res.error) { toast('Co-sign failed: ' + res.error.message, 'danger'); return; }
          notify(t.director_sig, 'tracker_authorized', { tracker_code: t.tracker_code, target: t.target });
          notify(me.id, 'tracker_authorized', { tracker_code: t.tracker_code, target: t.target });
          toast(`${t.tracker_code} fully authorized — tracking live`, 'success'); fetchTrackers();
        });
        const dl = card.querySelector('.tk-del');
        if (dl) dl.addEventListener('click', async () => { if (!confirm('Remove tracker ' + t.tracker_code + '?')) return; const r = await DB().remove('trackers', t.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } toast('Tracker removed', 'warn'); fetchTrackers(); });
        wrap.appendChild(card);
      });
    }
    function tickTrackers() {
      $$('#tracker-list .cd').forEach((n) => {
        const end = Number(n.dataset.end), r = end - Date.now();
        n.textContent = fmtCountdown(r);
        n.className = `cd font-mono text-sm font-bold ${r > 0 ? 'text-emerald-300' : 'text-rose-300'}`;
        if (r <= 0 && n.dataset.id && !_expiring.has(n.dataset.id) && DB() && DB().canDelete()) {
          _expiring.add(n.dataset.id);
          DB().update('trackers', n.dataset.id, { status: 'expired' }).then(() => fetchTrackers()).catch(() => {});
        }
      });
    }
    function openTrackerModal() {
      if (!(DB() && DB().canDelete())) { toast('Tracker deployment requires command authorization.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}">${escapeHTML(c.case_number)}</option>`)).join('');
      const me = DB().me || {};
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Surveillance Authorization</p><h3 class="text-xl font-bold text-white">Deploy GPS Tracker</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">Per SOP Title 7, deployment requires dual command authorization. You sign as Director now; a second command officer co-signs to activate.</p>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Target Vehicle / Subject *</label><input id="tk-target" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Black Sandking — plate 4XYZ" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Associated Case</label><select id="tk-case" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Director Signature *</label><input id="tk-dir" value="${escapeHTML(me.display_name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-[cursive] text-blue-200 outline-none focus:border-badge-500" placeholder="Your name" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Duration (hours)</label><input id="tk-dur" type="number" value="24" min="1" max="168" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" /></div>
          </div>
        </div>
        <button id="tk-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Deploy (awaiting deputy co-sign)</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#tk-go').onclick = async () => {
        const target = node.querySelector('#tk-target').value.trim();
        const dir = node.querySelector('#tk-dir').value.trim();
        if (!target || !dir) { toast('Target + Director signature are required.', 'warn'); return; }
        const dur = Math.max(1, Number(node.querySelector('#tk-dur').value) || 24);
        const caseId = node.querySelector('#tk-case').value || null;
        const c = casesCache.find((x) => x.id === caseId);
        const payload = { tracker_code: 'TRK-' + Math.floor(9000 + Math.random() * 999), target, case_id: caseId, bureau: c ? c.bureau : 'JTF', director_sig: me.id, duration_hours: dur, status: 'pending' };
        const res = await DB().insert('trackers', payload);
        if (res.error) { toast('Deploy failed: ' + res.error.message, 'danger'); return; }
        notify(me.id, 'tracker_pending', { tracker_code: payload.tracker_code, target });
        closeModal(); toast('Tracker logged — awaiting deputy co-sign', 'success'); fetchTrackers();
      };
      openModal(node);
    }

    /* ---- Raid compensation ---- */
    function findBracket(v) { return BRACKETS.find((b) => v >= b.min && v <= b.max) || null; }
    function renderCompBrackets() {
      $('#comp-brackets').innerHTML = `<table class="w-full text-left text-xs"><thead><tr class="bg-ink-800 uppercase tracking-wider text-slate-400"><th class="px-3 py-2 font-semibold">Net Seizure</th><th class="px-3 py-2 text-right font-semibold">% Given</th></tr></thead><tbody class="divide-y divide-white/5">${BRACKETS.map((b)=>`<tr class="cbrow" data-min="${b.min}"><td class="px-3 py-2 font-mono text-slate-300">${b.label}</td><td class="px-3 py-2 text-right font-mono font-semibold text-blue-300">${b.pct}%</td></tr>`).join('')}</tbody></table>`;
    }
    function calcComp() {
      const v = parseFloat($('#comp-input').value.replace(/[^0-9.]/g,'')) || 0;
      $$('#comp-brackets .cbrow').forEach((r) => r.classList.remove('bg-blue-500/10'));
      const out = $('#comp-output');
      if (v < BRACKETS[0].min) { out.innerHTML = `<p class="rounded-lg border border-white/5 bg-ink-850 p-4 text-sm text-slate-400">${v>0?'Below minimum bracket ($1,000,000).':'Enter a net seizure value to compute payouts.'}</p>`; return; }
      const b = findBracket(v); const given = v * b.pct/100; const retain = v - given;
      const ar = $$('#comp-brackets .cbrow').find((r) => Number(r.dataset.min) === b.min); if (ar) ar.classList.add('bg-blue-500/10');
      out.innerHTML = `
        <div class="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/5 p-3"><span class="text-xs font-semibold uppercase tracking-wider text-blue-300/80">Applicable Bracket</span><span class="font-mono text-lg font-bold text-blue-300">${b.pct}%</span></div>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"><p class="text-[10px] uppercase tracking-wider text-emerald-300/80">Compensation Pool</p><p class="font-mono text-lg font-bold text-emerald-300">${fmtUSD(given)}</p></div>
          <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><p class="text-[10px] uppercase tracking-wider text-amber-300/80">Retained to Division</p><p class="font-mono text-lg font-bold text-amber-300">${fmtUSD(retain)}</p></div>
        </div>
        <div class="rounded-lg border border-white/5 bg-ink-850 p-3"><p class="mb-2 text-[10px] uppercase tracking-wider text-slate-400">Automated Payout Split</p>
          ${Object.entries(COMP_SPLIT).map(([role,frac])=>`<div class="mb-1.5 flex items-center justify-between text-sm"><span class="text-slate-300">${role}</span><span class="font-mono font-semibold text-white">${fmtUSD(given*frac)}<span class="ml-1 text-[10px] text-slate-500">(${frac*100}%)</span></span></div>`).join('')}
        </div>`;
    }

    /* ============================================================ 6. NARCOTICS ============================================================ */
    const densTint = (d) => d==='High' ? 'text-rose-300 bg-rose-500/10' : d==='Medium' ? 'text-amber-300 bg-amber-500/10' : 'text-emerald-300 bg-emerald-500/10';
    function renderDrugs() {
      const wrap = $('#drug-registry'); if (!wrap) return; wrap.innerHTML = '';
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#narc-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Live narcotics registry requires sign-in.</div>'; $('#narc-count').textContent = '0'; $('#narc-hotspots').textContent = '0'; return; }
      if (!DRUGS.length) { wrap.innerHTML = `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">No narcotics on file.${canEdit ? ' Use “+ New Narcotic”.' : ''}</div>`; $('#narc-count').textContent = '0'; $('#narc-hotspots').textContent = '0'; return; }
      let hot = 0;
      DRUGS.forEach((d, i) => {
        hot += d.hotspots.length;
        const det = el('details', { class:'group overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        if (i === 0) det.setAttribute('open','');
        det.innerHTML = `
          <summary class="flex flex-wrap items-center gap-4 px-6 py-4">
            <svg class="chev h-4 w-4 flex-shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            <span class="text-2xl">${d.icon}</span>
            <div class="min-w-0"><h3 class="text-base font-semibold text-white">${esc(d.name)}</h3><p class="text-xs text-slate-400">${esc(d.cls)}</p></div>
            <div class="ml-auto flex items-center gap-4 text-right">
              <div><p class="text-[10px] uppercase tracking-wider text-slate-500">Street</p><p class="font-mono text-sm font-bold text-emerald-300">${fmtUSD(d.street)}</p></div>
              <div class="hidden sm:block"><p class="text-[10px] uppercase tracking-wider text-slate-500">Popularity</p><p class="font-mono text-sm font-bold text-blue-300">${d.pop}</p></div>
            </div>
          </summary>
          <div class="drawer-body"><div><div class="grid grid-cols-1 gap-6 border-t border-white/5 px-6 py-5 lg:grid-cols-2">
            <div>
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Chemical Precursors — adjust purity</p>
              <div class="space-y-3" data-drug="${i}">
                ${d.precursors.map((p,pi)=>`<div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">${esc(p.n)}</span><span class="font-mono text-slate-400 prc-val" data-pi="${pi}">${p.p}%</span></div><input type="range" min="0" max="100" value="${p.p}" data-pi="${pi}" class="prc w-full" /></div>`).join('')}
              </div>
              <div class="mt-4 flex items-center justify-between rounded-lg border border-white/10 bg-ink-850 p-3"><span class="text-xs font-semibold text-slate-300">Batch Purity → Adj. Street Value</span><span class="font-mono text-sm font-bold text-emerald-300 batch-out">—</span></div>
            </div>
            <div>
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Pricing Matrix</p>
              <div class="space-y-3">
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Street Price</span><span class="font-mono text-emerald-300">${fmtUSD(d.street)}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-emerald-500" style="width:100%"></div></div></div>
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Wholesale</span><span class="font-mono text-blue-300">${fmtUSD(d.wholesale)}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-blue-500" style="width:${Math.round(d.wholesale/d.street*100)}%"></div></div></div>
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Popularity Index</span><span class="font-mono text-violet-300">${d.pop}/100</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-violet-500" style="width:${d.pop}%"></div></div></div>
              </div>
              <p class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Geographic Selling Hotspots</p>
              <div class="space-y-2">
                ${d.hotspots.map((h)=>`<div class="flex items-center justify-between rounded-lg border border-white/5 bg-ink-850 px-3 py-2 text-sm"><span class="text-slate-200">${esc(h.area)}</span><span class="flex items-center gap-2"><span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${densTint(h.d)}">${h.d}</span>${h.case?`<span class="font-mono text-[11px] text-blue-300">${esc(h.case)}</span>`:'<span class="text-[11px] text-slate-500">unlinked</span>'}</span></div>`).join('')||'<p class="text-xs text-slate-500">No hotspots logged.</p>'}
              </div>
              ${canEdit ? `<div class="mt-4 text-right"><button class="narc-edit rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10" data-id="${d.id}">Edit narcotic</button></div>` : ''}
            </div>
          </div></div></div>`;
        wrap.appendChild(det);
        const eb = det.querySelector('.narc-edit'); if (eb) eb.addEventListener('click', () => openNarcoticModal(DRUGS.find((x) => x.id === eb.dataset.id)));
        // purity sliders (what-if calc; not persisted)
        const baseStreet = d.street;
        const recompute = () => {
          const vals = $$('.prc', det).map((s) => Number(s.value));
          const avg = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
          det.querySelector('.batch-out').textContent = `${Math.round(avg)}% · ${fmtUSD(baseStreet * avg/100)}`;
        };
        $$('.prc', det).forEach((s) => s.addEventListener('input', () => { det.querySelector(`.prc-val[data-pi="${s.dataset.pi}"]`).textContent = s.value + '%'; recompute(); }));
        recompute();
      });
      $('#narc-count').textContent = DRUGS.length;
      $('#narc-hotspots').textContent = hot;
    }

    function narcsNotice() { /* handled in renderDrugs */ }
    function onEnterNarcotics() { if (dbReady()) fetchDrugs(); else renderDrugs(); }
    async function fetchDrugs() {
      if (!dbReady()) { renderDrugs(); return; }
      try {
        const [narc, prec, hot] = await Promise.all([
          DB().list('narcotics', { order: 'name', ascending: true }),
          DB().list('narcotic_precursors', {}),
          DB().list('narcotic_hotspots', {})
        ]);
        const caseNum = (id) => { const c = casesCache.find((x) => x.id === id); return c ? c.case_number : null; };
        DRUGS = narc.map((n) => ({
          id: n.id, name: n.name, cls: n.classification || '', icon: n.icon || '💊',
          pop: n.popularity || 0, street: Number(n.street_price) || 0, wholesale: Number(n.wholesale_price) || 0,
          precursors: prec.filter((p) => p.narcotic_id === n.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((p) => ({ n: p.name, p: p.default_purity || 0 })),
          hotspots: hot.filter((h) => h.narcotic_id === n.id).map((h) => ({ area: h.area, d: cap(h.density), case: caseNum(h.case_id) })),
          hotspotsRaw: hot.filter((h) => h.narcotic_id === n.id)
        }));
        renderDrugs();
      } catch (e) { const w = $('#drug-registry'); if (w) w.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-rose-300">Could not load narcotics: ' + escapeHTML(e.message || String(e)) + '</div>'; }
    }
    function openNarcoticModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const isEdit = !!(record && record.id);
      const node = el('div', { class: 'p-6' });
      const caseOpts = (sel) => ['<option value="">— no case —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      const precRow = (p) => `<div class="prec-row grid grid-cols-12 gap-2"><input class="pn col-span-8 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="Precursor" value="${escapeHTML(p ? p.n : '')}" /><input type="number" class="pp col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="%" value="${p ? p.p : 0}" /><button class="prx col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button></div>`;
      const hotRow = (h) => `<div class="hot-row grid grid-cols-12 gap-2"><input class="ha col-span-5 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="Area" value="${escapeHTML(h ? h.area : '')}" /><select class="hd col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white">${['low','medium','high'].map((d)=>`<option value="${d}" ${h && (h.density||'')===d?'selected':''}>${cap(d)}</option>`).join('')}</select><select class="hc col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white">${caseOpts(h ? h.case_id : '')}</select><button class="hrx col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button></div>`;
      const d = record || {};
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${isEdit ? 'Edit' : 'New'} Narcotic</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(d.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Icon</label><input data-k="icon" value="${escapeHTML(d.icon || '💊')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="sm:col-span-3"><label class="mb-1 block text-xs font-semibold text-slate-400">Classification</label><input data-k="classification" value="${escapeHTML(d.cls || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Popularity</label><input type="number" data-k="popularity" value="${d.pop || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Street $</label><input type="number" data-k="street_price" value="${d.street || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Wholesale $</label><input type="number" data-k="wholesale_price" value="${d.wholesale || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <div class="mt-4"><div class="mb-2 flex items-center justify-between"><label class="text-xs font-semibold text-slate-400">Precursors (name + default purity %)</label><button id="prec-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Precursor</button></div><div id="precs" class="space-y-2">${(d.precursors || []).map(precRow).join('')}</div></div>
        <div class="mt-4"><div class="mb-2 flex items-center justify-between"><label class="text-xs font-semibold text-slate-400">Hotspots (area · density · case)</label><button id="hot-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Hotspot</button></div><div id="hots" class="space-y-2">${(d.hotspotsRaw || []).map(hotRow).join('')}</div></div>
        <div class="mt-5 flex gap-2">
          <button id="n-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${isEdit ? 'Save changes' : 'Create narcotic'}</button>
          ${isEdit && DB().canDelete() ? '<button id="n-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const bind = () => { $$('.prx', node).forEach((b) => b.onclick = () => b.closest('.prec-row').remove()); $$('.hrx', node).forEach((b) => b.onclick = () => b.closest('.hot-row').remove()); };
      bind();
      node.querySelector('#prec-add').onclick = () => { node.querySelector('#precs').insertAdjacentHTML('beforeend', precRow(null)); bind(); };
      node.querySelector('#hot-add').onclick = () => { node.querySelector('#hots').insertAdjacentHTML('beforeend', hotRow(null)); bind(); };
      node.querySelector('#n-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.type === 'number' ? (Number(f.value) || 0) : f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        let nid = record && record.id;
        let res = nid ? await DB().update('narcotics', nid, payload) : await DB().insert('narcotics', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        if (!nid) nid = res.data && res.data[0] && res.data[0].id;
        if (nid) {
          // replace children
          await DB().from('narcotic_precursors').delete().eq('narcotic_id', nid);
          await DB().from('narcotic_hotspots').delete().eq('narcotic_id', nid);
          const precs = $$('.prec-row', node).map((r, i) => ({ narcotic_id: nid, name: $('.pn', r).value.trim(), default_purity: Number($('.pp', r).value) || 0, sort_order: i })).filter((p) => p.name);
          const hots = $$('.hot-row', node).map((r) => ({ narcotic_id: nid, area: $('.ha', r).value.trim(), density: $('.hd', r).value, case_id: $('.hc', r).value || null })).filter((h) => h.area);
          if (precs.length) await DB().from('narcotic_precursors').insert(precs);
          if (hots.length) await DB().from('narcotic_hotspots').insert(hots);
        }
        closeModal(); toast(isEdit ? 'Narcotic updated' : 'Narcotic created', 'success'); fetchDrugs();
      };
      const nd = node.querySelector('#n-del'); if (nd) nd.onclick = async () => { if (!confirm('Delete ' + record.name + '?')) return; const r = await DB().remove('narcotics', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Narcotic deleted', 'warn'); fetchDrugs(); };
      openModal(node, { wide: true });
    }

    /* ============================================================ 7. BALLISTICS ============================================================ */
    let benchType = Store.get('benchType', 'street');
    function renderBenchTabs() {
      $$('.bench-tab').forEach((b) => {
        const on = b.dataset.bench === benchType;
        b.className = `bench-tab rounded-md px-4 py-2 text-xs font-semibold transition ${on ? 'bg-gradient-to-r from-badge-500 to-blue-700 text-white shadow-glow' : 'text-slate-300 hover:text-white'}`;
      });
    }
    function onEnterBallistics() { if (dbReady()) { fetchBenches(); fetchFootprints(); } else { renderBenches(); renderBallisticLog(); } }
    async function fetchBenches() { if (!dbReady()) { renderBenches(); return; } try { BENCHES_CACHE = await DB().list('ballistics_benches', { order: 'name', ascending: true }); renderBenches(); } catch (e) { $('#bench-list').innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || String(e)) + '</p>'; } }
    async function fetchFootprints() { if (!dbReady()) { renderBallisticLog(); return; } try { FOOTPRINTS = await DB().list('ballistic_footprints', { order: 'created_at', ascending: false }); renderBallisticLog(); } catch (e) {} }
    function renderBenches() {
      renderBenchTabs();
      const wrap = $('#bench-list'); if (!wrap) return;
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#bench-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Live bench records require sign-in.</p>'; return; }
      const list = BENCHES_CACHE.filter((b) => b.bench_type === benchType);
      if (!list.length) { wrap.innerHTML = `<p class="text-sm text-slate-500">No ${benchType === 'street' ? 'street-gang' : 'organized-crime'} benches logged.${canEdit ? ' Use “+ Bench”.' : ''}</p>`; return; }
      wrap.innerHTML = '';
      list.forEach((b) => {
        const tierTint = /high/i.test(b.tier || '') ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300';
        const heatTint = b.heat === 'Active' ? 'bg-rose-500/10 text-rose-300' : b.heat === 'Raid Pending' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300';
        const caseNo = caseNumById(b.case_id);
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-6' });
        card.innerHTML = `
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h4 class="text-base font-semibold text-white">${escapeHTML(b.name)}</h4><p class="mt-1 text-xs text-slate-400">Linked investigation: ${caseNo ? `<span class="font-mono text-blue-300">${escapeHTML(caseNo)}</span>` : '<span class="text-slate-500">none</span>'}</p></div>
            <div class="flex items-center gap-2">${b.tier ? `<span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${tierTint}">${escapeHTML(b.tier)}-Tier</span>` : ''}${b.heat ? `<span class="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase ${heatTint}">${escapeHTML(b.heat)}</span>` : ''}${canEdit ? '<button class="b-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}</div>
          </div>
          <div class="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Manufacturing Outputs</p><div class="flex flex-wrap gap-2">${(b.outputs || []).map((o) => `<span class="rounded-full border border-white/10 bg-ink-850 px-3 py-1 text-xs text-slate-200">${escapeHTML(o)}</span>`).join('') || '<span class="text-xs text-slate-500">—</span>'}</div></div>
            <div><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Component Tracing</p><div class="space-y-1.5">${(b.components || []).map((c) => `<div class="flex items-center gap-2 text-xs text-slate-300"><span class="h-1.5 w-1.5 rounded-full bg-blue-400"></span>${escapeHTML(c)}</div>`).join('') || '<span class="text-xs text-slate-500">—</span>'}</div></div>
          </div>`;
        const eb = card.querySelector('.b-edit'); if (eb) eb.addEventListener('click', () => openBenchModal(b));
        wrap.appendChild(card);
      });
    }
    function renderBallisticLog() {
      const wrap = $('#ballistic-log'); if (!wrap) return;
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#footprint-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view footprints.</p>'; return; }
      if (!FOOTPRINTS.length) { wrap.innerHTML = `<p class="text-sm text-slate-500">No footprints logged.${canEdit ? ' Use “+ Footprint”.' : ''}</p>`; return; }
      wrap.innerHTML = '';
      FOOTPRINTS.forEach((l) => {
        const gang = GANGS.find((g) => g.id === l.gang_id);
        const caseNo = caseNumById(l.case_id);
        const card = el('div', { class: 'rounded-xl border border-white/10 bg-ink-900 p-3' });
        card.innerHTML = `<div class="flex items-start justify-between gap-2"><p class="font-mono text-xs text-violet-300">${escapeHTML(l.signature)}</p>${canEdit ? '<button class="f-edit text-[11px] text-slate-400 hover:text-white">edit</button>' : ''}</div><p class="mt-1 text-sm text-white">${escapeHTML(l.weapon || '—')}</p><div class="mt-1.5 flex items-center justify-between text-[11px]"><span class="text-slate-400">${gang ? escapeHTML(gang.name) : '—'}</span><span class="font-mono text-blue-300">${caseNo ? escapeHTML(caseNo) : ''}</span></div>`;
        const eb = card.querySelector('.f-edit'); if (eb) eb.addEventListener('click', () => openFootprintModal(l));
        wrap.appendChild(card);
      });
    }
    function openBenchModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const b = record || {};
      const node = el('div', { class: 'p-6' });
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === b.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Weapon Bench</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(b.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bench Type</label><select data-k="bench_type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="street" ${b.bench_type === 'street' ? 'selected' : ''}>Street Gang</option><option value="organized" ${b.bench_type === 'organized' ? 'selected' : ''}>Organized Crime</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Tier</label><input data-k="tier" list="tier-list" value="${escapeHTML(b.tier || (record ? '' : 'Low'))}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="tier-list"><option value="Low"><option value="High"></datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Heat</label><input data-k="heat" list="heat-list" value="${escapeHTML(b.heat || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="heat-list"><option value="Active"><option value="Surveillance"><option value="Raid Pending"></datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Outputs <span class="text-slate-500">(one per line)</span></label><textarea data-arr="outputs" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML((b.outputs || []).join('\n'))}</textarea></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Components <span class="text-slate-500">(one per line)</span></label><textarea data-arr="components" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML((b.components || []).join('\n'))}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="b-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create bench'}</button>
          ${record && DB().canDelete() ? '<button id="b-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#b-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        $$('[data-arr]', node).forEach((f) => payload[f.dataset.arr] = f.value.split('\n').map((s) => s.trim()).filter(Boolean));
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        if (!payload.case_id) payload.case_id = null;
        const res = record && record.id ? await DB().update('ballistics_benches', record.id, payload) : await DB().insert('ballistics_benches', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Bench updated' : 'Bench created', 'success'); fetchBenches();
      };
      const bd = node.querySelector('#b-del'); if (bd) bd.onclick = async () => { if (!confirm('Delete bench?')) return; const r = await DB().remove('ballistics_benches', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Bench deleted', 'warn'); fetchBenches(); };
      openModal(node, { wide: true });
    }
    function openFootprintModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const l = record || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— none —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === l.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === l.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Ballistic Footprint</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Signature *</label><input data-k="signature" value="${escapeHTML(l.signature || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" placeholder="BLSTC-77-A · 9mm striations" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Weapon</label><input data-k="weapon" value="${escapeHTML(l.weapon || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Gang</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          </div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="f-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save' : 'Log footprint'}</button>
          ${record && DB().canDelete() ? '<button id="f-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#f-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.signature) { toast('Signature is required.', 'warn'); return; }
        if (!payload.gang_id) payload.gang_id = null; if (!payload.case_id) payload.case_id = null;
        const res = record && record.id ? await DB().update('ballistic_footprints', record.id, payload) : await DB().insert('ballistic_footprints', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Footprint updated' : 'Footprint logged', 'success'); fetchFootprints();
      };
      const fd = node.querySelector('#f-del'); if (fd) fd.onclick = async () => { if (!confirm('Delete footprint?')) return; const r = await DB().remove('ballistic_footprints', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Footprint deleted', 'warn'); fetchFootprints(); };
      openModal(node);
    }

    /* ============================================================ 8. PERSONNEL ============================================================ */
    function statusTint(s) { return s === 'On Duty' ? 'bg-emerald-400' : s === 'Field' ? 'bg-blue-400' : 'bg-slate-500'; }
    function renderRoster() {
      const g = $('#roster-grid'); g.innerHTML = '';
      ROSTER.forEach((p) => g.appendChild(el('div', { class:'rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-white/10' }, `
        <div class="flex items-center gap-3"><div class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white">${esc(p.init)}</div>
          <div class="min-w-0 flex-1"><p class="truncate font-semibold text-white">${esc(p.name)}</p><p class="text-xs text-slate-400">${esc(p.role)}</p></div>
          <span class="pulse-dot h-2.5 w-2.5 rounded-full ${statusTint(p.status)}" title="${esc(p.status)}"></span></div>
        <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div class="rounded-lg bg-ink-850 py-2"><p class="font-mono font-bold text-blue-300">${esc(p.cs)}</p><p class="text-[10px] text-slate-500">Callsign</p></div>
          <div class="rounded-lg bg-ink-850 py-2"><p class="font-semibold text-slate-200">${esc(p.unit)}</p><p class="text-[10px] text-slate-500">Unit</p></div>
          <div class="rounded-lg bg-ink-850 py-2"><p class="font-semibold text-slate-200">${esc(p.status)}</p><p class="text-[10px] text-slate-500">Status</p></div>
        </div>`)));
    }
    function renderCommendations() {
      const tints = { amber:'from-amber-500/20 to-amber-700/5 border-amber-500/20', blue:'from-blue-500/20 to-blue-700/5 border-blue-500/20', violet:'from-violet-500/20 to-violet-700/5 border-violet-500/20' };
      const g = $('#commend-grid'); g.innerHTML = '';
      COMMENDATIONS.forEach((c, i) => {
        const card = el('div', { class:`relative rounded-2xl border bg-gradient-to-br ${tints[c.tint]} p-5` });
        card.innerHTML = `
          <div class="flex items-start gap-3"><span class="text-3xl">${c.icon}</span><div class="min-w-0"><p class="font-semibold text-white">${esc(c.title)}</p><p class="text-xs text-slate-300">${esc(c.who)}</p></div></div>
          <p class="mt-3 text-xs text-slate-300">${esc(c.note)}</p>
          <div class="mt-4 relative">${dropupBtn('commend-'+i)}</div>`;
        g.appendChild(card);
        wireDropup(card.querySelector('.dropup'), `Commendation "${c.title}"`);
      });
    }
    function mediaThumb(m) {
      if (m.type === 'image' && m.src) return `<img src="${esc(m.src)}" alt="${esc(m.title)}" class="ev-img h-40 w-full cursor-zoom-in object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="hidden h-40 w-full items-center justify-center bg-ink-800 text-4xl">🖼️</div>`;
      if (m.type === 'video') return `<div class="flex h-40 w-full items-center justify-center bg-ink-800 text-4xl">🎬</div>`;
      return `<div class="flex h-40 w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-ink-800 to-ink-700"><span class="text-3xl">📡</span><span class="font-mono text-[10px] text-slate-400">${esc(m.src || 'fivemanage')}</span></div>`;
    }
    function mediaTagChips(m) {
      const t = m.tags || {}; const out = [];
      if (t.case) out.push(`<span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono text-blue-300">${esc(t.case)}</span>`);
      if (t.gang) out.push(`<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">🚩 ${esc(t.gang)}</span>`);
      if (t.location) out.push(`<span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">📍 ${esc(t.location)}</span>`);
      if (t.person) out.push(`<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">👤 ${esc(t.person)}</span>`);
      return out.join(' ');
    }
    function renderMediaFilters() {
      const bar = $('#media-filter'); if (!bar) return;
      const kinds = [ ['all','All'], ['case','By Case'], ['gang','By Gang'], ['location','By Location'], ['person','Mugshots'] ];
      bar.innerHTML = kinds.map(([k,l]) => `<button class="mf-chip rounded-full border px-3 py-1 text-xs font-medium transition ${mediaFilter===k?'border-badge-500 bg-blue-500/10 text-white':'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}" data-f="${k}">${l}</button>`).join('');
      bar.querySelectorAll('.mf-chip').forEach((b) => b.addEventListener('click', () => { mediaFilter = b.dataset.f; renderMediaFilters(); renderMedia(); }));
    }
    function renderMedia() {
      const g = $('#media-grid'); g.innerHTML = '';
      const items = MEDIA.filter((m) => mediaFilter === 'all' ? true : mediaFilter === 'person' ? !!(m.tags && m.tags.person) : !!(m.tags && m.tags[mediaFilter]));
      if (!items.length) { g.innerHTML = '<p class="text-sm text-slate-500">No assets match this filter.</p>'; return; }
      items.forEach((m) => {
        const card = el('div', { class:'overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        card.innerHTML = `
          ${mediaThumb(m)}
          <div class="p-4"><div class="flex items-center justify-between"><p class="truncate text-sm font-semibold text-white">${esc(m.title)}</p><span class="ml-2 flex-shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">${esc(m.kind)}</span></div>
          <div class="mt-2 flex flex-wrap gap-1">${mediaTagChips(m)}</div>
          <div class="mt-3 relative">${dropupBtn('media')}</div></div>`;
        g.appendChild(card);
        const img = card.querySelector('.ev-img'); if (img) img.addEventListener('click', () => openLightbox(m));
        wireDropup(card.querySelector('.dropup'), `Media "${m.title}"`);
      });
    }
    function openLightbox(m) {
      const node = el('div', { class:'p-4' });
      const body = m.type === 'image' && m.src ? `<img src="${esc(m.src)}" alt="${esc(m.title)}" class="max-h-[70vh] w-full rounded-lg object-contain" />` : `<div class="flex h-64 items-center justify-center rounded-lg bg-ink-800 text-5xl">${m.type==='video'?'🎬':'📡'}</div>`;
      node.innerHTML = `<div class="mb-3 flex items-center justify-between"><p class="text-sm font-semibold text-white">${esc(m.title)}</p><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>${body}<div class="mt-3 flex flex-wrap gap-1">${mediaTagChips(m)}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      openModal(node, { wide: true });
    }
    // "Forward to Case" drop-up menu
    function dropupBtn(id) {
      return `<button class="dropup flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition hover:bg-white/10" aria-haspopup="true" aria-expanded="false">↗ Forward to Case</button>`;
    }
    function wireDropup(btn, label) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = btn.parentElement.querySelector('.dropup-menu');
        document.querySelectorAll('.dropup-menu').forEach((m) => m.remove());
        if (existing) { btn.setAttribute('aria-expanded','false'); return; }
        const menu = el('div', { class:'dropup-menu absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-800 shadow-glow' });
        menu.innerHTML = ACTIVE_CASES.map((c)=>`<button class="case-pick block w-full px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-blue-500/15 hover:text-white" data-case="${esc(c)}">${esc(c)}</button>`).join('');
        btn.parentElement.appendChild(menu);
        btn.setAttribute('aria-expanded','true');
        menu.querySelectorAll('.case-pick').forEach((p) => p.addEventListener('click', () => { menu.remove(); btn.setAttribute('aria-expanded','false'); toast(`${label} forwarded → ${p.dataset.case}`, 'success'); }));
      });
    }
    document.addEventListener('click', () => document.querySelectorAll('.dropup-menu').forEach((m) => { m.remove(); const b = m.parentElement && m.parentElement.querySelector('.dropup'); if (b) b.setAttribute('aria-expanded','false'); }));

    function openMediaModal() {
      const node = el('div', { class:'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Ingest Media Asset</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label><input id="md-title" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Dashcam — Vinewood pursuit" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Source Type</label><select id="md-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="image">Direct Image URL</option><option value="video">MP4 Video Link</option><option value="fivemanage">FiveManage CDN Embed</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">URL / Embed ID</label><input id="md-src" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-badge-500" placeholder="https://… or fm_xxxxx" /></div>
          <p class="pt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Evidence Tags</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Case</label><select id="md-case" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="">— none —</option>${ACTIVE_CASES.map((c)=>`<option>${esc(c)}</option>`).join('')}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang</label><select id="md-gang" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="">— none —</option>${GANGS.map((g)=>`<option>${esc(g.name)}</option>`).join('')}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Location</label><input id="md-loc" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Area / place" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Person (mugshot)</label><input id="md-person" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Subject name" /></div>
          </div>
        </div>
        <button id="md-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add to Vault</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#md-go').onclick = () => {
        const title = node.querySelector('#md-title').value.trim();
        if (!title) { toast('A title is required.', 'warn'); return; }
        const type = node.querySelector('#md-type').value;
        const kind = type === 'image' ? 'Image URL' : type === 'video' ? 'MP4 Video' : 'FiveManage Embed';
        MEDIA.unshift({ title, type, src: node.querySelector('#md-src').value.trim(), kind, tags: { case:node.querySelector('#md-case').value, gang:node.querySelector('#md-gang').value, location:node.querySelector('#md-loc').value.trim(), person:node.querySelector('#md-person').value.trim() } });
        saveMedia(); renderMedia(); closeModal(); toast('Media ingested into vault', 'success');
      };
      openModal(node);
    }

    /* ============================================================ 9. M.O. DETECTOR ============================================================ */
    const SAMPLE_MO = "Two suspects in an unmarked black Burrito breached the rear door via lockpick. One matched the alias 'Tre'. A Class 2 AP Pistol casing was recovered, and thermite residue was found on the safe. They fled before our black CID SUV arrived.";
    function scanMO(text) {
      const lc = text.toLowerCase();
      const found = { names:[], entry:[], vehicles:[], weapons:[] };
      Object.keys(MO_DICT).forEach((cat) => MO_DICT[cat].forEach((term) => { if (lc.includes(term) && !found[cat].includes(term)) found[cat].push(term); }));
      return found;
    }
    function renderMO() {
      const text = $('#mo-input').value.trim();
      const tagBox = $('#mo-tags'); const matchBox = $('#mo-matches');
      if (!text) { toast('Paste an incident narrative first.', 'warn'); return; }
      const found = scanMO(text);
      const all = [].concat(found.names, found.entry, found.vehicles, found.weapons);
      const catMeta = { names:{l:'Aliases / Names', t:'bg-rose-500/10 text-rose-300 border-rose-500/20'}, entry:{l:'Entry Methods', t:'bg-amber-500/10 text-amber-300 border-amber-500/20'}, vehicles:{l:'Vehicles', t:'bg-blue-500/10 text-blue-300 border-blue-500/20'}, weapons:{l:'Weapons', t:'bg-violet-500/10 text-violet-300 border-violet-500/20'} };
      tagBox.innerHTML = `<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Extracted Tactical Indicators (${all.length})</p>` +
        (all.length ? Object.keys(catMeta).filter((c)=>found[c].length).map((c)=>`<div class="mb-2"><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500">${catMeta[c].l}</p><div class="flex flex-wrap gap-2">${found[c].map((t)=>`<span class="rounded-full border px-2.5 py-1 text-[11px] font-medium ${catMeta[c].t}">${esc(t)}</span>`).join('')}</div></div>`).join('')
        : '<p class="text-sm text-slate-500">No known indicators detected.</p>');

      // Score each case by shared indicators
      const scored = MO_CASES.map((c) => {
        const shared = c.tags.filter((tag) => all.includes(tag));
        const pct = Math.round((shared.length / c.tags.length) * 100);
        return { ...c, shared, pct };
      }).filter((c) => c.shared.length).sort((a,b) => b.pct - a.pct);

      matchBox.innerHTML = scored.length ? scored.map((c) => {
        const tint = c.pct >= 70 ? 'border-rose-500/40 bg-rose-500/5' : c.pct >= 40 ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900';
        const bar = c.pct >= 70 ? 'bg-rose-500' : c.pct >= 40 ? 'bg-amber-500' : 'bg-blue-500';
        return `<div class="rounded-xl border ${tint} p-4">
          <div class="flex items-center justify-between"><div><span class="font-mono text-sm font-semibold text-white">${esc(c.id)}</span> <span class="ml-2 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status==='Cold'?'bg-slate-500/20 text-slate-300':'bg-emerald-500/15 text-emerald-300'}">${c.status}</span></div><span class="font-mono text-lg font-bold ${c.pct>=70?'text-rose-300':c.pct>=40?'text-amber-300':'text-blue-300'}">${c.pct}%</span></div>
          <p class="mt-1 text-xs text-slate-400">${c.pct}% M.O. match — shared: ${c.shared.map((s)=>esc(s)).join(', ')}</p>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${bar}" style="width:${c.pct}%"></div></div>
        </div>`;
      }).join('') : '<p class="text-sm text-slate-500">No cross-reference matches found for these indicators.</p>';
      if (scored.length) toast(`${scored[0].pct}% M.O. match found with ${scored[0].id}`, scored[0].pct >= 70 ? 'danger' : 'info');
    }

    /* ============================================================ 10. CID GENERAL (Drive) ============================================================ */
    const ACCENTS = { blue:{tint:'text-blue-400',ring:'hover:border-blue-500/40 hover:bg-blue-500/5'}, emerald:{tint:'text-emerald-400',ring:'hover:border-emerald-500/40 hover:bg-emerald-500/5'}, violet:{tint:'text-violet-400',ring:'hover:border-violet-500/40 hover:bg-violet-500/5'}, amber:{tint:'text-amber-400',ring:'hover:border-amber-500/40 hover:bg-amber-500/5'}, rose:{tint:'text-rose-400',ring:'hover:border-rose-500/40 hover:bg-rose-500/5'}, slate:{tint:'text-slate-300',ring:'hover:border-slate-400/40 hover:bg-white/5'} };
    const fileIcon = (t) => ({ doc:'📄', sheet:'📊', pdf:'📕', zip:'🗜️', gangsheet:'📋', matrix:'🛡️' }[t] || '📄');
    function renderDrive() {
      const grid = $('#drive-grid'); grid.innerHTML = '';
      DRIVE_FOLDERS.forEach((f) => {
        const a = ACCENTS[f.accent] || ACCENTS.slate;
        const stars = f.star ? `<span class="text-amber-400">${'★'.repeat(f.star)}</span> ` : '';
        const card = el('div', { class:`folder-card cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-4 ${a.ring}` }, `
          <div class="flex items-start justify-between"><svg class="h-9 w-9 ${a.tint}" viewBox="0 0 24 24" fill="currentColor" opacity="0.9"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg><svg class="h-4 w-4 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></div>
          <p class="mt-3 truncate text-sm font-semibold text-white" title="${esc(f.name)}">${stars}${esc(f.name)}</p>
          <p class="mt-1 text-[11px] text-slate-500">Modified ${f.modified} · ${f.files.length} items</p>`);
        card.addEventListener('click', () => openFolder(f));
        grid.appendChild(card);
      });
    }
    function openFolder(folder) {
      const a = ACCENTS[folder.accent] || ACCENTS.slate;
      const node = el('div', { class:'p-6' });
      const sub = { doc:'open document', pdf:'open document', sheet:'open sheet', zip:'open archive', gangsheet:'open sheet', matrix:'live matrix' };
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><div class="flex items-center gap-3"><svg class="h-8 w-8 ${a.tint}" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg><div><h3 class="text-lg font-bold text-white">${esc(folder.name)}</h3><p class="text-xs text-slate-400">Modified ${folder.modified} · CID General / Shared</p></div></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-2">${folder.files.map((fl,i)=>`<div class="file-row flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-ink-900 px-4 py-3 transition hover:bg-white/5 hover:border-blue-500/30" data-idx="${i}"><span class="flex items-center gap-3 text-sm text-slate-200"><span class="text-lg">${fileIcon(fl.t)}</span>${esc(fl.n)}</span><span class="text-[11px] text-slate-500">${sub[fl.t]||'open'}</span></div>`).join('')}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.file-row').forEach((row) => row.addEventListener('click', () => openDocument(folder.files[Number(row.dataset.idx)], folder)));
      openModal(node, { wide: true });
    }

    /* ============================================================ LIVE CID PAPERWORK ============================================================
     * Every file in CID General opens as a real, editable, persisted document:
     *   doc  → editable rich-text document (.docx export)
     *   sheet→ editable spreadsheet (CSV export)
     *   pdf  → formatted read-only reference (.docx export)
     *   zip  → archive listing  ·  matrix → live computed CI risk matrix
     * Edits persist to Store('cidDocs') keyed by filename.
     * ---------------------------------------------------------------------------------------------------- */
    const docKey = (n) => n;
    const loadDoc = (n) => (Store.get('cidDocs', {}) || {})[docKey(n)];
    function saveDocStore(n, payload) { const d = Store.get('cidDocs', {}) || {}; d[docKey(n)] = payload; Store.set('cidDocs', d); }
    function resetDocStore(n) { const d = Store.get('cidDocs', {}) || {}; delete d[docKey(n)]; Store.set('cidDocs', d); }
    const safeName = (n) => n.replace(/\.[a-z]+$/i,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();

    // Seeded paperwork content (used until a user edits & saves).
    const DOC_SEEDS = {
      'JTF-Master-Index.sheet': { kind:'sheet', cols:['Operation','Bureaus','Status','Lead'], rows:[
        ['Operation Crosshair','LSB + SAB','Active','Lt. A. Stone'], ['Operation Dry Harbor','BCB + SAB','Planning','Lt. D. Honce'] ] },
      'Operation Crosshair (active).doc': { kind:'doc', body:
`JOINT TASK FORCE — OPERATION CROSSHAIR
Classification: Restricted // CID Eyes Only

OBJECTIVE
Dismantle the cross-bureau Class 3 weapons pipeline linking the Vagos Cartel cell (Sandy Shores CNC foundry) to Los Santos street distribution.

PARTICIPATING BUREAUS
- Los Santos Bureau (LSB) — street interdiction
- State Bureau (SAB) — corridor surveillance

CURRENT STATUS
Active. Tracker authorization on file (see [SAB] Case-9000007). Awaiting raid window.

NEXT STEPS
1. Confirm dual-signature tracker still in window.
2. Coordinate simultaneous entry with BCSO SWAT.
3. Stage seizure inventory team for compensation log.` },
      'Inter-Agency MOU.pdf': { kind:'pdf', body:
`MEMORANDUM OF UNDERSTANDING
Between the Los Santos Police Department, Blaine County Sheriff's Office, and San Andreas Highway Patrol

1. PURPOSE
This MOU governs the joint operation of the Criminal Investigation Division (CID) as a multi-agency body.

2. JURISDICTION
Each bureau retains primary jurisdiction within its territory. Joint Task Force cases supersede single-bureau assignment where activity crosses boundaries.

3. EVIDENCE SHARING
All structured records and media are maintained in the shared CID system under role-based access control.

4. CHAIN OF COMMAND
The Director holds ultimate authority. Tracker deployments require dual written authorization (Director + Deputy Director).` },
      '[BCB] Case-2000001 — Sandy Shores Meth.doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [BCB] Case-2000001
Bureau: Blaine County Bureau
Status: OPEN
Lead Detective: Det. Oliver Och (915)

SUMMARY
Meth lab operation discovered in a Sandy Shores trailer. Blue Meth production tied to the Vagos Cartel cell.

NARRATIVE
Initial tip received via Odyssey ticket-20089. Surveillance confirmed precursor deliveries (pseudoephedrine, anhydrous ammonia).

EVIDENCE LOG
- Photographs of trailer exterior (see Evidence Vault).
- Precursor purchase records.

DISPOSITION
Pending raid coordination under Operation Crosshair.` },
      '[BCB] Case-2000004 (COLD).doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [BCB] Case-2000004
Bureau: Blaine County Bureau
Status: COLD (2 weeks inactive)
Lead Detective: Det. D. Reyes (930)

SUMMARY
Grapeseed moonshine distribution ring. Leads exhausted; reclassified COLD pending new intelligence.

REOPEN CRITERIA
New informant testimony or seizure linking the Paleto Bay distribution node.` },
      'BCB Case Log.sheet': { kind:'sheet', cols:['Case #','Subject','Status','Lead','Updated'], rows:[
        ['[BCB] Case-2000001','Sandy Shores Meth','Open','Och','16/03/2026'],
        ['[BCB] Case-2000004','Grapeseed Moonshine','Cold','Reyes','02/03/2026'] ] },
      '[LSB] Case-1000001 — Legion Sq Trafficking.doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [LSB] Case-1000001
Bureau: Los Santos Bureau
Status: OPEN
Lead Detective: Det. Oliver Och (915)

SUMMARY
Suspect trafficking Class 3 weapons near Legion Square. Linked to Davis Ballas distribution.

NARRATIVE
Originating Odyssey ticket-10040. Ballistic footprint BLSTC-49-B recovered (auto-sear pistol).

EVIDENCE LOG
- Dashcam — Legion Sq stop (Evidence Vault).
- Recovered filed-serial pistol.

DISPOSITION
Active investigation.` },
      '[LSB] Case-1000044 — Vinewood Arson (CLOSED).doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [LSB] Case-1000044
Bureau: Los Santos Bureau
Status: CLOSED
Lead Detective: Det. Oliver Och (915)

SUMMARY
Vinewood arson ring dismantled. Three arrests, prosecution complete.

DISPOSITION
Closed — convictions secured. Distinguished Service Medal awarded.` },
      'LSB Case Log.sheet': { kind:'sheet', cols:['Case #','Subject','Status','Lead','Updated'], rows:[
        ['[LSB] Case-1000001','Legion Sq Trafficking','Open','Och','16/03/2026'],
        ['[LSB] Case-1000007','Davis Ballas Network','Cold','Hale','01/03/2026'],
        ['[LSB] Case-1000044','Vinewood Arson','Closed','Och','10/02/2026'] ] },
      '[SAB] Case-9000001 — Corridor Interdiction.doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — CASE FILE
Case Number: [SAB] Case-9000001
Bureau: State Bureau
Status: OPEN
Lead Detective: Det. L. Voss (948)

SUMMARY
Highway trafficking corridor interdiction on Route 68. CNC Class 3 rifles in transit.

EVIDENCE LOG
- Ballistic footprint BLSTC-12-C (5.56 chamber mark).` },
      '[SAB] Case-9000007 — Tracker Auth.doc': { kind:'doc', body:
`CRIMINAL INVESTIGATION DIVISION — TRACKER AUTHORIZATION
Case Number: [SAB] Case-9000007
Bureau: State Bureau

AUTHORIZATION
GPS tracker deployment on target vehicle (Black Sandking, plate 4XYZ).
Director Signature: A. Stone
Deputy Director Signature: R. Cole
Duration: 18 hours.

Per SOP Title 7 — no single-person approval permitted.` },
      'SAB Case Log.sheet': { kind:'sheet', cols:['Case #','Subject','Status','Lead','Updated'], rows:[
        ['[SAB] Case-9000001','Corridor Interdiction','Open','Voss','16/03/2026'],
        ['[SAB] Case-9000007','Tracker Authorization','Open','Stone','15/03/2026'] ] },
      'Closed Cases 2025.zip': { kind:'zip', items:['[LSB] Case-0900012 — Del Perro Smuggling (CLOSED).doc','[BCB] Case-1900003 — Cattle Theft Ring (CLOSED).doc','2025 Annual Disposition Report.pdf'] },
      'Retired CI Records.zip': { kind:'zip', items:['CI-0042 (deceased).doc','CI-0051 (relocated).doc','Handler Reassignment Log 2025.sheet'] },
      'HOW TO ASSIGN A CASE (read me).doc': { kind:'doc', body:
`HOW TO ASSIGN A CASE — QUICK GUIDE

1. Open Central Command → Odyssey Ticket Intake Queue.
2. Click "Process Ticket".
3. STEP 1 — Confirm jurisdiction (LSPD / BCSO / SAHP). If misrouted, the ticket auto-renames (e.g. ticket-2001 → blaine-2001).
4. STEP 2 — A 7-digit case number is generated from the bureau prefix:
     Los Santos  → [LSB] Case-1000001
     Blaine      → [BCB] Case-2000001
     State       → [SAB] Case-9000001
5. STEP 3 — Discord channel + Drive folder are provisioned automatically.

QUESTIONS? Ping a Bureau Lead in #cid-command.` },
      'Detective Incident Report (template).doc': { kind:'doc', body:
`DETECTIVE / INCIDENT REPORT  (FORM CID-IR-01)

Case Number: __________________________
Date / Time of Incident: ______________
Reporting Detective: Oliver Och   Callsign: 915   Unit: MCB

SUSPECT INFORMATION
Name: ________________________________
DOB: ____________   Known Affiliation: ____________

MIRANDA: [ ] Read & Acknowledged   [ ] Waived — Yes   [ ] Waived — No

INCIDENT NARRATIVE
______________________________________________________________
______________________________________________________________

STATEMENT OF UNDERSTANDING
I declare under penalty of perjury that the foregoing is true and correct, authored solely by me without AI generation.

Signature: ____________________   Date: ____________` },
      'UC Activity Log (template).doc': { kind:'doc', body:
`UNDERCOVER (UC) ACTIVITY LOG  (FORM CID-UC-02)   — CONFIDENTIAL

Report Type: ____________   UC Officer: ____________   Operation Code: ____________

CONTACTS & INTERACTIONS
Time | Subject | Interaction | Outcome
____ | _______ | __________ | _______

INTELLIGENCE / EVIDENCE OBSERVED
______________________________________________________________

THREAT LEVEL: [ ] Low   [ ] Medium   [ ] High` },
      'Penal Code Quick Reference.pdf': { kind:'pdf', body:
`SAN ANDREAS PENAL CODE — QUICK REFERENCE

WEAPONS
- Class 1: Civilian small arms.
- Class 2: Submachine guns, restricted.
- Class 3: Military rifles — prohibited; trafficking is a felony.

NARCOTICS
- Manufacture/distribution of controlled substances: felony.
- Precursor possession with intent: chargeable.

RICO PREDICATES (sample)
Drug trafficking, extortion, money laundering, witness tampering, murder-for-hire, illegal firearms trafficking.

Note: ≥2 predicate acts within 10 years required to establish a pattern.` },
      'CID SOP v4.2.pdf': { kind:'pdf', body:
`CRIMINAL INVESTIGATION DIVISION — STANDARD OPERATING PROCEDURE (v4.2)

TITLE 1 — INTRODUCTION
Mission: investigate serious, organized and cross-jurisdictional crime. Strict anti-AI / anti-plagiarism hiring clause.

TITLE 2 — CHAIN OF COMMAND
Director › Deputy Director › Bureau Leads › Senior Detectives › Detectives.

TITLE 5 — CASE MANAGEMENT
Open vs. Cold (2 weeks inactive) vs. Closed. Major incidents documented within 12 hours.

TITLE 6 & 7 — CI & SURVEILLANCE
Max 6 CIs per handler; ineligible at ≥8 violent felonies. Tracker deployment requires written Director + Deputy authorization — no single-person approval.` },
      'New Detective Onboarding.doc': { kind:'doc', body:
`NEW DETECTIVE ONBOARDING

WEEK 1
- Read CID SOP v4.2 (Resources / SOP-Training).
- Set radio callsign with the "CID" prefix.
- Shadow a Senior Detective.

WEEK 2
- Process a live Odyssey ticket end-to-end.
- File your first Incident Report.

REMEMBER
Plainclothes is standard. Tactical loadouts require Bureau Lead approval.` },
    };

    // Generators for sheets that should reflect current app data.
    function generatedDoc(name) {
      if (name === 'Radio Callsign Directory.sheet')
        return { kind:'sheet', cols:['Callsign','Officer','Unit'], rows: ROSTER.map((p)=>[p.cs, p.name, p.unit]) };
      if (name === 'Distribution Bracket Calc.sheet')
        return { kind:'sheet', cols:['Net Seizure Range','% Given'], rows: BRACKETS.map((b)=>[b.label, b.pct + '%']) };
      if (name === 'Prefix cheat-sheet.sheet')
        return { kind:'sheet', cols:['Bureau','Prefix','Starting #'], rows:[['Los Santos Bureau','LSB','1000001'],['Blaine County Bureau','BCB','2000001'],['State Bureau','SAB','9000001']] };
      if (name === 'Seizure Ledger FY26.sheet')
        return { kind:'sheet', cols:['Date','Case','Item','Street Value','Disposition'], rows:[
          ['14/03/2026','[LSB] Case-1000001','Class 3 rifle x2','$48,000','Booked'],
          ['11/03/2026','[BCB] Case-2000001','Blue Meth (2kg)','$2,400,000','Booked'] ] };
      return null;
    }

    function getDoc(file) {
      const n = file.n, t = file.t;
      if (t === 'matrix') return { kind:'matrix' };
      const saved = loadDoc(n);
      if (saved) return saved;
      if (t === 'gangsheet') return { kind:'sheet', cols: GANG_SHEET.cols.slice(), rows: GANG_SHEET.rows.map((r)=>r.slice()) };
      const gen = generatedDoc(n); if (gen) return gen;
      if (DOC_SEEDS[n]) return JSON.parse(JSON.stringify(DOC_SEEDS[n]));
      // Type-based default
      if (t === 'sheet') return { kind:'sheet', cols:['Date','Officer','Detail','Notes'], rows:[['','','','']] };
      if (t === 'zip')   return { kind:'zip', items:['(empty archive)'] };
      if (t === 'pdf')   return { kind:'pdf', body: n.replace(/\.[a-z]+$/i,'') + '\n\n(Reference document — content pending.)' };
      return { kind:'doc', body: n.replace(/\.[a-z]+$/i,'') + '\n\n' };
    }

    function exportDocText(title, body, filename) {
      const paras = [{ text:title, style:'title' }].concat(body.split('\n').map((l) => {
        const tr = l.trim();
        const heading = tr.length > 0 && tr.length <= 52 && tr === tr.toUpperCase() && /[A-Z]/.test(tr);
        return { text: l, style: heading ? 'heading' : 'normal' };
      }));
      downloadDocx(title, paras, filename);
    }
    function downloadCsv(filename, cols, rows) {
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = [cols.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      const a = document.createElement('a'); const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Open a single file as live, editable paperwork.
    function openDocument(file, folder) {
      const d = getDoc(file);
      const node = el('div', { class:'p-6' });
      const editable = d.kind === 'doc' || d.kind === 'sheet';
      const readonlyDoc = d.kind === 'pdf';
      let bodyHtml = '';

      if (d.kind === 'doc' || d.kind === 'pdf') {
        bodyHtml = readonlyDoc
          ? `<div class="doc-page max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-900 p-5 font-sans text-sm leading-relaxed text-slate-200">${esc(d.body)}</div>`
          : `<textarea id="doc-body" class="h-[55vh] w-full resize-none rounded-lg border border-white/10 bg-ink-900 p-5 font-mono text-sm leading-relaxed text-slate-100 outline-none focus:border-badge-500">${esc(d.body)}</textarea>`;
      } else if (d.kind === 'sheet') {
        bodyHtml = `
          <div class="max-h-[55vh] overflow-auto rounded-lg border border-white/10">
            <table class="w-full text-left text-sm" id="doc-sheet">
              <thead><tr class="bg-ink-800 text-[11px] uppercase tracking-wider text-slate-400">${d.cols.map((c)=>`<th class="border-b border-white/5 px-3 py-2 font-semibold">${esc(c)}</th>`).join('')}</tr></thead>
              <tbody class="divide-y divide-white/5">${d.rows.map((r)=>`<tr>${d.cols.map((_,ci)=>`<td contenteditable="true" class="cell border-r border-white/5 px-3 py-2 text-slate-200 outline-none focus:bg-blue-500/10">${esc(r[ci]!=null?r[ci]:'')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
          <button id="add-row" class="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 no-print">+ Add Row</button>`;
      } else if (d.kind === 'matrix') {
        const flagged = CI_MATRIX.filter((c)=>c.felonies>=8).length;
        bodyHtml = `
          <div class="mb-2 flex items-center justify-between"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">🚨 Confidential Informant Risk Matrix (live)</p>${flagged?`<span class="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">${flagged} flagged · ≥8 felonies</span>`:''}</div>
          <div class="overflow-hidden rounded-lg border border-white/5"><table class="w-full text-left text-sm"><thead><tr class="bg-ink-800 text-[11px] uppercase tracking-wider text-slate-400"><th class="px-3 py-2 font-semibold">CI ID</th><th class="px-3 py-2 font-semibold">Handler</th><th class="px-3 py-2 font-semibold">Exclusive</th><th class="px-3 py-2 font-semibold">Agreement</th><th class="px-3 py-2 font-semibold">Violent Felonies</th></tr></thead>
          <tbody class="divide-y divide-white/5">${CI_MATRIX.map((c)=>{const al=c.felonies>=8;const ag=c.agreement==='Active'?'text-emerald-300':c.agreement==='Pending'?'text-amber-300':'text-slate-400';return `<tr class="${al?'bg-rose-500/5':''}"><td class="px-3 py-2 font-mono text-blue-300">${esc(c.id)}</td><td class="px-3 py-2 text-slate-200">${esc(c.handler)}</td><td class="px-3 py-2">${c.exclusive?'<span class="text-emerald-300">Yes</span>':'<span class="text-rose-300">Shared ⚠</span>'}</td><td class="px-3 py-2 ${ag}">${esc(c.agreement)}</td><td class="px-3 py-2 font-mono ${al?'font-bold text-rose-300':'text-slate-300'}">${c.felonies}${al?' 🚨':''}</td></tr>`;}).join('')}</tbody></table></div>
          <p class="mt-2 text-[11px] text-slate-500">Policy: max 6 CIs per handler; ineligible at ≥8 violent felony convictions.</p>`;
      } else if (d.kind === 'zip') {
        bodyHtml = `<p class="mb-2 text-xs text-slate-400">Archive contents (read-only):</p><div class="space-y-2">${d.items.map((it)=>`<div class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 text-sm text-slate-300"><span>🗄️</span>${esc(it)}</div>`).join('')}</div>`;
      }

      const isSaved = !!loadDoc(file.n);
      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between gap-3 no-print">
          <div class="flex items-center gap-3"><span class="text-2xl">${fileIcon(file.t)}</span><div><h3 class="text-base font-bold text-white">${esc(file.n)}</h3><p class="text-[11px] text-slate-400">CID General${folder?' / '+esc(folder.name):''}${isSaved?' · <span class="text-emerald-300">edited copy</span>':' · template'}</p></div></div>
          <button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div class="print-area">${bodyHtml}</div>
        <div class="mt-4 flex flex-wrap gap-2 no-print">
          ${editable ? `<button id="d-save" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save</button>` : ''}
          <button id="d-print" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">🖨️ Print</button>
          ${d.kind==='sheet' ? `<button id="d-csv" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Export .csv</button>` : ''}
          ${d.kind==='doc'||d.kind==='pdf'||d.kind==='matrix' ? `<button id="d-docx" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Export .docx</button>` : ''}
          ${editable && isSaved ? `<button id="d-reset" class="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:text-rose-300">Reset to template</button>` : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#d-print') && (node.querySelector('#d-print').onclick = () => window.print());

      // Sheet helpers
      const readSheet = () => ({ kind:'sheet', cols: d.cols.slice(),
        rows: $$('#doc-sheet tbody tr', node).map((tr) => $$('.cell', tr).map((td) => td.textContent.trim())) });
      if (d.kind === 'sheet') {
        node.querySelector('#add-row').onclick = () => {
          const tb = node.querySelector('#doc-sheet tbody');
          tb.insertAdjacentHTML('beforeend', `<tr>${d.cols.map(()=>`<td contenteditable="true" class="cell border-r border-white/5 px-3 py-2 text-slate-200 outline-none focus:bg-blue-500/10"></td>`).join('')}</tr>`);
        };
      }

      // Save
      const saveBtn = node.querySelector('#d-save');
      if (saveBtn) saveBtn.onclick = () => {
        if (d.kind === 'doc') saveDocStore(file.n, { kind:'doc', body: node.querySelector('#doc-body').value });
        else if (d.kind === 'sheet') saveDocStore(file.n, readSheet());
        toast(`"${file.n}" saved`, 'success');
        openDocument(file, folder); // re-open to reflect saved state (shows Reset)
      };
      // Reset
      const resetBtn = node.querySelector('#d-reset');
      if (resetBtn) resetBtn.onclick = () => { resetDocStore(file.n); toast('Reverted to template', 'info'); openDocument(file, folder); };
      // Exports
      const docxBtn = node.querySelector('#d-docx');
      if (docxBtn) docxBtn.onclick = () => {
        if (d.kind === 'matrix') {
          const paras = [{text:'Confidential Informant Risk Matrix', style:'title'}].concat(
            CI_MATRIX.map((c)=>({ text:`${c.id} — ${c.handler} — ${c.exclusive?'Exclusive':'Shared'} — ${c.agreement} — ${c.felonies} violent felonies${c.felonies>=8?' (FLAGGED)':''}`, style:'normal' })));
          exportDocxParas('CI Risk Matrix', paras, safeName(file.n) + '.docx');
        } else {
          const body = d.kind === 'doc' ? (node.querySelector('#doc-body') ? node.querySelector('#doc-body').value : d.body) : d.body;
          exportDocText(file.n.replace(/\.[a-z]+$/i,''), body, safeName(file.n) + '.docx');
        }
        toast('Exported .docx', 'success');
      };
      const csvBtn = node.querySelector('#d-csv');
      if (csvBtn) csvBtn.onclick = () => { const s = readSheet(); downloadCsv(safeName(file.n) + '.csv', s.cols, s.rows); toast('Exported .csv', 'success'); };

      openModal(node, { wide: true });
    }
    function exportDocxParas(title, paras, filename) { downloadDocx(title, paras, filename); }

    /* ============================================================ 11. V3 — SHARED STATE ============================================================ */
    const uid = (p) => p + Math.random().toString(36).slice(2, 8);
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const bureauOf = (caseId) => { const m = (caseId || '').match(/\[(\w+)\]/); const b = m && Object.values(BUREAUS).find((x) => x.prefix === m[1]); return b ? b.name : '—'; };

    const RANKS = ['Leadership', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const PROP_TYPES = ['Stash House', 'Front Business', 'Vehicle', 'Safehouse', 'Warehouse'];
    const PLACE_TYPES = ['Drug Lab', 'Stash House', 'Dead Drop', 'Front Business', 'Chop Shop'];
    const RICO_PREDICATES = ['Drug Trafficking', 'Extortion', 'Money Laundering', 'Witness Tampering', 'Murder-for-Hire', 'Illegal Firearms Trafficking', 'Bribery', 'Obstruction of Justice', 'Kidnapping', 'Loan Sharking', 'Robbery'];

    // Gangs are now Supabase-backed; GANGS is a read cache used by gang/place/media/rico pickers.
    let GANGS = [];
    let PERSONS = [];   // Supabase-sourced cache of persons for link pickers

    let PLACES = [];   // Supabase-backed cache (see Places module)

    // Reports are now Supabase-backed (table `reports`); fetched per-case on demand.

    let RICO = Store.get('rico', null) || {};
    const saveRico = () => Store.set('rico', RICO);

    const REPORT_TEMPLATES = [
      { id:'incident', name:'Initial Incident Report', icon:'📄', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'bureau',label:'Bureau',type:'auto'}, {key:'detective',label:'Reporting Detective',type:'auto'},
        {key:'datetime',label:'Date of Incident',type:'date'}, {key:'location',label:'Location',type:'text'},
        {key:'classification',label:'Offense Classification',type:'select',opts:['Trafficking','Weapons','Narcotics Manufacture','Homicide','Robbery','Other']},
        {key:'narrative',label:'Incident Narrative',type:'textarea'} ] },
      { id:'arrest', name:'Arrest / Booking Report', icon:'🔗', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'detective',label:'Arresting Detective',type:'auto'},
        {key:'suspect',label:'Suspect Name',type:'text'}, {key:'charges',label:'Charges',type:'textarea'},
        {key:'miranda',label:'Miranda Advised',type:'select',opts:['Yes','No','Waived']}, {key:'datetime',label:'Date of Arrest',type:'date'} ] },
      { id:'warrant', name:'Search Warrant Affidavit', icon:'📜', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'affiant',label:'Affiant',type:'auto'},
        {key:'premises',label:'Premises to be Searched',type:'text'}, {key:'probable',label:'Statement of Probable Cause',type:'textarea'},
        {key:'items',label:'Items Sought',type:'textarea'} ] },
      { id:'surveillance', name:'Surveillance Log', icon:'🛰️', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'detective',label:'Observing Detective',type:'auto'},
        {key:'target',label:'Target / Subject',type:'text'}, {key:'datetime',label:'Date',type:'date'}, {key:'observations',label:'Observations',type:'textarea'} ] },
      { id:'rico_summary', name:'RICO Predicate Summary', icon:'⚖️', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'enterprise',label:'Enterprise',type:'text'},
        {key:'pattern',label:'Pattern Summary',type:'textarea'} ] },
    ];
    const tplById = (id) => REPORT_TEMPLATES.find((t) => t.id === id);
    function autoVal(key, caseId) {
      const c = casesCache.find((x) => x.id === caseId);
      if (key === 'caseId') return c ? c.case_number : caseId;
      if (key === 'bureau') return c ? c.bureau : '—';
      if (key === 'detective' || key === 'affiant') { const me = DB() && DB().me; return me ? (me.display_name + (me.badge_number ? ' · ' + me.badge_number : '')) : 'CID Detective'; }
      if (key === 'datetime') return todayISO();
      return '';
    }

    /* ============================================================ 11A. PERSONS (Supabase) ============================================================ */
    const RANK_SUGGEST = ['Leadership', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const threatTint = (t) => t === 'high' ? 'text-rose-300 bg-rose-500/10 border-rose-500/20' : t === 'medium' ? 'text-amber-300 bg-amber-500/10 border-amber-500/20' : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
    const gangNameById = (id) => { const g = GANGS.find((x) => x.id === id); return g ? g.name : null; };

    function personsNotice(m) { $('#persons-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterPersons() { if (dbReady()) fetchPersons(); else personsNotice('Live person records require sign-in.'); }
    async function fetchPersons() {
      if (!dbReady()) { personsNotice('Live person records require sign-in.'); return; }
      $('#persons-live').classList.remove('hidden'); $('#persons-live').classList.add('inline-flex');
      try { PERSONS = await DB().list('persons', { order: 'updated_at', ascending: false }); renderPersons(); }
      catch (e) { personsNotice('Could not load persons: ' + escapeHTML(e.message || String(e))); }
    }
    function renderPersons() {
      const grid = $('#persons-grid'); if (!grid) return;
      const q = ($('#person-search') ? $('#person-search').value : '').trim().toLowerCase();
      const items = PERSONS.filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q));
      $('#person-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { personsNotice(PERSONS.length ? 'No persons match your filter.' : 'No persons on file.' + (DB() && DB().canEdit() ? ' Use “+ New Person”.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((p) => {
        const flag = (p.felony_count || 0) >= 8;
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-5' });
        card.innerHTML = `
          <div class="flex items-start gap-3">
            ${p.mugshot_url ? `<img src="${escapeHTML(p.mugshot_url)}" class="h-14 w-14 flex-shrink-0 rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>` : `<div class="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>`}
            <div class="min-w-0 flex-1"><p class="truncate font-semibold text-white">${escapeHTML(p.name)}${flag ? ' <span title="≥8 violent felonies">🚨</span>' : ''}</p><p class="text-xs text-slate-400">${p.alias ? '“' + escapeHTML(p.alias) + '” · ' : ''}${escapeHTML(p.status || '')}</p>
              <p class="mt-1 text-[11px] text-slate-500">${p.gang_id ? '🚩 ' + escapeHTML(gangNameById(p.gang_id) || 'Gang') + ' · ' : ''}CCW ${p.ccw ? 'Yes' : 'No'} · VCH ${p.vch || 0} · Felonies ${p.felony_count || 0}</p></div>
            ${DB() && DB().canEdit() ? '<button class="p-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
          </div>
          ${p.notes ? `<p class="mt-3 line-clamp-2 text-xs text-slate-400">${escapeHTML(p.notes)}</p>` : ''}`;
        const eb = card.querySelector('.p-edit'); if (eb) eb.onclick = () => openPersonModal(p);
        grid.appendChild(card);
      });
    }
    function openPersonModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const p = record || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— no gang —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === p.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Person</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(p.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Alias</label><input data-k="alias" value="${escapeHTML(p.alias || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><input data-k="status" value="${escapeHTML(p.status || 'Person of Interest')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">CCW</label><select data-k="ccw" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="false" ${!p.ccw ? 'selected' : ''}>No</option><option value="true" ${p.ccw ? 'selected' : ''}>Yes</option></select></div>
          <div class="grid grid-cols-2 gap-3"><div><label class="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" data-k="vch" value="${p.vch || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div><div><label class="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" data-k="felony_count" value="${p.felony_count || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input data-k="mugshot_url" value="${escapeHTML(p.mugshot_url || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(p.notes || '')}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="p-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create person'}</button>
          ${record && DB().canDelete() ? '<button id="p-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#p-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        payload.ccw = payload.ccw === 'true'; payload.vch = Number(payload.vch) || 0; payload.felony_count = Number(payload.felony_count) || 0;
        if (!payload.gang_id) payload.gang_id = null;
        const res = record && record.id ? await DB().update('persons', record.id, payload) : await DB().insert('persons', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Person updated' : 'Person created', 'success'); fetchPersons();
      };
      const pd = node.querySelector('#p-del'); if (pd) pd.onclick = async () => {
        if (!confirm('Delete person “' + p.name + '”?')) return;
        const r = await DB().remove('persons', p.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        closeModal(); toast('Person deleted', 'warn'); fetchPersons();
      };
      openModal(node, { wide: true });
    }

    /* ============================================================ 11A2. GANGS & TURF (Supabase) ============================================================ */
    function gangsNotice(m) { $('#gang-grid').innerHTML = `<div class="xl:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function showGangsList() { $('#gang-detail').classList.add('hidden'); $('#gangs-list').classList.remove('hidden'); }
    function onEnterGangs() { showGangsList(); if (dbReady()) fetchGangs(); else gangsNotice('Live gang records require sign-in.'); }
    async function fetchGangs() {
      if (!dbReady()) { gangsNotice('Live gang records require sign-in.'); return; }
      $('#gangs-live').classList.remove('hidden'); $('#gangs-live').classList.add('inline-flex');
      try { GANGS = await DB().list('gangs', { order: 'name', ascending: true }); renderGangs(); }
      catch (e) { gangsNotice('Could not load gangs: ' + escapeHTML(e.message || String(e))); }
    }
    function renderGangs() {
      const grid = $('#gang-grid'); if (!grid) return;
      const q = ($('#gang-search') ? $('#gang-search').value : '').trim().toLowerCase();
      const items = GANGS.filter((g) => !q || JSON.stringify(g).toLowerCase().includes(q));
      const addBtn = $('#add-gang'); if (addBtn) addBtn.classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { gangsNotice(GANGS.length ? 'No gangs match your filter.' : 'No gangs on file.' + (DB() && DB().canEdit() ? ' Use “+ New Gang”.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((g) => {
        const card = el('div', { class: 'cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-6 transition hover:border-blue-500/30 hover:bg-white/5' });
        card.innerHTML = `
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h4 class="text-lg font-bold text-white">${escapeHTML(g.name)}</h4><p class="mt-0.5 text-xs text-slate-400">Colors: ${escapeHTML(g.colors || '—')}</p></div>
            <span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(g.threat_level)}">${escapeHTML(cap(g.threat_level))} Threat</span>
          </div>
          ${g.notes ? `<p class="mt-3 line-clamp-2 text-xs text-slate-400">${escapeHTML(g.notes)}</p>` : ''}
          <p class="mt-3 text-[11px] text-blue-300">View roster &amp; turf →</p>`;
        card.addEventListener('click', () => openGangDetail(g.id));
        grid.appendChild(card);
      });
    }
    function openGangModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const g = record || {};
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Gang</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(g.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Colors</label><input data-k="colors" value="${escapeHTML(g.colors || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Threat Level</label><select data-k="threat_level" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['low', 'medium', 'high'].map((t) => `<option value="${t}" ${t === (g.threat_level || 'medium') ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(g.notes || '')}</textarea></div>
        </div>
        <button id="g-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create gang'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#g-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Gang name is required.', 'warn'); return; }
        const res = record && record.id ? await DB().update('gangs', record.id, payload) : await DB().insert('gangs', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Gang updated' : 'Gang created', 'success'); fetchGangs();
        if (record && record.id) openGangDetail(record.id);
      };
      openModal(node, { wide: true });
    }
    let detailGang = null;
    async function openGangDetail(id) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      try {
        const rows = await DB().list('gangs', { eq: { id: id } });
        detailGang = rows[0]; if (!detailGang) { toast('Gang not found.', 'warn'); return; }
        $('#gangs-list').classList.add('hidden'); $('#gang-detail').classList.remove('hidden');
        await renderGangDetail();
      } catch (e) { toast('Load failed: ' + (e.message || e), 'danger'); }
    }
    async function renderGangDetail() {
      const g = detailGang, canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      let members = [], turf = [], places = [];
      try {
        [members, turf, places] = await Promise.all([
          DB().list('gang_members', { eq: { gang_id: g.id } }),
          DB().list('gang_turf', { eq: { gang_id: g.id } }),
          DB().list('places', { eq: { controlling_gang_id: g.id } })
        ]);
      } catch (e) {}
      const ranks = {}; members.forEach((m) => { const r = m.rank || 'Unranked'; (ranks[r] = ranks[r] || []).push(m); });
      $('#gang-detail').innerHTML = `
        <button id="gang-back" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">← All gangs</button>
        <div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h3 class="text-xl font-bold text-white">${escapeHTML(g.name)}</h3><p class="mt-1 text-sm text-slate-400">Colors: ${escapeHTML(g.colors || '—')}</p>${g.notes ? `<p class="mt-1 text-sm text-slate-400">${escapeHTML(g.notes)}</p>` : ''}</div>
            <div class="flex items-center gap-2">
              <span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(g.threat_level)}">${escapeHTML(cap(g.threat_level))} Threat</span>
              ${canEdit ? '<button id="gang-edit" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
              ${canDel ? '<button id="gang-del" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
            <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Roster (${members.length})</h4>${canEdit ? '<button id="member-new" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Member</button>' : ''}</div>
            ${members.length ? Object.keys(ranks).map((rk) => `<div class="mb-4"><p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">${escapeHTML(rk)} (${ranks[rk].length})</p><div class="grid grid-cols-1 gap-2 sm:grid-cols-2">${ranks[rk].map(memberCard).join('')}</div></div>`).join('') : '<p class="text-sm text-slate-500">No members yet.</p>'}
          </div>
          <div class="space-y-6">
            <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
              <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Turf (${turf.length})</h4>${canEdit ? '<button id="turf-new" class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">+ Turf</button>' : ''}</div>
              <div class="space-y-2">${turf.length ? turf.map((t) => `<div class="flex items-center justify-between rounded-lg bg-ink-850 px-3 py-1.5 text-xs"><span class="text-slate-200">${escapeHTML(t.block)}${t.hotspot_area ? ' · ' + escapeHTML(t.hotspot_area) : ''}</span><span class="flex items-center gap-2"><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${densTint(cap(t.density))}">${escapeHTML(cap(t.density))}</span>${canDel ? `<button class="turf-del text-rose-300" data-id="${t.id}">✕</button>` : ''}</span></div>`).join('') : '<p class="text-xs text-slate-500">No turf logged.</p>'}</div>
            </div>
            <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
              <h4 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Linked Properties (${places.length})</h4>
              <div class="space-y-2">${places.length ? places.map((p) => `<div class="rounded-lg bg-ink-850 px-3 py-1.5 text-xs text-slate-200">${escapeHTML(p.name)} <span class="text-slate-500">· ${escapeHTML(p.type)}</span></div>`).join('') : '<p class="text-xs text-slate-500">No linked places. (Set a controlling gang on a Place.)</p>'}</div>
            </div>
          </div>
        </div>`;
      $('#gang-back').onclick = showGangsList;
      const ge = $('#gang-edit'); if (ge) ge.onclick = () => openGangModal(detailGang);
      const gd = $('#gang-del'); if (gd) gd.onclick = async () => {
        if (!confirm('Delete gang “' + g.name + '”? This removes its members & turf.')) return;
        const r = await DB().remove('gangs', g.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        toast('Gang deleted', 'warn'); showGangsList(); fetchGangs();
      };
      const mn = $('#member-new'); if (mn) mn.onclick = () => openMemberModal(g.id, null);
      const tn = $('#turf-new'); if (tn) tn.onclick = () => openTurfModal(g.id);
      $$('.m-edit', $('#gang-detail')).forEach((b) => b.onclick = () => { const m = members.find((x) => x.id === b.dataset.id); openMemberModal(g.id, m); });
      $$('.turf-del', $('#gang-detail')).forEach((b) => b.onclick = async () => { await DB().remove('gang_turf', b.dataset.id); renderGangDetail(); });
    }
    function memberCard(m) {
      const flag = (m.felony_count || 0) >= 8, canEdit = DB() && DB().canEdit();
      return `<div class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-850 p-2.5">
        ${m.mugshot_url ? `<img src="${escapeHTML(m.mugshot_url)}" class="h-10 w-10 flex-shrink-0 rounded-md object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-sm">👤</div>` : `<div class="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-sm">👤</div>`}
        <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-white">${escapeHTML(m.name)}${flag ? ' 🚨' : ''}</p><p class="text-[11px] text-slate-400">${escapeHTML(m.status || '')} · CCW ${m.ccw ? 'Yes' : 'No'} · VCH ${m.vch || 0}</p></div>
        ${canEdit ? `<button class="m-edit flex-shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10" data-id="${m.id}">Edit</button>` : ''}
      </div>`;
    }
    function openMemberModal(gangId, member) {
      const m = member || {};
      const node = el('div', { class: 'p-6' });
      const personOpts = ['<option value="">— link person (optional) —</option>'].concat(PERSONS.map((p) => `<option value="${p.id}" ${p.id === m.person_id ? 'selected' : ''}>${escapeHTML(p.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— link case (optional) —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === m.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${member ? 'Edit' : 'Add'} Member</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(m.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Rank</label><input data-k="rank" list="rank-list" value="${escapeHTML(m.rank || 'Soldier')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="rank-list">${RANK_SUGGEST.map((r) => `<option value="${r}">`).join('')}</datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Callsign</label><input data-k="callsign" value="${escapeHTML(m.callsign || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><input data-k="status" value="${escapeHTML(m.status || 'At Large')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link Person</label><select data-k="person_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${personOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">CCW</label><select data-k="ccw" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="false" ${!m.ccw ? 'selected' : ''}>No</option><option value="true" ${m.ccw ? 'selected' : ''}>Yes</option></select></div>
          <div class="grid grid-cols-2 gap-3"><div><label class="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" data-k="vch" value="${m.vch || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div><div><label class="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" data-k="felony_count" value="${m.felony_count || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input data-k="mugshot_url" value="${escapeHTML(m.mugshot_url || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="m-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${member ? 'Save' : 'Add member'}</button>
          ${member && DB().canDelete() ? '<button id="m-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#m-save').onclick = async () => {
        const payload = { gang_id: gangId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        payload.ccw = payload.ccw === 'true'; payload.vch = Number(payload.vch) || 0; payload.felony_count = Number(payload.felony_count) || 0;
        if (!payload.person_id) payload.person_id = null; if (!payload.case_id) payload.case_id = null;
        const res = member && member.id ? await DB().update('gang_members', member.id, payload) : await DB().insert('gang_members', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Member saved', 'success'); renderGangDetail();
      };
      const md = node.querySelector('#m-del'); if (md) md.onclick = async () => { await DB().remove('gang_members', member.id); closeModal(); toast('Member removed', 'warn'); renderGangDetail(); };
      openModal(node, { wide: true });
    }
    function openTurfModal(gangId) {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Turf Block</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Block / Territory *</label><input data-k="block" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Density</label><select data-k="density" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Hotspot Area</label><input data-k="hotspot_area" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <button id="t-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add Turf</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#t-save').onclick = async () => {
        const payload = { gang_id: gangId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.block) { toast('Block is required.', 'warn'); return; }
        const res = await DB().insert('gang_turf', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Turf added', 'success'); renderGangDetail();
      };
      openModal(node, { wide: false });
    }

    /* ============================================================ 11B. CRIMINAL PLACES + PRODUCTION ============================================================ */
    /* ============================================================ 11B. CRIMINAL PLACES (Supabase) ============================================================ */
    const LOC_TYPES = [['drug_lab','Drug Lab'],['stash_house','Stash House'],['dead_drop','Dead Drop'],['front_business','Front Business'],['chop_shop','Chop Shop']];
    const locLabel = (v) => { const t = LOC_TYPES.find((x) => x[0] === v); return t ? t[1] : v; };
    const drugById = (id) => DRUGS.find((x) => x.id === id);
    const caseNumById = (id) => { const c = casesCache.find((x) => x.id === id); return c ? c.case_number : null; };
    function recipeFor(drug) {
      if (!drug) return [];
      return [ `Acquire precursors: ${(drug.precursors || []).map((p) => p.n).join(', ') || 'TBD'}`, `Synthesize / cook ${drug.name} base`, `Cut to street purity grade`, `Package into distribution units`, `Distribute to hotspot: ${drug.hotspots && drug.hotspots[0] ? drug.hotspots[0].area : 'TBD'}` ];
    }
    function placesNotice(m) { $('#place-grid').innerHTML = `<div class="lg:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterPlaces() { if (dbReady()) fetchPlaces(); else placesNotice('Live location records require sign-in.'); }
    async function fetchPlaces() {
      if (!dbReady()) { placesNotice('Live location records require sign-in.'); return; }
      try { PLACES = await DB().list('places', { order: 'updated_at', ascending: false }); renderPlaces(); }
      catch (e) { placesNotice('Could not load locations: ' + escapeHTML(e.message || String(e))); }
    }
    function renderPlaces() {
      const grid = $('#place-grid'); if (!grid) return;
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const addBtn = $('#add-place'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { placesNotice('Live location records require sign-in.'); return; }
      if (!PLACES.length) { placesNotice('No locations logged.' + (canEdit ? ' Use “+ New Location”.' : '')); return; }
      grid.innerHTML = '';
      PLACES.forEach((p) => {
        const gang = GANGS.find((g) => g.id === p.controlling_gang_id);
        const drug = p.narcotic_id ? drugById(p.narcotic_id) : null;
        const caseNo = caseNumById(p.case_id);
        const recipe = p.type === 'drug_lab' && drug ? recipeFor(drug) : [];
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-6' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div><h4 class="text-base font-semibold text-white">${escapeHTML(p.name)}</h4><p class="mt-0.5 text-xs text-slate-400">${escapeHTML(locLabel(p.type))} · ${escapeHTML(p.area || '—')}</p></div>
            <div class="flex items-center gap-2">${canEdit ? '<button class="pl-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}${canDel ? '<button class="pl-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>' : ''}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
            ${gang ? `<span class="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">🚩 ${escapeHTML(gang.name)}</span>` : ''}
            ${caseNo ? `<span class="rounded-md bg-blue-500/10 px-2 py-1 font-mono text-blue-300">${escapeHTML(caseNo)}</span>` : ''}
            ${drug ? `<span class="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">💊 ${escapeHTML(drug.name)}</span>` : ''}
          </div>
          ${p.notes ? `<p class="mt-3 text-xs text-slate-400">${escapeHTML(p.notes)}</p>` : ''}
          ${recipe.length ? `<div class="mt-4"><p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Production Process</p><div class="space-y-1.5">${recipe.map((s, i) => `<div class="flex items-center gap-2 text-xs text-slate-300"><span class="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-blue-500/15 font-mono text-[10px] text-blue-300">${i + 1}</span>${escapeHTML(s)}</div>`).join('')}</div></div>` : ''}`;
        const eb = card.querySelector('.pl-edit'); if (eb) eb.addEventListener('click', () => openPlaceModal(p));
        const db = card.querySelector('.pl-del'); if (db) db.addEventListener('click', async () => { if (!confirm(`Delete location "${p.name}"?`)) return; const r = await DB().remove('places', p.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } toast('Location deleted', 'warn'); fetchPlaces(); });
        grid.appendChild(card);
      });
    }
    function openPlaceModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const p = record || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— none —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === p.controlling_gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === p.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      const drugOpts = ['<option value="">— none —</option>'].concat(DRUGS.map((d) => `<option value="${d.id}" ${d.id === p.narcotic_id ? 'selected' : ''}>${escapeHTML(d.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Location</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" value="${escapeHTML(p.name || '')}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Type</label><select data-k="type" id="pl-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${LOC_TYPES.map((t) => `<option value="${t[0]}" ${t[0] === (p.type || 'drug_lab') ? 'selected' : ''}>${t[1]}</option>`).join('')}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Area</label><input data-k="area" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" value="${escapeHTML(p.area || '')}" /></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Controlling Gang</label><select data-k="controlling_gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          </div>
          <div id="pl-drug-wrap"><label class="mb-1 block text-xs font-semibold text-slate-400">Produced Narcotic (labs only)</label><select data-k="narcotic_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${drugOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(p.notes || '')}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="pl-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create location'}</button>
          ${record && DB().canDelete() ? '<button id="pl-del2" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const typeSel = node.querySelector('#pl-type'), drugWrap = node.querySelector('#pl-drug-wrap');
      const syncDrug = () => drugWrap.style.display = typeSel.value === 'drug_lab' ? '' : 'none';
      syncDrug(); typeSel.onchange = syncDrug;
      node.querySelector('#pl-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Location name is required.', 'warn'); return; }
        if (!payload.controlling_gang_id) payload.controlling_gang_id = null;
        if (!payload.case_id) payload.case_id = null;
        if (payload.type !== 'drug_lab' || !payload.narcotic_id) payload.narcotic_id = null;
        const res = record && record.id ? await DB().update('places', record.id, payload) : await DB().insert('places', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Location updated' : 'Location created', 'success'); fetchPlaces();
      };
      const pd = node.querySelector('#pl-del2'); if (pd) pd.onclick = async () => { if (!confirm('Delete “' + p.name + '”?')) return; const r = await DB().remove('places', p.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Location deleted', 'warn'); fetchPlaces(); };
      openModal(node);
    }

    /* ============================================================ 11C. REPORTS (template-driven + chains) ============================================================ */
    function renderTemplateList() {
      const wrap = $('#template-list'); if (!wrap) return; wrap.innerHTML = '';
      const canEdit = DB() && DB().canEdit();
      REPORT_TEMPLATES.forEach((t) => {
        const b = el('button', { class: 'flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/10 hover:text-white' }, `<span class="text-lg">${t.icon}</span><span>${esc(t.name)}</span>`);
        b.addEventListener('click', () => { if (!canEdit) { toast('Sign-in required to author reports.', 'warn'); return; } const cid = $('#report-case').value; if (!cid) { toast('Select a case first (create one in Case Files).', 'warn'); return; } openReportModal(t.id, cid, null, 'initial'); });
        wrap.appendChild(b);
      });
    }
    // Populate a <select> with live cases (value = uuid, label = case_number), preserving selection.
    function fillCaseSelect(sel) {
      if (!sel) return; const prev = sel.value;
      sel.innerHTML = casesCache.length ? casesCache.map((c) => `<option value="${c.id}">${esc(c.case_number)}</option>`).join('') : '<option value="">— no cases —</option>';
      if (prev && casesCache.some((c) => c.id === prev)) sel.value = prev;
    }
    function refreshCaseSelects() {
      if ($('#report-case')) { fillCaseSelect($('#report-case')); if ($('#view-reports').classList.contains('active')) renderReportChain(); }
      if ($('#rico-case')) { fillCaseSelect($('#rico-case')); if ($('#view-rico').classList.contains('active')) renderRico(); }
    }
    function reportKindBadge(r) {
      const map = { initial: 'bg-blue-500/15 text-blue-300', supplemental: 'bg-violet-500/15 text-violet-300', followup: 'bg-amber-500/15 text-amber-300' };
      const label = r.kind === 'initial' ? 'Initial' : r.kind === 'supplemental' ? `Supplemental #${r.seq}` : `Follow-up #${r.seq}`;
      return `<span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${map[r.kind] || ''}">${label}</span>`;
    }
    async function renderReportChain() {
      const caseId = $('#report-case').value;
      const wrap = $('#report-chain'); if (!wrap) return;
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view case reports.</p>'; $('#chain-count').textContent = '0 reports'; return; }
      if (!caseId) { wrap.innerHTML = '<p class="text-sm text-slate-500">No case selected. Create a case in Case Files first.</p>'; $('#chain-count').textContent = '0 reports'; return; }
      let list = [];
      try { list = await DB().list('reports', { order: 'created_at', ascending: true, eq: { case_id: caseId } }); } catch (e) { wrap.innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || e) + '</p>'; return; }
      $('#chain-count').textContent = `${list.length} report${list.length === 1 ? '' : 's'}`;
      const canEdit = DB() && DB().canEdit();
      if (!list.length) { wrap.innerHTML = '<p class="text-sm text-slate-500">No reports for this case yet.' + (canEdit ? ' Pick a template to generate the initial report.' : '') + '</p>'; return; }
      wrap.innerHTML = '';
      list.forEach((r) => {
        const tpl = tplById(r.template);
        const card = el('div', { class: 'rounded-xl border border-white/10 bg-ink-900 p-4' });
        card.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">${reportKindBadge(r)}<span class="text-sm font-semibold text-white">${esc(tpl ? tpl.name : 'Report')}</span>${r.finalized ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">🔒 finalized</span>' : '<span class="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">draft</span>'}</div>
            <span class="text-[11px] text-slate-500">${new Date(r.created_at).toLocaleDateString('en-US')}</span>
          </div>
          ${r.parent_id ? `<p class="mt-1 text-[11px] text-slate-500">↳ linked to prior report</p>` : ''}
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="r-view rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">View</button>
            <button class="r-docx rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">.docx</button>
            <button class="r-pdf rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">.pdf</button>
            ${canEdit ? '<button class="r-supp rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-white/10">+ Supplemental</button><button class="r-follow rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-white/10">+ Follow-up</button>' : ''}
          </div>`;
        card.querySelector('.r-view').onclick = () => viewReport(r);
        card.querySelector('.r-docx').onclick = () => exportReportDocx(r);
        card.querySelector('.r-pdf').onclick = () => exportReportPdf(r);
        const rs = card.querySelector('.r-supp'); if (rs) rs.onclick = () => openReportModal(r.template, caseId, r.id, 'supplemental');
        const rf = card.querySelector('.r-follow'); if (rf) rf.onclick = () => openReportModal(r.template, caseId, r.id, 'followup');
        wrap.appendChild(card);
      });
    }
    async function openReportModal(templateId, caseId, parentId, kind) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const tpl = tplById(templateId); if (!tpl) return;
      let seq = 0;
      if (kind !== 'initial') { try { const ex = await DB().list('reports', { eq: { case_id: caseId, kind: kind } }); seq = ex.length + 1; } catch (e) { seq = 1; } }
      const heading = kind === 'initial' ? tpl.name : kind === 'supplemental' ? `Supplemental #${seq}` : `Follow-up #${seq}`;
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">${esc(tpl.name)}</p><h3 class="text-xl font-bold text-white">${esc(heading)}</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${parentId ? `<p class="mb-4 rounded-lg border border-white/10 bg-ink-900 p-2.5 text-xs text-slate-400">↳ Linked as ${kind} to a prior report on <span class="font-mono text-blue-300">${esc(caseNumById(caseId) || caseId)}</span>.</p>` : ''}
        <div class="space-y-3">
          ${tpl.sections.map((s) => {
            const av = s.type === 'auto' ? autoVal(s.key, caseId) : '';
            if (s.type === 'auto') return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${esc(s.label)}</label><input data-key="${s.key}" readonly value="${esc(av)}" class="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-300 outline-none" /></div>`;
            if (s.type === 'textarea') return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${esc(s.label)}</label><textarea data-key="${s.key}" rows="4" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"></textarea></div>`;
            if (s.type === 'select') return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${esc(s.label)}</label><select data-key="${s.key}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${s.opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>`;
            return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${esc(s.label)}</label><input type="${s.type === 'date' ? 'date' : 'text'}" data-key="${s.key}" ${s.type === 'date' ? `value="${todayISO()}"` : ''} class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>`;
          }).join('')}
        </div>
        <button id="r-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save Report to Case</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#r-save').onclick = async () => {
        const fields = {}; $$('[data-key]', node).forEach((f) => fields[f.dataset.key] = f.value);
        const payload = { case_id: caseId, template: templateId, kind: kind, seq: seq, parent_id: parentId || null, fields: fields };
        if (DB().me) payload.author_id = DB().me.id;
        const res = await DB().insert('reports', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(`${heading} saved`, 'success'); renderReportChain();
      };
      openModal(node);
    }
    function reportTitle(r) { const tpl = tplById(r.template); return `${tpl ? tpl.name : 'Report'}${r.kind !== 'initial' ? ' — ' + (r.kind === 'supplemental' ? 'Supplemental #' + r.seq : 'Follow-up #' + r.seq) : ''}`; }
    function viewReport(r) {
      const tpl = tplById(r.template); const caseNo = caseNumById(r.case_id) || r.case_id;
      const sig = r.signature || null; const canFinalize = DB() && DB().canEdit() && !r.finalized;
      const node = el('div', { class: 'p-6 print-area' });
      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between no-print"><h3 class="text-lg font-bold text-white">Report Preview</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="rounded-xl border border-white/10 bg-ink-900 p-5">
          <p class="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300/70">Criminal Investigation Division — State of San Andreas</p>
          <h2 class="mt-1 text-center text-xl font-bold text-white">${esc(reportTitle(r))}</h2>
          <p class="mt-1 text-center text-xs text-slate-400">${esc(caseNo)} · ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? ' · 🔒 FINALIZED' : ' · DRAFT'}</p>
          <div class="mt-5 space-y-3">${tpl.sections.map((s) => { const v = (r.fields && r.fields[s.key]) || '—'; return `<div><p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">${esc(s.label)}</p><p class="mt-0.5 whitespace-pre-line text-sm text-slate-200">${esc(v)}</p></div>`; }).join('')}</div>
          ${sig ? `<div class="mt-6 border-t border-white/10 pt-4 text-xs text-slate-300"><p class="font-semibold uppercase tracking-wider text-emerald-300/80">Electronically signed</p><p class="mt-1 font-[cursive] text-base text-blue-200">${esc(sig.officer)}</p><p class="text-[11px] text-slate-500">Badge ${esc(sig.badge || '—')} · ${sig.signed_at ? new Date(sig.signed_at).toLocaleString('en-US') : ''}</p></div>` : ''}
        </div>
        <div class="mt-5 flex flex-wrap gap-3 no-print">
          <button onclick="window.print()" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">🖨️ Print</button>
          <button id="v-docx" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Export .docx</button>
          <button id="v-pdf" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Export .pdf</button>
          ${canFinalize ? '<button id="v-final" class="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">🔏 Finalize &amp; Sign</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#v-docx').onclick = () => exportReportDocx(r);
      node.querySelector('#v-pdf').onclick = () => exportReportPdf(r);
      const vf = node.querySelector('#v-final'); if (vf) vf.onclick = () => openFinalizeModal(r);
      openModal(node, { wide: true });
    }
    function openFinalizeModal(r) {
      const node = el('div', { class: 'p-6' });
      const me = DB().me || {};
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Finalize &amp; e-Sign</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">Finalizing locks the report against further edits and attaches your electronic signature.</p>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Officer *</label><input id="fin-officer" value="${esc(me.display_name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-[cursive] text-base text-blue-200 outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Badge Number</label><input id="fin-badge" value="${esc(me.badge_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <button id="fin-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Sign &amp; Lock Report</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#fin-go').onclick = async () => {
        const officer = node.querySelector('#fin-officer').value.trim();
        if (!officer) { toast('Officer signature required.', 'warn'); return; }
        const signature = { officer, badge: node.querySelector('#fin-badge').value.trim(), signed_at: new Date().toISOString() };
        const res = await DB().update('reports', r.id, { finalized: true, signature });
        if (res.error) { toast('Finalize failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Report finalized & signed', 'success'); renderReportChain();
      };
      openModal(node);
    }
    function reportParas(r) {
      const tpl = tplById(r.template); const caseNo = caseNumById(r.case_id) || r.case_id;
      const paras = [{ text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' }, { text: reportTitle(r), style: 'title' }, { text: `${caseNo}  ·  ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? '  ·  FINALIZED' : ''}`, style: 'subtitle' }, { text: '', style: 'normal' }];
      tpl.sections.forEach((s) => { paras.push({ text: s.label, style: 'heading' }); paras.push({ text: (r.fields && r.fields[s.key]) || '—', style: 'normal' }); });
      if (r.signature) { paras.push({ text: '', style: 'normal' }); paras.push({ text: 'Electronically signed', style: 'heading' }); paras.push({ text: `${r.signature.officer} — Badge ${r.signature.badge || '—'} — ${r.signature.signed_at ? new Date(r.signature.signed_at).toLocaleString('en-US') : ''}`, style: 'normal' }); }
      return paras;
    }
    function exportReportDocx(r) {
      downloadDocx(reportTitle(r), reportParas(r), `${(caseNumById(r.case_id) || 'case').replace(/[^a-z0-9]/gi, '-')}-${r.kind}-${r.seq || 0}.docx`);
      toast('Report exported as .docx', 'success');
    }
    function exportReportPdf(r) {
      const J = window.jspdf && window.jspdf.jsPDF;
      if (!J) { toast('PDF library unavailable (offline). Use .docx or Print.', 'warn'); return; }
      const doc = new J({ unit: 'pt', format: 'letter' }); const W = 612, M = 56; let y = M;
      const line = (txt, opts) => {
        opts = opts || {}; doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 11);
        const wrapped = doc.splitTextToSize(String(txt), W - M * 2);
        wrapped.forEach((ln) => { if (y > 740) { doc.addPage(); y = M; } doc.text(ln, opts.center ? W / 2 : M, y, opts.center ? { align: 'center' } : undefined); y += (opts.size || 11) + 5; });
      };
      line('CRIMINAL INVESTIGATION DIVISION — STATE OF SAN ANDREAS', { center: true, size: 9 });
      line(reportTitle(r), { center: true, bold: true, size: 16 }); y += 4;
      line(`${caseNumById(r.case_id) || r.case_id} · ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? ' · FINALIZED' : ' · DRAFT'}`, { center: true, size: 9 }); y += 10;
      const tpl = tplById(r.template);
      tpl.sections.forEach((s) => { line(s.label.toUpperCase(), { bold: true, size: 10 }); line((r.fields && r.fields[s.key]) || '—', { size: 11 }); y += 4; });
      if (r.signature) { y += 10; line('ELECTRONICALLY SIGNED', { bold: true, size: 10 }); line(`${r.signature.officer} — Badge ${r.signature.badge || '—'} — ${r.signature.signed_at ? new Date(r.signature.signed_at).toLocaleString('en-US') : ''}`, { size: 10 }); }
      doc.save(`${(caseNumById(r.case_id) || 'case').replace(/[^a-z0-9]/gi, '-')}-${r.kind}-${r.seq || 0}.pdf`);
      toast('Report exported as .pdf', 'success');
    }

    /* ============================================================ 11D. RICO ELEMENT TRACKER ============================================================ */
    function ricoOf(caseId) { return RICO[caseId] || (RICO[caseId] = { enterpriseGangId:'', predicates:[] }); }
    function withinTenYears(dateStr) { if (!dateStr) return false; const d = new Date(dateStr); return (Date.now() - d.getTime()) <= 10*365.25*24*3.6e6 && d.getTime() <= Date.now(); }
    function renderRico() {
      const caseId = $('#rico-case').value; const r = ricoOf(caseId);
      const datedPreds = r.predicates.filter((p) => withinTenYears(p.date));
      const evidenced = r.predicates.filter((p) => p.evidence && withinTenYears(p.date));
      const enterpriseOK = !!r.enterpriseGangId;
      const patternOK = evidenced.length >= 2;
      const allEvidenced = r.predicates.length > 0 && r.predicates.every((p) => p.evidence && withinTenYears(p.date));
      const ready = enterpriseOK && patternOK && allEvidenced;
      const score = (enterpriseOK?34:0) + Math.min(2, evidenced.length)*22 + (allEvidenced?22:0);
      const gang = GANGS.find((g) => g.id === r.enterpriseGangId);
      const body = $('#rico-body');
      body.innerHTML = `
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">① Enterprise</p>
          <p class="mb-3 text-xs text-slate-400">Link the defined criminal organization (a gang) that constitutes the enterprise.</p>
          <select id="rico-gang" class="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="">— select enterprise —</option>${GANGS.map((g)=>`<option value="${g.id}" ${g.id===r.enterpriseGangId?'selected':''}>${esc(g.name)}</option>`).join('')}</select>
          <div class="mt-3 rounded-lg border ${enterpriseOK?'border-emerald-500/20 bg-emerald-500/5':'border-white/10 bg-ink-850'} p-3 text-xs"><span class="${enterpriseOK?'text-emerald-300':'text-slate-400'}">${enterpriseOK?`✓ Enterprise: ${esc(gang?gang.name:'—')}${gang&&gang.threat_level?` (${cap(gang.threat_level)} threat)`:''}`:'✗ No enterprise defined'}</span></div>
        </div>
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6 lg:col-span-1">
          <div class="mb-2 flex items-center justify-between"><p class="text-xs font-semibold uppercase tracking-wider text-blue-300/70">② Pattern of Racketeering</p><button id="rico-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Predicate</button></div>
          <p class="mb-3 text-xs text-slate-400">Requires ≥2 predicate acts within 10 years, each evidenced.</p>
          <div class="space-y-2">${r.predicates.length?r.predicates.map((p)=>{const ok=p.evidence&&withinTenYears(p.date);return `<div class="rounded-lg border ${ok?'border-emerald-500/20 bg-emerald-500/5':'border-amber-500/20 bg-amber-500/5'} p-3"><div class="flex items-center justify-between"><span class="text-sm font-semibold text-white">${esc(p.type)}</span><button class="pr-del text-rose-300 hover:text-rose-200" data-id="${p.id}">✕</button></div><p class="text-[11px] text-slate-400">${esc(p.date||'no date')} · ${p.evidence?('evidence: '+esc(p.evidence)):'⚠ no evidence linked'}${!withinTenYears(p.date)&&p.date?' · ⚠ outside 10yr':''}</p>${p.note?`<p class="mt-1 text-[11px] text-slate-500">${esc(p.note)}</p>`:''}</div>`;}).join(''):'<p class="text-xs text-slate-500">No predicate acts logged.</p>'}</div>
        </div>
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">③ Readiness Meter</p>
          <div class="mb-2 flex items-end justify-between"><span class="font-mono text-3xl font-bold ${ready?'text-emerald-300':score>=50?'text-amber-300':'text-rose-300'}">${score}%</span><span class="rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${ready?'bg-emerald-500/15 text-emerald-300':score>=50?'bg-amber-500/15 text-amber-300':'bg-rose-500/15 text-rose-300'}">${ready?'RICO-ready':score>=50?'In progress':'Insufficient'}</span></div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${ready?'bg-emerald-500':score>=50?'bg-amber-500':'bg-rose-500'}" style="width:${score}%"></div></div>
          <ul class="mt-4 space-y-2 text-xs">
            <li class="${enterpriseOK?'text-emerald-300':'text-slate-400'}">${enterpriseOK?'✓':'○'} Enterprise defined</li>
            <li class="${patternOK?'text-emerald-300':'text-slate-400'}">${patternOK?'✓':'○'} ≥2 dated predicate acts within 10 years (${evidenced.length})</li>
            <li class="${allEvidenced?'text-emerald-300':'text-slate-400'}">${allEvidenced?'✓':'○'} Every predicate evidenced &amp; in-window</li>
          </ul>
          <p class="mt-4 text-[11px] text-slate-500">Tracking aid only — charging sufficiency is a prosecutor's determination.</p>
        </div>`;
      body.querySelector('#rico-gang').onchange = (e) => { r.enterpriseGangId = e.target.value; saveRico(); renderRico(); };
      body.querySelector('#rico-add').onclick = () => openPredicateModal(caseId);
      body.querySelectorAll('.pr-del').forEach((b) => b.onclick = () => { r.predicates = r.predicates.filter((x)=>x.id!==b.dataset.id); saveRico(); renderRico(); });
      if (ready) toast(`RICO elements satisfied for ${caseId}`, 'success');
    }
    function openPredicateModal(caseId) {
      const node = el('div', { class:'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Predicate Act</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Predicate Type *</label><select id="pr-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${RICO_PREDICATES.map((p)=>`<option>${esc(p)}</option>`).join('')}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Date of Act *</label><input id="pr-date" type="date" value="${todayISO()}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Evidence (report / media / case)</label><input id="pr-ev" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Surveillance Log #2, dashcam asset" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Note</label><textarea id="pr-note" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"></textarea></div>
        </div>
        <button id="pr-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add Predicate</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#pr-save').onclick = () => {
        const r = ricoOf(caseId);
        r.predicates.push({ id: uid('pr'), type:node.querySelector('#pr-type').value, date:node.querySelector('#pr-date').value, evidence:node.querySelector('#pr-ev').value.trim(), note:node.querySelector('#pr-note').value.trim() });
        saveRico(); renderRico(); closeModal(); toast('Predicate act added', 'success');
      };
      openModal(node);
    }
    function exportRicoDocx() {
      const caseId = $('#rico-case').value; const r = ricoOf(caseId);
      const gang = GANGS.find((g) => g.id === r.enterpriseGangId);
      const paras = [ {text:'Criminal Investigation Division — State of San Andreas', style:'subtitle'}, {text:'RICO Predicate Summary', style:'title'}, {text:`${caseId}  ·  Prepared ${new Date().toLocaleDateString('en-US')}`, style:'subtitle'}, {text:'', style:'normal'},
        {text:'Enterprise', style:'heading'}, {text: gang ? `${gang.name}${gang.threat_level ? ' — threat ' + gang.threat_level : ''}` : 'Not defined', style:'normal'},
        {text:'Pattern of Racketeering — Predicate Acts', style:'heading'} ];
      if (!r.predicates.length) paras.push({text:'No predicate acts logged.', style:'normal'});
      r.predicates.forEach((p, i) => paras.push({text:`${i+1}. ${p.type} — ${p.date||'no date'} — evidence: ${p.evidence||'none'}${p.note?(' — '+p.note):''}`, style:'normal'}));
      paras.push({text:'', style:'normal'});
      paras.push({text:'Disclaimer: organizational tracking aid only; predicate sufficiency is a prosecutor’s determination.', style:'subtitle'});
      downloadDocx('RICO Predicate Summary', paras, `${caseId.replace(/[^a-z0-9]/gi,'-')}-rico-summary.docx`);
      toast('RICO Predicate Summary exported as .docx', 'success');
    }

    /* ============================================================ 11E. OOXML .docx WRITER (dependency-free) ============================================================ */
    function crc32(buf) { let crc = ~0; for (let i=0;i<buf.length;i++){ crc ^= buf[i]; for (let j=0;j<8;j++) crc = (crc>>>1) ^ (0xEDB88320 & -(crc & 1)); } return ~crc >>> 0; }
    function zipStore(files) {
      const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
      files.forEach((f) => {
        const nameB = enc.encode(f.name); const data = f.data; const crc = crc32(data);
        const lh = new Uint8Array(30 + nameB.length); const dv = new DataView(lh.buffer);
        dv.setUint32(0,0x04034b50,true); dv.setUint16(4,20,true); dv.setUint16(6,0,true); dv.setUint16(8,0,true); dv.setUint16(10,0,true); dv.setUint16(12,0,true);
        dv.setUint32(14,crc,true); dv.setUint32(18,data.length,true); dv.setUint32(22,data.length,true); dv.setUint16(26,nameB.length,true); dv.setUint16(28,0,true);
        lh.set(nameB,30); chunks.push(lh, data);
        const ch = new Uint8Array(46 + nameB.length); const cv = new DataView(ch.buffer);
        cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0,true); cv.setUint16(10,0,true); cv.setUint16(12,0,true); cv.setUint16(14,0,true);
        cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,nameB.length,true);
        cv.setUint16(30,0,true); cv.setUint16(32,0,true); cv.setUint16(34,0,true); cv.setUint16(36,0,true); cv.setUint32(38,0,true); cv.setUint32(42,offset,true);
        ch.set(nameB,46); central.push(ch); offset += lh.length + data.length;
      });
      let cdSize = 0; central.forEach((c) => cdSize += c.length); const cdOffset = offset; central.forEach((c) => chunks.push(c));
      const end = new Uint8Array(22); const ev = new DataView(end.buffer);
      ev.setUint32(0,0x06054b50,true); ev.setUint16(4,0,true); ev.setUint16(6,0,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cdSize,true); ev.setUint32(16,cdOffset,true); ev.setUint16(20,0,true);
      chunks.push(end);
      return new Blob(chunks, { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
    const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]));
    function paraXml(p) {
      const styles = { title:{sz:36,b:1,jc:'center'}, subtitle:{sz:18,b:0,jc:'center',color:'64748B'}, heading:{sz:26,b:1}, normal:{sz:22,b:0} };
      const s = styles[p.style] || styles.normal;
      const rpr = `<w:rPr>${s.b?'<w:b/>':''}<w:sz w:val="${s.sz}"/>${s.color?`<w:color w:val="${s.color}"/>`:''}</w:rPr>`;
      const ppr = `<w:pPr>${s.jc?`<w:jc w:val="${s.jc}"/>`:''}<w:spacing w:after="120"/></w:pPr>`;
      return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
    }
    function downloadDocx(title, paras, filename) {
      const enc = new TextEncoder();
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
      const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
      const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(paraXml).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
      const blob = zipStore([
        { name:'[Content_Types].xml', data: enc.encode(contentTypes) },
        { name:'_rels/.rels', data: enc.encode(rels) },
        { name:'word/document.xml', data: enc.encode(doc) },
      ]);
      const a = document.createElement('a'); const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ============================================================ 12. LIVE CID RECORDS (Supabase) ============================================================ */
    const REC_FIELDS = [
      { key:'name', label:'Name', req:true }, { key:'callsign', label:'Callsign' },
      { key:'case_number', label:'Case Number' }, { key:'bureau', label:'Bureau', type:'select', opts:['','LSPD','BCSO','SAHP','JTF'] },
      { key:'gang', label:'Gang / Affiliation' }, { key:'status', label:'Status', type:'select', opts:['Open','Cold','Closed','Wanted'] },
      { key:'charges', label:'Charges', type:'textarea' }, { key:'officer', label:'Assigned Officer' },
      { key:'last_seen', label:'Last Seen' }, { key:'mugshot_url', label:'Mugshot URL' },
      { key:'notes', label:'Notes', type:'textarea' },
    ];
    let sb = null;           // supabase client
    let recSession = null;   // current auth session
    let recCache = [];       // last fetched records
    let recChannel = null;

    function recConfigured() {
      const c = window.CID_SUPABASE;
      return !!(window.supabase && c && c.url && c.anonKey && !/PASTE_YOUR/.test(c.anonKey));
    }
    function statusTintRec(s) {
      return s === 'Wanted' ? 'bg-rose-500/15 text-rose-300' : s === 'Open' ? 'bg-blue-500/15 text-blue-300'
           : s === 'Cold' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/15 text-emerald-300';
    }

    function initRecords() {
      // Wire the static controls regardless of config so the tab never looks dead.
      $('#rec-refresh').addEventListener('click', fetchRecords);
      $('#rec-new').addEventListener('click', () => openRecordModal(null));
      $('#rec-search').addEventListener('input', renderRecords);

      if (!recConfigured()) {
        $('#rec-notice').classList.remove('hidden');
        $('#rec-notice').innerHTML = window.supabase
          ? '⚙️ Live records are not configured yet. Add your Supabase <b>anon/publishable key</b> in the <code>window.CID_SUPABASE</code> block, then reload.'
          : '⚠️ The Supabase client library failed to load (offline?). Live records are unavailable; the rest of the portal works normally.';
        renderAuthBar();
        return;
      }

      sb = window.supabase.createClient(window.CID_SUPABASE.url, window.CID_SUPABASE.anonKey);
      sb.auth.getSession().then(({ data }) => { recSession = data.session; renderAuthBar(); fetchRecords(); });
      sb.auth.onAuthStateChange((_e, session) => { recSession = session; renderAuthBar(); renderRecords(); });

      // Realtime: re-fetch on any change so all open clients stay in sync.
      recChannel = sb.channel('cid_records_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cid_records' }, fetchRecords)
        .subscribe((st) => { $('#rec-live-dot').classList.toggle('hidden', st !== 'SUBSCRIBED'); $('#rec-live-dot').classList.toggle('inline-flex', st === 'SUBSCRIBED'); });
    }

    function renderAuthBar() {
      const bar = $('#rec-auth'); if (!bar) return;
      if (!recConfigured()) { bar.innerHTML = '<span class="text-xs text-slate-500">offline / unconfigured</span>'; return; }
      if (recSession && recSession.user) {
        const u = recSession.user;
        const who = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email || 'Signed in';
        bar.innerHTML = `<span class="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">👤 ${esc(who)}</span><button id="rec-logout" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">Sign out</button>`;
        bar.querySelector('#rec-logout').onclick = async () => { await sb.auth.signOut(); toast('Signed out', 'info'); };
        $('#rec-new').classList.remove('hidden');
      } else {
        bar.innerHTML = `
          <button id="rec-discord" class="flex items-center gap-2 rounded-lg bg-[#5865F2] px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110">Sign in with Discord</button>
          <div class="flex items-center gap-1">
            <input id="rec-email" type="email" placeholder="you@email.com" class="w-40 rounded-lg border border-white/10 bg-ink-850 px-2 py-2 text-xs text-white outline-none focus:border-badge-500" />
            <button id="rec-magic" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">Email link</button>
          </div>`;
        bar.querySelector('#rec-discord').onclick = async () => {
          const { error } = await sb.auth.signInWithOAuth({ provider:'discord', options:{ redirectTo: location.href.split('#')[0] } });
          if (error) toast('Discord sign-in error: ' + error.message, 'danger');
        };
        bar.querySelector('#rec-magic').onclick = async () => {
          const email = bar.querySelector('#rec-email').value.trim();
          if (!email) { toast('Enter your email first.', 'warn'); return; }
          const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.href.split('#')[0] } });
          toast(error ? ('Email error: ' + error.message) : 'Magic link sent — check your inbox.', error ? 'danger' : 'success');
        };
        $('#rec-new').classList.add('hidden');
      }
    }

    async function fetchRecords() {
      if (!sb) return;
      const { data, error } = await sb.from('cid_records').select('*').order('updated_at', { ascending:false });
      if (error) { $('#rec-notice').classList.remove('hidden'); $('#rec-notice').innerHTML = '⚠️ Could not load records: ' + esc(error.message) + ' — check that the migration ran and the key is correct.'; return; }
      $('#rec-notice').classList.add('hidden');
      recCache = data || [];
      renderRecords();
    }

    function renderRecords() {
      const grid = $('#rec-grid'); if (!grid) return;
      const q = ($('#rec-search') ? $('#rec-search').value : '').trim().toLowerCase();
      const canEdit = !!(recSession && recSession.user);
      const items = recCache.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
      if (!recConfigured()) { grid.innerHTML = ''; return; }
      if (!items.length) { grid.innerHTML = `<p class="text-sm text-slate-500">${recCache.length ? 'No records match your filter.' : 'No records yet.' + (canEdit ? ' Use “+ New Record”.' : ' Sign in to add the first one.')}</p>`; return; }
      grid.innerHTML = '';
      items.forEach((r) => {
        const card = el('div', { class:'overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        card.innerHTML = `
          <div class="flex gap-4 p-5">
            ${r.mugshot_url ? `<img src="${esc(r.mugshot_url)}" alt="" class="h-16 w-16 flex-shrink-0 rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-16 w-16 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-2xl">👤</div>` : `<div class="grid h-16 w-16 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-2xl">👤</div>`}
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0"><p class="truncate font-semibold text-white">${esc(r.name)}</p><p class="text-xs text-slate-400">${esc(r.callsign || '—')}${r.bureau ? ' · ' + esc(r.bureau) : ''}</p></div>
                <span class="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTintRec(r.status)}">${esc(r.status || '—')}</span>
              </div>
              ${r.case_number ? `<p class="mt-1 font-mono text-[11px] text-blue-300">${esc(r.case_number)}</p>` : ''}
              ${r.gang ? `<p class="mt-1 text-xs text-violet-300">🚩 ${esc(r.gang)}</p>` : ''}
              ${r.charges ? `<p class="mt-2 line-clamp-3 text-xs text-slate-300">${esc(r.charges)}</p>` : ''}
            </div>
          </div>
          <div class="flex items-center justify-between border-t border-white/5 px-5 py-2.5 text-[11px] text-slate-500">
            <span>${r.officer ? esc(r.officer) : 'Unassigned'}${r.last_seen ? ' · last seen ' + esc(r.last_seen) : ''}</span>
            ${canEdit ? `<button class="rec-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>` : ''}
          </div>`;
        const eb = card.querySelector('.rec-edit'); if (eb) eb.onclick = () => openRecordModal(r);
        grid.appendChild(card);
      });
    }

    function openRecordModal(record) {
      if (!(recSession && recSession.user)) { toast('Sign in to add or edit records.', 'warn'); return; }
      const r = record || {};
      const node = el('div', { class:'p-6' });
      const field = (f) => {
        const v = r[f.key] != null ? r[f.key] : (f.key === 'status' ? 'Open' : '');
        const req = f.req ? ' <span class="text-rose-400" aria-hidden="true">*</span>' : '';
        if (f.type === 'textarea') return `<div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><textarea data-k="${f.key}" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${esc(v)}</textarea></div>`;
        if (f.type === 'select') return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><select data-k="${f.key}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${f.opts.map((o)=>`<option ${o===v?'selected':''}>${o}</option>`).join('')}</select></div>`;
        return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><input data-k="${f.key}" value="${esc(v)}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>`;
      };
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Record</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">${REC_FIELDS.map(field).join('')}</div>
        <button id="rec-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create record'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#rec-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((el2) => payload[el2.dataset.k] = el2.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        let res;
        if (record && record.id) res = await sb.from('cid_records').update(payload).eq('id', record.id);
        else { payload.created_by = recSession.user.id; res = await sb.from('cid_records').insert(payload); }
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Record updated' : 'Record created', 'success');
        fetchRecords(); // realtime will also fire, but refetch guarantees immediate update
      };
      openModal(node, { wide: true });
    }

    /* ============================================================ 14. CASE FILES (Supabase-backed: cases + evidence + custody + timeline) ============================================================ */
    const DB = () => window.CIDDB;
    const dbReady = () => { const d = DB(); return !!(d && d.ready); };
    const caseStatusTint = (s) => s === 'closed' ? 'bg-slate-500/20 text-slate-300' : s === 'cold' ? 'bg-blue-500/15 text-blue-300' : s === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300';
    let casesCache = [];

    function casesNotice(msg) { $('#cases-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${msg}</div>`; }

    function showCasesList() { $('#case-detail').classList.add('hidden'); $('#cases-list').classList.remove('hidden'); }
    function onEnterCases() { showCasesList(); if (dbReady()) fetchCases(); else casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); }

    async function fetchCases() {
      if (!dbReady()) { casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); return; }
      $('#cases-live').classList.remove('hidden'); $('#cases-live').classList.add('inline-flex');
      try {
        casesCache = await DB().list('cases', { order: 'updated_at', ascending: false });
        renderCases();
        if (typeof refreshCaseSelects === 'function') refreshCaseSelects();
      } catch (e) { casesNotice('Could not load cases: ' + escapeHTML(e.message || String(e))); }
    }

    function renderCases() {
      const grid = $('#cases-grid'); if (!grid) return;
      const q = ($('#case-search') ? $('#case-search').value : '').trim().toLowerCase();
      const items = casesCache.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
      $('#case-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { casesNotice(casesCache.length ? 'No cases match your filter.' : 'No case files yet.' + (DB() && DB().canEdit() ? ' Use “+ New Case” to create the first.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((c) => {
        const card = el('div', { class: 'cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-blue-500/30 hover:bg-white/5' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="truncate font-mono text-sm font-semibold text-blue-300">${escapeHTML(c.case_number)}</p><p class="mt-0.5 truncate text-sm text-white">${escapeHTML(c.title || 'Untitled case')}</p></div>
            <span class="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span>
          </div>
          <p class="mt-2 line-clamp-2 text-xs text-slate-400">${escapeHTML(c.summary || 'No summary.')}</p>
          <div class="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span class="rounded bg-white/5 px-2 py-0.5">${escapeHTML(c.bureau)}</span><span>updated ${new Date(c.updated_at).toLocaleDateString('en-US')}</span></div>`;
        card.addEventListener('click', () => openCaseDetail(c.id));
        grid.appendChild(card);
      });
    }

    function openCaseModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required to edit cases.', 'warn'); return; }
      const c = record || {};
      const node = el('div', { class: 'p-6' });
      const sel = (k, opts, v) => `<select data-k="${k}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Case</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Case Number *</label><input data-k="case_number" value="${escapeHTML(c.case_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" placeholder="[LSB] Case-1000001" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title</label><input data-k="title" value="${escapeHTML(c.title || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bureau</label>${sel('bureau', ['LSB', 'BCB', 'SAB', 'JTF'], c.bureau || 'JTF')}</div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label>${sel('status', ['open', 'active', 'cold', 'closed'], c.status || 'open')}</div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Summary</label><textarea data-k="summary" rows="4" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(c.summary || '')}</textarea></div>
        </div>
        <button id="case-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create case'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#case-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.case_number) { toast('Case Number is required.', 'warn'); return; }
        const res = record && record.id ? await DB().update('cases', record.id, payload) : await DB().insert('cases', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Case updated' : 'Case created', 'success'); fetchCases();
        if (record && record.id) openCaseDetail(record.id);
      };
      openModal(node, { wide: true });
    }

    /* ---- Case Detail (tabs: Overview / Evidence / Reports / Timeline) ---- */
    let detailCase = null, detailTab = 'overview';
    async function openCaseDetail(id) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      try {
        const rows = await DB().list('cases', { eq: { id: id } });
        detailCase = rows[0]; if (!detailCase) { toast('Case not found.', 'warn'); return; }
        detailTab = 'overview';
        $('#cases-list').classList.add('hidden');
        $('#case-detail').classList.remove('hidden');
        renderCaseDetailShell();
        loadDetailTab();
      } catch (e) { toast('Load failed: ' + (e.message || e), 'danger'); }
    }
    function renderCaseDetailShell() {
      const c = detailCase, canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const tabs = ['overview', 'evidence', 'reports', 'timeline'];
      $('#case-detail').innerHTML = `
        <button id="case-back" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">← All cases</button>
        <div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><p class="font-mono text-sm text-blue-300">${escapeHTML(c.case_number)}</p><h3 class="text-xl font-bold text-white">${escapeHTML(c.title || 'Untitled case')}</h3><p class="mt-1 text-sm text-slate-400">${escapeHTML(c.summary || '')}</p></div>
            <div class="flex items-center gap-2">
              <span class="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span>
              <span class="rounded-md bg-white/5 px-2.5 py-1 text-xs text-slate-300">${escapeHTML(c.bureau)}</span>
              ${canEdit ? '<button id="case-edit" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
              ${canDel ? '<button id="case-del" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
            </div>
          </div>
          <div class="mt-5 flex gap-1 overflow-x-auto border-b border-white/5" id="detail-tabs">
            ${tabs.map((t) => `<button data-dt="${t}" class="detail-tab flex-shrink-0 border-b-2 px-4 py-2 text-sm font-medium capitalize transition ${t === detailTab ? 'border-badge-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}">${t}</button>`).join('')}
          </div>
        </div>
        <div id="detail-body"><p class="text-sm text-slate-500">Loading…</p></div>`;
      $('#case-back').onclick = showCasesList;
      const eb = $('#case-edit'); if (eb) eb.onclick = () => openCaseModal(detailCase);
      const db = $('#case-del'); if (db) db.onclick = async () => {
        if (!confirm('Delete case ' + detailCase.case_number + '? This cascades to its evidence/reports.')) return;
        const r = await DB().remove('cases', detailCase.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        toast('Case deleted', 'warn'); showCasesList(); fetchCases();
      };
      $$('.detail-tab', $('#case-detail')).forEach((b) => b.onclick = () => { detailTab = b.dataset.dt; renderCaseDetailShell(); loadDetailTab(); });
    }
    async function loadDetailTab() {
      const body = $('#detail-body'); const cid = detailCase.id; const canEdit = DB() && DB().canEdit();
      try {
        if (detailTab === 'overview') {
          const [ev, rep] = await Promise.all([ DB().list('evidence', { eq: { case_id: cid } }), DB().list('reports', { eq: { case_id: cid } }) ]);
          body.innerHTML = `<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            ${[['Evidence', ev.length, '🧾'], ['Reports', rep.length, '📝'], ['Status', detailCase.status, '📌']].map((k) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><p class="text-xs uppercase tracking-wider text-slate-400">${k[0]}</p><p class="mt-1 text-2xl font-bold text-white">${escapeHTML(String(k[1]))}</p></div>`).join('')}
          </div>`;
        } else if (detailTab === 'evidence') {
          const ev = await DB().list('evidence', { order: 'created_at', ascending: false, eq: { case_id: cid } });
          body.innerHTML = `
            <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Evidence (${ev.length})</h4>${canEdit ? '<button id="ev-new" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Add Evidence</button>' : ''}</div>
            <div class="space-y-3">${ev.length ? ev.map(evidenceCard).join('') : '<p class="text-sm text-slate-500">No evidence logged.</p>'}</div>`;
          const nb = $('#ev-new'); if (nb) nb.onclick = () => openEvidenceModal(cid);
          $$('.ev-custody', body).forEach((b) => b.onclick = () => openCustody(b.dataset.id));
        } else if (detailTab === 'reports') {
          const rep = await DB().list('reports', { order: 'created_at', ascending: false, eq: { case_id: cid } });
          body.innerHTML = `<div class="space-y-3">${rep.length ? rep.map((r) => `<div class="rounded-xl border border-white/10 bg-ink-900 p-4"><div class="flex items-center justify-between"><span class="text-sm font-semibold text-white">${escapeHTML(r.template)} <span class="text-xs text-slate-400">${escapeHTML(r.kind)}${r.seq ? ' #' + r.seq : ''}</span></span>${r.finalized ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase text-emerald-300">finalized</span>' : '<span class="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase text-amber-300">draft</span>'}</div><p class="mt-1 text-[11px] text-slate-500">${new Date(r.created_at).toLocaleString('en-US')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No reports linked. (Report authoring migrates in the next module.)</p>'}</div>`;
        } else if (detailTab === 'timeline') {
          const [ev, rep, cust] = await Promise.all([
            DB().list('evidence', { eq: { case_id: cid } }),
            DB().list('reports', { eq: { case_id: cid } }),
            DB().from('custody_chain').select('*, evidence!inner(case_id)').eq('evidence.case_id', cid).then((r) => r.data || [])
          ]);
          const events = [];
          ev.forEach((e) => events.push({ t: e.collected_at || e.created_at, label: 'Evidence collected: ' + (e.description || e.item_code || 'item'), dot: 'blue' }));
          rep.forEach((r) => events.push({ t: r.created_at, label: 'Report: ' + r.template + (r.finalized ? ' (finalized)' : ''), dot: 'violet' }));
          cust.forEach((c) => events.push({ t: c.at, label: 'Custody transfer: ' + (c.from_officer || '?') + ' → ' + (c.to_officer || '?'), dot: 'amber' }));
          events.push({ t: detailCase.created_at, label: 'Case opened', dot: 'emerald' });
          events.sort((a, b) => new Date(b.t) - new Date(a.t));
          const dot = { blue: 'bg-blue-400', violet: 'bg-violet-400', amber: 'bg-amber-400', emerald: 'bg-emerald-400' };
          body.innerHTML = `<ul class="space-y-4">${events.map((e) => `<li class="flex gap-3"><span class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dot[e.dot]}"></span><div><p class="text-sm text-slate-200">${escapeHTML(e.label)}</p><p class="text-[11px] text-slate-500">${e.t ? new Date(e.t).toLocaleString('en-US') : '—'}</p></div></li>`).join('')}</ul>`;
        }
      } catch (e) { body.innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || String(e)) + '</p>'; }
    }
    function evidenceCard(e) {
      const tint = e.tamper === 'intact' ? 'text-emerald-300' : e.tamper === 'compromised' ? 'text-rose-300' : 'text-amber-300';
      return `<div class="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div class="flex items-start justify-between gap-2"><div><p class="text-sm font-semibold text-white">${escapeHTML(e.description || e.item_code || 'Evidence')}</p><p class="text-[11px] text-slate-400">${escapeHTML(e.type || '—')}${e.item_code ? ' · ' + escapeHTML(e.item_code) : ''} · collected ${e.collected_at ? new Date(e.collected_at).toLocaleDateString('en-US') : '—'}</p></div><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tint}">${escapeHTML(e.tamper)}</span></div>
        <div class="mt-2 flex gap-2"><button class="ev-custody rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10" data-id="${e.id}">Chain of custody</button></div>
      </div>`;
    }
    function openEvidenceModal(caseId) {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Evidence</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Item Code</label><input data-k="item_code" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="EV-001" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Type</label><input data-k="type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Firearm / Narcotic / Document" /></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Description *</label><input data-k="description" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Location</label><input data-k="location" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Tamper Status</label><select data-k="tamper" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option>intact</option><option>compromised</option><option>released</option><option>destroyed</option></select></div>
        </div>
        <button id="ev-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Log Evidence</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#ev-save').onclick = async () => {
        const payload = { case_id: caseId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim() || null);
        if (!payload.description) { toast('Description is required.', 'warn'); return; }
        const res = await DB().insert('evidence', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Evidence logged', 'success'); loadDetailTab();
      };
      openModal(node, { wide: true });
    }
    async function openCustody(evidenceId) {
      const node = el('div', { class: 'p-6' });
      let chain = [];
      try { chain = await DB().list('custody_chain', { order: 'at', ascending: true, eq: { evidence_id: evidenceId } }); } catch (e) {}
      const canEdit = DB() && DB().canEdit();
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Chain of Custody</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-xs text-slate-400">Append-only transfer log.</p>
        <div id="custody-list" class="mb-4 space-y-2">${chain.length ? chain.map((c) => `<div class="rounded-lg border border-white/5 bg-ink-900 p-3 text-sm"><p class="text-slate-200">${escapeHTML(c.from_officer || '?')} → ${escapeHTML(c.to_officer || '?')}</p><p class="text-[11px] text-slate-500">${escapeHTML(c.reason || '')} · ${new Date(c.at).toLocaleString('en-US')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No transfers recorded.</p>'}</div>
        ${canEdit ? `<div class="grid grid-cols-1 gap-2 sm:grid-cols-3"><input id="cf" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="From officer" /><input id="ct" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="To officer" /><input id="cr" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Reason" /></div><button id="cust-add" class="mt-3 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Record Transfer</button>` : ''}`;
      node.querySelector('.close-x').onclick = closeModal;
      const add = node.querySelector('#cust-add');
      if (add) add.onclick = async () => {
        const payload = { evidence_id: evidenceId, from_officer: node.querySelector('#cf').value.trim(), to_officer: node.querySelector('#ct').value.trim(), reason: node.querySelector('#cr').value.trim() };
        if (!payload.to_officer) { toast('“To officer” is required.', 'warn'); return; }
        const res = await DB().insert('custody_chain', payload);
        if (res.error) { toast('Failed: ' + res.error.message, 'danger'); return; }
        toast('Transfer recorded', 'success'); openCustody(evidenceId);
      };
      openModal(node, { wide: true });
    }

    function initCases() {
      $('#case-new').addEventListener('click', () => openCaseModal(null));
      $('#case-refresh').addEventListener('click', fetchCases);
      $('#case-search').addEventListener('input', renderCases);
    }
    // Re-fetch when auth resolves (called by auth.js) and subscribe to realtime.
    window.CIDApp = window.CIDApp || {};
    window.CIDApp.onAuthed = function () {
      fetchProfiles(); fetchCases(); fetchGangs(); fetchPersons(); fetchDrugs(); fetchPlaces(); fetchBenches(); fetchFootprints(); fetchTrackers();
      if (dbReady()) {
        DB().subscribe('cases', fetchCases);
        DB().subscribe('gangs', fetchGangs);
        DB().subscribe('persons', fetchPersons);
        DB().subscribe('narcotics', fetchDrugs);
        DB().subscribe('places', fetchPlaces);
        DB().subscribe('ballistics_benches', fetchBenches);
        DB().subscribe('ballistic_footprints', fetchFootprints);
        DB().subscribe('trackers', fetchTrackers);
      }
    };

    /* ============================================================ 13. CLOCK + BOOT ============================================================ */
    function tickClock() { $('#clock').textContent = 'Secure link · ' + new Date().toLocaleTimeString('en-US', { hour12:false }); }

    function init() {
      Object.assign(caseCounters, Store.get('caseCounters', {}));
      wireDrawer(); wireCollapse();
      // Central command
      renderKPIs(); renderTickets(); renderActivity(); renderBureauLoad();
      renderTrackers(); $('#new-tracker').addEventListener('click', openTrackerModal);
      renderCompBrackets();
      $('#comp-input').addEventListener('input', () => { const d = $('#comp-input').value.replace(/[^0-9]/g,''); $('#comp-input').value = d ? Number(d).toLocaleString('en-US') : ''; calcComp(); });
      calcComp();
      // Narcotics (Supabase) — fetch via onAuthed / onEnterNarcotics
      renderDrugs();
      $('#narc-new').addEventListener('click', () => openNarcoticModal(null));
      // Ballistics (Supabase) — fetch via onAuthed / onEnterBallistics
      renderBenches(); renderBallisticLog();
      $$('.bench-tab').forEach((b) => b.addEventListener('click', () => { benchType = b.dataset.bench; Store.set('benchType', benchType); renderBenches(); }));
      $('#bench-new').addEventListener('click', () => openBenchModal(null));
      $('#footprint-new').addEventListener('click', () => openFootprintModal(null));
      // Personnel + evidence vault
      const savedMedia = Store.get('media', null);
      if (Array.isArray(savedMedia)) { MEDIA.length = 0; savedMedia.forEach((m) => MEDIA.push(m)); }
      renderRoster(); renderCommendations(); renderMediaFilters(); renderMedia();
      $('#add-media').addEventListener('click', openMediaModal);
      // M.O.
      $('#mo-run').addEventListener('click', renderMO);
      $('#mo-sample').addEventListener('click', () => { $('#mo-input').value = SAMPLE_MO; renderMO(); });
      // Gangs (Supabase) + Persons (Supabase) — fetch via onAuthed / onEnter*
      $('#add-gang').addEventListener('click', () => openGangModal(null));
      $('#gang-refresh').addEventListener('click', fetchGangs);
      $('#gang-search').addEventListener('input', renderGangs);
      $('#person-new').addEventListener('click', () => openPersonModal(null));
      $('#person-refresh').addEventListener('click', fetchPersons);
      $('#person-search').addEventListener('input', renderPersons);
      // Criminal places (Supabase) — fetch via onAuthed / onEnterPlaces
      renderPlaces(); $('#add-place').addEventListener('click', () => openPlaceModal(null));
      // Reports
      renderTemplateList(); fillCaseSelect($('#report-case')); $('#report-case').addEventListener('change', renderReportChain); renderReportChain();
      // RICO
      fillCaseSelect($('#rico-case')); $('#rico-case').addEventListener('change', renderRico); $('#rico-export').addEventListener('click', exportRicoDocx); renderRico();
      // Drive
      renderDrive();
      // Live CID Records (Supabase)
      initRecords();
      // Case Files (Supabase spine) — fetch happens via onAuthed / onEnterCases
      initCases();
      // Chrome
      tickClock(); setInterval(tickClock, 1000); setInterval(tickTrackers, 1000);

      const hash = (location.hash || '').replace('#','');
      navigate(PAGE_META[hash] ? hash : Store.get('tab', 'command'));

      $('#global-search').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = e.target.value.toLowerCase();
        if (/drug|meth|heroin|narc/.test(q)) navigate('narcotics');
        else if (/weapon|gun|ballist|bench/.test(q)) navigate('ballistics');
        else if (/officer|roster|medal|media|evidence/.test(q)) navigate('personnel');
        else if (/m\.?o|profile|suspect/.test(q)) navigate('modus');
        else if (/gang|turf|member/.test(q)) navigate('gangs');
        else if (/place|lab|stash|location|production/.test(q)) navigate('places');
        else if (/report|warrant|affidavit|supplement/.test(q)) navigate('reports');
        else if (/rico|predicate|enterprise|racket/.test(q)) navigate('rico');
        else if (/record|wanted|suspect|live/.test(q)) navigate('records');
        else if (/folder|drive|file|ci/.test(q)) navigate('drive');
        else navigate('command');
        toast('Searching division records for "' + e.target.value + '"…', 'info');
      });
    }
    document.addEventListener('DOMContentLoaded', init);
  })();
