/* app.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 15. NOTIFICATIONS / ADMIN / CASE PACKET / SEARCH ============================================================ */
    let NOTIFS = [];
    const NOTIF_LABEL = { tracker_pending: 'Tracker awaiting co-sign', tracker_authorized: 'Tracker authorized', case_assigned: 'Case assigned', report_finalized: 'Report finalized', rico_ready: 'RICO elements satisfied', signoff_waiting: 'Case awaiting your sign-off', signoff_approved: 'Case sign-off approved', signoff_denied: 'Case sign-off denied', signoff_changes: 'Sign-off — changes requested', signoff_escalated: 'Case auto-escalated (LOA)', signoff_heads_up: 'Deputy approved a case', chat_mention: 'You were mentioned', access_requested: 'Case access requested', access_granted: 'Case access granted', access_denied: 'Case access denied', announcement: '📣 Announcement' };
    async function fetchNotifications() {
      if (!dbReady()) return;
      try { NOTIFS = await DB().list('notifications', { order: 'created_at', ascending: false }); } catch (e) { NOTIFS = []; }
      const unread = NOTIFS.filter((n) => !n.read).length;
      const bell = $('#notif-bell'), badge = $('#notif-badge');
      if (bell) bell.classList.remove('hidden');
      if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.classList.toggle('hidden', unread === 0); }
    }
    function openNotifications() {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Notifications</h3><div class="flex items-center gap-2">${NOTIFS.some((n) => !n.read) ? '<button id="notif-readall" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10">Mark all read</button>' : ''}<button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div></div>
        <div class="space-y-2">${NOTIFS.length ? NOTIFS.map((n) => {
          const p = n.payload || {};
          const detail = p.case_number || p.tracker_code || p.target;
          const sub = p.reason || [p.tracker_code, p.target].filter(Boolean).join(' · ');
          const linkable = !!p.case_id;
          return `<div data-case="${linkable ? esc(p.case_id) : ''}" class="notif-row rounded-lg border ${n.read ? 'border-white/5 bg-ink-900' : 'border-blue-500/20 bg-blue-500/5'} p-3 ${linkable ? 'cursor-pointer transition hover:border-blue-500/40' : ''}">
            <div class="flex items-center justify-between gap-2"><span class="text-sm font-semibold text-white">${esc(NOTIF_LABEL[n.type] || n.type)}</span><span class="flex-shrink-0 text-[11px] text-slate-500">${timeAgo(n.created_at)}</span></div>
            ${detail ? `<p class="mt-0.5 font-mono text-[11px] text-blue-300">${esc(detail)}${p.detective ? ' · ' + esc(p.detective) : ''}</p>` : ''}
            ${sub ? `<p class="mt-1 text-xs text-slate-400">${esc(sub)}</p>` : ''}
            ${linkable ? '<p class="mt-1 text-[11px] font-semibold text-blue-300">View case →</p>' : ''}
          </div>`;
        }).join('') : '<p class="text-sm text-slate-500">No notifications.</p>'}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.notif-row[data-case]').forEach((row) => { if (!row.dataset.case) return; row.onclick = () => { closeModal(); if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(row.dataset.case); }; });
      const ra = node.querySelector('#notif-readall');
      if (ra) ra.onclick = async () => { const ids = NOTIFS.filter((n) => !n.read).map((n) => n.id); for (const id of ids) { try { await DB().update('notifications', id, { read: true }); } catch (e) {} } toast('Marked read', 'info'); closeModal(); fetchNotifications(); };
      openModal(node);
    }

    /* ---- Member administration (Director / Command) ---- */
    function renderAdmin() {
      const wrap = $('#admin-panel'); if (!wrap) return;
      if (!(DB() && DB().isAdmin())) { wrap.classList.add('hidden'); return; }
      wrap.classList.remove('hidden');
      const rows = PROFILES.slice().sort((a, b) => Number(a.active) - Number(b.active));
      wrap.innerHTML = `
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <h4 class="mb-1 text-sm font-semibold uppercase tracking-wider text-amber-300/80">⚙️ Member Administration (Director / Command)</h4>
          <p class="mb-4 text-xs text-slate-400">Approve and assign officers. New sign-ins are inactive until activated.</p>
          <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="text-[11px] uppercase tracking-wider text-slate-400"><th class="px-3 py-2">Officer</th><th class="px-3 py-2">Role</th><th class="px-3 py-2">Bureau</th><th class="px-3 py-2">Active</th><th class="px-3 py-2"></th></tr></thead>
          <tbody class="divide-y divide-white/5">${rows.map((p) => `<tr class="${p.active ? '' : 'bg-amber-500/5'}"><td class="px-3 py-2"><p class="text-white">${esc(p.display_name)} ${p.loa ? '<span class="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">On LOA</span>' : ''}</p><p class="text-[11px] text-slate-500">${esc(p.email || '')}</p></td><td class="px-3 py-2 text-slate-300">${esc(ROLE_LABEL[p.role] || p.role)}</td><td class="px-3 py-2 text-slate-300">${esc(p.division)}</td><td class="px-3 py-2">${p.active ? '<span class="text-emerald-300">Yes</span>' : '<span class="text-amber-300">Pending</span>'}</td><td class="px-3 py-2 text-right">${p.active ? '' : `<button class="adm-approve mr-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20" data-id="${p.id}">✓ Approve</button>`}<button class="adm-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10" data-id="${p.id}">Manage</button></td></tr>`).join('') || '<tr><td colspan="5" class="px-3 py-3 text-slate-500">No profiles yet.</td></tr>'}</tbody></table></div>
        </div>`;
      wrap.querySelectorAll('.adm-edit').forEach((b) => b.onclick = () => openAssignModal(PROFILES.find((p) => p.id === b.dataset.id)));
      // One-click approve for pending sign-ins (keeps their current role/bureau; flips active=true).
      wrap.querySelectorAll('.adm-approve').forEach((b) => b.onclick = async () => {
        const p = PROFILES.find((x) => x.id === b.dataset.id); if (!p) return;
        const res = await DB().rpc('assign_member', { target: p.id, new_role: p.role, new_division: p.division || null, set_active: true });
        if (res.error) { toast('Approve failed: ' + res.error.message, 'danger'); return; }
        toast(`${p.display_name} approved for access`, 'success');
        if (typeof notify === 'function') notify(p.id, 'member_approved', { detective: (DB().me && DB().me.display_name) || 'Command', reason: 'Your CID access has been approved — welcome aboard.' });
        fetchProfiles().then(renderAdmin);
      });
    }
    function openAssignModal(p) {
      if (!p) return;
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Manage Officer</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-[11px] text-slate-500">${esc(p.email || '')}</p>
        <div class="mb-3 grid grid-cols-2 gap-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Display Name</label><input id="adm-name" value="${esc(p.display_name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Badge #</label><input id="adm-badge" value="${esc(p.badge_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Role</label><select id="adm-role" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['detective', 'senior_detective', 'bureau_lead', 'supervisor', 'deputy_director', 'command', 'director'].map((r) => `<option value="${r}" ${r === p.role ? 'selected' : ''}>${esc(ROLE_LABEL[r] || r)}</option>`).join('')}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bureau</label><select id="adm-bureau" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['LSB', 'BCB', 'SAB', 'JTF'].map((b) => `<option ${b === p.division ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        </div>
        <label class="mt-3 flex items-center gap-2 text-sm text-slate-200"><input id="adm-active" type="checkbox" ${p.active ? 'checked' : ''} class="accent-emerald-500" /> Active (approved for access)</label>
        <label class="mt-2 flex items-center gap-2 text-sm text-slate-200"><input id="adm-loa" type="checkbox" ${p.loa ? 'checked' : ''} class="accent-amber-500" /> On LOA (Leave of Absence) — informational; auto-routes sign-offs around this officer</label>
        <button id="adm-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#adm-save').onclick = async () => {
        const res = await DB().rpc('assign_member', { target: p.id, new_role: node.querySelector('#adm-role').value, new_division: node.querySelector('#adm-bureau').value, set_active: node.querySelector('#adm-active').checked });
        if (res.error) { toast('Update failed: ' + res.error.message, 'danger'); return; }
        const nm = node.querySelector('#adm-name').value.trim(), bd = node.querySelector('#adm-badge').value.trim();
        if (nm !== (p.display_name || '') || bd !== (p.badge_number || '')) {
          const pr = await DB().update('profiles', p.id, { display_name: nm || p.display_name, badge_number: bd || null });
          if (pr.error) toast('Name/badge save failed: ' + pr.error.message, 'warn');
        }
        const loaWanted = node.querySelector('#adm-loa').checked;
        if (loaWanted !== !!p.loa && typeof setOfficerLoa === 'function') { const lr = await setOfficerLoa(p.id, loaWanted); if (lr && lr.error) { toast('Role saved; LOA update failed: ' + lr.error.message, 'warn'); } }
        closeModal(); toast('Member updated', 'success'); fetchProfiles().then(renderAdmin);
      };
      openModal(node);
    }

    /* ---- Full case packet export (.docx) ---- */
    // Gather all linked records for a case (used by every packet format).
    async function gatherCasePacket(c) {
      let ev = [], rep = [], cust = [], rico = [], preds = [], media = [];
      try {
        [ev, rep, media] = await Promise.all([
          DB().list('evidence', { order: 'created_at', ascending: true, eq: { case_id: c.id } }),
          DB().list('reports', { order: 'created_at', ascending: true, eq: { case_id: c.id } }),
          DB().list('media', { eq: { case_id: c.id } }),
        ]);
        const ricoRows = await DB().list('rico_cases', { eq: { case_id: c.id } }); rico = ricoRows;
        if (ricoRows[0]) preds = await DB().list('predicate_acts', { eq: { rico_case_id: ricoRows[0].id } });
      } catch (e) {}
      return { ev, rep, cust, rico, preds, media };
    }
    const slug = (s) => String(s || 'case').replace(/[^a-z0-9]/gi, '-');

    function packetDocx(c, d) {
      const P = [{ text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' }, { text: 'CASE PACKET — ' + c.case_number, style: 'title' }, { text: `${c.title || ''} · ${c.bureau} · ${String(c.status).toUpperCase()} · prepared ${new Date().toLocaleString('en-US')}`, style: 'subtitle' }, { text: '', style: 'normal' }];
      P.push({ text: 'Summary', style: 'heading' }); P.push({ text: c.summary || '—', style: 'normal' });
      P.push({ text: `Evidence (${d.ev.length})`, style: 'heading' });
      d.ev.length ? d.ev.forEach((e) => P.push({ text: `• ${(e.item_code ? e.item_code + ' — ' : '') + (e.description || e.type || 'item')} [${e.tamper}]`, style: 'normal' })) : P.push({ text: 'None.', style: 'normal' });
      P.push({ text: `Reports (${d.rep.length})`, style: 'heading' });
      d.rep.length ? d.rep.forEach((r) => P.push({ text: `• ${reportTitle(r)}${r.finalized ? ' (finalized)' : ''} — ${new Date(r.created_at).toLocaleDateString('en-US')}`, style: 'normal' })) : P.push({ text: 'None.', style: 'normal' });
      P.push({ text: `Media (${d.media.length})`, style: 'heading' });
      d.media.length ? d.media.forEach((m) => P.push({ text: `• ${m.title || m.type} — ${m.external_url || m.storage_path || ''}`, style: 'normal' })) : P.push({ text: 'None.', style: 'normal' });
      P.push({ text: 'RICO', style: 'heading' });
      P.push({ text: d.rico[0] ? `Enterprise linked; ${d.preds.length} predicate act(s).` : 'No RICO tracker for this case.', style: 'normal' });
      P.push({ text: '', style: 'normal' }); P.push({ text: 'Generated by the CID Portal. For internal investigative use.', style: 'subtitle' });
      downloadDocx('Case Packet — ' + c.case_number, P, slug(c.case_number) + '-packet.docx');
    }
    function packetPdf(c, d) {
      const J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('PDF library unavailable (offline). Use .docx or Excel.', 'warn'); return false; }
      const doc = new J({ unit: 'pt', format: 'letter' }); const M = 54; let y = M;
      const W = doc.internal.pageSize.getWidth() - M * 2;
      const line = (t, sz, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(sz); const lines = doc.splitTextToSize(String(t), W); lines.forEach((ln) => { if (y > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; } doc.text(ln, M, y); y += sz + 4; }); };
      line('CRIMINAL INVESTIGATION DIVISION', 9, false); line('CASE PACKET — ' + c.case_number, 16, true);
      line(`${c.title || ''} · ${c.bureau} · ${String(c.status).toUpperCase()} · ${new Date().toLocaleString('en-US')}`, 9, false); y += 6;
      line('Summary', 12, true); line(c.summary || '—', 10, false); y += 4;
      line(`Evidence (${d.ev.length})`, 12, true); d.ev.length ? d.ev.forEach((e) => line(`• ${(e.item_code ? e.item_code + ' — ' : '') + (e.description || e.type || 'item')} [${e.tamper}]`, 10, false)) : line('None.', 10, false); y += 4;
      line(`Reports (${d.rep.length})`, 12, true); d.rep.length ? d.rep.forEach((r) => line(`• ${reportTitle(r)}${r.finalized ? ' (finalized)' : ''} — ${new Date(r.created_at).toLocaleDateString('en-US')}`, 10, false)) : line('None.', 10, false); y += 4;
      line(`Media (${d.media.length})`, 12, true); d.media.length ? d.media.forEach((m) => line(`• ${m.title || m.type} — ${m.external_url || m.storage_path || ''}`, 10, false)) : line('None.', 10, false); y += 4;
      line('RICO', 12, true); line(d.rico[0] ? `Enterprise linked; ${d.preds.length} predicate act(s).` : 'No RICO tracker for this case.', 10, false);
      doc.save(slug(c.case_number) + '-packet.pdf'); return true;
    }
    function packetXlsx(c, d) {
      if (!window.XLSX) { toast('Excel library unavailable (offline). Use .docx or PDF.', 'warn'); return false; }
      const X = window.XLSX; const wb = X.utils.book_new();
      const overview = [['Case Number', c.case_number], ['Title', c.title || ''], ['Bureau', c.bureau], ['Lifecycle', c.status], ['Sign-off', c.signoff_status || 'none'], ['Summary', c.summary || ''], ['Prepared', new Date().toLocaleString('en-US')]];
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(overview), 'Case');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(d.ev.map((e) => ({ item_code: e.item_code, type: e.type, description: e.description, location: e.location, tamper: e.tamper, collected_at: e.collected_at }))), 'Evidence');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(d.rep.map((r) => ({ kind: r.kind, template: r.template, seq: r.seq, finalized: r.finalized, created_at: r.created_at }))), 'Reports');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(d.media.map((m) => ({ title: m.title, type: m.type, url: m.external_url || m.storage_path }))), 'Media');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(d.preds.map((p) => ({ statute: p.statute, description: p.description, occurred_at: p.occurred_at }))), 'RICO_Predicates');
      X.writeFile(wb, slug(c.case_number) + '-packet.xlsx'); return true;
    }
    function exportCasePacket(c) {
      if (!c) return;
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Export Case Packet</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-4 text-sm text-slate-400">${esc(c.case_number)} — includes the case, all evidence, reports, media and RICO predicates.</p>
        <div class="grid grid-cols-3 gap-2">
          <button data-fmt="docx" class="pk-fmt rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10">📄<br>.docx</button>
          <button data-fmt="pdf" class="pk-fmt rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10">📕<br>.pdf</button>
          <button data-fmt="xlsx" class="pk-fmt rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10">📊<br>.xlsx</button>
        </div>
        <div id="pk-msg" class="mt-3 text-xs text-slate-400"></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.pk-fmt').forEach((b) => b.onclick = async () => {
        const fmt = b.dataset.fmt; const m = node.querySelector('#pk-msg'); m.textContent = 'Exporting…';
        const d = await gatherCasePacket(c);
        let ok = true;
        if (fmt === 'docx') packetDocx(c, d); else if (fmt === 'pdf') ok = packetPdf(c, d); else ok = packetXlsx(c, d);
        if (ok) { m.textContent = 'Ready — download started.'; toast('Case packet exported (.' + fmt + ')', 'success'); closeModal(); }
        else { m.textContent = ''; }
      });
      openModal(node);
    }

    /* ---- Global search across Supabase ---- */
    async function supaSearch(q) {
      if (!dbReady()) { toast('Sign in to search.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `<div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Search “${esc(q)}”</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div><div id="search-results" class="space-y-4"><p class="text-sm text-slate-500">Searching…</p></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      openModal(node, { wide: true });
      const like = '%' + q + '%';
      const run = (tbl, cols, col) => DB().from(tbl).select('*').or(cols.map((c) => `${c}.ilike.${like}`).join(',')).limit(8).then((r) => r.data || []).catch(() => []);
      const [cases, persons, gangs, places] = await Promise.all([
        run('cases', ['case_number', 'title', 'summary']),
        run('persons', ['name', 'alias', 'status']),
        run('gangs', ['name', 'colors', 'notes']),
        run('places', ['name', 'area']),
      ]);
      const sec = (title, items, fmt) => items.length ? `<div><p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">${title} (${items.length})</p><div class="space-y-1">${items.map(fmt).join('')}</div></div>` : '';
      const box = node.querySelector('#search-results');
      const html = [
        sec('Cases', cases, (c) => `<button class="sr sr-case block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5" data-id="${c.id}"><span class="font-mono text-blue-300">${esc(c.case_number)}</span> · ${esc(c.title || '')}</button>`),
        sec('Persons', persons, (p) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">${esc(p.name)}${p.alias ? ' “' + esc(p.alias) + '”' : ''}</div>`),
        sec('Gangs', gangs, (g) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">🚩 ${esc(g.name)}</div>`),
        sec('Places', places, (p) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">📍 ${esc(p.name)} <span class="text-slate-500">${esc(p.area || '')}</span></div>`),
      ].join('');
      box.innerHTML = html || '<p class="text-sm text-slate-500">No matches across cases, persons, gangs or places.</p>';
      box.querySelectorAll('.sr-case').forEach((b) => b.onclick = () => { closeModal(); navigate('cases'); setTimeout(() => openCaseDetail(b.dataset.id), 120); });
    }

    /* ============================================================ 13. CLOCK + BOOT ============================================================ */
    function tickClock() { $('#clock').textContent = 'Secure link · ' + new Date().toLocaleTimeString('en-US', { hour12:false }); }

    function init() {
      wireDrawer(); wireCollapse(); wireAllImports();
      // Central command
      renderKPIs(); renderTickets(); renderActivity(); renderBureauLoad();
      renderTrackers(); $('#new-tracker').addEventListener('click', openTrackerModal);
      $('#new-ticket-btn').addEventListener('click', openNewTicketModal);
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
      // Personnel + evidence vault (Supabase) — fetch via onAuthed / onEnterPersonnel
      renderRoster(); renderCommendations(); renderMediaFilters(); renderMedia();
      $('#add-media').addEventListener('click', openMediaModal);
      $('#add-commend').addEventListener('click', () => openCommendModal(null));
      // M.O. (Supabase) — profiles fetched via onAuthed / onEnterModus
      $('#mo-run').addEventListener('click', renderMO);
      $('#mo-sample').addEventListener('click', () => { $('#mo-input').value = SAMPLE_MO; renderMO(); });
      $('#mo-save').addEventListener('click', openMoSaveModal);
      // Gangs (Supabase) + Persons (Supabase) — fetch via onAuthed / onEnter*
      $('#add-gang').addEventListener('click', () => openGangModal(null));
      $('#gang-refresh').addEventListener('click', fetchGangs);
      $('#gang-search').addEventListener('input', debounce(renderGangs, 180));
      $('#person-new').addEventListener('click', () => openPersonModal(null));
      $('#person-refresh').addEventListener('click', fetchPersons);
      $('#person-search').addEventListener('input', debounce(renderPersons, 180));
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
      $('#notif-bell').addEventListener('click', openNotifications);
      tickClock(); setInterval(tickClock, 1000); setInterval(tickTrackers, 1000);

      const hash = (location.hash || '').replace('#','');
      navigate(PAGE_META[hash] ? hash : Store.get('tab', 'command'));

      $('#global-search').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = e.target.value.trim();
        if (q.length >= 2 && dbReady()) { supaSearch(q); return; }
        toast('Type at least 2 characters (and sign in) to search.', 'info');
      });
    }
    document.addEventListener('DOMContentLoaded', init);
