/* command.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 5. CENTRAL COMMAND ============================================================ */
    /* ---- Central Command (live from Supabase) ---- */
    let TICKETS_CACHE = [], AUDIT = [], SEIZ_TOTAL = 0, RAIDS_CACHE = [], EVIDENCE_CACHE = [];
    const KPI_ACCENTS = { blue:'from-blue-500/20 to-blue-700/5 text-blue-300 border-blue-500/20', slate:'from-slate-500/20 to-slate-700/5 text-slate-300 border-slate-500/20', violet:'from-violet-500/20 to-violet-700/5 text-violet-300 border-violet-500/20', emerald:'from-emerald-500/20 to-emerald-700/5 text-emerald-300 border-emerald-500/20', amber:'from-amber-500/20 to-amber-700/5 text-amber-300 border-amber-500/20', rose:'from-rose-500/20 to-rose-700/5 text-rose-300 border-rose-500/20', cyan:'from-cyan-500/20 to-cyan-700/5 text-cyan-300 border-cyan-500/20' };
    // Command filters (#17) — command staff (bureau lead+) can scope the dashboard.
    const CMD_ROLES = ['bureau_lead', 'deputy_director', 'director'];
    const CMD_FILTERS = { bureau: '', detective: '', status: '', from: '', to: '' };
    function cmdCanFilter() { const me = DB() && DB().me; return !!(me && me.active && CMD_ROLES.includes(me.role)); }
    function cmdFilterActive() { return !!(CMD_FILTERS.bureau || CMD_FILTERS.detective || CMD_FILTERS.status || CMD_FILTERS.from || CMD_FILTERS.to); }
    function cmdMatch(c) {
      if (CMD_FILTERS.bureau && c.bureau !== CMD_FILTERS.bureau) return false;
      if (CMD_FILTERS.detective && c.lead_detective_id !== CMD_FILTERS.detective) return false;
      if (CMD_FILTERS.status === 'awaiting' && !/^awaiting_/.test(c.signoff_status || '')) return false;
      else if (CMD_FILTERS.status === 'ready_doj' && !(c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete')) return false;
      // 'open_active' is the drill target for the "Open Cases" KPI card, which counts open+active together.
      else if (CMD_FILTERS.status === 'open_active' && !(c.status === 'open' || c.status === 'active')) return false;
      else if (CMD_FILTERS.status && !['awaiting', 'ready_doj', 'open_active'].includes(CMD_FILTERS.status) && c.status !== CMD_FILTERS.status) return false;
      if (CMD_FILTERS.from && new Date(c.created_at) < new Date(CMD_FILTERS.from)) return false;
      if (CMD_FILTERS.to && new Date(c.created_at) > new Date(CMD_FILTERS.to + 'T23:59:59')) return false;
      return true;
    }
    function cmdFilteredCases() { return (typeof casesCache !== 'undefined' ? casesCache : []).filter(cmdMatch); }
    const reEvWeapon = /gun|weapon|firearm|pistol|rifle|shotgun|ammo|ammunition|magazine/i;
    const reEvNarc = /narc|drug|cocaine|coke|meth|heroin|cannabis|weed|marijuana|fentanyl|opi|pill/i;
    function avgResolutionDays(cases) {
      const closed = cases.filter((c) => c.closed_at && c.created_at);
      if (!closed.length) return null;
      const totalMs = closed.reduce((a, c) => a + (new Date(c.closed_at) - new Date(c.created_at)), 0);
      return totalMs / closed.length / 86400000;
    }
    function renderKPIs() {
      const g = $('#kpi-grid'); if (!g) return;
      const live = dbReady();
      const cases = cmdFilteredCases();
      const caseIds = new Set(cases.map((c) => c.id));
      const open = cases.filter((c) => c.status === 'open' || c.status === 'active').length;
      const cold = cases.filter((c) => c.status === 'cold').length;
      const awaiting = cases.filter((c) => /^awaiting_/.test(c.signoff_status || '')).length;
      const readyDoj = cases.filter((c) => c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete').length;
      const scoped = cmdFilterActive();
      const seiz = (scoped ? RAIDS_CACHE.filter((r) => caseIds.has(r.case_id)) : RAIDS_CACHE).reduce((a, b) => a + (Number(b.net_value) || 0), 0);
      const ev = scoped ? EVIDENCE_CACHE.filter((e) => caseIds.has(e.case_id)) : EVIDENCE_CACHE;
      const weapons = ev.filter((e) => reEvWeapon.test(e.type || '') || reEvWeapon.test(e.description || '')).length;
      const narcs = ev.filter((e) => reEvNarc.test(e.type || '') || reEvNarc.test(e.description || '')).length;
      const avg = avgResolutionDays(cases);
      const flagged = PERSONS.filter((p) => (p.felony_count || 0) >= 8).length;
      // Tactical zero-state: a flat 0 reads as "00 // STANDBY" so an idle metric
      // still reads as a deliberate system state, not missing data.
      const tVal = (v) => (v === 0 ? '00&#8202;<span class="t-standby">// STANDBY</span>' : String(v));
      const cards = [
        { label:'Open Cases', value: live ? tVal(open) : '—', delta: `${cases.length} ${scoped ? 'in filter' : 'total on file'}`, icon:'folder', accent:'blue', go:() => setCmdStatus('open_active') },
        { label:'Awaiting Sign-off', value: live ? tVal(awaiting) : '—', delta:'stuck in the approval chain', icon:'pen', accent:'amber', go:() => setCmdStatus('awaiting') },
        { label:'Ready for DOJ', value: live ? tVal(readyDoj) : '—', delta:'approved & complete', icon:'scale', accent:'emerald', go:() => setCmdStatus('ready_doj') },
        { label:'Avg Resolution', value: live ? (avg == null ? '<span class="t-readout text-slate-500">--</span>' : (avg < 1 ? '<1d' : avg.toFixed(1) + 'd')) : '—', delta: avg == null ? 'no closed cases yet' : 'open → closed', icon:'timer', accent:'cyan' },
        { label:'Cold Cases', value: live ? tVal(cold) : '—', delta:'2-week inactivity policy', icon:'cold', accent:'slate', go:() => setCmdStatus('cold') },
        { label:'Seizures (money)', value: live ? (seiz === 0 ? tVal(0) : fmtUSD(seiz)) : '—', delta:'logged raid compensation', icon:'cash', accent:'emerald' },
        { label:'Narcotics Seized', value: live ? tVal(narcs) : '—', delta:'evidence items logged', icon:'capsule', accent:'violet' },
        { label:'Weapons Seized', value: live ? tVal(weapons) : '—', delta:'evidence items logged', icon:'crosshair', accent:'rose' },
        { label:'Persons of Interest', value: live ? tVal(PERSONS.length) : '—', delta: `${flagged} ≥8-felony flagged`, icon:'users', accent:'violet' },
      ];
      g.innerHTML = '';
      cards.forEach((m) => { const card = el('div', { class:`kpi-tile relative overflow-hidden rounded-2xl border bg-gradient-to-br ${KPI_ACCENTS[m.accent]} p-5 transition hover:shadow-glow${m.go ? ' cursor-pointer hover:brightness-110' : ''}` },
        `<div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">${m.label}</p><p class="kpi-value mt-2 text-3xl font-bold text-white">${m.value}</p><p class="mt-1 text-[11px] text-slate-400">${m.delta}</p></div><span class="kpi-icon text-slate-500">${(typeof tIcon === 'function') ? tIcon(m.icon, 20) : ''}</span></div>`);
        if (m.go && live) card.onclick = m.go;
        g.appendChild(card); });
      renderCmdDrill();
      renderAttention();
    }

    /* ---- Needs-attention widget (Wave 5) --------------------------------------
       Three things that quietly slip: open cases gone stale (≥14d, matching the
       auto-escalate rule), open cases with no lead detective, and cases stuck in
       the sign-off chain. Derived entirely from the RLS-scoped cases cache, so
       every member sees only their own bureau's slippage. Hidden when clean. */
    function renderAttention() {
      const box = $('#attention-widget'); if (!box) return;
      if (!dbReady()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      const cc = (typeof casesCache !== 'undefined' ? casesCache : []);
      const days = (typeof caseStaleDays === 'function') ? caseStaleDays : () => 0;
      const isOpen = (c) => c.status === 'open' || c.status === 'active';
      const stale = cc.filter((c) => isOpen(c) && days(c) >= 14).sort((a, b) => days(b) - days(a));
      const unassigned = cc.filter((c) => isOpen(c) && !c.lead_detective_id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const sAge = (c) => Math.floor((Date.now() - new Date(c.signoff_submitted_at || c.updated_at).getTime()) / 86400000);
      const awaiting = cc.filter((c) => /^awaiting_/.test(c.signoff_status || '')).sort((a, b) => sAge(b) - sAge(a));
      if (!stale.length && !unassigned.length && !awaiting.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      const row = (c, note, noteTint) => `<button class="att-row flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left transition hover:border-blue-500/30 hover:bg-white/5" data-id="${c.id}"><span class="min-w-0 flex-1 truncate"><span class="font-mono text-xs text-blue-300">${esc(c.case_number)}</span> <span class="text-xs text-slate-300">${esc(c.title || '')}</span></span><span class="flex-shrink-0 text-[10px] font-semibold ${noteTint}">${esc(note)}</span></button>`;
      const col = (icon, title, list, tint, rowsHtml, viewAll) => `<div class="min-w-0 rounded-xl border border-white/5 bg-ink-900/60 p-3">
        <div class="mb-2 flex items-center justify-between"><p class="text-[11px] font-semibold uppercase tracking-wider ${tint}">${icon} ${title} (${list.length})</p>${list.length > 5 && viewAll ? `<button class="att-all text-[11px] font-semibold text-blue-300 hover:text-blue-200" data-go="${viewAll}">all →</button>` : ''}</div>
        ${list.length ? `<div class="space-y-1.5">${rowsHtml}</div>` : '<p class="t-readout text-xs text-slate-600">SYSTEM CLEAR</p>'}</div>`;
      box.classList.remove('hidden');
      box.innerHTML = `<div class="rounded-2xl border border-amber-500/15 bg-ink-900/60 p-4">
        <p class="t-readout mb-3 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80"><span class="t-dot t-dot-amber pulse-dot"></span> Needs attention // what's slipping</p>
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
          ${col('<span class="t-dot t-dot-amber"></span>', 'Stale ≥14d', stale, 'text-amber-300', stale.slice(0, 5).map((c) => row(c, days(c) + 'd quiet', 'text-amber-300')).join(''), 'stale')}
          ${col('<span class="t-dot t-dot-rose"></span>', 'No lead detective', unassigned, 'text-rose-300', unassigned.slice(0, 5).map((c) => row(c, 'unassigned', 'text-rose-300')).join(''), 'unassigned')}
          ${col('<span class="t-dot t-dot-cyan"></span>', 'Stuck in sign-off', awaiting, 'text-blue-300', awaiting.slice(0, 5).map((c) => row(c, sAge(c) + 'd waiting on ' + (officerName(c.signoff_assignee_id) || 'reviewer'), 'text-blue-300')).join(''), 'awaiting')}
        </div>
      </div>`;
      box.querySelectorAll('.att-row').forEach((b) => b.onclick = () => { if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); });
      box.querySelectorAll('.att-all').forEach((b) => b.onclick = () => {
        const go = b.dataset.go;
        if (go === 'awaiting') { setCmdStatus('awaiting'); return; }   // drill stays on Command
        // Stale/unassigned → the Cases list with the matching saved-filter applied.
        // Force 'all' scope: the default 'mine' scope would intersect these
        // bureau-wide lists (esp. unassigned) down to the empty set.
        if (typeof casesScope !== 'undefined') { casesScope = 'all'; if (typeof Store !== 'undefined') Store.set('casesScope', 'all'); }
        if (typeof caseFilters !== 'undefined') {
          caseFilters = { bureau: '', status: '', assignee: go === 'unassigned' ? 'unassigned' : '', stale: go === 'stale' ? 'stale' : '' };
          if (typeof activeViewName !== 'undefined') activeViewName = '';
          if (typeof persistCaseFilters === 'function') persistCaseFilters();
        }
        if (typeof navigate === 'function') navigate('cases');
        if (typeof renderCases === 'function') renderCases();
      });
    }
    function setCmdStatus(s) { CMD_FILTERS.status = (CMD_FILTERS.status === s ? '' : s); syncCmdFilterControls(); refreshCommand(); }
    function renderCmdDrill() {
      const box = $('#cmd-drill'); if (!box) return;
      if (!dbReady() || !cmdFilterActive()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      const cases = cmdFilteredCases().slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      box.classList.remove('hidden');
      const statusPill = (c) => { const s = /^awaiting_/.test(c.signoff_status || '') ? 'awaiting' : (c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete' ? 'DOJ-ready' : c.status); const tint = { open:'bg-blue-500/15 text-blue-300', active:'bg-blue-500/15 text-blue-300', cold:'bg-slate-500/15 text-slate-300', closed:'bg-emerald-500/15 text-emerald-300', awaiting:'bg-amber-500/15 text-amber-300', 'DOJ-ready':'bg-emerald-500/15 text-emerald-300' }[s] || 'bg-white/10 text-slate-300'; return `<span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tint}">${esc(s)}</span>`; };
      box.innerHTML = `<div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-semibold text-white">Matching cases</h3><span class="text-[11px] text-slate-500">${cases.length} result${cases.length === 1 ? '' : 's'}</span></div>` +
        (cases.length ? `<div class="space-y-2">${cases.slice(0, 40).map((c) => `<button class="cmd-drill-row flex w-full items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 text-left transition hover:border-blue-500/30 hover:bg-white/5" data-id="${c.id}"><span class="min-w-0 flex-1"><span class="font-mono text-xs text-blue-300">${esc(c.case_number)}</span> <span class="text-sm text-slate-200">${esc(c.title || '')}</span></span><span class="flex flex-shrink-0 items-center gap-2"><span class="text-[11px] text-slate-500">${esc(c.bureau)}</span>${statusPill(c)}</span></button>`).join('')}</div>${cases.length > 40 ? '<p class="mt-2 text-center text-[11px] text-slate-500">Showing first 40.</p>' : ''}` : '<p class="text-sm text-slate-500">No cases match the current filters.</p>');
      box.querySelectorAll('.cmd-drill-row').forEach((b) => b.onclick = () => { if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); });
    }
    function refreshCommand() { renderKPIs(); renderBureauLoad(); renderBureauScorecards(); const cnt = $('#cmd-f-count'); if (cnt) cnt.textContent = cmdFilterActive() ? cmdFilteredCases().length + ' of ' + (casesCache ? casesCache.length : 0) + ' cases' : ''; }
    function syncCmdFilterControls() {
      const b = $('#cmd-f-bureau'), d = $('#cmd-f-detective'), s = $('#cmd-f-status'), f = $('#cmd-f-from'), t = $('#cmd-f-to');
      if (b) b.value = CMD_FILTERS.bureau; if (d) d.value = CMD_FILTERS.detective; if (s) s.value = CMD_FILTERS.status; if (f) f.value = CMD_FILTERS.from; if (t) t.value = CMD_FILTERS.to;
    }
    function populateDetectiveFilter() {
      const d = $('#cmd-f-detective'); if (!d) return;
      const officers = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
      d.innerHTML = '<option value="">All detectives</option>' + officers.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('');
      d.value = CMD_FILTERS.detective;
    }
    function wireCommandFilters() {
      const bar = $('#cmd-filterbar'); if (!bar) return;
      bar.classList.toggle('hidden', !cmdCanFilter());
      bar.classList.toggle('flex', cmdCanFilter());
      if (!cmdCanFilter()) { Object.keys(CMD_FILTERS).forEach((k) => CMD_FILTERS[k] = ''); return; }
      if (bar.dataset.wired) { populateDetectiveFilter(); syncCmdFilterControls(); return; }
      bar.dataset.wired = '1';
      populateDetectiveFilter();
      const on = (id, key) => { const e = $(id); if (e) e.onchange = () => { CMD_FILTERS[key] = e.value; refreshCommand(); }; };
      on('#cmd-f-bureau', 'bureau'); on('#cmd-f-detective', 'detective'); on('#cmd-f-status', 'status'); on('#cmd-f-from', 'from'); on('#cmd-f-to', 'to');
      const r = $('#cmd-f-reset'); if (r) r.onclick = () => { Object.keys(CMD_FILTERS).forEach((k) => CMD_FILTERS[k] = ''); syncCmdFilterControls(); refreshCommand(); };
    }
    async function fetchKpis() {
      if (dbReady()) { try {
        [RAIDS_CACHE, EVIDENCE_CACHE] = await Promise.all([ DB().list('raid_compensations', {}), DB().list('evidence', {}).catch(() => []) ]);
        SEIZ_TOTAL = RAIDS_CACHE.reduce((a, b) => a + (Number(b.net_value) || 0), 0);
      } catch (e) {} }
      renderKPIs();
    }

    async function fetchTickets() { if (!dbReady()) { renderTickets(); return; } if (!TICKETS_CACHE.length) skeletonTable($('#ticket-table'), 6); try { TICKETS_CACHE = await DB().list('tickets', { order: 'created_at', ascending: false }); } catch (e) { toast('Could not load the ticket queue — check your connection.', 'danger'); } renderTickets(); }
    let ticketState = { sortKey: null, sortDir: 'asc', page: 0 };
    function renderTickets() {
      const mount = $('#ticket-table'); if (!mount) return;
      const canEdit = DB() && DB().canEdit();
      const nb = $('#new-ticket-btn'); if (nb) nb.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { mount.innerHTML = '<p class="px-2 py-6 text-center text-sm text-slate-500">Sign in to view the intake queue.</p>'; return; }
      renderDataTable(mount, {
        rows: TICKETS_CACHE, pageSize: 50,
        sortKey: ticketState.sortKey, sortDir: ticketState.sortDir, page: ticketState.page,
        empty: 'No tickets in the queue.' + (canEdit ? ' Use “+ New Ticket”.' : ''),
        onState: (s) => { ticketState = s; renderTickets(); },
        columns: [
          { key: 'ticket', label: 'Ticket ID', mono: true, sortVal: (t) => t.ticket_code || '', cell: (t) => '<span class="rounded-md bg-ink-800 px-2 py-1 text-xs text-blue-300">' + esc(t.ticket_code) + '</span>' },
          { key: 'source', label: 'Source', sortVal: (t) => t.source || '', cell: (t) => '<span class="inline-flex items-center gap-1.5 text-slate-300"><span class="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>' + esc(t.source || 'Discord') + '</span>' },
          { key: 'desc', label: 'Description', tint: 'text-slate-300', cell: (t) => esc(t.description || '') },
          { key: 'dept', label: 'Reported Dept', sortVal: (t) => t.reported_dept || '', cell: (t) => '<span class="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-200">' + esc(t.reported_dept || '—') + '</span>' },
          { key: 'action', label: 'Action', align: 'right', cell: (t) => t.status === 'processed'
            ? '<span class="rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-mono text-emerald-300">' + esc(caseNumById(t.case_id) || 'processed') + '</span>'
            : (canEdit ? '<button class="process-btn rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110" data-id="' + esc(t.id) + '">Process</button>' : '<span class="text-[11px] text-amber-300">pending</span>') },
        ],
      });
      mount.querySelectorAll('.process-btn[data-id]').forEach((b) => b.onclick = () => { const t = TICKETS_CACHE.find((x) => x.id === b.dataset.id); if (t) openTicketWizard(t); });
    }
    function openNewTicketModal() {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">New Intake Ticket</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Ticket Code *</label><input data-k="ticket_code" value="ticket-${Math.floor(10000 + Math.random() * 89999)}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Source</label><input data-k="source" value="Discord Ticket" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Reported Dept</label><select data-k="reported_dept" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option>LSPD</option><option>BCSO</option><option>SAHP</option></select></div>
          </div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Description *</label><textarea data-k="description" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"></textarea></div>
        </div>
        <button id="tkt-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add to Queue</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#tkt-save').onclick = async () => {
        const p = { status: 'new' }; $$('[data-k]', node).forEach((f) => p[f.dataset.k] = f.value.trim());
        if (!p.ticket_code || !p.description) { toast('Ticket code + description required.', 'warn'); return; }
        const res = await DB().insert('tickets', p);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Ticket queued', 'success'); fetchTickets();
      };
      openModal(node);
    }

    function timeAgo(ts) { const s = (Date.now() - new Date(ts).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
    async function fetchActivity() { if (dbReady()) { try { const r = await DB().from('audit_log').select('*').order('created_at', { ascending: false }).limit(12); AUDIT = r.data || []; } catch (e) {} } renderActivity(); }
    function renderActivity() {
      const f = $('#activity-feed'); if (!f) return;
      if (!dbReady()) { f.innerHTML = '<li class="text-sm text-slate-500">Sign in to view the division activity feed.</li>'; return; }
      if (!AUDIT.length) { f.innerHTML = '<li class="text-sm text-slate-500">No recent activity.</li>'; return; }
      const dot = { INSERT: 'bg-emerald-400', UPDATE: 'bg-blue-400', DELETE: 'bg-rose-400' };
      const verb = { INSERT: 'created', UPDATE: 'updated', DELETE: 'removed' };
      f.innerHTML = '';
      AUDIT.forEach((a) => f.appendChild(el('li', { class: 'flex gap-3' }, `<span class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dot[a.action] || 'bg-slate-400'}"></span><div class="flex-1"><p class="text-sm text-slate-200"><span class="font-semibold text-white">${esc(officerName(a.actor_id) || 'System')}</span> ${verb[a.action] || a.action.toLowerCase()} ${esc((a.entity || '').replace(/_/g, ' '))}</p><p class="text-[11px] text-slate-500">${timeAgo(a.created_at)}</p></div>`)));
    }
    function renderBureauLoad() {
      const w = $('#bureau-load'); if (!w) return;
      const colors = { LSB: 'bg-blue-500', BCB: 'bg-emerald-500', SAB: 'bg-violet-500', JTF: 'bg-amber-500' };
      const names = { LSB: 'Los Santos Bureau', BCB: 'Blaine County Bureau', SAB: 'State Bureau', JTF: 'Joint Task Force' };
      const counts = { LSB: 0, BCB: 0, SAB: 0, JTF: 0 };
      cmdFilteredCases().forEach((c) => { if (counts[c.bureau] != null) counts[c.bureau]++; });
      const max = Math.max(1, counts.LSB, counts.BCB, counts.SAB, counts.JTF);
      w.innerHTML = '';
      ['LSB', 'BCB', 'SAB', 'JTF'].forEach((k) => { const row = el('div', { class: cmdCanFilter() ? 'cursor-pointer' : '', title: cmdCanFilter() ? 'Filter to ' + names[k] : '' }, `<div class="mb-1.5 flex justify-between text-xs"><span class="font-medium ${CMD_FILTERS.bureau === k ? 'text-white' : 'text-slate-300'}">${names[k]}${CMD_FILTERS.bureau === k ? ' ✓' : ''}</span><span class="font-mono text-slate-400">${counts[k]} case${counts[k] === 1 ? '' : 's'}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${colors[k]} transition-all duration-700" style="width:${Math.round(counts[k] / max * 100)}%"></div></div>`);
        if (cmdCanFilter()) row.onclick = () => { CMD_FILTERS.bureau = (CMD_FILTERS.bureau === k ? '' : k); syncCmdFilterControls(); refreshCommand(); };
        w.appendChild(row); });
    }
    // Wave 3: per-bureau performance scorecards. Director/deputy see all bureaus;
    // a bureau lead sees only their own. Computed from the RLS-scoped casesCache,
    // so a viewer never sees numbers for a bureau they aren't cleared for. Standing
    // view (independent of the transient dashboard filters).
    const BUREAU_FULL_NAMES = { LSB: 'Los Santos Bureau', BCB: 'Blaine County Bureau', SAB: 'State Bureau', JTF: 'Joint Task Force' };
    function bureauScore(cases) {
      const open = cases.filter((c) => c.status === 'open' || c.status === 'active').length;
      const closed = cases.filter((c) => c.status === 'closed').length;
      const total = cases.length;
      return { open, closed, total, clearance: total ? Math.round(closed / total * 100) : null, avg: avgResolutionDays(cases) };
    }
    function renderBureauScorecards() {
      const w = $('#bureau-scorecards'); if (!w) return;
      const me = DB() && DB().me;
      const isCommand = !!(me && me.active && CMD_ROLES.includes(me.role));
      if (!dbReady() || !isCommand) { w.classList.add('hidden'); w.innerHTML = ''; return; }
      let keys = ['LSB', 'BCB', 'SAB', 'JTF'];
      if (me.role === 'bureau_lead' && me.division) keys = [me.division];   // profiles use `division`, not `bureau`
      const all = (typeof casesCache !== 'undefined' ? casesCache : []);
      w.classList.remove('hidden');
      w.innerHTML = `<div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Bureau scorecards</h3><span class="text-[11px] text-slate-500">${me.role === 'bureau_lead' ? 'your bureau' : 'all bureaus'} · performance</span></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2${keys.length > 2 ? ' xl:grid-cols-4' : ''}">${keys.map((k) => {
          const s = bureauScore(all.filter((c) => c.bureau === k));
          const clr = s.clearance == null ? '—' : s.clearance + '%';
          const clrTint = s.clearance == null ? 'text-slate-400' : s.clearance >= 60 ? 'text-emerald-300' : s.clearance >= 30 ? 'text-amber-300' : 'text-rose-300';
          const avg = s.avg == null ? '—' : (s.avg < 1 ? '<1d' : s.avg.toFixed(1) + 'd');
          return `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-4">
            <p class="text-sm font-bold text-white">${esc(BUREAU_FULL_NAMES[k] || k)}</p>
            <p class="mt-0.5 text-[11px] text-slate-500">${s.total} case${s.total === 1 ? '' : 's'} on file</p>
            <div class="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><p class="text-2xl font-bold text-white">${s.open}</p><p class="text-[10px] uppercase tracking-wider text-slate-500">Active load</p></div>
              <div><p class="text-2xl font-bold ${clrTint}">${clr}</p><p class="text-[10px] uppercase tracking-wider text-slate-500">Clearance</p></div>
              <div><p class="text-2xl font-bold text-white">${avg}</p><p class="text-[10px] uppercase tracking-wider text-slate-500">Avg close</p></div>
            </div>
          </div>`;
        }).join('')}</div>`;
    }
    /* ---- Crime analytics (Command) -----------------------------------------
       Stat tiles + single-hue magnitude bars, computed from the RLS-scoped
       client caches. One hue per chart (magnitude, not identity); values are
       direct-labeled; labels stay in text tokens. */
    function anBar(label, val, max, hue) {
      const pct = max ? Math.round(val / max * 100) : 0;
      return `<div class="flex items-center gap-3" title="${escapeHTML(label)}: ${val}">
        <span class="w-32 flex-shrink-0 truncate text-xs text-slate-400">${escapeHTML(label)}</span>
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-ink-900"><div class="h-full rounded-full" style="width:${pct}%;background:${hue}"></div></div>
        <span class="w-8 flex-shrink-0 text-right font-mono text-xs text-slate-200">${val}</span>
      </div>`;
    }
    function renderAnalytics() {
      const box = $('#cmd-analytics'); if (!box) return;
      if (!dbReady()) { box.classList.add('hidden'); return; }
      const cases = (typeof casesCache !== 'undefined' ? casesCache : []);
      const persons = (typeof PERSONS !== 'undefined' ? PERSONS : []);
      const gangs = (typeof GANGS !== 'undefined' ? GANGS : []);
      const evidence = (typeof EVIDENCE_CACHE !== 'undefined' ? EVIDENCE_CACHE : []);
      if (!cases.length && !persons.length) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      // Headlines.
      const closed = cases.filter((c) => c.status === 'closed').length;
      const clearance = cases.length ? Math.round(closed / cases.length * 100) : 0;
      const openCases = cases.filter((c) => c.status === 'open' || c.status === 'active').length;
      const bolos = persons.filter((p) => p.bolo).length;
      const ev30 = evidence.filter((e) => e.created_at && (Date.now() - Date.parse(e.created_at)) < 30 * 86400000).length;
      // Cases opened per month (last 6 calendar months).
      const months = [];
      for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }), n: 0 }); }
      cases.forEach((c) => { const k = (c.created_at || '').slice(0, 7); const m = months.find((x) => x.key === k); if (m) m.n++; });
      const mMax = months.reduce((a, m) => Math.max(a, m.n), 0);
      // Evidence by type.
      const byType = {};
      evidence.forEach((e) => { const t = (e.type || 'other').toLowerCase(); byType[t] = (byType[t] || 0) + 1; });
      const types = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const tMax = types.reduce((a, t) => Math.max(a, t[1]), 0);
      // Top gangs by tracked members.
      const byGang = {};
      persons.forEach((p) => { if (p.gang_id) byGang[p.gang_id] = (byGang[p.gang_id] || 0) + 1; });
      const topGangs = Object.entries(byGang).map(([id, n]) => ({ name: (gangs.find((g) => g.id === id) || {}).name || 'Unknown', n })).sort((a, b) => b.n - a.n).slice(0, 6);
      const gMax = topGangs.reduce((a, g) => Math.max(a, g.n), 0);
      const tile = (label, val, sub) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><p class="text-xs uppercase tracking-wider text-slate-400">${escapeHTML(label)}</p><p class="mt-1 text-2xl font-bold text-white">${escapeHTML(String(val))}</p>${sub ? `<p class="mt-0.5 text-[11px] text-slate-500">${escapeHTML(sub)}</p>` : ''}</div>`;
      const panel = (title, inner) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><h4 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">${escapeHTML(title)}</h4><div class="space-y-2">${inner}</div></div>`;
      box.innerHTML = `
        <h4 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">📈 Crime Analytics</h4>
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          ${tile('Clearance rate', clearance + '%', closed + ' of ' + cases.length + ' cases closed')}
          ${tile('Open cases', openCases, 'open + active')}
          ${tile('Active BOLOs', bolos, 'flagged persons at large')}
          ${tile('Evidence (30d)', ev30, 'items logged this month')}
        </div>
        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          ${panel('Cases opened per month', months.map((m) => anBar(m.label, m.n, mMax, '#3b82f6')).join('') || '<p class="text-xs text-slate-500">No data.</p>')}
          ${panel('Evidence by type', types.length ? types.map(([t, n]) => anBar(t, n, tMax, '#10b981')).join('') : '<p class="text-xs text-slate-500">No evidence logged yet.</p>')}
          ${panel('Top gangs by tracked members', topGangs.length ? topGangs.map((g) => anBar(g.name, g.n, gMax, '#8b5cf6')).join('') : '<p class="text-xs text-slate-500">No gang-linked persons yet.</p>')}
        </div>`;
    }
    function onEnterCommand() {
      wireCommandFilters();
      if (typeof renderJumpBack === 'function') renderJumpBack();
      if (dbReady()) {
        fetchTrackers(); fetchTickets(); fetchKpis().then(() => { if (typeof renderAnalytics === 'function') renderAnalytics(); }); fetchActivity(); renderBureauLoad(); renderBureauScorecards();
        // KPIs read PROFILES (activity/detective filter) and PERSONS (persons-of-interest count),
        // which are loaded by onAuthed elsewhere; reload here and re-render so the dashboard is
        // never stuck showing 0 / an empty detective list when Command is the first view entered.
        if (typeof fetchProfiles === 'function') fetchProfiles();
        if (typeof fetchPersons === 'function') fetchPersons().then(() => { renderKPIs(); if (typeof renderAnalytics === 'function') renderAnalytics(); });
      } else { renderKPIs(); renderTickets(); renderActivity(); renderBureauLoad(); renderBureauScorecards(); renderTrackers(); }
    }

    /* ---- Ticket processing wizard ---- */
    function openTicketWizard(ticket) {
      const node = el('div', { class: 'p-6' });
      let routedDept = ticket.reported_dept || 'LSPD';
      let workingId = ticket.ticket_code;

      const step1 = () => {
        node.innerHTML = `
          <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 1 of 3</p><h3 class="text-xl font-bold text-white">Jurisdictional Routing</h3></div><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
          <div class="mb-5 rounded-xl border border-white/10 bg-ink-900 p-4 text-sm"><p class="font-mono text-xs text-blue-300" id="wk-id">${esc(workingId)}</p><p class="mt-1 text-slate-200">${esc(ticket.description || '')}</p><p class="mt-2 text-xs text-slate-400">Originally reported: <span class="font-semibold text-slate-200">${esc(ticket.reported_dept || '—')}</span></p></div>
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
          if (routedDept !== ticket.reported_dept) {
            const renamed = ticket.ticket_code.replace(/^ticket/i, DEPT_ROUTING[routedDept].rename);
            workingId = renamed; node.querySelector('#wk-id').textContent = renamed;
            mis.classList.remove('hidden');
            mis.innerHTML = `⚠️ Misrouted ticket detected. Auto-renaming <span class="font-mono">${esc(ticket.ticket_code)}</span> → <span class="font-mono font-bold">${esc(renamed)}</span> and tagging <b>${routedDept}</b>.`;
          } else { mis.classList.add('hidden'); workingId = ticket.ticket_code; node.querySelector('#wk-id').textContent = ticket.ticket_code; }
        }));
        node.querySelector('#to-step2').onclick = step2;
      };

      const step2 = () => {
        const key = DEPT_ROUTING[routedDept].bureau;
        node.innerHTML = `
          <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 2 of 3</p><h3 class="text-xl font-bold text-white">Case Number Entry</h3></div><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
          <div class="mb-4 rounded-lg border border-white/10 bg-ink-900 p-3 text-xs text-slate-400">Source ticket: <span class="font-mono text-blue-300">${esc(workingId)}</span> · Jurisdiction: <span class="font-semibold text-slate-200">${routedDept}</span></div>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Bureau (auto-selected from jurisdiction)</label>
          <select id="bsel" class="mb-4 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
            ${Object.keys(BUREAUS).map((k) => `<option value="${k}" ${k===key?'selected':''}>${BUREAUS[k].name} — [${BUREAUS[k].prefix}] (${BUREAUS[k].dept})</option>`).join('')}
          </select>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Case Number — type it (format BUREAU-NUMBER)</label>
          <div class="mb-2 flex items-center gap-2"><span id="cpre" class="rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-sm font-semibold text-blue-300"></span><input id="cnum" inputmode="numeric" class="flex-1 rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-badge-500" /></div>
          <p class="mb-5 text-[11px] text-slate-500">LSB→1xxxxx · BCB→2xxxxx · SAB/JTF→9xxxxx. Must be unique.</p>
          <div class="flex gap-3"><button id="back1" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">← Back</button><button id="gen" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white transition hover:brightness-110">Create Case File →</button></div>`;
        const sel = node.querySelector('#bsel'), pre = node.querySelector('#cpre'), num = node.querySelector('#cnum');
        const lead = (k) => ({ LSB: '1', BCB: '2', SAB: '9', JTF: '9' }[k] || '9');
        const sync = () => { pre.textContent = sel.value + '-'; num.placeholder = lead(sel.value) + 'xxxxx'; };
        sync(); sel.onchange = sync;
        node.querySelector('.close-x').onclick = closeModal;
        node.querySelector('#back1').onclick = step1;
        node.querySelector('#gen').onclick = async () => {
          const k = sel.value, numv = num.value.trim();
          if (!/^\d+$/.test(numv)) { toast('Enter the numeric case number (digits only) — the bureau prefix is added automatically.', 'warn'); return; }
          if (numv[0] !== lead(k)) toast(`Note: ${k} case numbers usually start with ${lead(k)} — saving anyway.`, 'warn');
          const full = `${k}-${numv}`;
          let newCaseId = null;
          if (dbReady()) {
            const res = await DB().insert('cases', { case_number: full, title: ticket.description || workingId, bureau: k, status: 'open' });
            if (res.error) { const dup = /duplicate|unique|already exists|23505/i.test(res.error.message || ''); toast(dup ? `Case number ${full} already exists — choose a unique number.` : 'Case create failed: ' + res.error.message, 'danger'); return; }
            newCaseId = res.data && res.data[0] && res.data[0].id;
            if (ticket.id) { const tu = await DB().update('tickets', ticket.id, { status: 'processed', case_id: newCaseId, routed_bureau: k }); if (tu && tu.error) toast('Case created, but the ticket wasn’t marked processed: ' + tu.error.message + ' — re-check the queue.', 'warn'); }
          }
          step3(full, k, newCaseId);
        };
      };

      const step3 = (caseId, key, newCaseId) => {
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
        node.querySelector('#done').onclick = () => { closeModal(); toast(`${caseId} created` + (newCaseId ? ' · saved to Supabase' : ''), 'success'); fetchTickets(); fetchCases(); fetchKpis(); };
      };

      step1(); openModal(node);
    }

    /* ---- Tracker deployment logs (dual signature + countdown) ---- */
    // Trackers are Supabase-backed; PROFILES cache resolves signer names.
    let trackers = [];
    let PROFILES = [];
    const officerName = (id) => { if (!id) return null; const p = PROFILES.find((x) => x.id === id); if (p) return p.display_name; const me = DB() && DB().me; return (me && me.id === id) ? me.display_name : 'Officer'; };
    // profiles.email is column-restricted to command; roster reads omit it and
    // the admin panel pulls addresses via the command-gated admin_member_emails RPC.
    const PROFILE_COLS = 'id,display_name,avatar_url,badge_number,division,role,active,created_at,updated_at,loa,loa_since,discord_id,removed_at';
    let MEMBER_EMAILS = {};
    async function fetchProfiles() {
      if (!dbReady()) return;
      try { PROFILES = await DB().list('profiles', { select: PROFILE_COLS }); } catch (e) {}
      if (DB() && DB().isAdmin && DB().isAdmin()) {
        try { const r = await DB().rpc('admin_member_emails'); if (r && !r.error && Array.isArray(r.data)) { MEMBER_EMAILS = {}; r.data.forEach((x) => { MEMBER_EMAILS[x.id] = x.email; }); } } catch (e) {}
      }
      if (typeof renderAdmin === 'function') renderAdmin();
      if (typeof renderActivity === 'function') renderActivity();
      if (typeof populateDetectiveFilter === 'function') populateDetectiveFilter();
      updatePendingBadge();
    }
    const memberEmail = (id) => (typeof MEMBER_EMAILS !== 'undefined' && MEMBER_EMAILS[id]) || '';
    // Pending-approval alert badge (admins only): count of inactive profiles.
    function updatePendingBadge() {
      const n = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => !p.active && !p.removed_at).length;
      const show = n > 0 && DB() && DB().isAdmin();
      ['#pending-nav-badge', '#pending-bnav-badge'].forEach((sel) => { const b = $(sel); if (!b) return; b.textContent = String(n); b.setAttribute('role', 'status'); b.setAttribute('aria-label', n + ' member' + (n === 1 ? '' : 's') + ' awaiting approval'); b.classList.toggle('hidden', !show); });
    }
    function fmtCountdown(ms) {
      if (ms <= 0) return 'EXPIRED';
      const h = Math.floor(ms/3.6e6), m = Math.floor((ms%3.6e6)/6e4), s = Math.floor((ms%6e4)/1000);
      return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
    const NOTIF_TITLES = { access_requested: 'Case access requested', access_granted: 'Case access granted', access_denied: 'Case access denied', member_approved: 'CID access approved', signoff_waiting: 'Sign-off needed', signoff_approved: 'Sign-off approved', signoff_denied: 'Sign-off denied', signoff_changes: 'Changes requested', signoff_escalated: 'Sign-off escalated', signoff_heads_up: 'Deputy approved a case', announcement: 'New announcement', mention: 'You were mentioned', chat_mention: 'You were mentioned', case_stale: 'Case needs attention', tracker_pending: 'Tracker awaiting co-sign', tracker_authorized: 'Tracker authorized', case_assigned: 'Case assigned', report_finalized: 'Report finalized', rico_ready: 'RICO elements satisfied' };
    function notifTitle(type) { return NOTIF_TITLES[type] || 'CID Portal'; }
    async function notify(userId, type, payload) {
      if (!userId || !dbReady()) return;
      try {
        await DB().rpc('create_notification', { p_user_id: userId, p_type: type, p_payload: payload || {} });
      } catch (e) { return; }
      // Fire-and-forget Discord DM (Edge Function); never blocks the in-app notification.
      try {
        const c = window.CIDDB && window.CIDDB.client;
        if (c && c.functions) {
          const p = payload || {};
          const body = [p.case_number, p.reason || p.detective].filter(Boolean).join(' — ');
          c.functions.invoke('discord-notify', { body: { user_id: userId, type: type, payload: p } }).catch(function () {});
        }
      } catch (e) {}
    }
    function onEnterTrackers() { if (dbReady()) fetchTrackers(); else renderTrackers(); }
    async function fetchTrackers() {
      if (!dbReady()) { renderTrackers(); return; }
      try { trackers = await DB().list('trackers', { order: 'created_at', ascending: false }); renderTrackers(); }
      catch (e) { const w = $('#tracker-list'); if (w) w.innerHTML = '<p class="text-sm text-rose-300">Couldn’t load — ' + escapeHTML(e.message || e) + '</p>'; }
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
            ${canSign ? '<button aria-label="Remove" class="tk-del rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">✕</button>' : ''}
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
        if (dl) dl.addEventListener('click', async () => { if (!(await uiConfirm('Remove tracker ' + t.tracker_code + '?', { confirmText: 'Remove' }))) return; const r = await DB().remove('trackers', t.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } toast('Tracker removed', 'warn'); fetchTrackers(); });
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
        <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Surveillance Authorization</p><h3 class="text-xl font-bold text-white">Deploy GPS Tracker</h3></div><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
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
        const payload = { tracker_code: 'TRK-' + Math.floor(1000 + Math.random() * 9000), target, case_id: caseId, bureau: c ? c.bureau : 'JTF', director_sig: me.id, duration_hours: dur, status: 'pending' };
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
        </div>
        <p class="text-center text-[10px] italic text-slate-500">Local preview — not saved. Record the authorized split on the Raid Seizure Allocation form.</p>`;
    }

