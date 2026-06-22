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
      if (typeof updateSignoffBadge === 'function') updateSignoffBadge();   // My Desk badge counts unread mentions too
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
          return `<div data-id="${esc(n.id)}" data-read="${n.read ? '1' : ''}" data-case="${linkable ? esc(p.case_id) : ''}" class="notif-row cursor-pointer rounded-lg border ${n.read ? 'border-white/5 bg-ink-900' : 'border-blue-500/20 bg-blue-500/5'} p-3 transition hover:border-blue-500/40">
            <div class="flex items-center justify-between gap-2"><span class="text-sm font-semibold text-white">${esc(NOTIF_LABEL[n.type] || n.type)}</span><span class="flex-shrink-0 text-[11px] text-slate-500">${timeAgo(n.created_at)}</span></div>
            ${detail ? `<p class="mt-0.5 font-mono text-[11px] text-blue-300">${esc(detail)}${p.detective ? ' · ' + esc(p.detective) : ''}</p>` : ''}
            ${sub ? `<p class="mt-1 text-xs text-slate-400">${esc(sub)}</p>` : ''}
            ${linkable ? '<p class="mt-1 text-[11px] font-semibold text-blue-300">View case →</p>' : ''}
          </div>`;
        }).join('') : '<p class="text-sm text-slate-500">No notifications.</p>'}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.notif-row').forEach((row) => {
        row.onclick = async () => {
          if (row.dataset.id && !row.dataset.read) {
            row.dataset.read = '1'; row.classList.remove('border-blue-500/20', 'bg-blue-500/5'); row.classList.add('border-white/5', 'bg-ink-900');
            try { await DB().update('notifications', row.dataset.id, { read: true }); } catch (e) {} fetchNotifications();
          }
          if (row.dataset.case) { closeModal(); if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(row.dataset.case); }
        };
      });
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
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Role</label><select id="adm-role" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director'].map((r) => `<option value="${r}" ${r === p.role ? 'selected' : ''}>${esc(ROLE_LABEL[r] || r)}</option>`).join('')}</select></div>
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

    /* ---- Audit Log viewer (own tab; Bureau Lead and above) ---- */
    let AUDIT_LOG = [];
    function canViewAudit() { const me = DB() && DB().me; return !!(me && me.active && typeof CMD_ROLES !== 'undefined' && CMD_ROLES.includes(me.role)); }
    function onEnterAudit() { if (dbReady()) fetchAuditLog(); else renderAuditLog(); }
    async function fetchAuditLog() {
      if (!dbReady() || !canViewAudit()) { renderAuditLog(); return; }
      try { AUDIT_LOG = await DB().list('audit_log', { order: 'created_at', ascending: false }); } catch (e) { AUDIT_LOG = []; }
      renderAuditLog();
    }
    function renderAuditLog() {
      const wrap = $('#audit-panel'); if (!wrap) return;
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view the audit log.</p>'; return; }
      if (!canViewAudit()) { wrap.innerHTML = '<p class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">Restricted — the audit log is accessible to Bureau Lead and above.</p>'; return; }
      const q = ($('#audit-search') ? $('#audit-search').value : '').trim().toLowerCase();
      const named = (id) => (typeof officerName === 'function' && officerName(id)) || 'System';
      const rows = AUDIT_LOG.filter((r) => !q || [r.action, r.entity, r.entity_id, named(r.actor_id), JSON.stringify(r.detail || '')].join(' ').toLowerCase().includes(q)).slice(0, 200);
      wrap.innerHTML = `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><span class="text-xs text-slate-400">${AUDIT_LOG.length} total · showing ${rows.length}</span><input id="audit-search" value="${esc(q)}" placeholder="Filter action / entity / officer…" class="w-60 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-white outline-none focus:border-badge-500" /></div>
        <div class="max-h-96 overflow-y-auto rounded-lg border border-white/5"><table class="w-full text-left text-xs"><thead class="sticky top-0 bg-ink-900"><tr class="text-[10px] uppercase tracking-wider text-slate-400"><th class="px-3 py-2">When</th><th class="px-3 py-2">Officer</th><th class="px-3 py-2">Action</th><th class="px-3 py-2">Entity</th></tr></thead>
        <tbody class="divide-y divide-white/5">${rows.length ? rows.map((r) => `<tr><td class="whitespace-nowrap px-3 py-1.5 text-slate-400">${new Date(r.created_at).toLocaleString('en-US')}</td><td class="px-3 py-1.5 text-slate-200">${esc(named(r.actor_id))}</td><td class="px-3 py-1.5"><span class="rounded bg-white/5 px-1.5 py-0.5 text-slate-200">${esc(r.action || '')}</span></td><td class="px-3 py-1.5 font-mono text-slate-400">${esc(r.entity || '')}${r.entity_id ? ` <span class="text-slate-600">${esc(String(r.entity_id).slice(0, 8))}</span>` : ''}</td></tr>`).join('') : `<tr><td colspan="4" class="px-3 py-3 text-slate-500">${AUDIT_LOG.length ? 'No entries match.' : 'No audit entries yet.'}</td></tr>`}</tbody></table></div>
      </div>`;
      const se = $('#audit-search'); if (se) se.oninput = (typeof debounce === 'function' ? debounce(renderAuditLog, 150) : renderAuditLog);
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
      if (typeof pdfLetterhead === 'function') y = pdfLetterhead(doc, M);
      line('CASE PACKET — ' + c.case_number, 16, true);
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
      const [cases, persons, gangs, places, narcotics, benches, footprints, docs] = await Promise.all([
        run('cases', ['case_number', 'title', 'summary']),
        run('persons', ['name', 'alias', 'status']),
        run('gangs', ['name', 'colors', 'notes']),
        run('places', ['name', 'area']),
        run('narcotics', ['name', 'classification']),
        run('ballistics_benches', ['name']),
        run('ballistic_footprints', ['signature', 'weapon']),
        run('documents', ['name']),
      ]);
      // Charges are static reference data — filter the in-memory penal catalog.
      const charges = (typeof PENAL_CODE !== 'undefined' ? PENAL_CODE : []).filter((c) => (c.code + ' ' + c.title + ' ' + c.level + ' ' + (c.desc || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 10);
      // Benches + footprints share the Ballistics section, distinguished by icon.
      const ballistics = benches.map((b) => ({ kind: 'bench', label: b.name, sub: b.tier ? 'Tier ' + b.tier + ' bench' : 'Weapon bench' }))
        .concat(footprints.map((f) => ({ kind: 'footprint', label: f.signature, sub: [f.weapon].filter(Boolean).join(' · ') || 'Ballistic footprint' })));
      const sec = (title, items, fmt) => items.length ? `<div><p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">${title} (${items.length})</p><div class="space-y-1">${items.map(fmt).join('')}</div></div>` : '';
      const goto = (tab, term, inner) => `<button class="sr sr-goto block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5" data-tab="${tab}"${term ? ` data-term="${esc(term)}"` : ''}>${inner}</button>`;
      const box = node.querySelector('#search-results');
      const html = [
        sec('Cases', cases, (c) => `<button class="sr sr-case block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5" data-id="${c.id}"><span class="font-mono text-blue-300">${esc(c.case_number)}</span> · ${esc(c.title || '')}</button>`),
        sec('Persons', persons, (p) => goto('persons', p.name, `${esc(p.name)}${p.alias ? ' “' + esc(p.alias) + '”' : ''}`)),
        sec('Gangs', gangs, (g) => goto('gangs', g.name, `🚩 ${esc(g.name)}`)),
        sec('Places', places, (p) => goto('places', p.name, `📍 ${esc(p.name)} <span class="text-slate-500">${esc(p.area || '')}</span>`)),
        sec('Narcotics', narcotics, (n) => goto('narcotics', n.name, `💊 ${esc(n.name)}${n.classification ? ' <span class="text-slate-500">' + esc(n.classification) + '</span>' : ''}`)),
        sec('Ballistics', ballistics, (b) => goto('ballistics', '', `${b.kind === 'bench' ? '🔫' : '🧬'} ${esc(b.label || '')} <span class="text-slate-500">${esc(b.sub || '')}</span>`)),
        sec('Drive documents', docs, (d) => goto('drive', '', `📄 ${esc(d.name)}`)),
        sec('Charges', charges, (c) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">⚖️ <span class="font-mono text-blue-300">${esc(c.code)}</span> ${esc(c.title)} <span class="text-slate-500">· ${esc(c.level)} · ${penalSentence(c.jail)}${c.fine != null ? ' · ' + fmtUSD(c.fine) : ''}</span></div>`),
      ].join('');
      box.innerHTML = html || '<p class="text-sm text-slate-500">No matches across cases, persons, gangs, places, narcotics, ballistics, Drive docs or charges.</p>';
      box.querySelectorAll('.sr-case').forEach((b) => b.onclick = () => { closeModal(); navigate('cases'); setTimeout(() => openCaseDetail(b.dataset.id), 120); });
      box.querySelectorAll('.sr-goto').forEach((b) => b.onclick = () => {
        closeModal(); navigate(b.dataset.tab);
        const sel = { persons: '#person-search', gangs: '#gang-search' }[b.dataset.tab];
        if (sel && b.dataset.term) setTimeout(() => { const inp = $(sel); if (inp) { inp.value = b.dataset.term; inp.dispatchEvent(new Event('input', { bubbles: true })); } }, 140);
      });
    }

    /* ---- Command palette (Cmd/Ctrl-K): instant, keyboard-driven jump to any
     * case / person / gang / place / narcotic / Drive doc / charge across the
     * in-memory caches; recent cases when empty. Complements the deep server
     * search on the top bar (Enter). ------------------------------------------ */
    let palItems = [], palSel = 0;
    function openPaletteCase(id) { closePalette(); navigate('cases'); setTimeout(() => openCaseDetail(id), 120); }
    function paletteSources(q) {
      const ql = q.toLowerCase(); const out = [];
      const cc = (typeof casesCache !== 'undefined' ? casesCache : []);
      const match = (s) => s && String(s).toLowerCase().includes(ql);
      const push = (arr, max, fn) => arr.filter(Boolean).slice(0, max).forEach((x) => out.push(fn(x)));
      if (!ql) {
        const ids = [...new Set([...(typeof pinnedCaseIds === 'function' ? pinnedCaseIds() : []), ...(typeof recentCaseIds === 'function' ? recentCaseIds() : [])])];
        push(ids.map((id) => cc.find((c) => c.id === id)), 8, (c) => ({ icon: '📁', label: c.case_number + ' · ' + (c.title || ''), sub: 'Recent case', act: () => openPaletteCase(c.id) }));
        return out;
      }
      push(cc.filter((c) => match(c.case_number) || match(c.title) || match(c.summary)), 6, (c) => ({ icon: '📁', label: c.case_number + ' · ' + (c.title || ''), sub: 'Case', act: () => openPaletteCase(c.id) }));
      push((typeof PERSONS !== 'undefined' ? PERSONS : []).filter((p) => match(p.name) || match(p.alias)), 6, (p) => ({ icon: '👤', label: p.name + (p.alias ? ' “' + p.alias + '”' : ''), sub: 'Person', act: () => { closePalette(); if (typeof openIntelProfile === 'function') openIntelProfile('person', p.id); } }));
      push((typeof GANGS !== 'undefined' ? GANGS : []).filter((g) => match(g.name)), 5, (g) => ({ icon: '🚩', label: g.name, sub: 'Gang', act: () => { closePalette(); if (typeof openIntelProfile === 'function') openIntelProfile('gang', g.id); } }));
      push((typeof PLACES !== 'undefined' ? PLACES : []).filter((p) => match(p.name) || match(p.area)), 5, (p) => ({ icon: '📍', label: p.name, sub: 'Place' + (p.area ? ' · ' + p.area : ''), act: () => { closePalette(); navigate('places'); } }));
      push((typeof DRUGS !== 'undefined' ? DRUGS : []).filter((d) => match(d.name) || match(d.classification)), 4, (d) => ({ icon: '💊', label: d.name, sub: 'Narcotic', act: () => { closePalette(); navigate('narcotics'); } }));
      push((typeof DOCS !== 'undefined' ? DOCS : []).filter((d) => match(d.name)), 5, (d) => ({ icon: '📄', label: d.name, sub: 'Drive document', act: () => { closePalette(); navigate('drive'); } }));
      push((typeof PENAL_CODE !== 'undefined' ? PENAL_CODE : []).filter((c) => match(c.code) || match(c.title)), 6, (c) => ({ icon: '⚖️', label: c.code + ' · ' + c.title, sub: 'Charge · ' + c.level, act: () => { closePalette(); toast(c.code + ' ' + c.title + ' — ' + c.level + ' · ' + penalSentence(c.jail) + (c.fine != null ? ' · ' + fmtUSD(c.fine) : ''), 'info'); } }));
      push((typeof BENCHES_CACHE !== 'undefined' ? BENCHES_CACHE : []).filter((b) => match(b.name)), 3, (b) => ({ icon: '🔫', label: b.name, sub: 'Ballistics bench', act: () => { closePalette(); navigate('ballistics'); } }));
      return out;
    }
    function renderPalette(q) {
      palItems = paletteSources(q); palSel = 0;
      const list = $('#cmdk-list'); if (!list) return;
      list.innerHTML = palItems.length
        ? palItems.map((it, i) => `<button class="cmdk-row flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === palSel ? 'bg-blue-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}" data-i="${i}"><span>${it.icon}</span><span class="min-w-0 flex-1 truncate">${esc(it.label)}</span><span class="flex-shrink-0 text-[11px] text-slate-500">${esc(it.sub || '')}</span></button>`).join('')
        : `<p class="px-3 py-6 text-center text-sm text-slate-500">${q ? 'No matches.' : 'Type to search, or open a recent case.'}</p>`;
      $$('.cmdk-row', list).forEach((b) => b.onclick = () => { const it = palItems[+b.dataset.i]; if (it) it.act(); });
    }
    function palMove(d) {
      if (!palItems.length) return; palSel = (palSel + d + palItems.length) % palItems.length;
      const list = $('#cmdk-list'); $$('.cmdk-row', list).forEach((b, i) => { b.classList.toggle('bg-blue-500/15', i === palSel); b.classList.toggle('text-white', i === palSel); });
      const sel = list.querySelector(`.cmdk-row[data-i="${palSel}"]`); if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    function closePalette() { const c = $('#cmdk'); if (c) c.remove(); }
    function openPalette() {
      if ($('#cmdk')) return;
      if (!dbReady()) { const b = $('#global-search'); if (b) b.focus(); return; }
      const back = el('div', { id: 'cmdk', class: 'fixed inset-0 z-[60] flex items-start justify-center bg-ink-950/70 p-4 pt-[12vh] backdrop-blur-sm' });
      const panel = el('div', { class: 'w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-glow' });
      panel.innerHTML = `<input id="cmdk-input" type="text" placeholder="Search cases, people, gangs, places, charges, docs…" class="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white outline-none" autocomplete="off" />
        <div id="cmdk-list" class="max-h-[55vh] overflow-y-auto p-1.5"></div>
        <div class="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500">↑↓ navigate · ↵ open · esc close</div>`;
      back.appendChild(panel); document.body.appendChild(back);
      const input = $('#cmdk-input');
      input.addEventListener('input', () => renderPalette(input.value.trim()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = palItems[palSel]; if (it) it.act(); }
        else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      });
      back.addEventListener('click', (e) => { if (e.target === back) closePalette(); });
      renderPalette(''); input.focus();
    }

    /* ============================================================ 13. CLOCK + BOOT ============================================================ */
    function tickClock() { $('#clock').textContent = 'Secure link · ' + new Date().toLocaleTimeString('en-US', { hour12:false }); }

    function init() {
      if (typeof setupConnectionWatch === 'function') setupConnectionWatch();
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
      // Reports authoring now lives inside each case's Reports tab (Case Files).
      // RICO
      fillCaseSelect($('#rico-case')); $('#rico-case').addEventListener('change', renderRico); $('#rico-export').addEventListener('click', exportRicoDocx); renderRico();
      // Drive
      renderDrive();
      // Live CID Records (Supabase)
      initRecords();
      // Case Files (Supabase spine) — fetch happens via onAuthed / onEnterCases
      initCases();
      // Sign-off Inbox (Oversight) — badge + per-user case buckets
      initInbox();
      // Chrome
      $('#notif-bell').addEventListener('click', openNotifications);
      tickClock(); setInterval(tickClock, 1000); setInterval(tickTrackers, 1000);

      // Deep-link support: #case=<id> opens that case directly; otherwise route to the tab.
      function openFromHash() {
        const raw = (location.hash || '').replace('#', '');
        const m = /^case=(.+)$/.exec(raw);
        if (m) { if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(decodeURIComponent(m[1])); return true; }
        return false;
      }
      if (!openFromHash()) { const hash = (location.hash || '').replace('#', ''); navigate(PAGE_META[hash] ? hash : Store.get('tab', 'command')); }
      window.addEventListener('hashchange', openFromHash);

      $('#global-search').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = e.target.value.trim();
        if (q.length >= 2 && dbReady()) { supaSearch(q); return; }
        toast('Type at least 2 characters (and sign in) to search.', 'info');
      });
      // QoL: press "/" anywhere (outside a field) to jump to global search.
      document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        const box = $('#global-search'); if (box) { e.preventDefault(); box.focus(); box.select(); }
      });
      // Cmd/Ctrl-K opens the instant command palette anywhere.
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); }
      });
    }
    document.addEventListener('DOMContentLoaded', init);
