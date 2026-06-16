/* command.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 5. CENTRAL COMMAND ============================================================ */
    /* ---- Central Command (live from Supabase) ---- */
    let TICKETS_CACHE = [], AUDIT = [], SEIZ_TOTAL = 0;
    const KPI_ACCENTS = { blue:'from-blue-500/20 to-blue-700/5 text-blue-300 border-blue-500/20', slate:'from-slate-500/20 to-slate-700/5 text-slate-300 border-slate-500/20', violet:'from-violet-500/20 to-violet-700/5 text-violet-300 border-violet-500/20', emerald:'from-emerald-500/20 to-emerald-700/5 text-emerald-300 border-emerald-500/20' };
    function renderKPIs() {
      const g = $('#kpi-grid'); if (!g) return;
      const live = dbReady();
      const open = casesCache.filter((c) => c.status === 'open' || c.status === 'active').length;
      const cold = casesCache.filter((c) => c.status === 'cold').length;
      const flagged = PERSONS.filter((p) => (p.felony_count || 0) >= 8).length;
      const cards = [
        { label:'Open Cases', value: live ? open : '—', delta: `${casesCache.length} total on file`, icon:'📂', accent:'blue' },
        { label:'Cold Cases', value: live ? cold : '—', delta:'2-week inactivity policy', icon:'🧊', accent:'slate' },
        { label:'Persons of Interest', value: live ? PERSONS.length : '—', delta: `${flagged} ≥8-felony flagged`, icon:'🧑‍⚖️', accent:'violet' },
        { label:'Total Seizures', value: live ? fmtUSD(SEIZ_TOTAL) : '—', delta:'logged raid compensation', icon:'💵', accent:'emerald' },
      ];
      g.innerHTML = '';
      cards.forEach((m) => g.appendChild(el('div', { class:`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${KPI_ACCENTS[m.accent]} p-5 transition hover:shadow-glow` },
        `<div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">${m.label}</p><p class="mt-2 text-3xl font-bold text-white">${m.value}</p><p class="mt-1 text-[11px] text-slate-400">${m.delta}</p></div><span class="text-2xl">${m.icon}</span></div>`)));
    }
    async function fetchKpis() { if (dbReady()) { try { const raids = await DB().list('raid_compensations', {}); SEIZ_TOTAL = raids.reduce((a, b) => a + (Number(b.net_value) || 0), 0); } catch (e) {} } renderKPIs(); }

    async function fetchTickets() { if (!dbReady()) { renderTickets(); return; } try { TICKETS_CACHE = await DB().list('tickets', { order: 'created_at', ascending: false }); } catch (e) {} renderTickets(); }
    function renderTickets() {
      const tb = $('#ticket-tbody'); if (!tb) return;
      const canEdit = DB() && DB().canEdit();
      const nb = $('#new-ticket-btn'); if (nb) nb.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { tb.innerHTML = '<tr><td colspan="5" class="px-6 py-6 text-center text-sm text-slate-500">Sign in to view the intake queue.</td></tr>'; return; }
      if (!TICKETS_CACHE.length) { tb.innerHTML = `<tr><td colspan="5" class="px-6 py-6 text-center text-sm text-slate-500">No tickets in the queue.${canEdit ? ' Use “+ New Ticket”.' : ''}</td></tr>`; return; }
      tb.innerHTML = '';
      TICKETS_CACHE.forEach((t) => {
        const processed = t.status === 'processed';
        const tr = el('tr', { class: 'transition hover:bg-white/5' });
        tr.innerHTML = `
          <td class="px-6 py-4"><span class="rounded-md bg-ink-800 px-2 py-1 font-mono text-xs text-blue-300">${esc(t.ticket_code)}</span></td>
          <td class="px-6 py-4"><span class="inline-flex items-center gap-1.5 text-slate-300"><span class="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>${esc(t.source || 'Discord')}</span></td>
          <td class="px-6 py-4 max-w-md text-slate-300">${esc(t.description || '')}</td>
          <td class="px-6 py-4"><span class="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-200">${esc(t.reported_dept || '—')}</span></td>
          <td class="px-6 py-4 text-right">${processed ? `<span class="rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-mono text-emerald-300">${esc(caseNumById(t.case_id) || 'processed')}</span>` : (canEdit ? '<button class="process-btn rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:brightness-110 active:scale-95">Process Ticket</button>' : '<span class="text-[11px] text-amber-300">pending</span>')}</td>`;
        const pb = tr.querySelector('.process-btn'); if (pb) pb.addEventListener('click', () => openTicketWizard(t));
        tb.appendChild(tr);
      });
    }
    function openNewTicketModal() {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">New Intake Ticket</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
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
    async function fetchActivity() { if (dbReady()) { try { AUDIT = (await DB().list('audit_log', { order: 'created_at', ascending: false })).slice(0, 12); } catch (e) {} } renderActivity(); }
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
      casesCache.forEach((c) => { if (counts[c.bureau] != null) counts[c.bureau]++; });
      const max = Math.max(1, counts.LSB, counts.BCB, counts.SAB, counts.JTF);
      w.innerHTML = '';
      ['LSB', 'BCB', 'SAB', 'JTF'].forEach((k) => w.appendChild(el('div', {}, `<div class="mb-1.5 flex justify-between text-xs"><span class="font-medium text-slate-300">${names[k]}</span><span class="font-mono text-slate-400">${counts[k]} case${counts[k] === 1 ? '' : 's'}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${colors[k]} transition-all duration-700" style="width:${Math.round(counts[k] / max * 100)}%"></div></div>`)));
    }
    function onEnterCommand() { if (dbReady()) { fetchTrackers(); fetchTickets(); fetchKpis(); fetchActivity(); renderBureauLoad(); } else { renderKPIs(); renderTickets(); renderActivity(); renderBureauLoad(); renderTrackers(); } }

    /* ---- Ticket processing wizard ---- */
    function openTicketWizard(ticket) {
      const node = el('div', { class: 'p-6' });
      let routedDept = ticket.reported_dept || 'LSPD';
      let workingId = ticket.ticket_code;

      const step1 = () => {
        node.innerHTML = `
          <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 1 of 3</p><h3 class="text-xl font-bold text-white">Jurisdictional Routing</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
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
        const sync = () => { const b = BUREAUS[sel.value]; pre.textContent = `[${b.prefix}] Case-`; num.value = String(nextCaseNumber(sel.value)); };
        sync(); sel.onchange = sync;
        node.querySelector('.close-x').onclick = closeModal;
        node.querySelector('#back1').onclick = step1;
        node.querySelector('#gen').onclick = async () => {
          const k = sel.value; const full = `[${BUREAUS[k].prefix}] Case-${num.value}`;
          let newCaseId = null;
          if (dbReady()) {
            const res = await DB().insert('cases', { case_number: full, title: ticket.description || workingId, bureau: k, status: 'open' });
            if (res.error) { toast('Case create failed: ' + res.error.message, 'danger'); return; }
            newCaseId = res.data && res.data[0] && res.data[0].id;
            if (ticket.id) await DB().update('tickets', ticket.id, { status: 'processed', case_id: newCaseId, routed_bureau: k });
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
    async function fetchProfiles() { if (!dbReady()) return; try { PROFILES = await DB().list('profiles', {}); } catch (e) {} if (typeof renderAdmin === 'function') renderAdmin(); if (typeof renderActivity === 'function') renderActivity(); }
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

